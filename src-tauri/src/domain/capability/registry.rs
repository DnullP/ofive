//! # 平台能力注册中心
//!
//! 提供能力注册、去重校验与按消费者过滤查询的基础能力。

use std::collections::BTreeMap;

use crate::domain::capability::{CapabilityConsumer, CapabilityDescriptor};

/// 平台能力注册中心。
#[derive(Debug, Clone, Default)]
pub(crate) struct CapabilityRegistry {
    /// 已注册的平台能力表，使用能力 ID 去重。
    descriptors: BTreeMap<String, CapabilityDescriptor>,
}

impl CapabilityRegistry {
    /// 创建一个空的平台注册中心。
    pub(crate) fn new() -> Self {
        Self {
            descriptors: BTreeMap::new(),
        }
    }

    /// 注册一条平台能力描述。
    pub(crate) fn register(&mut self, descriptor: CapabilityDescriptor) -> Result<(), String> {
        if self.descriptors.contains_key(&descriptor.id) {
            return Err(format!("能力已注册: {}", descriptor.id));
        }

        self.descriptors.insert(descriptor.id.clone(), descriptor);
        Ok(())
    }

    /// 列出全部平台能力。
    pub(crate) fn list(&self) -> Vec<CapabilityDescriptor> {
        self.descriptors.values().cloned().collect()
    }

    /// 按能力 ID 获取单条平台能力描述。
    pub(crate) fn get(&self, capability_id: &str) -> Option<CapabilityDescriptor> {
        self.descriptors.get(capability_id).cloned()
    }

    /// 按消费者列出允许访问的平台能力。
    pub(crate) fn list_for_consumer(
        &self,
        consumer: CapabilityConsumer,
    ) -> Vec<CapabilityDescriptor> {
        self.descriptors
            .values()
            .filter(|descriptor| descriptor.supports_consumer(&consumer))
            .cloned()
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use crate::domain::capability::{
        CapabilityConsumer, CapabilityDescriptor, CapabilityKind, CapabilityRiskLevel,
    };

    use super::CapabilityRegistry;

    #[test]
    fn registry_should_reject_duplicate_capability_ids() {
        let descriptor = CapabilityDescriptor {
            id: "vault.read_markdown_file".to_string(),
            api_version: "2026-03-17".to_string(),
            display_name: "Read Markdown File".to_string(),
            description: "Read one markdown file from the current vault.".to_string(),
            kind: CapabilityKind::Read,
            input_schema: json!({"type":"object"}),
            output_schema: json!({"type":"object"}),
            risk_level: CapabilityRiskLevel::Low,
            requires_confirmation: false,
            required_permissions: vec!["vault.read".to_string()],
            supported_consumers: vec![CapabilityConsumer::Frontend],
        };

        let mut registry = CapabilityRegistry::new();
        registry
            .register(descriptor.clone())
            .expect("首次注册应成功");

        let error = registry.register(descriptor).expect_err("重复注册应失败");

        assert!(error.contains("能力已注册"));
    }

    #[test]
    fn registry_should_filter_by_consumer() {
        let mut registry = CapabilityRegistry::new();
        registry
            .register(CapabilityDescriptor {
                id: "vault.search_markdown".to_string(),
                api_version: "2026-03-17".to_string(),
                display_name: "Search Markdown".to_string(),
                description: "Search markdown files.".to_string(),
                kind: CapabilityKind::Read,
                input_schema: json!({"type":"object"}),
                output_schema: json!({"type":"array"}),
                risk_level: CapabilityRiskLevel::Low,
                requires_confirmation: false,
                required_permissions: vec!["vault.search".to_string()],
                supported_consumers: vec![CapabilityConsumer::AiTool, CapabilityConsumer::Sidecar],
            })
            .expect("注册搜索能力应成功");

        let capabilities = registry.list_for_consumer(CapabilityConsumer::AiTool);

        assert_eq!(capabilities.len(), 1);
        assert_eq!(capabilities[0].id, "vault.search_markdown");
    }
}
