//! # AI gRPC 客户端模块
//!
//! 负责建立 Rust 到 Go sidecar 的 gRPC 连接，作为 AI 应用服务访问
//! runtime 的底层通信适配层。

use tonic::transport::Channel;

use crate::ai_service::pb;

/// 建立到指定 sidecar endpoint 的 gRPC 客户端连接。
pub(crate) async fn connect_ai_sidecar_client(
    endpoint: String,
) -> Result<pb::ai_agent_service_client::AiAgentServiceClient<Channel>, String> {
    pb::ai_agent_service_client::AiAgentServiceClient::connect(endpoint.clone())
        .await
        .map_err(|error| format!("连接 AI sidecar 失败 endpoint={endpoint}: {error}"))
}