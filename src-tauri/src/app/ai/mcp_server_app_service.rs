//! # AI MCP Server 应用服务
//!
//! 负责基于成熟的 `rmcp` SDK 在 Rust 侧暴露本地 MCP server，
//! 将现有 capability catalog 映射为标准 MCP tools，供后续 Go sidecar
//! 通过 MCP client/toolset 接入。
//!
//! 依赖：
//! - `tool_app_service`：提供 AI 可见工具目录；
//! - `execution_app_service`：执行底层 capability；
//! - `rmcp`：提供 MCP server 与 streamable HTTP transport。
//!
//! 使用示例：
//! - 在一次聊天会话开始前启动本地 MCP server；
//! - 将返回的 `server_url` 提供给 MCP client；
//! - 聊天结束时调用 `shutdown()` 释放监听端口与会话状态。

#![allow(dead_code)]

use std::borrow::Cow;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use axum::extract::State as AxumState;
use axum::http::{HeaderMap, Request, StatusCode};
use axum::middleware::{self, Next};
use axum::response::Response;
use axum::Router;
use rmcp::handler::server::router::tool::{ToolRoute, ToolRouter};
use rmcp::model::{
    CallToolRequestParams, CallToolResult, JsonObject, ListToolsResult, PaginatedRequestParams,
    ServerCapabilities, ServerInfo, Tool,
};
use rmcp::service::RequestContext;
use rmcp::transport::streamable_http_server::{
    session::local::LocalSessionManager, StreamableHttpServerConfig, StreamableHttpService,
};
use rmcp::{ErrorData, ServerHandler};
use tauri::AppHandle;
use tokio::net::TcpListener;
use tokio::sync::oneshot;

use crate::app::ai::tool_app_service;
use crate::app::capability::execution_app_service;
use crate::domain::ai::sidecar_contract::SidecarCapabilityCallRequest;

static MCP_SERVER_SEQUENCE: AtomicU64 = AtomicU64::new(1);

#[derive(Clone)]
struct McpAuthState {
    auth_token: String,
}

/// Rust 本地 MCP server 句柄。
///
/// `server_url` 用于 MCP client 建立连接；`auth_token` 用于后续 client
/// 以 header 方式完成本地鉴权；`shutdown()` 用于结束当前会话级 server。
pub(crate) struct OfiveMcpServerHandle {
    pub server_url: String,
    pub auth_token: String,
    shutdown_sender: Option<oneshot::Sender<()>>,
}

impl OfiveMcpServerHandle {
    /// 关闭当前 MCP server。
    pub(crate) fn shutdown(mut self) {
        if let Some(sender) = self.shutdown_sender.take() {
            let _ = sender.send(());
        }
    }
}

/// 启动一次会话级本地 MCP server。
///
/// 该 server 监听 `127.0.0.1` 的临时端口，并通过 streamable HTTP
/// 暴露标准 MCP tools 接口。
pub(crate) async fn start_ofive_mcp_server(
    app_handle: AppHandle,
) -> Result<OfiveMcpServerHandle, String> {
    let auth_token = next_mcp_auth_token();
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|error| format!("启动 MCP server 失败: {error}"))?;
    let local_addr = listener
        .local_addr()
        .map_err(|error| format!("读取 MCP server 地址失败: {error}"))?;
    let server_url = format!("http://{local_addr}/mcp");
    let (shutdown_sender, shutdown_receiver) = oneshot::channel::<()>();
    let auth_state = McpAuthState {
        auth_token: auth_token.clone(),
    };

    let service: StreamableHttpService<OfiveCapabilityMcpServer, LocalSessionManager> =
        StreamableHttpService::new(
            move || Ok(OfiveCapabilityMcpServer::new(app_handle.clone())),
            Default::default(),
            StreamableHttpServerConfig {
                stateful_mode: true,
                ..Default::default()
            },
        );

    let router =
        Router::new()
            .nest_service("/mcp", service)
            .route_layer(middleware::from_fn_with_state(
                auth_state,
                authorize_mcp_request,
            ));

    tauri::async_runtime::spawn(async move {
        let server = axum::serve(listener, router).with_graceful_shutdown(async move {
            let _ = shutdown_receiver.await;
        });

        if let Err(error) = server.await {
            log::warn!("[ai-mcp-server] server exited with error: {error}");
        }
    });

    log::info!("[ai-mcp-server] server started: url={server_url}");

    Ok(OfiveMcpServerHandle {
        server_url,
        auth_token,
        shutdown_sender: Some(shutdown_sender),
    })
}

/// MCP server 实现。
///
/// @state
/// - `app_handle` - 当前 Tauri 应用句柄 (AppHandle) [会话启动时注入]
/// - `tool_router` - MCP tool 路由表 (ToolRouter<Self>) [基于 capability catalog 构建]
///
/// @lifecycle
/// - 初始化时机：每次启动会话级 MCP server 时创建一个实例
/// - 数据来源：AI tool catalog 与 capability execution service
/// - 更新触发：当前实现为静态会话快照，不在运行期热更新
/// - 清理时机：HTTP server 关闭时释放
///
/// @sync
/// - 与后端同步：直接调用本地 capability execution service
/// - 缓存策略：不缓存 tool 执行结果
/// - 与其他Store的关系：无
#[derive(Clone)]
struct OfiveCapabilityMcpServer {
    /// 当前 Tauri 应用句柄，用于获取 app state 并执行 capability。
    app_handle: AppHandle,
    /// 基于平台注册能力构建出的 MCP tool 路由表。
    tool_router: ToolRouter<Self>,
}

impl OfiveCapabilityMcpServer {
    /// 创建 MCP server 实例。
    fn new(app_handle: AppHandle) -> Self {
        Self {
            app_handle,
            tool_router: build_tool_router(),
        }
    }
}

impl ServerHandler for OfiveCapabilityMcpServer {
    /// 返回 MCP server 元信息。
    fn get_info(&self) -> ServerInfo {
        ServerInfo::new(ServerCapabilities::builder().enable_tools().build())
            .with_instructions(
                "Use these tools to inspect the local vault. Prefer tool calls whenever the user asks for vault file contents, outline, backlinks, search, or graph data.",
            )
    }

    /// 列出当前 MCP server 暴露的 tools。
    fn list_tools(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<rmcp::RoleServer>,
    ) -> impl std::future::Future<Output = Result<ListToolsResult, rmcp::ErrorData>> + Send + '_
    {
        std::future::ready(Ok(ListToolsResult::with_all_items(
            self.tool_router.list_all(),
        )))
    }

    /// 执行一次 MCP tool 调用。
    fn call_tool(
        &self,
        request: CallToolRequestParams,
        context: RequestContext<rmcp::RoleServer>,
    ) -> impl std::future::Future<Output = Result<CallToolResult, rmcp::ErrorData>> + Send + '_
    {
        let tool_call_context =
            rmcp::handler::server::tool::ToolCallContext::new(self, request, context);
        async move {
            self.tool_router
                .call(tool_call_context)
                .await
                .map_err(Into::into)
        }
    }

    /// 查询指定 tool 定义。
    fn get_tool(&self, name: &str) -> Option<Tool> {
        self.tool_router.get(name).cloned()
    }
}

fn build_tool_router() -> ToolRouter<OfiveCapabilityMcpServer> {
    let mut router = ToolRouter::new();
    for tool in tool_app_service::get_ai_tool_catalog() {
        let capability_id = tool.capability_id.clone();
        let tool_name = tool.name.clone();
        let description = tool.description.clone();
        let input_schema = schema_object_from_value(tool.input_schema);

        router.add_route(ToolRoute::new_dyn(
            Tool::new(Cow::Owned(tool_name), description, input_schema),
            move |context| {
                let capability_id = capability_id.clone();
                Box::pin(async move {
                    execute_mcp_tool_call(context.service, &capability_id, context.arguments).await
                })
            },
        ));
    }

    router
}

async fn execute_mcp_tool_call(
    server: &OfiveCapabilityMcpServer,
    capability_id: &str,
    arguments: Option<JsonObject>,
) -> Result<CallToolResult, ErrorData> {
    let request = SidecarCapabilityCallRequest::new(
        capability_id.to_string(),
        serde_json::Value::Object(arguments.unwrap_or_default()),
    );
    let result =
        execution_app_service::execute_sidecar_capability_call(&server.app_handle, request);

    if result.success {
        Ok(CallToolResult::structured(result.output))
    } else {
        Ok(CallToolResult::structured_error(serde_json::json!({
            "capabilityId": result.capability_id,
            "error": result.error.unwrap_or_else(|| "unknown capability error".to_string()),
        })))
    }
}

async fn authorize_mcp_request(
    AxumState(state): AxumState<McpAuthState>,
    headers: HeaderMap,
    request: Request<axum::body::Body>,
    next: Next,
) -> Result<Response, StatusCode> {
    if is_authorized(&headers, &state.auth_token) {
        Ok(next.run(request).await)
    } else {
        Err(StatusCode::UNAUTHORIZED)
    }
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

fn next_mcp_auth_token() -> String {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    let sequence = MCP_SERVER_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    format!("ofive-mcp-{timestamp}-{sequence}")
}

fn schema_object_from_value(value: serde_json::Value) -> JsonObject {
    match value {
        serde_json::Value::Object(object) => object,
        _ => JsonObject::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::build_tool_router;

    #[test]
    fn build_tool_router_should_expose_registered_vault_tools() {
        let tool_names = build_tool_router()
            .list_all()
            .into_iter()
            .map(|tool| tool.name.to_string())
            .collect::<Vec<_>>();

        assert!(
            tool_names.contains(&"vault_read_markdown_file".to_string()),
            "MCP tool router 应暴露 read markdown tool"
        );
        assert!(
            tool_names.contains(&"vault_search_markdown_files".to_string()),
            "MCP tool router 应暴露 search markdown tool"
        );
    }

    #[test]
    fn schema_object_from_value_should_fallback_to_empty_object_for_non_object_schema() {
        let object = super::schema_object_from_value(serde_json::json!("invalid"));

        assert!(object.is_empty());
    }
}
