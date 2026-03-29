//! # Vault Capability Catalog
//!
//! 定义 Vault 模块对平台贡献的 capability descriptors。
//! 该模块只描述稳定能力契约，不承载具体执行逻辑，
//! 供平台注册中心在启动时聚合使用。

use serde_json::json;

use crate::domain::capability::{
    CapabilityConsumer, CapabilityDescriptor, CapabilityKind, CapabilityRiskLevel,
};

const CAPABILITY_API_VERSION: &str = "2026-03-17";

/// 返回 Vault 模块贡献的平台能力描述列表。
pub(crate) fn vault_capability_descriptors() -> Vec<CapabilityDescriptor> {
    vec![
        read_markdown_file_capability(),
        search_markdown_capability(),
        search_canvas_capability(),
        resolve_wikilink_target_capability(),
        suggest_wikilink_targets_capability(),
        get_outline_capability(),
        get_backlinks_capability(),
        get_graph_capability(),
        get_canvas_document_capability(),
        create_markdown_file_capability(),
        save_markdown_file_capability(),
        apply_markdown_patch_capability(),
        save_canvas_document_capability(),
        rename_markdown_file_capability(),
        delete_markdown_file_capability(),
        create_directory_capability(),
    ]
}

/// 构建“搜索 Canvas 文件”能力描述。
fn search_canvas_capability() -> CapabilityDescriptor {
    CapabilityDescriptor {
        id: "vault.search_canvas_files".to_string(),
        api_version: CAPABILITY_API_VERSION.to_string(),
        display_name: "Search Canvas Files".to_string(),
        description: "Search Obsidian canvas files in the current vault by fuzzy query.".to_string(),
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

/// 构建“读取 Markdown 文件”能力描述。
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
                "content": {"type": "string"},
                "numberedContent": {
                    "type": "string",
                    "description": "Line-numbered helper view for reasoning and discussion. Use content as the source of truth for copying exact lines into unified diffs; do not copy the numeric prefixes into file edits."
                }
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

/// 构建“搜索 Markdown 文件”能力描述。
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

/// 构建“解析 WikiLink 目标”能力描述。
fn resolve_wikilink_target_capability() -> CapabilityDescriptor {
    CapabilityDescriptor {
        id: "vault.resolve_wikilink_target".to_string(),
        api_version: CAPABILITY_API_VERSION.to_string(),
        display_name: "Resolve WikiLink Target".to_string(),
        description: "Resolve one wikilink target to the best matching markdown file inside the current vault.".to_string(),
        kind: CapabilityKind::Read,
        input_schema: json!({
            "type": "object",
            "required": ["currentDir", "target"],
            "properties": {
                "currentDir": {"type": "string"},
                "target": {"type": "string"}
            }
        }),
        output_schema: json!({
            "oneOf": [
                {
                    "type": "object",
                    "required": ["relativePath", "absolutePath"],
                    "properties": {
                        "relativePath": {"type": "string"},
                        "absolutePath": {"type": "string"}
                    }
                },
                {"type": "null"}
            ]
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

/// 构建“建议 WikiLink 目标”能力描述。
fn suggest_wikilink_targets_capability() -> CapabilityDescriptor {
    CapabilityDescriptor {
        id: "vault.suggest_wikilink_targets".to_string(),
        api_version: CAPABILITY_API_VERSION.to_string(),
        display_name: "Suggest WikiLink Targets".to_string(),
        description: "Suggest markdown notes that should be linked with wikilink syntax in the current vault.".to_string(),
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
                "required": ["relativePath", "title", "score", "referenceCount"]
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

/// 构建“获取 Markdown 大纲”能力描述。
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

/// 构建“获取反向链接”能力描述。
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

/// 构建“获取 Markdown 图谱”能力描述。
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

/// 构建“读取结构化 Canvas 文档”能力描述。
fn get_canvas_document_capability() -> CapabilityDescriptor {
    CapabilityDescriptor {
        id: "vault.get_canvas_document".to_string(),
        api_version: CAPABILITY_API_VERSION.to_string(),
        display_name: "Get Canvas Document".to_string(),
        description: "Read one Obsidian canvas file as a structured document from the current vault. Canvas node geometry may contain floating-point coordinates, and unknown fields are preserved in the structured payload when possible.".to_string(),
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
            "required": ["relativePath", "document"],
            "properties": {
                "relativePath": {"type": "string"},
                "document": {
                    "type": "object",
                    "required": ["nodes", "edges"],
                    "properties": {
                        "nodes": {"type": "array"},
                        "edges": {"type": "array"},
                        "metadata": {"type": "object"}
                    }
                }
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

/// 构建“创建 Markdown 文件”能力描述。
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
            CapabilityConsumer::Sidecar,
        ],
    }
}

/// 构建“应用 Markdown 增量 patch”能力描述。
fn apply_markdown_patch_capability() -> CapabilityDescriptor {
    CapabilityDescriptor {
        id: "vault.apply_markdown_patch".to_string(),
        api_version: CAPABILITY_API_VERSION.to_string(),
        display_name: "Apply Markdown Patch".to_string(),
        description: "Apply a unified diff patch to one markdown file in the current vault. Read the latest file first, then send a single-file unified diff in unifiedDiff. Keep the diff scoped to relativePath, include --- and +++ file headers, and use standard @@ hunks with exact current file content. Preserve blank lines as literal blank diff lines, and include adjacent separator lines when they are part of the edited block. Use one contiguous @@ hunk per contiguous edit block instead of rewriting the whole file. Example: {\"relativePath\":\"notes/guide.md\",\"unifiedDiff\":\"--- a/notes/guide.md\\n+++ b/notes/guide.md\\n@@ -3,3 +3,3 @@\\n alpha\\n-beta\\n+beta patched\\n gamma\"}. Section insertion example: {\"relativePath\":\"notes/guide.md\",\"unifiedDiff\":\"--- a/notes/guide.md\\n+++ b/notes/guide.md\\n@@ -5,4 +5,7 @@\\n ## 影响因素\\n - 价格变化\\n - 需求弹性\\n - 市场结构\\n+\\n+## 具体例子\\n+\\n+示例内容\\n \\n [[供需原理]]\"}".to_string(),
        kind: CapabilityKind::Write,
        input_schema: json!({
            "type": "object",
            "required": ["relativePath", "unifiedDiff"],
            "properties": {
                "relativePath": {
                    "type": "string",
                    "description": "Target markdown file relative to the vault root.",
                    "examples": ["notes/guide.md"]
                },
                "unifiedDiff": {
                    "type": "string",
                    "minLength": 1,
                    "description": "Single-file unified diff text. Must include --- and +++ headers for relativePath and one or more @@ hunks with exact current lines.",
                    "examples": [
                        "--- a/notes/guide.md\n+++ b/notes/guide.md\n@@ -3,3 +3,3 @@\n alpha\n-beta\n+beta patched\n gamma"
                    ]
                }
            }
        }),
        output_schema: json!({
            "type": "object",
            "required": ["relativePath", "appliedBlockCount"],
            "properties": {
                "relativePath": {"type": "string"},
                "appliedBlockCount": {"type": "integer", "minimum": 1}
            }
        }),
        risk_level: CapabilityRiskLevel::Medium,
        requires_confirmation: true,
        required_permissions: vec!["vault.write".to_string()],
        supported_consumers: vec![
            CapabilityConsumer::AiTool,
            CapabilityConsumer::Sidecar,
        ],
    }
}

/// 构建“保存 Markdown 文件”能力描述。
fn save_markdown_file_capability() -> CapabilityDescriptor {
    CapabilityDescriptor {
        id: "vault.save_markdown_file".to_string(),
        api_version: CAPABILITY_API_VERSION.to_string(),
        display_name: "Save Markdown File".to_string(),
        description: "Overwrite one markdown note in the current vault. Use this only for intentional whole-file rewrites. For localized edits, read the latest file and prefer vault.apply_markdown_patch instead.".to_string(),
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

/// 构建“保存结构化 Canvas 文档”能力描述。
fn save_canvas_document_capability() -> CapabilityDescriptor {
    CapabilityDescriptor {
        id: "vault.save_canvas_document".to_string(),
        api_version: CAPABILITY_API_VERSION.to_string(),
        display_name: "Save Canvas Document".to_string(),
        description: "Overwrite one canvas file in the current vault using the structured canvas document contract. Always call vault.get_canvas_document first, modify the returned document, and then save the full document back. Each node must remain a complete object including id, type, x, y, width, and height; canvas geometry may use floating-point numbers. Preserve unchanged nodes, edges, metadata, and unknown fields unless you intentionally remove them.".to_string(),
        kind: CapabilityKind::Write,
        input_schema: json!({
            "type": "object",
            "required": ["relativePath", "document"],
            "properties": {
                "relativePath": {"type": "string"},
                "document": {
                    "type": "object",
                    "required": ["nodes", "edges"],
                    "properties": {
                        "nodes": {"type": "array"},
                        "edges": {"type": "array"},
                        "metadata": {"type": "object"}
                    }
                }
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

/// 构建“重命名 Markdown 文件”能力描述。
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

/// 构建“删除 Markdown 文件”能力描述。
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

/// 构建“创建目录”能力描述。
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
