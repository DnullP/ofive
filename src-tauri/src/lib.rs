//! # Tauri 后端入口
//!
//! 本文件仅负责模块装配、应用状态初始化与命令注册，
//! 具体业务逻辑拆分至独立模块：
//! - `frontend_log`：前端日志桥接命令
//! - `state`：全局共享状态
//! - `vault_config`：仓库配置存储能力
//! - `vault_fs`：仓库文件系统监听能力
//! - `vault_commands`：仓库相关命令

use std::collections::HashMap;
use std::sync::Mutex;
use tauri::{App, LogicalSize, Manager, PhysicalPosition, Position, Size};

mod frontend_log;
mod logging;
mod state;
mod vault_commands;
mod vault_config;
mod vault_fs;

/// 对外导出日志桥接命令以支持集成测试直接调用。
pub use frontend_log::forward_frontend_log;
/// 对外导出日志模块以支持测试中的日志初始化。
pub use logging::init as init_logging;
pub use vault_commands::copy_vault_entry_in_root;
pub use vault_commands::create_vault_binary_file_in_root;
pub use vault_commands::create_vault_directory_in_root;
/// 对外导出仓库命令的 root 级辅助函数以支持集成测试。
pub use vault_commands::create_vault_markdown_file_in_root;
pub use vault_commands::delete_vault_binary_file_in_root;
pub use vault_commands::delete_vault_directory_in_root;
pub use vault_commands::delete_vault_markdown_file_in_root;
/// 对外导出索引构建与查询函数以支持基准测试。
pub use vault_commands::ensure_query_index_current;
pub use vault_commands::get_backlinks_for_file_in_root;
pub use vault_commands::get_current_vault_config_in_root;
pub use vault_commands::get_current_vault_markdown_graph_in_root;
pub use vault_commands::get_current_vault_tree_in_root;
pub use vault_commands::get_vault_markdown_ast_in_root;
pub use vault_commands::get_vault_markdown_outline_in_root;
pub use vault_commands::list_markdown_files;
pub use vault_commands::load_markdown_graph;
pub use vault_commands::move_vault_directory_to_directory_in_root;
pub use vault_commands::move_vault_markdown_file_to_directory_in_root;
pub use vault_commands::parse_markdown_to_ast;
pub use vault_commands::query_vault_markdown_frontmatter_in_root;
pub use vault_commands::read_vault_binary_file_in_root;
pub use vault_commands::read_vault_markdown_file_in_root;
pub use vault_commands::rename_vault_directory_in_root;
pub use vault_commands::rename_vault_markdown_file_in_root;
pub use vault_commands::resolve_media_embed_target_in_root;
pub use vault_commands::resolve_wikilink_target_in_root;
/// 对外导出 WikiLink 解析函数以支持集成测试直接调用。
pub use vault_commands::resolve_wikilink_target_path_in_vault;
pub use vault_commands::save_current_vault_config_in_root;
pub use vault_commands::save_vault_markdown_file_in_root;
pub use vault_commands::search_vault_markdown_files_in_root;
/// 对外导出分词命令以支持集成测试直接调用。
///
/// 该导出仅用于测试与验证，不改变前端通过 Tauri `invoke` 的调用路径。
pub use vault_commands::segment_chinese_text;
pub use vault_commands::set_current_vault_precheck;
/// 对外导出 WikiLink 建议搜索函数以支持集成测试直接调用。
pub use vault_commands::suggest_wikilink_targets_in_root;
pub use vault_config::VaultConfig;

/// 根据主显示器尺寸按比例初始化主窗口大小，并居中显示。
fn setup_main_window(app: &mut App) -> std::result::Result<(), Box<dyn std::error::Error>> {
    let Some(main_window) = app.get_webview_window("main") else {
        log::warn!("[window] setup warning: main window not found");
        return Ok(());
    };

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

    // 动态比例窗口尺寸（基于可用工作区而不是整块物理屏幕），避免越过右下可见边界。
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

    // 使用 work_area 进行物理坐标居中，避免 center() 在某些平台下受整屏坐标影响导致的视觉偏移。
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    logging::init();
    log::info!("[app] ofive starting");

    tauri::Builder::default()
        .setup(setup_main_window)
        .manage(state::AppState {
            current_vault: Mutex::new(None),
            vault_watcher: Mutex::new(None),
            pending_vault_write_trace_by_path: Mutex::new(HashMap::new()),
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            frontend_log::forward_frontend_log,
            vault_commands::set_current_vault,
            vault_commands::get_current_vault_tree,
            vault_commands::read_vault_markdown_file,
            vault_commands::read_vault_binary_file,
            vault_commands::create_vault_markdown_file,
            vault_commands::create_vault_directory,
            vault_commands::create_vault_binary_file,
            vault_commands::save_vault_markdown_file,
            vault_commands::rename_vault_markdown_file,
            vault_commands::move_vault_markdown_file_to_directory,
            vault_commands::rename_vault_directory,
            vault_commands::move_vault_directory_to_directory,
            vault_commands::delete_vault_directory,
            vault_commands::delete_vault_markdown_file,
            vault_commands::delete_vault_binary_file,
            vault_commands::copy_vault_entry,
            vault_commands::resolve_wikilink_target,
            vault_commands::resolve_media_embed_target,
            vault_commands::search_vault_markdown_files,
            vault_commands::get_current_vault_markdown_graph,
            vault_commands::get_vault_markdown_ast,
            vault_commands::segment_chinese_text,
            vault_commands::suggest_wikilink_targets,
            vault_commands::get_current_vault_config,
            vault_commands::save_current_vault_config,
            vault_commands::get_backlinks_for_file,
            vault_commands::get_vault_markdown_outline,
            vault_commands::query_vault_markdown_frontmatter
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
