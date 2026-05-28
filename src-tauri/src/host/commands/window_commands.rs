//! # 窗口效果宿主命令模块
//!
//! 提供 Tauri `command` 包装层，负责接收前端下发的窗口原生效果参数、
//! 应用 reload 请求，并同步治理窗口与宿主运行时资源。

use crate::host::window_effects::{self, WindowsAcrylicEffectConfig};
use crate::state::AppState;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Instant;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

pub(crate) const WINDOW_COMMAND_IDS: &[&str] = &[
    "update_main_window_acrylic_effect",
    "reload_current_window",
    "create_detached_tab_window",
];

static DETACHED_WINDOW_SEQUENCE: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetachedTabWindowTab {
    pub id: String,
    pub title: String,
    pub component: String,
    #[serde(default)]
    pub params: Option<Value>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateDetachedTabWindowRequest {
    pub tab: DetachedTabWindowTab,
    #[serde(default)]
    pub screen_x: Option<f64>,
    #[serde(default)]
    pub screen_y: Option<f64>,
}

fn next_detached_window_label() -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();
    let sequence = DETACHED_WINDOW_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    format!("ofive-detached-{millis}-{sequence}")
}

fn encode_detached_tab_for_url(tab: &DetachedTabWindowTab) -> Result<String, String> {
    let json = serde_json::to_vec(tab)
        .map_err(|error| format!("serialize detached tab payload failed: {error}"))?;
    Ok(URL_SAFE_NO_PAD.encode(json))
}

fn cleanup_runtime_for_reload_state(state: &AppState) -> Result<(), String> {
    {
        let mut controls = state
            .ai_chat_stream_controls
            .lock()
            .map_err(|error| format!("lock AI stream controls failed: {error}"))?;
        let stream_count = controls.len();
        for (_, control) in controls.drain() {
            let _ = control.stop_tx.send(());
        }
        log::info!("[app-reload] cleared AI stream controls: count={stream_count}");
    }

    {
        let mut sidecar_runtime = state
            .ai_sidecar_runtime
            .lock()
            .map_err(|error| format!("lock AI sidecar runtime failed: {error}"))?;
        if let Some(runtime) = sidecar_runtime.take() {
            log::info!(
                "[app-reload] stopping AI sidecar: port={} endpoint={}",
                runtime.port,
                runtime.endpoint
            );
            if let Err(error) = runtime.child.kill() {
                log::warn!("[app-reload] AI sidecar kill failed: {error}");
            }
        }
    }

    {
        let mut watcher = state
            .vault_watcher
            .lock()
            .map_err(|error| format!("lock vault watcher failed: {error}"))?;
        if watcher.take().is_some() {
            log::info!("[app-reload] dropped vault watcher");
        }
    }

    {
        let mut traces = state
            .pending_vault_write_trace_by_path
            .lock()
            .map_err(|error| format!("lock pending vault write traces failed: {error}"))?;
        let trace_count = traces.len();
        traces.clear();
        log::info!("[app-reload] cleared pending vault write traces: count={trace_count}");
    }

    {
        let mut current_vault = state
            .current_vault
            .lock()
            .map_err(|error| format!("lock current vault failed: {error}"))?;
        if let Some(vault_root) = current_vault.take() {
            log::info!(
                "[app-reload] cleared current vault: {}",
                vault_root.display()
            );
        }
    }

    crate::infra::logging::set_vault_log_path(None);

    Ok(())
}

/// 更新主窗口原生材质效果参数。
///
/// - `config`：前端下发的窗口效果参数快照，包含应用主题模式
/// - `window`：当前调用窗口
/// - `state`：后端共享运行时状态
/// - 返回：成功或错误信息
/// - 副作用：更新内存中的窗口效果配置，并立即重设当前窗口原生效果
/// - 并发：短暂持有状态锁，不跨 await
#[tauri::command]
pub fn update_main_window_acrylic_effect(
    config: WindowsAcrylicEffectConfig,
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> Result<(), String> {
    log::info!("[command] update_main_window_acrylic_effect invoked");
    let start = Instant::now();

    {
        let mut config_guard = state
            .windows_acrylic_effect_config
            .lock()
            .map_err(|error| format!("lock windows acrylic config failed: {error}"))?;
        *config_guard = config.clone();
    }

    let is_focused = window.is_focused().unwrap_or(true);
    window_effects::apply_runtime_window_effect_config(&window, &config, is_focused)
        .map_err(|error| format!("apply window effect config failed: {error}"))?;

    log::info!(
        "[command] update_main_window_acrylic_effect completed in {:?}",
        start.elapsed()
    );
    Ok(())
}

/// 清理当前宿主运行时资源并 reload 调用方 WebView。
///
/// 前端会先完成 React/plugin/autosave 清理；该命令负责释放后端进程内资源，
/// 然后让同一 Tauri 进程重新加载前端 bundle。
#[tauri::command]
pub fn reload_current_window(
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> Result<(), String> {
    log::info!("[command] reload_current_window invoked");
    let start = Instant::now();

    cleanup_runtime_for_reload_state(&state)?;

    window
        .reload()
        .map_err(|error| format!("reload current window failed: {error}"))?;

    log::info!(
        "[command] reload_current_window completed in {:?}",
        start.elapsed()
    );
    Ok(())
}

/// 为拖出主工作区的 tab 创建独立窗口。
///
/// 新窗口复用同一前端入口，通过 URL 启动参数进入 detached main-only 模式。
#[tauri::command]
pub async fn create_detached_tab_window(
    app: AppHandle,
    window: WebviewWindow,
    request: CreateDetachedTabWindowRequest,
    state: State<'_, AppState>,
) -> Result<String, String> {
    log::info!("[command] create_detached_tab_window invoked");
    let start = Instant::now();

    let label = next_detached_window_label();
    let encoded_tab = encode_detached_tab_for_url(&request.tab)?;
    let window_url = format!(
        "index.html?ofiveWindow=detached&ofiveInitialTab={encoded_tab}"
    );

    let fallback_position = window.outer_position().ok();
    let fallback_x = fallback_position
        .as_ref()
        .map(|position| f64::from(position.x) + 72.0)
        .unwrap_or(80.0);
    let fallback_y = fallback_position
        .as_ref()
        .map(|position| f64::from(position.y) + 48.0)
        .unwrap_or(80.0);
    let target_x = request.screen_x.map(|x| x - 220.0).unwrap_or(fallback_x);
    let target_y = request.screen_y.map(|y| y - 28.0).unwrap_or(fallback_y);

    let mut builder = WebviewWindowBuilder::new(
        &app,
        label.clone(),
        WebviewUrl::App(window_url.into()),
    )
    .title(format!("ofive - {}", request.tab.title))
    .inner_size(980.0, 700.0)
    .min_inner_size(360.0, 240.0)
    .position(target_x, target_y)
    .transparent(true)
    .decorations(false)
    .shadow(true)
    .disable_drag_drop_handler();

    #[cfg(windows)]
    {
        builder = builder.drag_and_drop(false);
    }

    #[cfg(target_os = "macos")]
    {
        builder = builder
            .title_bar_style(tauri::TitleBarStyle::Overlay)
            .hidden_title(true);
    }

    let detached_window = builder
        .build()
        .map_err(|error| format!("create detached tab window failed: {error}"))?;

    window_effects::apply_transparent_window_background(&detached_window);

    let acrylic_config = state
        .windows_acrylic_effect_config
        .lock()
        .map(|guard| guard.clone())
        .unwrap_or_else(|error| {
            log::warn!(
                "[window] detached setup warning: failed to read acrylic config from state: {}",
                error
            );
            WindowsAcrylicEffectConfig::default()
        });
    if let Err(error) = window_effects::apply_main_window_effects(&detached_window, &acrylic_config)
    {
        log::warn!("[window] detached setup warning: failed to apply window effect: {error}");
    }

    if let Err(error) = detached_window.set_focus() {
        log::warn!("[window] detached setup warning: failed to focus detached window: {error}");
    }

    log::info!(
        "[command] create_detached_tab_window completed label={} in {:?}",
        label,
        start.elapsed()
    );
    Ok(label)
}

#[cfg(test)]
mod tests {
    use super::cleanup_runtime_for_reload_state;
    use crate::host::window_effects::WindowsAcrylicEffectConfig;
    use crate::state::{AiChatStreamControl, AppState, PendingVaultWriteTrace};
    use std::collections::HashMap;
    use std::path::PathBuf;
    use std::sync::Mutex;
    use tokio::sync::oneshot;

    fn new_test_app_state() -> AppState {
        AppState {
            current_vault: Mutex::new(Some(PathBuf::from("/tmp/ofive-test-vault"))),
            vault_watcher: Mutex::new(None),
            pending_vault_write_trace_by_path: Mutex::new(HashMap::from([(
                "notes/demo.md".to_string(),
                PendingVaultWriteTrace {
                    trace_id: "trace-1".to_string(),
                    expire_at_unix_ms: 1,
                },
            )])),
            ai_sidecar_runtime: Mutex::new(None),
            ai_chat_stream_controls: Mutex::new(HashMap::new()),
            windows_acrylic_effect_config: Mutex::new(WindowsAcrylicEffectConfig::default()),
        }
    }

    #[test]
    fn cleanup_runtime_for_reload_state_should_clear_reloadable_runtime_resources() {
        let app_state = new_test_app_state();
        let (stop_tx, stop_rx) = oneshot::channel();
        app_state
            .ai_chat_stream_controls
            .lock()
            .expect("stream controls should be writable")
            .insert(
                "stream-1".to_string(),
                AiChatStreamControl {
                    stream_id: "stream-1".to_string(),
                    session_id: "session-1".to_string(),
                    stop_tx,
                },
            );

        cleanup_runtime_for_reload_state(&app_state).expect("reload cleanup should succeed");

        assert!(app_state
            .current_vault
            .lock()
            .expect("current vault should be readable")
            .is_none());
        assert!(app_state
            .pending_vault_write_trace_by_path
            .lock()
            .expect("pending traces should be readable")
            .is_empty());
        assert!(app_state
            .ai_chat_stream_controls
            .lock()
            .expect("stream controls should be readable")
            .is_empty());
        assert!(stop_rx.blocking_recv().is_ok());
    }
}
