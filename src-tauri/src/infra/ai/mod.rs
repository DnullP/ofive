//! # AI 基础设施模块
//!
//! 提供 AI 相关的底层技术实现，包括 sidecar 生命周期管理、
//! gRPC 客户端连接与 vendor 模型列表抓取。

pub(crate) mod grpc_client;
pub(crate) mod sidecar_manager;
pub(crate) mod vendor_model_fetcher;
