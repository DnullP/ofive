//! # AI Persistence Callback 应用服务
//!
//! 在 Rust 侧暴露 sidecar 可调用的宿主持久化回调端点，使 sidecar 能通过
//! 稳定协议请求宿主持久化能力，而不是直接感知底层文件布局。

use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use axum::extract::State as AxumState;
use axum::http::{HeaderMap, StatusCode};
use axum::routing::post;
use axum::{Json, Router};
use tokio::net::TcpListener;
use tokio::sync::oneshot;

use crate::app::persistence::persistence_app_service;
use crate::shared::persistence_contracts::{PersistenceRequest, PersistenceResponse};

static PERSISTENCE_CALLBACK_SEQUENCE: AtomicU64 = AtomicU64::new(1);

#[derive(Clone)]
struct PersistenceCallbackServerState {
    vault_root: PathBuf,
    callback_token: String,
}

/// sidecar persistence callback 句柄。
pub(crate) struct SidecarPersistenceCallbackHandle {
    /// sidecar 应调用的 callback URL。
    pub callback_url: String,
    /// sidecar 回调鉴权 token。
    pub callback_token: String,
    shutdown_sender: Option<oneshot::Sender<()>>,
}

impl SidecarPersistenceCallbackHandle {
    /// 关闭本次聊天绑定的 persistence callback server。
    pub(crate) fn shutdown(mut self) {
        if let Some(sender) = self.shutdown_sender.take() {
            let _ = sender.send(());
        }
    }
}

/// 启动 sidecar persistence callback server。
pub(crate) async fn start_sidecar_persistence_callback_server(
    vault_root: PathBuf,
) -> Result<SidecarPersistenceCallbackHandle, String> {
    let callback_token = next_callback_token();
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|error| format!("启动 sidecar persistence callback server 失败: {error}"))?;
    let local_addr = listener
        .local_addr()
        .map_err(|error| format!("读取 sidecar persistence callback server 地址失败: {error}"))?;
    let callback_url = format!("http://{local_addr}/persistence/state");
    let (shutdown_sender, shutdown_receiver) = oneshot::channel::<()>();

    let router = Router::new()
        .route("/persistence/state", post(handle_persistence_request))
        .with_state(PersistenceCallbackServerState {
            vault_root,
            callback_token: callback_token.clone(),
        });

    tauri::async_runtime::spawn(async move {
        let server = axum::serve(listener, router).with_graceful_shutdown(async move {
            let _ = shutdown_receiver.await;
        });

        if let Err(error) = server.await {
            log::warn!(
                "[ai-persistence-callback] callback server exited with error: {error}"
            );
        }
    });

    log::info!(
        "[ai-persistence-callback] callback server started: url={}",
        callback_url
    );

    Ok(SidecarPersistenceCallbackHandle {
        callback_url,
        callback_token,
        shutdown_sender: Some(shutdown_sender),
    })
}

async fn handle_persistence_request(
    headers: HeaderMap,
    AxumState(state): AxumState<PersistenceCallbackServerState>,
    Json(request): Json<PersistenceRequest>,
) -> Result<Json<PersistenceResponse>, (StatusCode, String)> {
    if !is_authorized(&headers, &state.callback_token) {
        return Err((StatusCode::UNAUTHORIZED, "unauthorized".to_string()));
    }

    persistence_app_service::execute_persistence_request_in_root(&state.vault_root, request)
        .map(Json)
        .map_err(|error| (StatusCode::INTERNAL_SERVER_ERROR, error))
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
    let sequence = PERSISTENCE_CALLBACK_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    format!("ofive-sidecar-persistence-{timestamp}-{sequence}")
}

#[cfg(test)]
mod tests {
    use super::start_sidecar_persistence_callback_server;
    use crate::shared::persistence_contracts::{
        PersistenceAction, PersistenceRequest, PersistenceResponseStatus, PersistenceScope,
        PERSISTENCE_CONTRACT_API_VERSION,
    };
    use reqwest::StatusCode;
    use serde_json::json;
    use std::fs;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    static TEST_ROOT_SEQ: AtomicU64 = AtomicU64::new(1);

    fn create_test_root() -> PathBuf {
        let sequence = TEST_ROOT_SEQ.fetch_add(1, Ordering::Relaxed);
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0);
        let root = std::env::temp_dir().join(format!(
            "ofive-persistence-callback-test-{}-{}",
            unique, sequence
        ));
        fs::create_dir_all(root.join(".ofive")).expect("应成功创建测试根目录");
        root
    }

    fn create_broken_test_root() -> PathBuf {
        let sequence = TEST_ROOT_SEQ.fetch_add(1, Ordering::Relaxed);
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0);
        let root = std::env::temp_dir().join(format!(
            "ofive-persistence-callback-broken-test-{}-{}",
            unique, sequence
        ));
        fs::create_dir_all(&root).expect("应成功创建测试根目录");
        fs::write(root.join(".ofive"), "broken").expect("应成功写入冲突文件");
        root
    }

    fn build_request() -> PersistenceRequest {
        PersistenceRequest {
            api_version: PERSISTENCE_CONTRACT_API_VERSION,
            module_id: "ai-chat".to_string(),
            runtime_id: "go-sidecar".to_string(),
            session_id: Some("session-1".to_string()),
            task_id: Some("task-1".to_string()),
            trace_id: Some("trace-1".to_string()),
            scope: PersistenceScope::ModulePrivate,
            owner: "ai-chat".to_string(),
            state_key: Some("history".to_string()),
            schema_version: 1,
            expected_revision: None,
            action: PersistenceAction::Save,
            payload: Some(json!({"messages": ["hello"]})),
        }
    }

    #[tokio::test]
    async fn persistence_callback_server_should_accept_authorized_request() {
        let root = create_test_root();
        let handle = start_sidecar_persistence_callback_server(root.clone())
            .await
            .expect("应成功启动 persistence callback server");

        let client = reqwest::Client::new();
        let response = client
            .post(&handle.callback_url)
            .header("x-ofive-sidecar-token", &handle.callback_token)
            .json(&build_request())
            .send()
            .await
            .expect("应成功发送 authorized 请求");

        assert_eq!(response.status(), StatusCode::OK);
        let payload = response
            .json::<crate::shared::persistence_contracts::PersistenceResponse>()
            .await
            .expect("应成功解析响应");
        assert_eq!(payload.status, PersistenceResponseStatus::Ok);
        assert_eq!(payload.state_key.as_deref(), Some("history"));

        handle.shutdown();
        let _ = fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn persistence_callback_server_should_reject_unauthorized_request() {
        let root = create_test_root();
        let handle = start_sidecar_persistence_callback_server(root.clone())
            .await
            .expect("应成功启动 persistence callback server");

        let client = reqwest::Client::new();
        let response = client
            .post(&handle.callback_url)
            .json(&build_request())
            .send()
            .await
            .expect("应成功发送 unauthorized 请求");

        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);

        handle.shutdown();
        let _ = fs::remove_dir_all(root);
    }

    #[tokio::test]
    async fn persistence_callback_server_should_return_internal_server_error_for_storage_failure() {
        let root = create_broken_test_root();
        let handle = start_sidecar_persistence_callback_server(root.clone())
            .await
            .expect("应成功启动 persistence callback server");

        let client = reqwest::Client::new();
        let response = client
            .post(&handle.callback_url)
            .header("x-ofive-sidecar-token", &handle.callback_token)
            .json(&build_request())
            .send()
            .await
            .expect("应成功发送请求");

        assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);

        handle.shutdown();
        let _ = fs::remove_file(root.join(".ofive"));
        let _ = fs::remove_dir_all(root);
    }
}