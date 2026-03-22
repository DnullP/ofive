//! # AI 设置应用服务
//!
//! 负责 AI vendor 目录、仓库内 AI 设置读写与模型列表拉取的用例编排。

use tauri::State;

use crate::ai_service::{
    AiChatHistoryState, AiChatSettings, AiVendorDefinition, AiVendorModelDefinition,
};
use crate::app::ai::plugin_app_service;
use crate::infra::ai::vendor_model_fetcher;
use crate::infra::persistence::ai_chat_store;
use crate::shared::backend_plugin_contracts::BackendPluginConfig;
use crate::state::AppState;

/// 获取可用 AI vendor 列表。
pub(crate) fn get_ai_vendor_catalog() -> Vec<AiVendorDefinition> {
    ai_chat_store::get_ai_vendor_catalog()
}

/// 读取当前仓库 AI 后端插件启停配置。
pub(crate) fn get_ai_backend_plugin_config(
    state: &State<'_, AppState>,
) -> Result<BackendPluginConfig, String> {
    plugin_app_service::get_ai_backend_plugin_config(state)
}

/// 保存当前仓库 AI 后端插件启停配置。
pub(crate) fn save_ai_backend_plugin_config(
    plugin_config: BackendPluginConfig,
    state: &State<'_, AppState>,
) -> Result<BackendPluginConfig, String> {
    plugin_app_service::save_ai_backend_plugin_config(plugin_config, state)
}

/// 根据当前设置拉取 vendor 可用模型列表。
pub(crate) async fn get_ai_vendor_models(
    settings: AiChatSettings,
) -> Result<Vec<AiVendorModelDefinition>, String> {
    vendor_model_fetcher::fetch_ai_vendor_models(settings).await
}

/// 读取当前仓库 AI 设置。
pub(crate) fn get_ai_chat_settings(state: &State<'_, AppState>) -> Result<AiChatSettings, String> {
    ai_chat_store::load_ai_chat_settings(state)
}

/// 读取当前仓库 AI 对话历史。
pub(crate) fn get_ai_chat_history(
    state: &State<'_, AppState>,
) -> Result<AiChatHistoryState, String> {
    ai_chat_store::load_ai_chat_history(state)
}

/// 保存当前仓库 AI 设置。
pub(crate) fn save_ai_chat_settings(
    settings: AiChatSettings,
    state: &State<'_, AppState>,
) -> Result<AiChatSettings, String> {
    ai_chat_store::save_ai_chat_settings(settings, state)
}

/// 保存当前仓库 AI 对话历史。
pub(crate) fn save_ai_chat_history(
    history: AiChatHistoryState,
    state: &State<'_, AppState>,
) -> Result<AiChatHistoryState, String> {
    ai_chat_store::save_ai_chat_history(history, state)
}
