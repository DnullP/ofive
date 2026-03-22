//! # 宿主持久化领域模块
//!
//! 定义宿主持久化协议在平台内的访问策略语义，供应用服务在真正进入
//! 持久化基础设施前统一裁决和审计。

mod policy;

pub(crate) use policy::{
    build_persistence_audit_record, evaluate_persistence_access, PersistenceAuditRecord,
};