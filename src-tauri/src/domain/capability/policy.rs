//! # 平台能力策略模型
//!
//! 定义平台注册能力的风险与确认策略，
//! 让 AI / sidecar 消费者先经过统一裁决再进入执行器。

use crate::domain::capability::{
    CapabilityConsumer, CapabilityDescriptor, CapabilityKind, CapabilityRiskLevel,
};

/// 能力确认策略。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CapabilityConfirmationPolicy {
    /// 可直接执行。
    AutoApproved,
    /// 需要用户确认。
    RequiresUserConfirmation,
}

/// 能力访问裁决结果。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CapabilityAccessDecision {
    /// 确认策略。
    pub confirmation_policy: CapabilityConfirmationPolicy,
}

/// 评估指定消费者访问某项能力时的策略结果。
pub(crate) fn evaluate_capability_access(
    descriptor: &CapabilityDescriptor,
    consumer: &CapabilityConsumer,
) -> Result<CapabilityAccessDecision, String> {
    if !descriptor.supports_consumer(consumer) {
        return Err(format!(
            "能力 {} 不允许消费者 {} 访问",
            descriptor.id,
            consumer_label(consumer)
        ));
    }

    let confirmation_policy = if descriptor.requires_confirmation
        || matches!(descriptor.kind, CapabilityKind::Write)
        || matches!(
            descriptor.risk_level,
            CapabilityRiskLevel::Medium | CapabilityRiskLevel::High
        ) {
        CapabilityConfirmationPolicy::RequiresUserConfirmation
    } else {
        CapabilityConfirmationPolicy::AutoApproved
    };

    Ok(CapabilityAccessDecision {
        confirmation_policy,
    })
}

fn consumer_label(consumer: &CapabilityConsumer) -> &'static str {
    match consumer {
        CapabilityConsumer::Frontend => "frontend",
        CapabilityConsumer::AiTool => "ai-tool",
        CapabilityConsumer::Sidecar => "sidecar",
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use crate::domain::capability::{
        CapabilityConsumer, CapabilityDescriptor, CapabilityKind, CapabilityRiskLevel,
    };

    use super::{evaluate_capability_access, CapabilityConfirmationPolicy};

    #[test]
    fn low_risk_read_should_be_auto_approved_for_ai_tool() {
        let descriptor = CapabilityDescriptor {
            id: "vault.read_markdown_file".to_string(),
            api_version: "2026-03-17".to_string(),
            display_name: "Read Markdown File".to_string(),
            description: "Read one markdown file.".to_string(),
            kind: CapabilityKind::Read,
            input_schema: json!({"type":"object"}),
            output_schema: json!({"type":"object"}),
            risk_level: CapabilityRiskLevel::Low,
            requires_confirmation: false,
            required_permissions: vec!["vault.read".to_string()],
            supported_consumers: vec![CapabilityConsumer::AiTool],
        };

        let decision = evaluate_capability_access(&descriptor, &CapabilityConsumer::AiTool)
            .expect("低风险读能力应允许 AI tool 访问");

        assert_eq!(
            decision.confirmation_policy,
            CapabilityConfirmationPolicy::AutoApproved
        );
    }

    #[test]
    fn medium_risk_write_should_require_confirmation_for_sidecar() {
        let descriptor = CapabilityDescriptor {
            id: "vault.save_markdown_file".to_string(),
            api_version: "2026-03-17".to_string(),
            display_name: "Save Markdown File".to_string(),
            description: "Save one markdown file.".to_string(),
            kind: CapabilityKind::Write,
            input_schema: json!({"type":"object"}),
            output_schema: json!({"type":"object"}),
            risk_level: CapabilityRiskLevel::Medium,
            requires_confirmation: true,
            required_permissions: vec!["vault.write".to_string()],
            supported_consumers: vec![CapabilityConsumer::Sidecar],
        };

        let decision = evaluate_capability_access(&descriptor, &CapabilityConsumer::Sidecar)
            .expect("中风险写能力应返回确认策略，而不是直接拒绝");

        assert_eq!(
            decision.confirmation_policy,
            CapabilityConfirmationPolicy::RequiresUserConfirmation
        );
    }
}
