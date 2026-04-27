//! # Semantic Index 应用服务模块
//!
//! 组织语义索引模块的宿主装配、能力执行与受控 facade，
//! 为后续向量索引构建、增量更新与 AI 语义检索提供稳定边界。

pub(crate) mod capability_execution;
pub(crate) mod index_app_service;
pub(crate) mod index_facade;
pub(crate) mod module_contribution;
