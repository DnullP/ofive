//! # AI sidecar 生命周期模块
//!
//! 管理 Go sidecar 的启动、端口分配、健康检查与运行时状态复用。

use std::net::TcpListener;
use std::time::Duration;

use tauri::{AppHandle, State};
use tauri_plugin_shell::process::CommandEvent;
use tauri_plugin_shell::ShellExt;
use tonic::Request;

use crate::ai_service::pb;
use crate::infra::ai::grpc_client;
use crate::infra::logging;
use crate::state::{AiSidecarRuntime, AppState};

const SIDECAR_HEALTH_RETRY_COUNT: usize = 30;
const SIDECAR_HEALTH_RETRY_DELAY_MS: u64 = 100;

/// 确保当前存在一个可用的 AI sidecar endpoint。
pub(crate) async fn ensure_ai_sidecar_endpoint(
    app_handle: &AppHandle,
    state: &State<'_, AppState>,
) -> Result<String, String> {
    let current_runtime = {
        let guard = state
            .ai_sidecar_runtime
            .lock()
            .map_err(|error| format!("读取 AI sidecar 状态失败: {error}"))?;
        guard.as_ref().map(|runtime| (runtime.port, runtime.endpoint.clone()))
    };

    if let Some((port, endpoint)) = current_runtime {
        if wait_for_sidecar_ready(endpoint.clone()).await.is_ok() {
            log::debug!(
                "[ai-service] reuse healthy sidecar runtime: port={} endpoint={}",
                port,
                endpoint
            );
            return Ok(endpoint);
        }

        let mut guard = state
            .ai_sidecar_runtime
            .lock()
            .map_err(|error| format!("重置 AI sidecar 状态失败: {error}"))?;
        if let Some(runtime) = guard.take() {
            log::warn!(
                "[ai-service] sidecar runtime unhealthy, restarting: port={} endpoint={}",
                runtime.port,
                runtime.endpoint
            );
            let _ = runtime.child.kill();
        }
    }

    let endpoint = spawn_sidecar(app_handle, state)?;
    wait_for_sidecar_ready(endpoint.clone()).await?;
    Ok(endpoint)
}

/// 启动 sidecar 进程并注册到全局运行时状态。
fn spawn_sidecar(app_handle: &AppHandle, state: &State<'_, AppState>) -> Result<String, String> {
    let mut guard = state
        .ai_sidecar_runtime
        .lock()
        .map_err(|error| format!("写入 AI sidecar 状态失败: {error}"))?;

    if let Some(runtime) = guard.as_ref() {
        log::debug!(
            "[ai-service] sidecar runtime already registered: port={} endpoint={}",
            runtime.port,
            runtime.endpoint
        );
        return Ok(runtime.endpoint.clone());
    }

    let port = allocate_local_port()?;
    let endpoint = format!("http://127.0.0.1:{port}");
    let command = app_handle
        .shell()
        .sidecar("ofive-ai-sidecar")
        .map_err(|error| format!("创建 AI sidecar 命令失败: {error}"))?
        .args(["--port", &port.to_string()]);
    let (mut receiver, child) = command
        .spawn()
        .map_err(|error| format!("启动 AI sidecar 失败: {error}"))?;

    tauri::async_runtime::spawn(async move {
        while let Some(event) = receiver.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => {
                    let text = String::from_utf8_lossy(&bytes);
                    logging::forward_sidecar_output("stdout", &text);
                }
                CommandEvent::Stderr(bytes) => {
                    let text = String::from_utf8_lossy(&bytes);
                    logging::forward_sidecar_output("stderr", &text);
                }
                _ => {}
            }
        }
    });

    log::info!("[ai-service] sidecar spawned: port={port} endpoint={endpoint}");
    *guard = Some(AiSidecarRuntime {
        port,
        endpoint: endpoint.clone(),
        child,
    });

    Ok(endpoint)
}

/// 分配一个仅供本地 sidecar 使用的空闲端口。
fn allocate_local_port() -> Result<u16, String> {
    let listener = TcpListener::bind("127.0.0.1:0")
        .map_err(|error| format!("分配 AI sidecar 端口失败: {error}"))?;
    let port = listener
        .local_addr()
        .map_err(|error| format!("读取 AI sidecar 本地端口失败: {error}"))?
        .port();
    drop(listener);
    Ok(port)
}

/// 等待 sidecar 健康检查通过。
async fn wait_for_sidecar_ready(endpoint: String) -> Result<(), String> {
    let mut last_error = String::new();

    for _ in 0..SIDECAR_HEALTH_RETRY_COUNT {
        match grpc_client::connect_ai_sidecar_client(endpoint.clone()).await {
            Ok(mut client) => match client.health(Request::new(pb::HealthRequest {})).await {
                Ok(_) => return Ok(()),
                Err(error) => {
                    last_error = error.to_string();
                }
            },
            Err(error) => {
                last_error = error;
            }
        }

        tokio::time::sleep(Duration::from_millis(SIDECAR_HEALTH_RETRY_DELAY_MS)).await;
    }

    Err(format!("等待 AI sidecar 就绪超时: {last_error}"))
}