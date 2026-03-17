//! # AI 服务模块
//!
//! 负责启动并维护 Go sidecar，通过 gRPC 与 sidecar 通信，
//! 并将流式聊天结果转发为前端可订阅的 Tauri 事件。
//!
//! 该模块当前目标是：
//! - 保证 sidecar 可被 Tauri 正常拉起与打包；
//! - 保证 Rust 可通过 gRPC 获取流式聊天结果；
//! - 保证前端只依赖 Tauri `invoke + listen` 即可消费流式对话。

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::AtomicU64;
#[path = "ai_service/settings.rs"]
mod settings;
#[path = "ai_service/sidecar.rs"]
mod sidecar;
#[path = "ai_service/stream.rs"]
mod stream;

const AI_CHAT_STREAM_EVENT_NAME: &str = "ai://chat-stream";
const AI_CHAT_SETTINGS_CONFIG_KEY: &str = "aiChatSettings";
const DEFAULT_AI_VENDOR_ID: &str = "baidu-qianfan";
const SIDECAR_HEALTH_RETRY_COUNT: usize = 30;
const SIDECAR_HEALTH_RETRY_DELAY_MS: u64 = 100;

static AI_STREAM_SEQUENCE: AtomicU64 = AtomicU64::new(1);

pub mod pb {
    tonic::include_proto!("ofive.ai.v1");
}

pub(crate) use settings::fetch_ai_vendor_models;
pub(crate) use settings::load_ai_chat_settings;
pub(crate) use settings::load_validated_ai_chat_settings;
pub(crate) use settings::save_ai_chat_settings_in_state;
pub(crate) use sidecar::connect_client as connect_ai_sidecar_client;
pub(crate) use sidecar::ensure_sidecar_endpoint as ensure_ai_sidecar_endpoint;
pub(crate) use stream::emit_stream_event as emit_ai_stream_event;
pub(crate) use stream::next_stream_id as next_ai_stream_id;

/// AI vendor 字段类型。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiVendorFieldDefinition {
    pub key: String,
    pub label: String,
    pub description: String,
    pub field_type: String,
    pub required: bool,
    pub placeholder: Option<String>,
    pub default_value: Option<String>,
}

/// AI vendor 描述。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiVendorDefinition {
    pub id: String,
    pub title: String,
    pub description: String,
    pub default_model: String,
    pub fields: Vec<AiVendorFieldDefinition>,
}

/// AI vendor 模型定义。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiVendorModelDefinition {
    pub id: String,
    pub object: Option<String>,
    pub owned_by: Option<String>,
    pub created: Option<i64>,
}

/// AI 聊天设置。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiChatSettings {
    pub vendor_id: String,
    pub model: String,
    pub field_values: HashMap<String, String>,
}

/// sidecar 健康检查响应。
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiSidecarHealthResponse {
    pub status: String,
    pub agent_name: String,
    pub version: String,
    pub pid: i64,
}

/// 启动一次流式聊天后的返回值。
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiChatStreamStartResponse {
    pub stream_id: String,
}

/// Rust 转发给前端的聊天流事件。
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiChatStreamEventPayload {
    pub stream_id: String,
    pub event_type: String,
    pub session_id: Option<String>,
    pub agent_name: Option<String>,
    pub delta_text: Option<String>,
    pub accumulated_text: Option<String>,
    pub debug_title: Option<String>,
    pub debug_text: Option<String>,
    pub confirmation_id: Option<String>,
    pub confirmation_hint: Option<String>,
    pub confirmation_tool_name: Option<String>,
    pub confirmation_tool_args_json: Option<String>,
    pub error: Option<String>,
    pub done: bool,
}

/// 获取可用 AI vendor 列表。
pub(crate) fn load_ai_vendor_catalog() -> Vec<AiVendorDefinition> {
    settings::ai_vendor_catalog()
}
