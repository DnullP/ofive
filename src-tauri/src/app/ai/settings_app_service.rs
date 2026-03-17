//! # AI 设置应用服务
//!
//! 负责 AI vendor 目录、仓库内 AI 设置读写与模型列表拉取的用例编排。

use tauri::State;

use crate::ai_service::{self, AiChatSettings, AiVendorDefinition, AiVendorModelDefinition};
use crate::state::AppState;

/// 获取可用 AI vendor 列表。
pub(crate) fn get_ai_vendor_catalog() -> Vec<AiVendorDefinition> {
    ai_service::load_ai_vendor_catalog()
}

/// 根据当前设置拉取 vendor 可用模型列表。
pub(crate) async fn get_ai_vendor_models(
    settings: AiChatSettings,
) -> Result<Vec<AiVendorModelDefinition>, String> {
    ai_service::fetch_ai_vendor_models(settings).await
}

/// 读取当前仓库 AI 设置。
pub(crate) fn get_ai_chat_settings(state: &State<'_, AppState>) -> Result<AiChatSettings, String> {
    ai_service::load_ai_chat_settings(state)
}

/// 保存当前仓库 AI 设置。
pub(crate) fn save_ai_chat_settings(
    settings: AiChatSettings,
    state: &State<'_, AppState>,
) -> Result<AiChatSettings, String> {
    ai_service::save_ai_chat_settings_in_state(settings, state)
}
