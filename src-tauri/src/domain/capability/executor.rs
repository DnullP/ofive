//! # 平台能力执行模型
//!
//! 定义平台能力执行请求、执行上下文与执行器 trait，
//! 作为 Phase 3 中 capability registry 与具体实现之间的稳定边界。

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

/// 平台能力执行器 trait。
pub trait CapabilityExecutor {
    /// 执行指定输入，并返回结构化输出。
    fn execute(
        &self,
        input: Value,
        context: &CapabilityExecutionContext<'_>,
    ) -> Result<Value, String>;
}
