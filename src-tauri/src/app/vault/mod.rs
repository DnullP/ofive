//! # Vault 应用服务模块
//!
//! 组织仓库切换、目录树读取和文件读取等核心用例，作为命令入口与底层
//! vault 实现之间的稳定编排边界。

pub(crate) mod canvas_app_service;
pub(crate) mod capability_execution;
pub(crate) mod markdown_patch_app_service;
pub(crate) mod module_contribution;
pub(crate) mod query_app_service;
pub(crate) mod sync_facade;
pub(crate) mod vault_app_service;
