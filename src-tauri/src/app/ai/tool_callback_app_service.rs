//! # AI Tool Callback 应用服务
//!
//! 负责在 Rust 侧暴露本地 callback 端点，供 Go sidecar 在对话期间
//! 回调执行平台注册能力。

#![allow(dead_code)]

use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use axum::extract::State as AxumState;
use axum::http::{HeaderMap, StatusCode};
use axum::routing::post;
use axum::{Json, Router};
use tauri::AppHandle;
use tokio::net::TcpListener;
use tokio::sync::oneshot;

use crate::app::capability::execution_app_service;
use crate::domain::ai::sidecar_contract::{
    SidecarCapabilityCallRequest, SidecarCapabilityCallResult,
};

static CALLBACK_SEQUENCE: AtomicU64 = AtomicU64::new(1);

#[derive(Clone)]
struct ToolCallbackServerState {
    app_handle: AppHandle,
    callback_token: String,
}

/// sidecar callback 句柄。
pub(crate) struct SidecarCapabilityCallbackHandle {
    /// sidecar 应调用的 callback URL。
    pub callback_url: String,
    /// sidecar 回调鉴权 token。
    pub callback_token: String,
    shutdown_sender: Option<oneshot::Sender<()>>,
}

impl SidecarCapabilityCallbackHandle {
    /// 关闭本次聊天绑定的 callback server。
    pub(crate) fn shutdown(mut self) {
        if let Some(sender) = self.shutdown_sender.take() {
            let _ = sender.send(());
        }
    }
}

/// 启动 sidecar capability callback server。
pub(crate) async fn start_sidecar_capability_callback_server(
    app_handle: AppHandle,
) -> Result<SidecarCapabilityCallbackHandle, String> {
    let callback_token = next_callback_token();
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|error| format!("启动 sidecar callback server 失败: {error}"))?;
    let local_addr = listener
        .local_addr()
        .map_err(|error| format!("读取 sidecar callback server 地址失败: {error}"))?;
    let callback_url = format!("http://{local_addr}/capabilities/call");
    let (shutdown_sender, shutdown_receiver) = oneshot::channel::<()>();

    let router = Router::new()
        .route("/capabilities/call", post(handle_capability_call))
        .with_state(ToolCallbackServerState {
            app_handle,
            callback_token: callback_token.clone(),
        });

    tauri::async_runtime::spawn(async move {
        let server = axum::serve(listener, router).with_graceful_shutdown(async move {
            let _ = shutdown_receiver.await;
        });

        if let Err(error) = server.await {
            log::warn!("[ai-tool-callback] callback server exited with error: {error}");
        }
    });

    log::info!(
        "[ai-tool-callback] callback server started: url={}",
        callback_url
    );

    Ok(SidecarCapabilityCallbackHandle {
        callback_url,
        callback_token,
        shutdown_sender: Some(shutdown_sender),
    })
}

async fn handle_capability_call(
    headers: HeaderMap,
    AxumState(state): AxumState<ToolCallbackServerState>,
    Json(request): Json<SidecarCapabilityCallRequest>,
) -> Result<Json<SidecarCapabilityCallResult>, (StatusCode, String)> {
    if !is_authorized(&headers, &state.callback_token) {
        return Err((StatusCode::UNAUTHORIZED, "unauthorized".to_string()));
    }

    Ok(Json(
        execution_app_service::execute_sidecar_capability_call(&state.app_handle, request),
    ))
}

fn is_authorized(headers: &HeaderMap, expected_token: &str) -> bool {
    let callback_token = headers
        .get("x-ofive-sidecar-token")
        .and_then(|value| value.to_str().ok())
        .map(str::trim);
    if callback_token == Some(expected_token) {
        return true;
    }

    headers
        .get("authorization")
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .and_then(|value| value.strip_prefix("Bearer "))
        .map(str::trim)
        == Some(expected_token)
}

fn next_callback_token() -> String {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    let sequence = CALLBACK_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    format!("ofive-sidecar-{timestamp}-{sequence}")
}
