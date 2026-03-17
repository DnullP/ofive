//! # AI Tool 描述模块
//!
//! 将平台注册的通用能力投影为 AI runtime 可消费的 tool 描述，
//! 避免 AI 直接依赖内部 command 或实现细节。

use serde::Serialize;
use serde_json::Value;

use crate::domain::capability::{CapabilityDescriptor, CapabilityRiskLevel};

/// AI runtime 可消费的 tool 描述。
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AiToolDescriptor {
    /// 对应的平台能力 ID。
    pub capability_id: String,
    /// 平台 API 版本。
    pub api_version: String,
    /// AI runtime 使用的工具名称。
    pub name: String,
    /// 提供给模型的工具说明。
    pub description: String,
    /// 工具输入 schema。
    pub input_schema: Value,
    /// 工具输出 schema。
    pub output_schema: Value,
    /// 工具风险级别。
    pub risk_level: CapabilityRiskLevel,
    /// 是否需要用户确认。
    pub requires_confirmation: bool,
}

impl From<&CapabilityDescriptor> for AiToolDescriptor {
    fn from(value: &CapabilityDescriptor) -> Self {
        Self {
            capability_id: value.id.clone(),
            api_version: value.api_version.clone(),
            name: value.id.replace('.', "_").replace('-', "_").to_lowercase(),
            description: value.description.clone(),
            input_schema: value.input_schema.clone(),
            output_schema: value.output_schema.clone(),
            risk_level: value.risk_level.clone(),
            requires_confirmation: value.requires_confirmation,
        }
    }
}
