//! # AI Tool 应用服务
//!
//! 负责从平台注册中心构建 AI runtime 可见的 tool 目录，
//! 作为后续 Go sidecar tool-call 协议的稳定输入边界。

use crate::ai_service::pb;
use crate::domain::ai::tool::AiToolDescriptor;
use crate::domain::ai::tool_registry::build_ai_tool_catalog;
use crate::domain::capability::{build_builtin_capability_registry, CapabilityRiskLevel};

/// 获取当前 AI runtime 可见的 tool 目录。
pub(crate) fn get_ai_tool_catalog() -> Vec<AiToolDescriptor> {
    let registry = build_builtin_capability_registry();
    build_ai_tool_catalog(&registry)
}

/// 获取提供给 Go sidecar 的 protobuf tool 目录。
pub(crate) fn get_ai_sidecar_tool_catalog() -> Result<Vec<pb::ToolDescriptor>, String> {
    get_ai_tool_catalog()
        .into_iter()
        .map(|tool| {
            Ok(pb::ToolDescriptor {
                capability_id: tool.capability_id,
                name: tool.name,
                description: tool.description,
                input_schema_json: serde_json::to_string(&tool.input_schema)
                    .map_err(|error| format!("序列化 tool input schema 失败: {error}"))?,
                output_schema_json: serde_json::to_string(&tool.output_schema)
                    .map_err(|error| format!("序列化 tool output schema 失败: {error}"))?,
                risk_level: risk_level_label(&tool.risk_level).to_string(),
                requires_confirmation: tool.requires_confirmation,
                api_version: tool.api_version,
            })
        })
        .collect()
}

fn risk_level_label(risk_level: &CapabilityRiskLevel) -> &'static str {
    match risk_level {
        CapabilityRiskLevel::Low => "low",
        CapabilityRiskLevel::Medium => "medium",
        CapabilityRiskLevel::High => "high",
    }
}
