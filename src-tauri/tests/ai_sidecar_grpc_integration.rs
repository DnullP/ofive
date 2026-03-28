//! AI sidecar gRPC 集成测试。
//!
//! 验证 Rust 能直接拉起 Go sidecar，并通过 gRPC 接收流式聊天结果。

use std::collections::HashMap;
use std::fs::File;
use std::net::TcpListener;
use std::path::Path;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::sync::Mutex;
use std::time::SystemTime;
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

#[derive(Clone)]
struct PersistenceCallbackState {
    expected_token: String,
    call_count: Arc<AtomicUsize>,
    entries: Arc<Mutex<HashMap<String, PersistenceEntry>>>,
}

#[derive(Clone)]
struct PersistenceEntry {
    schema_version: u32,
    revision: String,
    payload: serde_json::Value,
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

async fn spawn_mock_persistence_callback_server(
    expected_token: String,
) -> Result<(String, tokio::sync::oneshot::Sender<()>, Arc<AtomicUsize>), String> {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|error| format!("启动 mock persistence callback server 失败: {error}"))?;
    let address = listener
        .local_addr()
        .map_err(|error| format!("读取 mock persistence callback server 地址失败: {error}"))?;
    let (shutdown_sender, shutdown_receiver) = tokio::sync::oneshot::channel();

    let call_count = Arc::new(AtomicUsize::new(0));
    let router = Router::new()
        .route("/persistence/state", post(handle_mock_persistence_callback))
        .with_state(PersistenceCallbackState {
            expected_token,
            call_count: call_count.clone(),
            entries: Arc::new(Mutex::new(HashMap::new())),
        });

    tokio::spawn(async move {
        let server = axum::serve(listener, router).with_graceful_shutdown(async move {
            let _ = shutdown_receiver.await;
        });
        let _ = server.await;
    });

    Ok((
        format!("http://{address}/persistence/state"),
        shutdown_sender,
        call_count,
    ))
}

async fn handle_mock_persistence_callback(
    headers: HeaderMap,
    AxumState(state): AxumState<PersistenceCallbackState>,
    Json(request): Json<serde_json::Value>,
) -> Result<Json<serde_json::Value>, (StatusCode, String)> {
    state.call_count.fetch_add(1, Ordering::SeqCst);

    let token = headers
        .get("x-ofive-sidecar-token")
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();
    if token != state.expected_token {
        return Err((StatusCode::UNAUTHORIZED, "unexpected token".to_string()));
    }

    let action = request
        .get("action")
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default();
    let owner = request
        .get("owner")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("ai-chat");
    let state_key = request
        .get("stateKey")
        .and_then(serde_json::Value::as_str)
        .unwrap_or_default()
        .to_string();
    let schema_version = request
        .get("schemaVersion")
        .and_then(serde_json::Value::as_u64)
        .unwrap_or(1) as u32;

    let mut entries = state.entries.lock().map_err(|_| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            "lock poisoned".to_string(),
        )
    })?;

    let response = match action {
        "save" => {
            let revision = format!("rev-{}", state.call_count.load(Ordering::SeqCst));
            let payload = request
                .get("payload")
                .cloned()
                .unwrap_or_else(|| serde_json::json!({}));
            entries.insert(
                state_key.clone(),
                PersistenceEntry {
                    schema_version,
                    revision: revision.clone(),
                    payload: payload.clone(),
                },
            );
            serde_json::json!({
                "status": "ok",
                "owner": owner,
                "stateKey": state_key,
                "schemaVersion": schema_version,
                "revision": revision,
                "payload": payload,
                "items": []
            })
        }
        "load" => match entries.get(&state_key) {
            Some(entry) => serde_json::json!({
                "status": "ok",
                "owner": owner,
                "stateKey": state_key,
                "schemaVersion": entry.schema_version,
                "revision": entry.revision,
                "payload": entry.payload,
                "items": []
            }),
            None => serde_json::json!({
                "status": "not_found",
                "owner": owner,
                "stateKey": state_key,
                "items": [],
                "errorCode": "state_not_found",
                "errorMessage": "state not found"
            }),
        },
        "list" => {
            let items: Vec<serde_json::Value> = entries
                .iter()
                .map(|(key, entry)| {
                    serde_json::json!({
                        "owner": owner,
                        "stateKey": key,
                        "schemaVersion": entry.schema_version,
                        "revision": entry.revision,
                    })
                })
                .collect();
            serde_json::json!({
                "status": "ok",
                "owner": owner,
                "items": items
            })
        }
        "delete" => {
            entries.remove(&state_key);
            serde_json::json!({
                "status": "ok",
                "owner": owner,
                "stateKey": state_key,
                "items": []
            })
        }
        _ => serde_json::json!({
            "status": "error",
            "owner": owner,
            "items": [],
            "errorCode": "unsupported_scope",
            "errorMessage": format!("unsupported action: {action}")
        }),
    };

    Ok(Json(response))
}

fn allocate_port() -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").expect("应成功分配测试端口");
    let port = listener.local_addr().expect("应成功读取测试端口").port();
    drop(listener);
    port
}

fn workspace_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("应成功定位工作区根目录")
    .to_path_buf()
}

fn resolve_prebuilt_sidecar_path() -> PathBuf {
    let binaries_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("binaries");
    let candidates = std::fs::read_dir(&binaries_dir)
        .unwrap_or_else(|error| {
            panic!(
                "应成功读取 sidecar 二进制目录: path={} error={error}",
                binaries_dir.display(),
            )
        });

    let mut matches: Vec<PathBuf> = candidates
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.file_name()
                .and_then(|name| name.to_str())
                .map(|name| name.starts_with("ofive-ai-sidecar-"))
                .unwrap_or(false)
        })
        .collect();

    matches.sort();
    matches.into_iter().next().unwrap_or_else(|| {
        panic!(
            "未找到预构建 AI sidecar 二进制: path={}",
            binaries_dir.display(),
        )
    })
}

fn create_sidecar_log_path(port: u16) -> PathBuf {
    let timestamp = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .expect("系统时间应晚于 Unix epoch")
        .as_millis();
    std::env::temp_dir().join(format!(
        "ofive-ai-sidecar-test-{port}-{timestamp}.log",
    ))
}

fn spawn_sidecar(port: u16) -> (Child, PathBuf) {
    let sidecar_path = resolve_prebuilt_sidecar_path();
    let log_path = create_sidecar_log_path(port);
    let stdout_file = File::create(&log_path).unwrap_or_else(|error| {
        panic!(
            "应成功创建 sidecar stdout 日志文件: path={} error={error}",
            log_path.display(),
        )
    });
    let stderr_file = stdout_file.try_clone().unwrap_or_else(|error| {
        panic!(
            "应成功克隆 sidecar stderr 日志文件句柄: path={} error={error}",
            log_path.display(),
        )
    });

    let child = Command::new(&sidecar_path)
        .arg("--port")
        .arg(port.to_string())
        .current_dir(workspace_root())
        .stdout(Stdio::from(stdout_file))
        .stderr(Stdio::from(stderr_file))
        .spawn()
        .unwrap_or_else(|error| {
            panic!(
                "应成功启动预构建 Go AI sidecar: path={} error={error}",
                sidecar_path.display(),
            )
        });

    (child, log_path)
}

fn read_sidecar_log(log_path: &Path) -> String {
    std::fs::read_to_string(log_path).unwrap_or_else(|error| {
        format!(
            "<failed to read sidecar log: path={} error={error}>",
            log_path.display(),
        )
    })
}

async fn wait_for_health(
    endpoint: &str,
    child: &mut Child,
    log_path: &Path,
) -> pb::ai_agent_service_client::AiAgentServiceClient<tonic::transport::Channel> {
    for _ in 0..100 {
        if let Some(status) = child
            .try_wait()
            .expect("应成功轮询 sidecar 子进程状态")
        {
            panic!(
                "AI sidecar 在就绪前退出: status={} log={}\n{}",
                status,
                log_path.display(),
                read_sidecar_log(log_path),
            );
        }

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

    panic!(
        "AI sidecar 在预期时间内未就绪: log={}\n{}",
        log_path.display(),
        read_sidecar_log(log_path),
    );
}

#[tokio::test]
async fn ai_sidecar_streams_chat_chunks() {
    let port = allocate_port();
    let endpoint = format!("http://127.0.0.1:{port}");
    let (mut child, log_path) = spawn_sidecar(port);

    async {
        let mut client = wait_for_health(&endpoint, &mut child, &log_path).await;
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
                history: Vec::new(),
                persistence_callback_url: String::new(),
                persistence_callback_token: String::new(),
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
    let (mut child, log_path) = spawn_sidecar(port);
    let callback_token = "integration-callback-token".to_string();
    let (callback_url, shutdown_sender, call_count) =
        spawn_mock_callback_server(callback_token.clone())
            .await
            .expect("应成功启动 mock callback server");

    async {
        let mut client = wait_for_health(&endpoint, &mut child, &log_path).await;
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
                history: Vec::new(),
                persistence_callback_url: String::new(),
                persistence_callback_token: String::new(),
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
    let (mut child, log_path) = spawn_sidecar(port);
    let callback_token = "integration-callback-token".to_string();
    let (callback_url, shutdown_sender, call_count) =
        spawn_mock_callback_server(callback_token.clone())
            .await
            .expect("应成功启动 mock callback server");

    async {
        let mut client = wait_for_health(&endpoint, &mut child, &log_path).await;
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
                history: Vec::new(),
                persistence_callback_url: String::new(),
                persistence_callback_token: String::new(),
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

#[tokio::test]
async fn ai_sidecar_can_execute_explicit_persistence_callback() {
    let port = allocate_port();
    let endpoint = format!("http://127.0.0.1:{port}");
    let (mut child, log_path) = spawn_sidecar(port);
    let callback_token = "integration-persistence-token".to_string();
    let (callback_url, shutdown_sender, call_count) =
        spawn_mock_persistence_callback_server(callback_token.clone())
            .await
            .expect("应成功启动 mock persistence callback server");

    async {
        let mut client = wait_for_health(&endpoint, &mut child, &log_path).await;

        let save_response = client
            .chat(Request::new(pb::ChatRequest {
                session_id: "integration-session".to_string(),
                user_id: "integration-user".to_string(),
                message: r#"persist save {"stateKey":"history","schemaVersion":1,"payload":{"messages":["hello persistence"]}}"#
                    .to_string(),
                vendor_config: HashMap::new(),
                vendor_id: "mock-echo".to_string(),
                model: String::new(),
                tools: Vec::new(),
                capability_callback_url: String::new(),
                capability_callback_token: String::new(),
                mcp_server_url: String::new(),
                mcp_auth_token: String::new(),
                history: Vec::new(),
                persistence_callback_url: callback_url.clone(),
                persistence_callback_token: callback_token.clone(),
            }))
            .await
            .expect("应成功建立 persistence save 聊天流");

        let mut save_stream = save_response.into_inner();
        let mut save_text = String::new();
        while let Some(chunk) = save_stream.message().await.expect("应成功读取 save 聊天流") {
            save_text = chunk.accumulated_text;
        }

        assert!(save_text.contains("[persistence:save]"));
        assert!(save_text.contains("hello persistence"));
        assert!(save_text.contains("\"status\": \"ok\""));

        let load_response = client
            .chat(Request::new(pb::ChatRequest {
                session_id: "integration-session".to_string(),
                user_id: "integration-user".to_string(),
                message: r#"persist load {"stateKey":"history","schemaVersion":1}"#
                    .to_string(),
                vendor_config: HashMap::new(),
                vendor_id: "mock-echo".to_string(),
                model: String::new(),
                tools: Vec::new(),
                capability_callback_url: String::new(),
                capability_callback_token: String::new(),
                mcp_server_url: String::new(),
                mcp_auth_token: String::new(),
                history: Vec::new(),
                persistence_callback_url: callback_url,
                persistence_callback_token: callback_token,
            }))
            .await
            .expect("应成功建立 persistence load 聊天流");

        let mut load_stream = load_response.into_inner();
        let mut load_text = String::new();
        while let Some(chunk) = load_stream.message().await.expect("应成功读取 load 聊天流") {
            load_text = chunk.accumulated_text;
        }

        assert!(load_text.contains("[persistence:load]"));
        assert!(load_text.contains("hello persistence"));
        assert_eq!(call_count.load(Ordering::SeqCst), 2);
    }
    .await;

    let _ = shutdown_sender.send(());
    let _ = child.kill();
    let _ = child.wait();
}

#[tokio::test]
async fn ai_sidecar_can_resume_confirmation_via_host_persistence() {
    let port = allocate_port();
    let endpoint = format!("http://127.0.0.1:{port}");
    let (mut child, log_path) = spawn_sidecar(port);
    let callback_token = "integration-confirmation-token".to_string();
    let (callback_url, shutdown_sender, call_count) =
        spawn_mock_persistence_callback_server(callback_token.clone())
            .await
            .expect("应成功启动 confirmation persistence callback server");

    async {
        let mut client = wait_for_health(&endpoint, &mut child, &log_path).await;
        let response = client
            .chat(Request::new(pb::ChatRequest {
                session_id: "confirmation-session".to_string(),
                user_id: "integration-user".to_string(),
                message: r##"confirmtool {"confirmationId":"confirm-1","toolName":"vault.create_markdown_file","toolArgs":{"relativePath":"Notes/New.md","content":"# New"},"hint":"Please confirm this write.","responseText":"Pending create file"}"##
                    .to_string(),
                vendor_config: HashMap::new(),
                vendor_id: "mock-echo".to_string(),
                model: String::new(),
                tools: Vec::new(),
                capability_callback_url: String::new(),
                capability_callback_token: String::new(),
                mcp_server_url: String::new(),
                mcp_auth_token: String::new(),
                history: Vec::new(),
                persistence_callback_url: callback_url.clone(),
                persistence_callback_token: callback_token.clone(),
            }))
            .await
            .expect("应成功建立 confirmation 聊天流");

        let mut stream = response.into_inner();
        let confirmation_chunk = stream
            .message()
            .await
            .expect("应成功读取 confirmation 聊天流")
            .expect("应返回 confirmation chunk");

        assert_eq!(confirmation_chunk.event_type, "confirmation");
        assert_eq!(confirmation_chunk.confirmation_id, "confirm-1");
        assert_eq!(confirmation_chunk.confirmation_tool_name, "vault.create_markdown_file");
        assert!(confirmation_chunk.accumulated_text.contains("Pending create file"));

        let confirmation_response = client
            .submit_confirmation(Request::new(pb::ConfirmationRequest {
                session_id: "confirmation-session".to_string(),
                user_id: "integration-user".to_string(),
                confirmation_id: confirmation_chunk.confirmation_id,
                confirmed: true,
                vendor_config: HashMap::new(),
                vendor_id: "mock-echo".to_string(),
                model: String::new(),
                tools: Vec::new(),
                mcp_server_url: String::new(),
                mcp_auth_token: String::new(),
                capability_callback_url: String::new(),
                capability_callback_token: String::new(),
                persistence_callback_url: callback_url,
                persistence_callback_token: callback_token,
            }))
            .await
            .expect("应成功提交 confirmation");

        let mut confirmation_stream = confirmation_response.into_inner();
        let mut final_text = String::new();
        while let Some(chunk) = confirmation_stream
            .message()
            .await
            .expect("应成功读取 confirmation 结果流")
        {
            final_text = chunk.accumulated_text;
        }

        assert!(final_text.contains("[confirmation:approved]"));
        assert!(final_text.contains("vault.create_markdown_file"));
        assert!(final_text.contains("Notes/New.md"));
        assert_eq!(call_count.load(Ordering::SeqCst), 3);
    }
    .await;

    let _ = shutdown_sender.send(());
    let _ = child.kill();
    let _ = child.wait();
}
