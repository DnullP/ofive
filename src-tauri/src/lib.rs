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
#[cfg(test)]
mod architecture_guard;
mod backend_module_manifest;
mod domain;
mod frontend_log;
mod host;
mod infra;
#[cfg(test)]
mod module_boundary_template;
mod module_contribution;
mod platform_public_surface;
mod shared;
mod state;
pub mod test_support;

use crate::module_contribution::{
    builtin_backend_module_contributions, validate_backend_module_contributions,
};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    infra::logging::init();
    log::info!("[app] ofive starting");

    let builtin_module_contributions = builtin_backend_module_contributions();

    validate_backend_module_contributions(&builtin_module_contributions)
        .expect("builtin backend module contributions should remain consistent");
    host::command_registry::validate_registered_app_commands(
        &builtin_module_contributions,
        host::command_registry::REGISTERED_APP_COMMAND_IDS,
    )
    .expect("registered app commands should remain aligned with backend module contributions");
    host::events::validate_registered_host_events(
        &builtin_module_contributions,
        &host::events::builtin_host_events(),
    )
    .expect("registered host events should remain aligned with backend module contributions");

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
