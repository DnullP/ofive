//! # AI 命令入口模块
//!
//! 提供宿主层 AI 命令包装，并将请求分发到 AI 应用服务。

use tauri::{AppHandle, State};

use crate::ai_service::{
    AiChatHistoryMessage, AiChatHistoryState, AiChatSettings, AiChatStreamStartResponse,
    AiSidecarHealthResponse, AiVendorDefinition, AiVendorModelDefinition,
};
use crate::app::ai::{chat_app_service, settings_app_service, tool_app_service};
use crate::domain::ai::tool::AiToolDescriptor;
use crate::shared::backend_plugin_contracts::BackendPluginConfig;
use crate::state::AppState;

pub(crate) const AI_COMMAND_IDS: &[&str] = &[
    "get_ai_vendor_catalog",
    "get_ai_backend_plugin_config",
    "save_ai_backend_plugin_config",
    "get_ai_vendor_models",
    "get_ai_chat_settings",
    "get_ai_chat_history",
    "save_ai_chat_settings",
    "save_ai_chat_history",
    "get_ai_tool_catalog",
    "get_ai_sidecar_health",
    "start_ai_chat_stream",
    "submit_ai_chat_confirmation",
];

/// 获取可用 AI vendor 列表。
#[tauri::command]
pub fn get_ai_vendor_catalog() -> Result<Vec<AiVendorDefinition>, String> {
    Ok(settings_app_service::get_ai_vendor_catalog())
}

/// 获取当前仓库的 AI 后端插件启停配置。
#[tauri::command]
pub fn get_ai_backend_plugin_config(
    state: State<'_, AppState>,
) -> Result<BackendPluginConfig, String> {
    settings_app_service::get_ai_backend_plugin_config(&state)
}

/// 保存当前仓库的 AI 后端插件启停配置。
#[tauri::command]
pub fn save_ai_backend_plugin_config(
    plugin_config: BackendPluginConfig,
    state: State<'_, AppState>,
) -> Result<BackendPluginConfig, String> {
    settings_app_service::save_ai_backend_plugin_config(plugin_config, &state)
}

/// 按当前 vendor 配置拉取可用模型列表。
#[tauri::command]
pub async fn get_ai_vendor_models(
    settings: AiChatSettings,
) -> Result<Vec<AiVendorModelDefinition>, String> {
    settings_app_service::get_ai_vendor_models(settings).await
}

/// 获取当前仓库保存的 AI 聊天设置。
#[tauri::command]
pub fn get_ai_chat_settings(state: State<'_, AppState>) -> Result<AiChatSettings, String> {
    settings_app_service::get_ai_chat_settings(&state)
}

/// 获取当前仓库保存的 AI 对话历史。
#[tauri::command]
pub fn get_ai_chat_history(state: State<'_, AppState>) -> Result<AiChatHistoryState, String> {
    settings_app_service::get_ai_chat_history(&state)
}

/// 保存当前仓库的 AI 聊天设置。
#[tauri::command]
pub fn save_ai_chat_settings(
    settings: AiChatSettings,
    state: State<'_, AppState>,
) -> Result<AiChatSettings, String> {
    settings_app_service::save_ai_chat_settings(settings, &state)
}

/// 保存当前仓库的 AI 对话历史。
#[tauri::command]
pub fn save_ai_chat_history(
    history: AiChatHistoryState,
    state: State<'_, AppState>,
) -> Result<AiChatHistoryState, String> {
    settings_app_service::save_ai_chat_history(history, &state)
}

/// 获取当前 AI runtime 可见的 tool 目录。
#[tauri::command]
pub fn get_ai_tool_catalog(state: State<'_, AppState>) -> Result<Vec<AiToolDescriptor>, String> {
    tool_app_service::get_enabled_ai_tool_catalog(&state)
}

/// 获取 sidecar 健康状态。
#[tauri::command]
pub async fn get_ai_sidecar_health(
    app_handle: AppHandle,
    state: State<'_, AppState>,
) -> Result<AiSidecarHealthResponse, String> {
    chat_app_service::get_ai_sidecar_health(&app_handle, &state).await
}

/// 启动一次 AI 流式聊天，并通过事件向前端推送增量结果。
#[tauri::command]
pub async fn start_ai_chat_stream(
    message: String,
    session_id: Option<String>,
    user_id: Option<String>,
    history: Option<Vec<AiChatHistoryMessage>>,
    app_handle: AppHandle,
    state: State<'_, AppState>,
) -> Result<AiChatStreamStartResponse, String> {
    chat_app_service::start_ai_chat_stream(message, session_id, user_id, history, app_handle, state)
        .await
}

/// 提交一次 AI tool 确认结果，并继续同一会话的流式对话。
#[tauri::command]
pub async fn submit_ai_chat_confirmation(
    confirmation_id: String,
    confirmed: bool,
    session_id: Option<String>,
    user_id: Option<String>,
    app_handle: AppHandle,
    state: State<'_, AppState>,
) -> Result<AiChatStreamStartResponse, String> {
    chat_app_service::submit_ai_chat_confirmation(
        confirmation_id,
        confirmed,
        session_id,
        user_id,
        app_handle,
        state,
    )
    .await
}
