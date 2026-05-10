//! # Project Reader Capability Catalog
//!
//! 定义外部项目只读阅读器模块向平台注册中心贡献的 capability descriptors。

use serde_json::json;

use crate::domain::capability::{
    CapabilityConsumer, CapabilityDescriptor, CapabilityKind, CapabilityRiskLevel,
};

const CAPABILITY_API_VERSION: &str = "2026-03-17";

/// 返回 Project Reader 模块贡献的平台能力描述列表。
pub(crate) fn project_reader_capability_descriptors() -> Vec<CapabilityDescriptor> {
    vec![
        list_projects_capability(),
        get_project_tree_capability(),
        read_project_file_capability(),
        get_code_references_capability(),
        resolve_project_symbol_capability(),
    ]
}

fn list_projects_capability() -> CapabilityDescriptor {
    CapabilityDescriptor {
        id: "project_reader.list_projects".to_string(),
        api_version: CAPABILITY_API_VERSION.to_string(),
        display_name: "List Project Reader Projects".to_string(),
        description: "List imported external projects that are available for read-only analysis."
            .to_string(),
        kind: CapabilityKind::Read,
        input_schema: json!({
            "type": "object",
            "properties": {}
        }),
        output_schema: json!({
            "type": "array",
            "items": {
                "type": "object",
                "required": ["id", "name", "rootPath", "createdAtUnixMs", "updatedAtUnixMs"]
            }
        }),
        risk_level: CapabilityRiskLevel::Low,
        requires_confirmation: false,
        required_permissions: vec!["project-reader.read".to_string()],
        supported_consumers: vec![
            CapabilityConsumer::Frontend,
            CapabilityConsumer::AiTool,
            CapabilityConsumer::Sidecar,
        ],
    }
}

fn get_project_tree_capability() -> CapabilityDescriptor {
    CapabilityDescriptor {
        id: "project_reader.get_project_tree".to_string(),
        api_version: CAPABILITY_API_VERSION.to_string(),
        display_name: "Get Project Tree".to_string(),
        description: "Fetch the cached file tree for one imported external project.".to_string(),
        kind: CapabilityKind::Read,
        input_schema: json!({
            "type": "object",
            "required": ["projectId"],
            "properties": {
                "projectId": {"type": "string"}
            }
        }),
        output_schema: json!({
            "type": "object",
            "required": ["projectId", "rootPath", "entries"],
            "properties": {
                "projectId": {"type": "string"},
                "rootPath": {"type": "string"},
                "entries": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "required": ["relativePath", "isDir"]
                    }
                }
            }
        }),
        risk_level: CapabilityRiskLevel::Low,
        requires_confirmation: false,
        required_permissions: vec!["project-reader.read".to_string()],
        supported_consumers: vec![
            CapabilityConsumer::Frontend,
            CapabilityConsumer::AiTool,
            CapabilityConsumer::Sidecar,
        ],
    }
}

fn read_project_file_capability() -> CapabilityDescriptor {
    CapabilityDescriptor {
        id: "project_reader.read_project_file".to_string(),
        api_version: CAPABILITY_API_VERSION.to_string(),
        display_name: "Read Project File".to_string(),
        description: "Read one file from an imported external project by relative path."
            .to_string(),
        kind: CapabilityKind::Read,
        input_schema: json!({
            "type": "object",
            "required": ["projectId", "relativePath"],
            "properties": {
                "projectId": {"type": "string"},
                "relativePath": {"type": "string"}
            }
        }),
        output_schema: json!({
            "type": "object",
            "required": ["projectId", "relativePath", "content"],
            "properties": {
                "projectId": {"type": "string"},
                "relativePath": {"type": "string"},
                "content": {"type": "string"},
                "language": {"type": ["string", "null"]},
                "sizeBytes": {"type": "integer"},
                "modifiedAtUnixMs": {"type": ["integer", "null"]}
            }
        }),
        risk_level: CapabilityRiskLevel::Low,
        requires_confirmation: false,
        required_permissions: vec!["project-reader.read".to_string()],
        supported_consumers: vec![
            CapabilityConsumer::Frontend,
            CapabilityConsumer::AiTool,
            CapabilityConsumer::Sidecar,
        ],
    }
}

fn resolve_project_symbol_capability() -> CapabilityDescriptor {
    CapabilityDescriptor {
        id: "project_reader.resolve_symbol".to_string(),
        api_version: CAPABILITY_API_VERSION.to_string(),
        display_name: "Resolve Project Symbol".to_string(),
        description: "Resolve a symbol name inside one imported external project to candidate definitions or implementations.".to_string(),
        kind: CapabilityKind::Read,
        input_schema: json!({
            "type": "object",
            "required": ["projectId", "symbol"],
            "properties": {
                "projectId": {"type": "string"},
                "symbol": {"type": "string"},
                "context": {
                    "type": ["object", "null"],
                    "properties": {
                        "currentFilePath": {"type": ["string", "null"]},
                        "currentLineNumber": {"type": ["integer", "null"]},
                        "currentColumnNumber": {"type": ["integer", "null"]}
                    }
                }
            }
        }),
        output_schema: json!({
            "type": "object",
            "required": ["projectId", "symbol", "locations"],
            "properties": {
                "projectId": {"type": "string"},
                "symbol": {"type": "string"},
                "locations": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "required": [
                            "projectId",
                            "relativePath",
                            "lineNumber",
                            "columnNumber",
                            "symbolName",
                            "kind",
                            "preview"
                        ]
                    }
                }
            }
        }),
        risk_level: CapabilityRiskLevel::Low,
        requires_confirmation: false,
        required_permissions: vec!["project-reader.read".to_string()],
        supported_consumers: vec![
            CapabilityConsumer::Frontend,
            CapabilityConsumer::AiTool,
            CapabilityConsumer::Sidecar,
        ],
    }
}

fn get_code_references_capability() -> CapabilityDescriptor {
    CapabilityDescriptor {
        id: "project_reader.get_code_references".to_string(),
        api_version: CAPABILITY_API_VERSION.to_string(),
        display_name: "Get Project Code References".to_string(),
        description:
            "Find current-vault notes that reference snippets in one imported external project."
                .to_string(),
        kind: CapabilityKind::Read,
        input_schema: json!({
            "type": "object",
            "required": ["projectId"],
            "properties": {
                "projectId": {"type": "string"}
            }
        }),
        output_schema: json!({
            "type": "object",
            "required": ["projectId", "references"],
            "properties": {
                "projectId": {"type": "string"},
                "references": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "required": ["sourcePath", "title", "linkText", "target"]
                    }
                }
            }
        }),
        risk_level: CapabilityRiskLevel::Low,
        requires_confirmation: false,
        required_permissions: vec!["project-reader.read".to_string()],
        supported_consumers: vec![
            CapabilityConsumer::Frontend,
            CapabilityConsumer::AiTool,
            CapabilityConsumer::Sidecar,
        ],
    }
}
