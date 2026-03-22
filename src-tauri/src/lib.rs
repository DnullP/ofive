//! # Tauri 后端入口
//!
//! 本文件仅负责模块装配、应用状态初始化与命令注册，
//! 具体业务逻辑拆分至独立模块：
//! - `ai_service`：AI 共享契约与 protobuf 定义
//! - `frontend_log`：前端日志桥接命令
//! - `host`：宿主装配与命令注册辅助
//! - `infra`：sidecar、持久化、日志等基础设施实现
//! - `shared`：跨层共享的稳定数据契约
//! - `state`：全局共享状态

mod ai_service;
mod app;
mod domain;
mod frontend_log;
mod host;
mod infra;
mod shared;
mod state;

pub use app::vault::query_app_service::get_backlinks_for_file_in_root;
pub use app::vault::query_app_service::get_current_vault_markdown_graph_in_root;
pub use app::vault::query_app_service::get_vault_markdown_ast_in_root;
pub use app::vault::query_app_service::get_vault_markdown_outline_in_root;
pub use app::vault::query_app_service::parse_markdown_to_ast;
pub use app::vault::query_app_service::query_vault_markdown_frontmatter_in_root;
pub use app::vault::query_app_service::resolve_media_embed_target_in_root;
pub use app::vault::query_app_service::resolve_wikilink_target_in_root;
pub use app::vault::query_app_service::search_vault_markdown_files_in_root;
pub use app::vault::query_app_service::suggest_wikilink_targets_in_root;
pub use app::vault::vault_app_service::copy_vault_entry_in_root;
pub use app::vault::vault_app_service::create_vault_binary_file_in_root;
pub use app::vault::vault_app_service::create_vault_directory_in_root;
/// 对外导出仓库命令的 root 级辅助函数以支持集成测试。
pub use app::vault::vault_app_service::create_vault_markdown_file_in_root;
pub use app::vault::vault_app_service::delete_vault_binary_file_in_root;
pub use app::vault::vault_app_service::delete_vault_directory_in_root;
pub use app::vault::vault_app_service::delete_vault_markdown_file_in_root;
pub use app::vault::vault_app_service::get_current_vault_config_in_root;
pub use app::vault::vault_app_service::get_current_vault_tree_in_root;
pub use app::vault::vault_app_service::move_vault_directory_to_directory_in_root;
pub use app::vault::vault_app_service::move_vault_markdown_file_to_directory_in_root;
pub use app::vault::vault_app_service::read_vault_binary_file_in_root;
pub use app::vault::vault_app_service::read_vault_markdown_file_in_root;
pub use app::vault::vault_app_service::rename_vault_directory_in_root;
pub use app::vault::vault_app_service::rename_vault_markdown_file_in_root;
pub use app::vault::vault_app_service::save_current_vault_config_in_root;
pub use app::vault::vault_app_service::save_vault_markdown_file_in_root;
pub use app::vault::vault_app_service::set_current_vault_precheck;
/// 对外导出日志桥接命令以支持集成测试直接调用。
pub use frontend_log::forward_frontend_log;
pub use host::commands::ai_commands::get_ai_chat_settings;
pub use host::commands::ai_commands::get_ai_sidecar_health;
pub use host::commands::ai_commands::get_ai_tool_catalog;
pub use host::commands::ai_commands::get_ai_vendor_catalog;
pub use host::commands::ai_commands::get_ai_vendor_models;
pub use host::commands::ai_commands::save_ai_chat_settings;
pub use host::commands::ai_commands::start_ai_chat_stream;
pub use host::commands::ai_commands::submit_ai_chat_confirmation;
pub use host::commands::capability_commands::get_capability_catalog;
pub use host::commands::persistence_commands::execute_persistence_request;
/// 对外导出分词命令以支持集成测试直接调用。
///
/// 该导出仅用于测试与验证，不改变前端通过 Tauri `invoke` 的调用路径。
pub use host::commands::vault_commands::segment_chinese_text;
/// 对外导出日志模块以支持测试中的日志初始化。
pub use infra::logging::init as init_logging;
pub use infra::persistence::vault_config_store::VaultConfig;
/// 对外导出索引构建与查询函数以支持基准测试。
pub use infra::query::query_index::ensure_query_index_current;
pub use infra::query::query_index::list_markdown_files;
pub use infra::query::query_index::load_markdown_graph;
/// 对外导出 WikiLink 解析函数以支持集成测试直接调用。
pub use infra::query::wikilink::resolve_wikilink_target_path_in_vault;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    infra::logging::init();
    log::info!("[app] ofive starting");

    tauri::Builder::default()
        .setup(host::bootstrap::setup_main_window)
        .manage(host::bootstrap::build_app_state())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(host::command_registry::app_commands!())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
