//! # Semantic Index Capability Catalog
//!
//! 定义语义索引模块对平台注册中心贡献的 capability descriptor，
//! 供 AI runtime 以统一 tool catalog 投影方式消费。

use serde_json::json;

use crate::domain::capability::{
    CapabilityConsumer, CapabilityDescriptor, CapabilityKind, CapabilityRiskLevel,
};

const CAPABILITY_API_VERSION: &str = "2026-04-02";

/// 返回语义索引模块贡献的平台能力描述列表。
pub(crate) fn semantic_index_capability_descriptors() -> Vec<CapabilityDescriptor> {
    vec![search_markdown_chunks_capability()]
}

/// 构建“搜索 Markdown chunk”能力描述。
fn search_markdown_chunks_capability() -> CapabilityDescriptor {
    CapabilityDescriptor {
        id: "semantic.search_markdown_chunks".to_string(),
        api_version: CAPABILITY_API_VERSION.to_string(),
        display_name: "Search Markdown Chunks By Semantic Similarity".to_string(),
        description: "Search persisted markdown chunks in the current vault with local semantic retrieval. This tool is read-only and is intended for AI context gathering rather than file editing.".to_string(),
        kind: CapabilityKind::Read,
        input_schema: json!({
            "type": "object",
            "required": ["query"],
            "properties": {
                "query": {"type": "string"},
                "limit": {"type": "integer", "minimum": 1, "maximum": 20, "default": 8},
                "relativePathPrefix": {"type": "string"},
                "excludePaths": {
                    "type": "array",
                    "items": {"type": "string"}
                },
                "scoreThreshold": {"type": "number"}
            }
        }),
        output_schema: json!({
            "type": "object",
            "required": ["status", "modelId", "results"],
            "properties": {
                "status": {
                    "type": "string",
                    "enum": ["ready", "building", "disabled", "empty"]
                },
                "modelId": {"type": "string"},
                "results": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "required": [
                            "relativePath",
                            "startLine",
                            "endLine",
                            "chunkText",
                            "distance",
                            "indexedAtMs"
                        ],
                        "properties": {
                            "relativePath": {"type": "string"},
                            "headingPath": {"type": ["string", "null"]},
                            "startLine": {"type": "integer"},
                            "endLine": {"type": "integer"},
                            "chunkText": {"type": "string"},
                            "distance": {"type": "number"},
                            "indexedAtMs": {"type": "integer"}
                        }
                    }
                }
            }
        }),
        risk_level: CapabilityRiskLevel::Low,
        requires_confirmation: false,
        required_permissions: vec!["vault.read".to_string(), "semantic.search".to_string()],
        supported_consumers: vec![CapabilityConsumer::AiTool, CapabilityConsumer::Sidecar],
    }
}