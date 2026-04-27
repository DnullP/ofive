//! # AI 对话应用服务
//!
//! 负责 sidecar 健康检查、聊天流启动、前端终止控制与流事件编排。

use serde_json;
use tauri::{AppHandle, Manager, State};
use tokio::sync::oneshot;
use tonic::Request;

use crate::app::ai::{
    persistence_callback_app_service, plugin_app_service, tool_app_service,
    tool_callback_app_service,
};
use crate::host::events::ai_events;
use crate::infra::ai::{grpc_client, sidecar_manager};
use crate::infra::persistence::ai_chat_store;
use crate::shared::ai_service::{
    pb, AiChatHistoryMessage, AiChatStreamEventPayload, AiChatStreamStartResponse,
    AiSidecarHealthResponse,
};
use crate::state::{get_vault_root, AiChatStreamControl, AppState};

enum StreamTaskOutcome {
    Completed,
    Stopped,
    Failed(String),
}

/// 注册一条可被前端终止的 AI 流控制句柄。
fn register_ai_chat_stream_control(
    app_state: &AppState,
    stream_id: &str,
    session_id: &str,
    stop_tx: oneshot::Sender<()>,
) -> Result<(), String> {
    let mut controls = app_state
        .ai_chat_stream_controls
        .lock()
        .map_err(|error| format!("锁定 AI 流控制表失败: {error}"))?;

    controls.insert(
        stream_id.to_string(),
        AiChatStreamControl {
            stream_id: stream_id.to_string(),
            session_id: session_id.to_string(),
            stop_tx,
        },
    );

    Ok(())
}

/// 移除一条 AI 流控制句柄。
fn remove_ai_chat_stream_control(app_state: &AppState, stream_id: &str) {
    match app_state.ai_chat_stream_controls.lock() {
        Ok(mut controls) => {
            controls.remove(stream_id);
        }
        Err(error) => {
            log::warn!(
                "[ai-service] remove stream control failed: stream_id={} error={}",
                stream_id,
                error
            );
        }
    }
}

/// 停止一条当前仍在运行的 AI 流。
fn stop_ai_chat_stream_in_state(stream_id: &str, app_state: &AppState) -> Result<bool, String> {
    let control = app_state
        .ai_chat_stream_controls
        .lock()
        .map_err(|error| format!("锁定 AI 流控制表失败: {error}"))?
        .remove(stream_id);

    let Some(control) = control else {
        log::info!(
            "[ai-service] stop ignored: stream already finished or not found: {}",
            stream_id
        );
        return Ok(false);
    };

    log::info!(
        "[ai-service] stop requested: stream_id={} session_id={}",
        control.stream_id,
        control.session_id
    );

    if control.stop_tx.send(()).is_err() {
        log::info!(
            "[ai-service] stop ignored: stream task already closed: {}",
            stream_id
        );
        return Ok(false);
    }

    Ok(true)
}

/// 停止一条当前仍在运行的 AI 流。
pub(crate) fn stop_ai_chat_stream(
    stream_id: String,
    state: &State<'_, AppState>,
) -> Result<bool, String> {
    let trimmed_stream_id = stream_id.trim().to_string();
    if trimmed_stream_id.is_empty() {
        return Err("stream_id 不能为空".to_string());
    }

    stop_ai_chat_stream_in_state(&trimmed_stream_id, state)
}

/// 获取 AI sidecar 健康状态。
pub(crate) async fn get_ai_sidecar_health(
    app_handle: &AppHandle,
    state: &State<'_, AppState>,
) -> Result<AiSidecarHealthResponse, String> {
    plugin_app_service::ensure_ai_backend_plugin_enabled(state)?;
    let endpoint = sidecar_manager::ensure_ai_sidecar_endpoint(app_handle, state).await?;
    let mut client = grpc_client::connect_ai_sidecar_client(endpoint).await?;
    let response = client
        .health(Request::new(pb::HealthRequest {}))
        .await
        .map_err(|error| format!("调用 AI sidecar health 失败: {error}"))?
        .into_inner();

    Ok(AiSidecarHealthResponse {
        status: response.status,
        agent_name: response.agent_name,
        version: response.version,
        pid: response.pid,
    })
}

/// 启动一次 AI 流式聊天。
pub(crate) async fn start_ai_chat_stream(
    message: String,
    session_id: Option<String>,
    user_id: Option<String>,
    history: Option<Vec<AiChatHistoryMessage>>,
    app_handle: AppHandle,
    state: State<'_, AppState>,
) -> Result<AiChatStreamStartResponse, String> {
    plugin_app_service::ensure_ai_backend_plugin_enabled(&state)?;
    let trimmed_message = message.trim().to_string();
    if trimmed_message.is_empty() {
        return Err("message 不能为空".to_string());
    }

    let stream_id = ai_events::next_ai_stream_id();
    let resolved_session_id = session_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "default".to_string());
    let resolved_user_id = user_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "desktop-user".to_string());
    let ai_settings = ai_chat_store::validate_ai_chat_settings_for_chat(
        ai_chat_store::load_ai_chat_settings(&state)?,
    )?;
    let vault_root = get_vault_root(&state)?;
    let sidecar_tools = tool_app_service::get_ai_sidecar_tool_catalog()?;
    let capability_callback_handle =
        tool_callback_app_service::start_sidecar_capability_callback_server(
            app_handle.clone(),
            vault_root.clone(),
        )
        .await?;
    let persistence_callback_handle =
        persistence_callback_app_service::start_sidecar_persistence_callback_server(vault_root)
            .await?;
    let endpoint = sidecar_manager::ensure_ai_sidecar_endpoint(&app_handle, &state).await?;

    ai_events::emit_ai_stream_event(
        &app_handle,
        AiChatStreamEventPayload {
            stream_id: stream_id.clone(),
            event_type: "started".to_string(),
            session_id: Some(resolved_session_id.clone()),
            agent_name: None,
            delta_text: None,
            accumulated_text: None,
            reasoning_delta_text: None,
            reasoning_accumulated_text: None,
            history_content_blocks_json: None,
            debug_title: None,
            debug_level: None,
            debug_text: None,
            confirmation_id: None,
            confirmation_hint: None,
            confirmation_tool_name: None,
            confirmation_tool_args_json: None,
            error: None,
            done: false,
        },
    );

    let (stop_tx, mut stop_rx) = oneshot::channel::<()>();
    register_ai_chat_stream_control(&state, &stream_id, &resolved_session_id, stop_tx)?;

    let event_app_handle = app_handle.clone();
    let stream_id_for_task = stream_id.clone();
    tauri::async_runtime::spawn(async move {
        let request = pb::ChatRequest {
            session_id: resolved_session_id.clone(),
            user_id: resolved_user_id,
            message: trimmed_message,
            vendor_config: ai_settings.field_values.clone(),
            vendor_id: ai_settings.vendor_id.clone(),
            model: ai_settings.model.clone(),
            tools: sidecar_tools,
            capability_callback_url: capability_callback_handle.callback_url.clone(),
            capability_callback_token: capability_callback_handle.callback_token.clone(),
            mcp_server_url: String::new(),
            mcp_auth_token: String::new(),
            persistence_callback_url: persistence_callback_handle.callback_url.clone(),
            persistence_callback_token: persistence_callback_handle.callback_token.clone(),
            history: history
                .clone()
                .unwrap_or_default()
                .into_iter()
                .map(|item| pb::ChatHistoryEntry {
                    role: item.role,
                    text: item.text,
                    interrupted_by_user: item.interrupted_by_user,
                    reasoning_text: item.reasoning_text.unwrap_or_default(),
                    content_blocks_json: serde_json::to_string(&item.content_blocks)
                        .unwrap_or_else(|_| "[]".to_string()),
                })
                .collect(),
        };

        let stream_result = async {
            let mut client = grpc_client::connect_ai_sidecar_client(endpoint).await?;
            let mut response_stream = client
                .chat(Request::new(request))
                .await
                .map_err(|error| format!("调用 AI sidecar chat 失败: {error}"))?
                .into_inner();

            while let Some(chunk) = response_stream
                .message()
                .await
                .map_err(|error| format!("读取 AI sidecar chat stream 失败: {error}"))?
            {
                ai_events::emit_ai_stream_event(
                    &event_app_handle,
                    AiChatStreamEventPayload {
                        stream_id: stream_id_for_task.clone(),
                        event_type: if chunk.event_type.trim().is_empty() {
                            if chunk.done {
                                "done".to_string()
                            } else {
                                "delta".to_string()
                            }
                        } else {
                            chunk.event_type
                        },
                        session_id: Some(chunk.session_id),
                        agent_name: Some(chunk.agent_name),
                        delta_text: Some(chunk.delta_text),
                        accumulated_text: Some(chunk.accumulated_text),
                        reasoning_delta_text: if chunk.reasoning_delta_text.is_empty() {
                            None
                        } else {
                            Some(chunk.reasoning_delta_text)
                        },
                        reasoning_accumulated_text: if chunk.reasoning_accumulated_text.is_empty() {
                            None
                        } else {
                            Some(chunk.reasoning_accumulated_text)
                        },
                        history_content_blocks_json: if chunk.history_content_blocks_json.is_empty()
                        {
                            None
                        } else {
                            Some(chunk.history_content_blocks_json)
                        },
                        debug_title: if chunk.debug_title.is_empty() {
                            None
                        } else {
                            Some(chunk.debug_title)
                        },
                        debug_level: if chunk.debug_level.is_empty() {
                            None
                        } else {
                            Some(chunk.debug_level)
                        },
                        debug_text: if chunk.debug_text.is_empty() {
                            None
                        } else {
                            Some(chunk.debug_text)
                        },
                        confirmation_id: if chunk.confirmation_id.is_empty() {
                            None
                        } else {
                            Some(chunk.confirmation_id)
                        },
                        confirmation_hint: if chunk.confirmation_hint.is_empty() {
                            None
                        } else {
                            Some(chunk.confirmation_hint)
                        },
                        confirmation_tool_name: if chunk.confirmation_tool_name.is_empty() {
                            None
                        } else {
                            Some(chunk.confirmation_tool_name)
                        },
                        confirmation_tool_args_json: if chunk.confirmation_tool_args_json.is_empty()
                        {
                            None
                        } else {
                            Some(chunk.confirmation_tool_args_json)
                        },
                        error: if chunk.error.is_empty() {
                            None
                        } else {
                            Some(chunk.error)
                        },
                        done: chunk.done,
                    },
                );
            }

            Ok::<(), String>(())
        };

        let outcome = tokio::select! {
            _ = &mut stop_rx => StreamTaskOutcome::Stopped,
            result = stream_result => match result {
                Ok(()) => StreamTaskOutcome::Completed,
                Err(error) => StreamTaskOutcome::Failed(error),
            },
        };

        capability_callback_handle.shutdown();
        persistence_callback_handle.shutdown();

        remove_ai_chat_stream_control(
            event_app_handle.state::<AppState>().inner(),
            &stream_id_for_task,
        );

        match outcome {
            StreamTaskOutcome::Completed => {}
            StreamTaskOutcome::Stopped => {
                ai_events::emit_ai_stream_event(
                    &event_app_handle,
                    AiChatStreamEventPayload {
                        stream_id: stream_id_for_task,
                        event_type: "stopped".to_string(),
                        session_id: Some(resolved_session_id),
                        agent_name: None,
                        delta_text: None,
                        accumulated_text: None,
                        reasoning_delta_text: None,
                        reasoning_accumulated_text: None,
                        history_content_blocks_json: None,
                        debug_title: None,
                        debug_level: None,
                        debug_text: None,
                        confirmation_id: None,
                        confirmation_hint: None,
                        confirmation_tool_name: None,
                        confirmation_tool_args_json: None,
                        error: None,
                        done: true,
                    },
                );
            }
            StreamTaskOutcome::Failed(error) => {
                ai_events::emit_ai_stream_event(
                    &event_app_handle,
                    AiChatStreamEventPayload {
                        stream_id: stream_id_for_task,
                        event_type: "error".to_string(),
                        session_id: Some(resolved_session_id),
                        agent_name: None,
                        delta_text: None,
                        accumulated_text: None,
                        reasoning_delta_text: None,
                        reasoning_accumulated_text: None,
                        history_content_blocks_json: None,
                        debug_title: None,
                        debug_level: None,
                        debug_text: None,
                        confirmation_id: None,
                        confirmation_hint: None,
                        confirmation_tool_name: None,
                        confirmation_tool_args_json: None,
                        error: Some(error),
                        done: true,
                    },
                );
            }
        }
    });

    Ok(AiChatStreamStartResponse { stream_id })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::host::window_effects::WindowsAcrylicEffectConfig;
    use std::collections::HashMap;
    use std::sync::Mutex;

    fn new_test_app_state() -> AppState {
        AppState {
            current_vault: Mutex::new(None),
            vault_watcher: Mutex::new(None),
            pending_vault_write_trace_by_path: Mutex::new(HashMap::new()),
            ai_sidecar_runtime: Mutex::new(None),
            ai_chat_stream_controls: Mutex::new(HashMap::new()),
            windows_acrylic_effect_config: Mutex::new(WindowsAcrylicEffectConfig::default()),
        }
    }

    #[test]
    fn stop_ai_chat_stream_in_state_should_signal_and_remove_registered_control() {
        let app_state = new_test_app_state();
        let (stop_tx, stop_rx) = oneshot::channel();

        register_ai_chat_stream_control(&app_state, "stream-1", "session-1", stop_tx)
            .expect("应成功注册流控制句柄");

        let stopped =
            stop_ai_chat_stream_in_state("stream-1", &app_state).expect("停止流时不应返回错误");

        assert!(stopped);
        assert!(stop_rx.blocking_recv().is_ok());
        assert!(app_state
            .ai_chat_stream_controls
            .lock()
            .expect("应成功读取流控制表")
            .is_empty());
    }

    #[test]
    fn stop_ai_chat_stream_in_state_should_ignore_unknown_stream() {
        let app_state = new_test_app_state();

        let stopped = stop_ai_chat_stream_in_state("missing-stream", &app_state)
            .expect("缺失流也不应返回错误");

        assert!(!stopped);
    }
}

/// 提交一次 AI tool 确认结果，并继续同一会话的流式对话。
pub(crate) async fn submit_ai_chat_confirmation(
    confirmation_id: String,
    confirmed: bool,
    session_id: Option<String>,
    user_id: Option<String>,
    app_handle: AppHandle,
    state: State<'_, AppState>,
) -> Result<AiChatStreamStartResponse, String> {
    plugin_app_service::ensure_ai_backend_plugin_enabled(&state)?;
    let trimmed_confirmation_id = confirmation_id.trim().to_string();
    if trimmed_confirmation_id.is_empty() {
        return Err("confirmation_id 不能为空".to_string());
    }

    let stream_id = ai_events::next_ai_stream_id();
    let resolved_session_id = session_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "default".to_string());
    let resolved_user_id = user_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "desktop-user".to_string());
    let ai_settings = ai_chat_store::validate_ai_chat_settings_for_chat(
        ai_chat_store::load_ai_chat_settings(&state)?,
    )?;
    let vault_root = get_vault_root(&state)?;
    let sidecar_tools = tool_app_service::get_ai_sidecar_tool_catalog()?;
    let capability_callback_handle =
        tool_callback_app_service::start_sidecar_capability_callback_server(
            app_handle.clone(),
            vault_root.clone(),
        )
        .await?;
    let persistence_callback_handle =
        persistence_callback_app_service::start_sidecar_persistence_callback_server(vault_root)
            .await?;
    let endpoint = sidecar_manager::ensure_ai_sidecar_endpoint(&app_handle, &state).await?;

    ai_events::emit_ai_stream_event(
        &app_handle,
        AiChatStreamEventPayload {
            stream_id: stream_id.clone(),
            event_type: "started".to_string(),
            session_id: Some(resolved_session_id.clone()),
            agent_name: None,
            delta_text: None,
            accumulated_text: None,
            reasoning_delta_text: None,
            reasoning_accumulated_text: None,
            history_content_blocks_json: None,
            debug_title: None,
            debug_level: None,
            debug_text: None,
            confirmation_id: None,
            confirmation_hint: None,
            confirmation_tool_name: None,
            confirmation_tool_args_json: None,
            error: None,
            done: false,
        },
    );

    let (stop_tx, mut stop_rx) = oneshot::channel::<()>();
    register_ai_chat_stream_control(&state, &stream_id, &resolved_session_id, stop_tx)?;

    let event_app_handle = app_handle.clone();
    let stream_id_for_task = stream_id.clone();
    tauri::async_runtime::spawn(async move {
        let request = pb::ConfirmationRequest {
            session_id: resolved_session_id.clone(),
            user_id: resolved_user_id,
            confirmation_id: trimmed_confirmation_id,
            confirmed,
            vendor_config: ai_settings.field_values.clone(),
            vendor_id: ai_settings.vendor_id.clone(),
            model: ai_settings.model.clone(),
            tools: sidecar_tools,
            mcp_server_url: String::new(),
            mcp_auth_token: String::new(),
            capability_callback_url: capability_callback_handle.callback_url.clone(),
            capability_callback_token: capability_callback_handle.callback_token.clone(),
            persistence_callback_url: persistence_callback_handle.callback_url.clone(),
            persistence_callback_token: persistence_callback_handle.callback_token.clone(),
        };

        let stream_result = async {
            let mut client = grpc_client::connect_ai_sidecar_client(endpoint).await?;
            let mut response_stream = client
                .submit_confirmation(Request::new(request))
                .await
                .map_err(|error| format!("调用 AI sidecar confirmation 失败: {error}"))?
                .into_inner();

            while let Some(chunk) = response_stream
                .message()
                .await
                .map_err(|error| format!("读取 AI sidecar confirmation stream 失败: {error}"))?
            {
                ai_events::emit_ai_stream_event(
                    &event_app_handle,
                    AiChatStreamEventPayload {
                        stream_id: stream_id_for_task.clone(),
                        event_type: if chunk.event_type.trim().is_empty() {
                            if chunk.done {
                                "done".to_string()
                            } else {
                                "delta".to_string()
                            }
                        } else {
                            chunk.event_type
                        },
                        session_id: Some(chunk.session_id),
                        agent_name: Some(chunk.agent_name),
                        delta_text: Some(chunk.delta_text),
                        accumulated_text: Some(chunk.accumulated_text),
                        reasoning_delta_text: if chunk.reasoning_delta_text.is_empty() {
                            None
                        } else {
                            Some(chunk.reasoning_delta_text)
                        },
                        reasoning_accumulated_text: if chunk.reasoning_accumulated_text.is_empty() {
                            None
                        } else {
                            Some(chunk.reasoning_accumulated_text)
                        },
                        history_content_blocks_json: if chunk.history_content_blocks_json.is_empty()
                        {
                            None
                        } else {
                            Some(chunk.history_content_blocks_json)
                        },
                        debug_title: if chunk.debug_title.is_empty() {
                            None
                        } else {
                            Some(chunk.debug_title)
                        },
                        debug_level: if chunk.debug_level.is_empty() {
                            None
                        } else {
                            Some(chunk.debug_level)
                        },
                        debug_text: if chunk.debug_text.is_empty() {
                            None
                        } else {
                            Some(chunk.debug_text)
                        },
                        confirmation_id: if chunk.confirmation_id.is_empty() {
                            None
                        } else {
                            Some(chunk.confirmation_id)
                        },
                        confirmation_hint: if chunk.confirmation_hint.is_empty() {
                            None
                        } else {
                            Some(chunk.confirmation_hint)
                        },
                        confirmation_tool_name: if chunk.confirmation_tool_name.is_empty() {
                            None
                        } else {
                            Some(chunk.confirmation_tool_name)
                        },
                        confirmation_tool_args_json: if chunk.confirmation_tool_args_json.is_empty()
                        {
                            None
                        } else {
                            Some(chunk.confirmation_tool_args_json)
                        },
                        error: if chunk.error.is_empty() {
                            None
                        } else {
                            Some(chunk.error)
                        },
                        done: chunk.done,
                    },
                );
            }

            Ok::<(), String>(())
        };

        let outcome = tokio::select! {
            _ = &mut stop_rx => StreamTaskOutcome::Stopped,
            result = stream_result => match result {
                Ok(()) => StreamTaskOutcome::Completed,
                Err(error) => StreamTaskOutcome::Failed(error),
            },
        };

        capability_callback_handle.shutdown();
        persistence_callback_handle.shutdown();

        remove_ai_chat_stream_control(
            event_app_handle.state::<AppState>().inner(),
            &stream_id_for_task,
        );

        match outcome {
            StreamTaskOutcome::Completed => {}
            StreamTaskOutcome::Stopped => {
                ai_events::emit_ai_stream_event(
                    &event_app_handle,
                    AiChatStreamEventPayload {
                        stream_id: stream_id_for_task,
                        event_type: "stopped".to_string(),
                        session_id: Some(resolved_session_id),
                        agent_name: None,
                        delta_text: None,
                        accumulated_text: None,
                        reasoning_delta_text: None,
                        reasoning_accumulated_text: None,
                        history_content_blocks_json: None,
                        debug_title: None,
                        debug_level: None,
                        debug_text: None,
                        confirmation_id: None,
                        confirmation_hint: None,
                        confirmation_tool_name: None,
                        confirmation_tool_args_json: None,
                        error: None,
                        done: true,
                    },
                );
            }
            StreamTaskOutcome::Failed(error) => {
                ai_events::emit_ai_stream_event(
                    &event_app_handle,
                    AiChatStreamEventPayload {
                        stream_id: stream_id_for_task,
                        event_type: "error".to_string(),
                        session_id: Some(resolved_session_id),
                        agent_name: None,
                        delta_text: None,
                        accumulated_text: None,
                        reasoning_delta_text: None,
                        reasoning_accumulated_text: None,
                        history_content_blocks_json: None,
                        debug_title: None,
                        debug_level: None,
                        debug_text: None,
                        confirmation_id: None,
                        confirmation_hint: None,
                        confirmation_tool_name: None,
                        confirmation_tool_args_json: None,
                        error: Some(error),
                        done: true,
                    },
                );
            }
        }
    });

    Ok(AiChatStreamStartResponse { stream_id })
}
