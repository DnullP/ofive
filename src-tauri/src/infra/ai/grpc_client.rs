//! # AI gRPC 客户端模块
//!
//! 负责建立 Rust 到 Go sidecar 的 gRPC 连接，作为 AI 应用服务访问
//! runtime 的底层通信适配层。

use tonic::transport::Channel;

use crate::shared::ai_service::pb;

/// AI sidecar gRPC 单条消息的收发上限。
///
/// 聊天流里的 tool result、history content blocks 与上下文快照可能承载较大的
/// Markdown 内容，默认 4MiB 上限会让 Rust 客户端在读取 stream 时失败。
pub const AI_SIDECAR_GRPC_MAX_MESSAGE_SIZE_BYTES: usize = 64 * 1024 * 1024;

/// 建立到指定 sidecar endpoint 的 gRPC 客户端连接。
pub async fn connect_ai_sidecar_client(
    endpoint: String,
) -> Result<pb::ai_agent_service_client::AiAgentServiceClient<Channel>, String> {
    let client = pb::ai_agent_service_client::AiAgentServiceClient::connect(endpoint.clone())
        .await
        .map_err(|error| format!("连接 AI sidecar 失败 endpoint={endpoint}: {error}"))?;

    Ok(client
        .max_decoding_message_size(AI_SIDECAR_GRPC_MAX_MESSAGE_SIZE_BYTES)
        .max_encoding_message_size(AI_SIDECAR_GRPC_MAX_MESSAGE_SIZE_BYTES))
}
