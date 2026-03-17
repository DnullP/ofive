//! # 内建平台注册目录
//!
//! 提供当前后端已实现能力的稳定注册表，作为 AI、frontend 与 sidecar 的统一事实源。

use serde_json::json;

use crate::domain::capability::{
    CapabilityConsumer, CapabilityDescriptor, CapabilityKind, CapabilityRegistry,
    CapabilityRiskLevel,
};

const CAPABILITY_API_VERSION: &str = "2026-03-17";

/// 构建当前内建平台注册中心。
pub(crate) fn build_builtin_capability_registry() -> CapabilityRegistry {
    let mut registry = CapabilityRegistry::new();

    builtin_capabilities().into_iter().for_each(|descriptor| {
        registry.register(descriptor).expect("内建能力注册不应重复");
    });

    registry
}

fn builtin_capabilities() -> Vec<CapabilityDescriptor> {
    vec![
        read_markdown_file_capability(),
        search_markdown_capability(),
        get_outline_capability(),
        get_backlinks_capability(),
        get_graph_capability(),
        create_markdown_file_capability(),
        save_markdown_file_capability(),
        rename_markdown_file_capability(),
        delete_markdown_file_capability(),
        create_directory_capability(),
    ]
}

fn read_markdown_file_capability() -> CapabilityDescriptor {
    CapabilityDescriptor {
        id: "vault.read_markdown_file".to_string(),
        api_version: CAPABILITY_API_VERSION.to_string(),
        display_name: "Read Markdown File".to_string(),
        description: "Read one markdown note from the current vault by relative path.".to_string(),
        kind: CapabilityKind::Read,
        input_schema: json!({
            "type": "object",
            "required": ["relativePath"],
            "properties": {
                "relativePath": {"type": "string"}
            }
        }),
        output_schema: json!({
            "type": "object",
            "required": ["relativePath", "content"],
            "properties": {
                "relativePath": {"type": "string"},
                "content": {"type": "string"}
            }
        }),
        risk_level: CapabilityRiskLevel::Low,
        requires_confirmation: false,
        required_permissions: vec!["vault.read".to_string()],
        supported_consumers: vec![
            CapabilityConsumer::Frontend,
            CapabilityConsumer::AiTool,
            CapabilityConsumer::Sidecar,
        ],
    }
}

fn search_markdown_capability() -> CapabilityDescriptor {
    CapabilityDescriptor {
        id: "vault.search_markdown_files".to_string(),
        api_version: CAPABILITY_API_VERSION.to_string(),
        display_name: "Search Markdown Files".to_string(),
        description: "Search markdown files in the current vault by fuzzy query.".to_string(),
        kind: CapabilityKind::Read,
        input_schema: json!({
            "type": "object",
            "required": ["query"],
            "properties": {
                "query": {"type": "string"},
                "limit": {"type": "integer", "minimum": 1}
            }
        }),
        output_schema: json!({
            "type": "array",
            "items": {
                "type": "object",
                "required": ["relativePath", "title", "score"]
            }
        }),
        risk_level: CapabilityRiskLevel::Low,
        requires_confirmation: false,
        required_permissions: vec!["vault.search".to_string()],
        supported_consumers: vec![
            CapabilityConsumer::Frontend,
            CapabilityConsumer::AiTool,
            CapabilityConsumer::Sidecar,
        ],
    }
}

fn get_outline_capability() -> CapabilityDescriptor {
    CapabilityDescriptor {
        id: "vault.get_markdown_outline".to_string(),
        api_version: CAPABILITY_API_VERSION.to_string(),
        display_name: "Get Markdown Outline".to_string(),
        description: "Extract heading outline from one markdown note in the current vault."
            .to_string(),
        kind: CapabilityKind::Read,
        input_schema: json!({
            "type": "object",
            "required": ["relativePath"],
            "properties": {
                "relativePath": {"type": "string"}
            }
        }),
        output_schema: json!({
            "type": "object",
            "required": ["relativePath", "headings"]
        }),
        risk_level: CapabilityRiskLevel::Low,
        requires_confirmation: false,
        required_permissions: vec!["vault.read".to_string()],
        supported_consumers: vec![
            CapabilityConsumer::Frontend,
            CapabilityConsumer::AiTool,
            CapabilityConsumer::Sidecar,
        ],
    }
}

fn get_backlinks_capability() -> CapabilityDescriptor {
    CapabilityDescriptor {
        id: "vault.get_backlinks_for_file".to_string(),
        api_version: CAPABILITY_API_VERSION.to_string(),
        display_name: "Get Backlinks For File".to_string(),
        description: "Load backlinks that reference one markdown note in the current vault."
            .to_string(),
        kind: CapabilityKind::Read,
        input_schema: json!({
            "type": "object",
            "required": ["relativePath"],
            "properties": {
                "relativePath": {"type": "string"}
            }
        }),
        output_schema: json!({
            "type": "array",
            "items": {"type": "object"}
        }),
        risk_level: CapabilityRiskLevel::Low,
        requires_confirmation: false,
        required_permissions: vec!["vault.read".to_string()],
        supported_consumers: vec![
            CapabilityConsumer::Frontend,
            CapabilityConsumer::AiTool,
            CapabilityConsumer::Sidecar,
        ],
    }
}

fn get_graph_capability() -> CapabilityDescriptor {
    CapabilityDescriptor {
        id: "vault.get_markdown_graph".to_string(),
        api_version: CAPABILITY_API_VERSION.to_string(),
        display_name: "Get Markdown Graph".to_string(),
        description: "Load the markdown graph for the current vault.".to_string(),
        kind: CapabilityKind::Read,
        input_schema: json!({
            "type": "object",
            "properties": {}
        }),
        output_schema: json!({
            "type": "object",
            "required": ["nodes", "edges"]
        }),
        risk_level: CapabilityRiskLevel::Low,
        requires_confirmation: false,
        required_permissions: vec!["vault.read".to_string()],
        supported_consumers: vec![
            CapabilityConsumer::Frontend,
            CapabilityConsumer::AiTool,
            CapabilityConsumer::Sidecar,
        ],
    }
}

fn create_markdown_file_capability() -> CapabilityDescriptor {
    CapabilityDescriptor {
        id: "vault.create_markdown_file".to_string(),
        api_version: CAPABILITY_API_VERSION.to_string(),
        display_name: "Create Markdown File".to_string(),
        description: "Create one markdown note in the current vault.".to_string(),
        kind: CapabilityKind::Write,
        input_schema: json!({
            "type": "object",
            "required": ["relativePath"],
            "properties": {
                "relativePath": {"type": "string"},
                "content": {"type": "string"}
            }
        }),
        output_schema: json!({
            "type": "object",
            "required": ["relativePath", "created"]
        }),
        risk_level: CapabilityRiskLevel::Medium,
        requires_confirmation: true,
        required_permissions: vec!["vault.write".to_string()],
        supported_consumers: vec![
            CapabilityConsumer::Frontend,
            CapabilityConsumer::AiTool,
            CapabilityConsumer::Sidecar,
        ],
    }
}

fn save_markdown_file_capability() -> CapabilityDescriptor {
    CapabilityDescriptor {
        id: "vault.save_markdown_file".to_string(),
        api_version: CAPABILITY_API_VERSION.to_string(),
        display_name: "Save Markdown File".to_string(),
        description: "Overwrite one markdown note in the current vault.".to_string(),
        kind: CapabilityKind::Write,
        input_schema: json!({
            "type": "object",
            "required": ["relativePath", "content"],
            "properties": {
                "relativePath": {"type": "string"},
                "content": {"type": "string"}
            }
        }),
        output_schema: json!({
            "type": "object",
            "required": ["relativePath", "created"]
        }),
        risk_level: CapabilityRiskLevel::Medium,
        requires_confirmation: true,
        required_permissions: vec!["vault.write".to_string()],
        supported_consumers: vec![
            CapabilityConsumer::Frontend,
            CapabilityConsumer::AiTool,
            CapabilityConsumer::Sidecar,
        ],
    }
}

fn rename_markdown_file_capability() -> CapabilityDescriptor {
    CapabilityDescriptor {
        id: "vault.rename_markdown_file".to_string(),
        api_version: CAPABILITY_API_VERSION.to_string(),
        display_name: "Rename Markdown File".to_string(),
        description: "Rename one markdown note in the current vault.".to_string(),
        kind: CapabilityKind::Write,
        input_schema: json!({
            "type": "object",
            "required": ["fromRelativePath", "toRelativePath"],
            "properties": {
                "fromRelativePath": {"type": "string"},
                "toRelativePath": {"type": "string"}
            }
        }),
        output_schema: json!({
            "type": "object",
            "required": ["relativePath", "created"]
        }),
        risk_level: CapabilityRiskLevel::Medium,
        requires_confirmation: true,
        required_permissions: vec!["vault.write".to_string()],
        supported_consumers: vec![
            CapabilityConsumer::Frontend,
            CapabilityConsumer::AiTool,
            CapabilityConsumer::Sidecar,
        ],
    }
}

fn delete_markdown_file_capability() -> CapabilityDescriptor {
    CapabilityDescriptor {
        id: "vault.delete_markdown_file".to_string(),
        api_version: CAPABILITY_API_VERSION.to_string(),
        display_name: "Delete Markdown File".to_string(),
        description: "Delete one markdown note from the current vault.".to_string(),
        kind: CapabilityKind::Write,
        input_schema: json!({
            "type": "object",
            "required": ["relativePath"],
            "properties": {
                "relativePath": {"type": "string"}
            }
        }),
        output_schema: json!({
            "type": "object",
            "properties": {"ok": {"type": "boolean"}}
        }),
        risk_level: CapabilityRiskLevel::High,
        requires_confirmation: true,
        required_permissions: vec!["vault.delete".to_string()],
        supported_consumers: vec![
            CapabilityConsumer::Frontend,
            CapabilityConsumer::AiTool,
            CapabilityConsumer::Sidecar,
        ],
    }
}

fn create_directory_capability() -> CapabilityDescriptor {
    CapabilityDescriptor {
        id: "vault.create_directory".to_string(),
        api_version: CAPABILITY_API_VERSION.to_string(),
        display_name: "Create Directory".to_string(),
        description: "Create one directory inside the current vault.".to_string(),
        kind: CapabilityKind::Write,
        input_schema: json!({
            "type": "object",
            "required": ["relativeDirectoryPath"],
            "properties": {
                "relativeDirectoryPath": {"type": "string"}
            }
        }),
        output_schema: json!({
            "type": "object",
            "properties": {"ok": {"type": "boolean"}}
        }),
        risk_level: CapabilityRiskLevel::Medium,
        requires_confirmation: true,
        required_permissions: vec!["vault.write".to_string()],
        supported_consumers: vec![
            CapabilityConsumer::Frontend,
            CapabilityConsumer::AiTool,
            CapabilityConsumer::Sidecar,
        ],
    }
}
