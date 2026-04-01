//! # AI 共享契约模块
//!
//! 定义 AI 模块对应用层、基础设施层与宿主桥接层共享的数据结构与
//! protobuf 契约。该模块只承载稳定契约，不负责业务编排或运行时连接。

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

pub mod pb {
    tonic::include_proto!("ofive.ai.v1");
}

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

/// AI 对话消息记录。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiChatHistoryMessage {
    pub id: String,
    pub role: String,
    pub text: String,
    pub created_at_unix_ms: i64,
    #[serde(default)]
    pub interrupted_by_user: bool,
}

/// AI 对话会话记录。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiChatConversationRecord {
    pub id: String,
    pub session_id: String,
    pub title: String,
    pub created_at_unix_ms: i64,
    pub updated_at_unix_ms: i64,
    pub messages: Vec<AiChatHistoryMessage>,
}

/// AI 对话历史仓库级状态。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiChatHistoryState {
    pub active_conversation_id: Option<String>,
    pub conversations: Vec<AiChatConversationRecord>,
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
///
/// `event_type` 目前支持：
/// - `started`：宿主已接受请求并为该轮分配 streamId
/// - `delta`：流式增量文本
/// - `done`：本轮自然完成
/// - `stopped`：前端主动终止，后台链路已取消
/// - `error`：本轮异常结束
/// - `debug`：调试轨迹
/// - `confirmation`：等待用户确认工具调用
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
    pub debug_level: Option<String>,
    pub debug_text: Option<String>,
    pub confirmation_id: Option<String>,
    pub confirmation_hint: Option<String>,
    pub confirmation_tool_name: Option<String>,
    pub confirmation_tool_args_json: Option<String>,
    pub error: Option<String>,
    pub done: bool,
}