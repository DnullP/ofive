//! # 应用编排层模块
//!
//! 提供按能力域组织的应用服务，负责拼接运行时状态、基础设施与领域规则，
//! 为宿主命令层提供稳定的用例入口。

pub(crate) mod ai;
pub(crate) mod app_storage;
pub(crate) mod capability;
pub(crate) mod persistence;
pub(crate) mod semantic_index;
pub(crate) mod sync;
pub(crate) mod vault;
