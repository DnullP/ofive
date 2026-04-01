//! # 宿主引导模块
//!
//! 提供主窗口初始化、后台启动任务与 `AppState` 构建逻辑，供宿主入口层复用。

use crate::app::vault::query_app_service;
use crate::host::window_effects;
use crate::state::AppState;
use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{
    window::Color, App, LogicalSize, Manager, PhysicalPosition, Position, Size, WebviewWindow,
};

/// 构建全局共享状态。
pub(crate) fn build_app_state() -> AppState {
    AppState {
        current_vault: Mutex::new(None),
        vault_watcher: Mutex::new(None),
        pending_vault_write_trace_by_path: Mutex::new(HashMap::new()),
        ai_sidecar_runtime: Mutex::new(None),
        ai_chat_stream_controls: Mutex::new(HashMap::new()),
        windows_acrylic_effect_config: Mutex::new(
            window_effects::WindowsAcrylicEffectConfig::default(),
        ),
    }
}

/// 启动宿主后台预热任务，避免首次用户操作命中重量级冷启动。
///
/// 当前仅包含中文分词器预热；任务以后台线程方式执行，不阻塞窗口创建。
pub(crate) fn spawn_startup_background_tasks() {
    std::thread::spawn(|| {
        log::info!("[startup] chinese segmenter warmup scheduled");
        query_app_service::warmup_chinese_segmenter();
    });
}

/// 根据主显示器尺寸按比例初始化主窗口大小，并居中显示。
pub(crate) fn setup_main_window(
    app: &mut App,
) -> std::result::Result<(), Box<dyn std::error::Error>> {
    let Some(main_window) = app.get_webview_window("main") else {
        log::warn!("[window] setup warning: main window not found");
        return Ok(());
    };

    apply_main_window_transparent_background(&main_window);

    let initial_window_effect_config = app
        .state::<AppState>()
        .windows_acrylic_effect_config
        .lock()
        .map(|guard| guard.clone())
        .unwrap_or_else(|error| {
            log::warn!(
                "[window] setup warning: failed to read acrylic config from state: {}",
                error
            );
            window_effects::WindowsAcrylicEffectConfig::default()
        });

    if let Err(error) =
        window_effects::apply_main_window_effects(&main_window, &initial_window_effect_config)
    {
        log::warn!("[window] setup warning: failed to apply vibrancy effect: {error}");
    }

    let monitor = match main_window.current_monitor() {
        Ok(Some(current)) => Some(current),
        Ok(None) => match main_window.primary_monitor() {
            Ok(primary) => primary,
            Err(error) => {
                log::warn!("[window] setup warning: failed to get primary monitor: {error}");
                None
            }
        },
        Err(error) => {
            log::warn!("[window] setup warning: failed to get current monitor: {error}");
            None
        }
    };

    let Some(monitor) = monitor else {
        log::warn!("[window] setup warning: monitor information unavailable");
        return Ok(());
    };

    let monitor_size = monitor.size();
    let work_area = monitor.work_area();
    let scale_factor = monitor.scale_factor().max(1.0);
    let logical_work_width = f64::from(work_area.size.width) / scale_factor;
    let logical_work_height = f64::from(work_area.size.height) / scale_factor;

    let ratio_width = 0.9f64;
    let ratio_height = 0.9f64;

    let min_width = 640.0f64.min(logical_work_width);
    let min_height = 480.0f64.min(logical_work_height);
    let target_width = (logical_work_width * ratio_width)
        .round()
        .clamp(min_width, logical_work_width);
    let target_height = (logical_work_height * ratio_height)
        .round()
        .clamp(min_height, logical_work_height);

    if let Err(error) =
        main_window.set_size(Size::Logical(LogicalSize::new(target_width, target_height)))
    {
        log::warn!("[window] setup warning: set_size failed: {error}");
    }

    let target_physical_width = (target_width * scale_factor)
        .round()
        .clamp(1.0, f64::from(work_area.size.width)) as i32;
    let target_physical_height = (target_height * scale_factor)
        .round()
        .clamp(1.0, f64::from(work_area.size.height)) as i32;

    let centered_x =
        work_area.position.x + ((work_area.size.width as i32 - target_physical_width) / 2).max(0);
    let centered_y =
        work_area.position.y + ((work_area.size.height as i32 - target_physical_height) / 2).max(0);

    if let Err(error) = main_window.set_position(Position::Physical(PhysicalPosition::new(
        centered_x, centered_y,
    ))) {
        log::warn!("[window] setup warning: set_position failed: {error}");

        if let Err(center_error) = main_window.center() {
            log::warn!("[window] setup warning: fallback center failed: {center_error}");
        }
    }

    log::info!(
        "[window] setup success: monitor_physical={}x{} work_area_physical={}x{} logical_work={}x{} scale_factor={} window={}x{} position=({}, {})",
        monitor_size.width,
        monitor_size.height,
        work_area.size.width,
        work_area.size.height,
        logical_work_width,
        logical_work_height,
        scale_factor,
        target_width,
        target_height,
        centered_x,
        centered_y
    );

    Ok(())
}

/// 为 macOS 主窗口与主 WebView 显式设置透明背景。
///
/// Wry 在 macOS 上对 `set_background_color` 已经内置了对 WKWebView 白底的处理，
/// 这里在宿主启动阶段直接下发透明色，避免前端 CSS 已透明但 WebView 仍保留默认白底。
fn apply_main_window_transparent_background(window: &WebviewWindow) {
    #[cfg(target_os = "macos")]
    {
        let transparent = Color(0, 0, 0, 0);
        if let Err(error) = window.set_background_color(Some(transparent)) {
            log::warn!(
                "[window] setup warning: failed to set transparent macOS webview background: {error}"
            );
        } else {
            log::info!("[window] applied transparent macOS window/webview background");
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        let _ = window;
    }
}
