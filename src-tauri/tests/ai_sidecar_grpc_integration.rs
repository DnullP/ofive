//! AI sidecar gRPC 集成测试。
//!
//! 验证 Rust 能直接拉起 Go sidecar，并通过 gRPC 接收流式聊天结果。

use std::collections::HashMap;
use std::net::TcpListener;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::Duration;

use axum::extract::State as AxumState;
use axum::http::{HeaderMap, StatusCode};
use axum::routing::post;
use axum::{Json, Router};
use tonic::Request;

pub mod pb {
    tonic::include_proto!("ofive.ai.v1");
}

#[derive(Clone)]
struct CallbackState {
    expected_token: String,
    call_count: Arc<AtomicUsize>,
}

async fn spawn_mock_callback_server(
    expected_token: String,
) -> Result<(String, tokio::sync::oneshot::Sender<()>, Arc<AtomicUsize>), String> {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|error| format!("启动 mock callback server 失败: {error}"))?;
    let address = listener
        .local_addr()
        .map_err(|error| format!("读取 mock callback server 地址失败: {error}"))?;
    let (shutdown_sender, shutdown_receiver) = tokio::sync::oneshot::channel();

    let call_count = Arc::new(AtomicUsize::new(0));
    let router = Router::new()
        .route("/capabilities/call", post(handle_mock_callback))
        .with_state(CallbackState {
            expected_token,
            call_count: call_count.clone(),
        });

    tokio::spawn(async move {
        let server = axum::serve(listener, router).with_graceful_shutdown(async move {
            let _ = shutdown_receiver.await;
        });
        let _ = server.await;
    });

    Ok((
        format!("http://{address}/capabilities/call"),
        shutdown_sender,
        call_count,
    ))
}

async fn handle_mock_callback(
    headers: HeaderMap,
    AxumState(state): AxumState<CallbackState>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    state.call_count.fetch_add(1, Ordering::SeqCst);

    let token = headers
        .get("x-ofive-sidecar-token")
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();
    if token != state.expected_token {
        return Err((StatusCode::UNAUTHORIZED, "unexpected token".to_string()));
    }

    Ok(Json(serde_json::json!({
        "schemaVersion": "2026-03-17",
        "capabilityId": "vault.read_markdown_file",
        "success": true,
        "output": {
            "relativePath": "Notes/A.md",
            "content": "# A"
        },
        "error": null
    })))
}

fn allocate_port() -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").expect("应成功分配测试端口");
    let port = listener.local_addr().expect("应成功读取测试端口").port();
    drop(listener);
    port
}

fn go_sidecar_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("应成功定位工作区根目录")
        .join("sidecars/go/ofive-ai-agent")
}

fn spawn_sidecar(port: u16) -> Child {
    Command::new("go")
        .arg("run")
        .arg("./cmd/ofive-ai-sidecar")
        .arg("--port")
        .arg(port.to_string())
        .current_dir(go_sidecar_dir())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .expect("应成功启动 Go AI sidecar")
}

async fn wait_for_health(
    endpoint: &str,
) -> pb::ai_agent_service_client::AiAgentServiceClient<tonic::transport::Channel> {
    for _ in 0..30 {
        if let Ok(mut client) =
            pb::ai_agent_service_client::AiAgentServiceClient::connect(endpoint.to_string()).await
        {
            if client
                .health(Request::new(pb::HealthRequest {}))
                .await
                .is_ok()
            {
                return client;
            }
        }

        tokio::time::sleep(Duration::from_millis(100)).await;
    }

    panic!("AI sidecar 在预期时间内未就绪");
}

#[tokio::test]
async fn ai_sidecar_streams_chat_chunks() {
    let port = allocate_port();
    let endpoint = format!("http://127.0.0.1:{port}");
    let mut child = spawn_sidecar(port);

    async {
        let mut client = wait_for_health(&endpoint).await;
        let response = client
            .chat(Request::new(pb::ChatRequest {
                session_id: "integration-session".to_string(),
                user_id: "integration-user".to_string(),
                message: "hello integration".to_string(),
                vendor_config: HashMap::new(),
                vendor_id: "mock-echo".to_string(),
                model: String::new(),
                tools: Vec::new(),
                capability_callback_url: String::new(),
                capability_callback_token: String::new(),
                mcp_server_url: String::new(),
                mcp_auth_token: String::new(),
            }))
            .await
            .expect("应成功建立聊天流");

        let mut stream = response.into_inner();
        let mut chunk_count = 0usize;
        let mut final_text = String::new();
        let mut saw_done = false;

        while let Some(chunk) = stream.message().await.expect("应成功读取聊天流") {
            chunk_count += 1;
            final_text = chunk.accumulated_text.clone();
            if chunk.done {
                saw_done = true;
            }
        }

        assert!(chunk_count > 0, "应至少收到一个流式 chunk");
        assert!(saw_done, "应收到 done=true 的结束 chunk");
        assert_eq!(final_text, "[ADK] hello integration");
    }
    .await;

    let _ = child.kill();
    let _ = child.wait();
}

#[tokio::test]
async fn ai_sidecar_can_execute_explicit_capability_callback() {
    let port = allocate_port();
    let endpoint = format!("http://127.0.0.1:{port}");
    let mut child = spawn_sidecar(port);
    let callback_token = "integration-callback-token".to_string();
    let (callback_url, shutdown_sender, call_count) =
        spawn_mock_callback_server(callback_token.clone())
            .await
            .expect("应成功启动 mock callback server");

    async {
        let mut client = wait_for_health(&endpoint).await;
        let response = client
            .chat(Request::new(pb::ChatRequest {
                session_id: "integration-session".to_string(),
                user_id: "integration-user".to_string(),
                message: r#"tool vault.read_markdown_file {"relativePath":"Notes/A.md"}"#
                    .to_string(),
                vendor_config: HashMap::new(),
                vendor_id: "mock-echo".to_string(),
                model: String::new(),
                tools: vec![pb::ToolDescriptor {
                    capability_id: "vault.read_markdown_file".to_string(),
                    name: "vault_read_markdown_file".to_string(),
                    description: "Read one markdown file".to_string(),
                    input_schema_json: r#"{"type":"object"}"#.to_string(),
                    output_schema_json: r#"{"type":"object"}"#.to_string(),
                    risk_level: "low".to_string(),
                    requires_confirmation: false,
                    api_version: "2026-03-17".to_string(),
                }],
                capability_callback_url: callback_url,
                capability_callback_token: callback_token,
                mcp_server_url: String::new(),
                mcp_auth_token: String::new(),
            }))
            .await
            .expect("应成功建立带 callback 的聊天流");

        let mut stream = response.into_inner();
        let mut final_text = String::new();
        while let Some(chunk) = stream.message().await.expect("应成功读取聊天流") {
            final_text = chunk.accumulated_text;
        }

        assert!(final_text.contains("[tool:vault.read_markdown_file]"));
        assert!(final_text.contains("Notes/A.md"));
        assert!(final_text.contains("# A"));
        assert_eq!(call_count.load(Ordering::SeqCst), 1);
    }
    .await;

    let _ = shutdown_sender.send(());
    let _ = child.kill();
    let _ = child.wait();
}

#[tokio::test]
async fn ai_sidecar_can_execute_planned_capability_callback_from_natural_language() {
    let port = allocate_port();
    let endpoint = format!("http://127.0.0.1:{port}");
    let mut child = spawn_sidecar(port);
    let callback_token = "integration-callback-token".to_string();
    let (callback_url, shutdown_sender, call_count) =
        spawn_mock_callback_server(callback_token.clone())
            .await
            .expect("应成功启动 mock callback server");

    async {
        let mut client = wait_for_health(&endpoint).await;
        let response = client
            .chat(Request::new(pb::ChatRequest {
                session_id: "integration-session".to_string(),
                user_id: "integration-user".to_string(),
                message: "请读取 Notes/A.md，并告诉我里面的内容".to_string(),
                vendor_config: HashMap::new(),
                vendor_id: "mock-echo".to_string(),
                model: String::new(),
                tools: vec![pb::ToolDescriptor {
                    capability_id: "vault.read_markdown_file".to_string(),
                    name: "vault_read_markdown_file".to_string(),
                    description: "Read one markdown file".to_string(),
                    input_schema_json: r#"{"type":"object"}"#.to_string(),
                    output_schema_json: r#"{"type":"object"}"#.to_string(),
                    risk_level: "low".to_string(),
                    requires_confirmation: false,
                    api_version: "2026-03-17".to_string(),
                }],
                capability_callback_url: callback_url,
                capability_callback_token: callback_token,
                mcp_server_url: String::new(),
                mcp_auth_token: String::new(),
            }))
            .await
            .expect("应成功建立带规划 callback 的聊天流");

        let mut stream = response.into_inner();
        let mut final_text = String::new();
        while let Some(chunk) = stream.message().await.expect("应成功读取聊天流") {
            final_text = chunk.accumulated_text;
        }

        assert!(final_text.contains("我已经读取到目标 Markdown 文件"));
        assert_eq!(call_count.load(Ordering::SeqCst), 1);
    }
    .await;

    let _ = shutdown_sender.send(());
    let _ = child.kill();
    let _ = child.wait();
}
