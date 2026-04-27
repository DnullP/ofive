//! # App Storage 应用服务模块
//!
//! 负责注册、管理与分配跨仓库复用的应用级存储资源。
//! 当前阶段先提供 owner 级命名空间管理，供 embedding 模型等
//! 应用级共享资产在不同 Vault 间复用。

pub(crate) mod module_contribution;
pub(crate) mod storage_registry_app_service;
pub(crate) mod storage_registry_facade;
