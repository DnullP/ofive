//! # AI 宿主事件模块
//!
//! 管理 AI 流式对话事件编号与前端事件发射，作为 AI 应用层到宿主
//! 事件桥接的稳定边界。

use std::sync::atomic::{AtomicU64, Ordering};

use tauri::{AppHandle, Emitter};

use crate::module_contribution::{BackendEventDescriptor, BackendEventKind};
use crate::shared::ai_service::AiChatStreamEventPayload;

pub(crate) const AI_CHAT_STREAM_EVENT_NAME: &str = "ai://chat-stream";
pub(crate) const AI_EVENTS: &[BackendEventDescriptor] = &[BackendEventDescriptor::new(
    AI_CHAT_STREAM_EVENT_NAME,
    BackendEventKind::UiBridge,
)];

static AI_STREAM_SEQUENCE: AtomicU64 = AtomicU64::new(1);

/// 生成唯一的 AI 流事件序列号。
pub(crate) fn next_ai_stream_id() -> String {
    format!(
        "ai-stream-{}",
        AI_STREAM_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    )
}

/// 向前端发射一条 AI 流事件。
pub(crate) fn emit_ai_stream_event(app_handle: &AppHandle, payload: AiChatStreamEventPayload) {
    if let Err(error) = app_handle.emit(AI_CHAT_STREAM_EVENT_NAME, payload.clone()) {
        log::warn!("[ai-service] emit stream event failed: {error}");
        return;
    }

    log::info!(
        "[ai-service] event emitted: stream_id={} type={} done={}",
        payload.stream_id,
        payload.event_type,
        payload.done
    );
}
