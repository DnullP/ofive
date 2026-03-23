//! # 平台能力执行模型
//!
//! 定义平台能力执行请求与执行上下文，
//! 作为 Phase 3 中 capability registry 与模块级执行路由之间的稳定边界。

use std::path::Path;

use serde_json::Value;

use crate::domain::capability::CapabilityConsumer;

/// 一次平台能力执行请求。
#[derive(Debug, Clone)]
pub struct CapabilityExecutionRequest {
    /// 平台能力 ID。
    pub capability_id: String,
    /// 调用方消费者类型。
    pub consumer: CapabilityConsumer,
    /// 结构化输入。
    pub input: Value,
}

/// 平台能力执行上下文。
pub struct CapabilityExecutionContext<'a> {
    /// 当前调用绑定的 vault 根目录。
    pub vault_root: &'a Path,
}
