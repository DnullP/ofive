//! # 窗口效果宿主命令模块
//!
//! 提供 Tauri `command` 包装层，负责接收前端下发的窗口原生效果参数，
//! 并同步更新当前主窗口的运行时材质效果配置。

use crate::host::window_effects::{self, WindowsAcrylicEffectConfig};
use crate::state::AppState;
use std::time::Instant;
use tauri::{State, WebviewWindow};

/// 更新主窗口原生材质效果参数。
///
/// - `config`：前端下发的窗口效果参数快照
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
