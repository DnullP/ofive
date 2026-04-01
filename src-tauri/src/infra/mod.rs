//! # 基础设施层模块
//!
//! 承载与产品能力解耦的技术实现，包括 AI sidecar 连接、
//! 持久化存储与其他底层适配器。

pub(crate) mod ai;
pub(crate) mod fs;
pub(crate) mod logging;
pub(crate) mod persistence;
pub(crate) mod query;
pub(crate) mod vector;
