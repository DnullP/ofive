//! # 宿主持久化应用服务模块
//!
//! 负责将稳定的持久化协议请求编排到具体持久化基础设施，形成 sidecar /
//! runtime 可复用的宿主入口。

pub(crate) mod persistence_app_service;
