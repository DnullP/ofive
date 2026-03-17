//! # AI Tool 注册投影模块
//!
//! 负责从平台注册中心中过滤出允许 AI 使用的能力，并投影为稳定的 tool 目录。

use crate::domain::ai::tool::AiToolDescriptor;
use crate::domain::capability::{CapabilityConsumer, CapabilityRegistry};

/// 从平台能力注册中心构建 AI tool 目录。
pub(crate) fn build_ai_tool_catalog(registry: &CapabilityRegistry) -> Vec<AiToolDescriptor> {
    registry
        .list_for_consumer(CapabilityConsumer::AiTool)
        .iter()
        .map(AiToolDescriptor::from)
        .collect()
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use crate::domain::capability::{
        CapabilityConsumer, CapabilityDescriptor, CapabilityKind, CapabilityRegistry,
        CapabilityRiskLevel,
    };

    use super::build_ai_tool_catalog;

    #[test]
    fn ai_tool_catalog_should_only_include_ai_visible_capabilities() {
        let mut registry = CapabilityRegistry::new();
        registry
            .register(CapabilityDescriptor {
                id: "vault.read_note".to_string(),
                api_version: "2026-03-17".to_string(),
                display_name: "Read Note".to_string(),
                description: "Read one markdown note from the current vault.".to_string(),
                kind: CapabilityKind::Read,
                input_schema: json!({"type":"object"}),
                output_schema: json!({"type":"object"}),
                risk_level: CapabilityRiskLevel::Low,
                requires_confirmation: false,
                required_permissions: vec!["vault.read".to_string()],
                supported_consumers: vec![CapabilityConsumer::AiTool],
            })
            .expect("应成功注册 AI 能力");
        registry
            .register(CapabilityDescriptor {
                id: "ui.open_panel".to_string(),
                api_version: "2026-03-17".to_string(),
                display_name: "Open Panel".to_string(),
                description: "Open one panel in the desktop UI.".to_string(),
                kind: CapabilityKind::Ui,
                input_schema: json!({"type":"object"}),
                output_schema: json!({"type":"object"}),
                risk_level: CapabilityRiskLevel::Low,
                requires_confirmation: false,
                required_permissions: vec!["ui.open_panel".to_string()],
                supported_consumers: vec![CapabilityConsumer::Frontend],
            })
            .expect("应成功注册前端能力");

        let tools = build_ai_tool_catalog(&registry);

        assert_eq!(tools.len(), 1);
        assert_eq!(tools[0].capability_id, "vault.read_note");
        assert_eq!(tools[0].api_version, "2026-03-17");
        assert_eq!(tools[0].name, "vault_read_note");
    }

    #[test]
    fn ai_tool_catalog_should_include_confirmation_required_capabilities() {
        let mut registry = CapabilityRegistry::new();
        registry
            .register(CapabilityDescriptor {
                id: "vault.create_note".to_string(),
                api_version: "2026-03-17".to_string(),
                display_name: "Create Note".to_string(),
                description: "Create one markdown note in the current vault.".to_string(),
                kind: CapabilityKind::Write,
                input_schema: json!({"type":"object"}),
                output_schema: json!({"type":"object"}),
                risk_level: CapabilityRiskLevel::Medium,
                requires_confirmation: true,
                required_permissions: vec!["vault.write".to_string()],
                supported_consumers: vec![CapabilityConsumer::AiTool],
            })
            .expect("应成功注册需要确认的 AI 能力");

        let tools = build_ai_tool_catalog(&registry);

        assert_eq!(tools.len(), 1);
        assert!(tools[0].requires_confirmation);
        assert_eq!(tools[0].capability_id, "vault.create_note");
    }
}
