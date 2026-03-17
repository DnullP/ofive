//! # AI 流事件模块
//!
//! 负责流式聊天事件编号与前端事件发射。

use std::sync::atomic::Ordering;

use tauri::{AppHandle, Emitter};

use super::{AiChatStreamEventPayload, AI_CHAT_STREAM_EVENT_NAME, AI_STREAM_SEQUENCE};

pub(crate) fn next_stream_id() -> String {
    format!(
        "ai-stream-{}",
        AI_STREAM_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    )
}

pub(crate) fn emit_stream_event(app_handle: &AppHandle, payload: AiChatStreamEventPayload) {
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
