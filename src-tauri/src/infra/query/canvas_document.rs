//! # Canvas 文档查询基础设施模块
//!
//! 负责 `.canvas` JSON 文档的解析与序列化，提供给 Vault 模块内部的
//! 结构化 Canvas 读写能力。

use crate::shared::vault_contracts::VaultCanvasDocument;

/// 解析 `.canvas` JSON 文本为稳定契约。
///
/// # 参数
/// - `content`：原始 `.canvas` 文件内容
///
/// # 返回
/// - 成功时返回结构化 `VaultCanvasDocument`
/// - 失败时返回可读错误信息
pub(crate) fn parse_vault_canvas_document(content: &str) -> Result<VaultCanvasDocument, String> {
    serde_json::from_str(content).map_err(|error| format!("解析 Canvas 文档失败: {error}"))
}

/// 将结构化 Canvas 文档序列化为 `.canvas` JSON 文本。
///
/// # 参数
/// - `document`：待保存的结构化 Canvas 文档
///
/// # 返回
/// - 成功时返回格式化后的 JSON 文本（以换行结尾）
/// - 失败时返回可读错误信息
pub(crate) fn serialize_vault_canvas_document(
    document: &VaultCanvasDocument,
) -> Result<String, String> {
    serde_json::to_string_pretty(document)
        .map(|content| format!("{content}\n"))
        .map_err(|error| format!("序列化 Canvas 文档失败: {error}"))
}

#[cfg(test)]
mod tests {
    use super::{parse_vault_canvas_document, serialize_vault_canvas_document};
    use crate::shared::vault_contracts::{
        VaultCanvasDocument, VaultCanvasDocumentMetadata, VaultCanvasEdge, VaultCanvasEdgeSide,
        VaultCanvasNode, VaultCanvasNodeKind,
    };
    use serde_json::json;
    use std::collections::BTreeMap;

    #[test]
    fn parse_canvas_document_should_accept_obsidian_canvas_payload() {
        let document = parse_vault_canvas_document(
            r#"{
  "nodes": [
    {
      "id": "text-1",
      "type": "text",
            "x": 12.5,
            "y": 24,
            "width": 320.25,
            "height": 180,
            "text": "hello",
            "unknownField": true
    }
  ],
  "edges": [
    {
      "id": "edge-1",
      "fromNode": "text-1",
      "toNode": "text-1",
      "fromSide": "right",
      "toSide": "left"
    }
  ],
  "metadata": {
    "title": "Roadmap"
  }
}"#,
        )
        .expect("解析 Canvas 文档应成功");

        assert_eq!(document.nodes.len(), 1);
        assert_eq!(document.nodes[0].node_type, VaultCanvasNodeKind::Text);
        assert_eq!(document.nodes[0].x, 12.5);
        assert_eq!(document.nodes[0].width, 320.25);
        assert_eq!(
            document.nodes[0].extra_fields.get("unknownField"),
            Some(&json!(true))
        );
        assert_eq!(
            document.edges[0].from_side,
            Some(VaultCanvasEdgeSide::Right)
        );
        assert_eq!(
            document.metadata.and_then(|metadata| metadata.title),
            Some("Roadmap".to_string())
        );
    }

    #[test]
    fn serialize_canvas_document_should_roundtrip_document() {
        let document = VaultCanvasDocument {
            nodes: vec![VaultCanvasNode {
                id: "file-1".to_string(),
                node_type: VaultCanvasNodeKind::File,
                x: 48.5,
                y: 72.0,
                width: 260.0,
                height: 140.0,
                text: None,
                file: Some("notes/guide.md".to_string()),
                label: None,
                color: Some("#475569".to_string()),
                background: None,
                extra_fields: BTreeMap::from([("zIndex".to_string(), json!(3))]),
            }],
            edges: vec![VaultCanvasEdge {
                id: "edge-1".to_string(),
                from_node: "file-1".to_string(),
                to_node: "file-1".to_string(),
                from_side: Some(VaultCanvasEdgeSide::Bottom),
                to_side: Some(VaultCanvasEdgeSide::Top),
                label: Some("linked".to_string()),
                color: Some("#64748b".to_string()),
                extra_fields: BTreeMap::new(),
            }],
            metadata: Some(VaultCanvasDocumentMetadata {
                title: Some("Roadmap".to_string()),
                extra_fields: BTreeMap::from([("zoom".to_string(), json!(1.25))]),
            }),
            extra_fields: BTreeMap::from([("theme".to_string(), json!("glass"))]),
        };

        let serialized =
            serialize_vault_canvas_document(&document).expect("序列化 Canvas 文档应成功");
        let parsed = parse_vault_canvas_document(&serialized).expect("反序列化应成功");

        assert_eq!(parsed, document);
        assert!(serialized.ends_with('\n'));
        assert!(serialized.contains("\"zIndex\": 3"));
        assert!(serialized.contains("\"theme\": \"glass\""));
    }

    #[test]
    fn serialize_canvas_document_should_roundtrip_group_parent_id_extra_field() {
        let document = VaultCanvasDocument {
            nodes: vec![
                VaultCanvasNode {
                    id: "group-1".to_string(),
                    node_type: VaultCanvasNodeKind::Group,
                    x: 100.0,
                    y: 200.0,
                    width: 320.0,
                    height: 220.0,
                    text: None,
                    file: None,
                    label: Some("Cluster".to_string()),
                    color: None,
                    background: None,
                    extra_fields: BTreeMap::new(),
                },
                VaultCanvasNode {
                    id: "text-1".to_string(),
                    node_type: VaultCanvasNodeKind::Text,
                    x: 140.0,
                    y: 260.0,
                    width: 180.0,
                    height: 80.0,
                    text: Some("kubelet".to_string()),
                    file: None,
                    label: None,
                    color: None,
                    background: None,
                    extra_fields: BTreeMap::from([("parentId".to_string(), json!("group-1"))]),
                },
            ],
            edges: vec![],
            metadata: None,
            extra_fields: BTreeMap::new(),
        };

        let serialized =
            serialize_vault_canvas_document(&document).expect("序列化 Canvas 文档应成功");
        let parsed = parse_vault_canvas_document(&serialized).expect("反序列化应成功");

        assert_eq!(parsed, document);
        assert!(serialized.contains("\"parentId\": \"group-1\""));
    }
}
