//! # Canvas 文档结构化能力集成测试
//!
//! 覆盖后端暴露接口：
//! - `get_vault_canvas_document_in_root`
//! - `save_vault_canvas_document_in_root`

#[path = "support/mod.rs"]
mod support;

use ofive_lib::test_support::{
    create_vault_canvas_file_in_root, get_vault_canvas_document_in_root,
    save_vault_canvas_document_in_root, VaultCanvasDocument, VaultCanvasDocumentMetadata,
    VaultCanvasEdge, VaultCanvasEdgeSide, VaultCanvasNode, VaultCanvasNodeKind,
};
use serde_json::json;
use std::collections::BTreeMap;
use support::TestVault;

#[test]
fn get_vault_canvas_document_should_parse_canvas_payload() {
    let vault = TestVault::new();

    create_vault_canvas_file_in_root(
        "boards/roadmap.canvas".to_string(),
        Some(
            "{\n  \"nodes\": [{\n    \"id\": \"text-1\",\n    \"type\": \"text\",\n    \"x\": 8.5,\n    \"y\": 16,\n    \"width\": 320,\n    \"height\": 180.25,\n    \"text\": \"hello\",\n    \"unknownField\": true\n  }],\n  \"edges\": [],\n  \"metadata\": {\n    \"title\": \"Roadmap\"\n  },\n  \"viewport\": {\n    \"zoom\": 1.1\n  }\n}\n"
                .to_string(),
        ),
        &vault.root,
    )
    .expect("创建 Canvas 文件应成功");

    let response = get_vault_canvas_document_in_root(&vault.root, "boards/roadmap.canvas".to_string())
        .expect("读取结构化 Canvas 文档应成功");

    assert_eq!(response.relative_path, "boards/roadmap.canvas");
    assert_eq!(response.document.nodes.len(), 1);
    assert_eq!(response.document.nodes[0].node_type, VaultCanvasNodeKind::Text);
    assert_eq!(response.document.nodes[0].x, 8.5);
    assert_eq!(response.document.extra_fields.get("viewport"), Some(&json!({"zoom": 1.1})));
    assert_eq!(response.document.metadata.and_then(|metadata| metadata.title), Some("Roadmap".to_string()));
}

#[test]
fn save_vault_canvas_document_should_persist_structured_payload() {
    let vault = TestVault::new();

    create_vault_canvas_file_in_root(
        "boards/roadmap.canvas".to_string(),
        Some("{\n  \"nodes\": [],\n  \"edges\": []\n}\n".to_string()),
        &vault.root,
    )
    .expect("创建 Canvas 文件应成功");

    let document = VaultCanvasDocument {
        nodes: vec![VaultCanvasNode {
            id: "file-1".to_string(),
            node_type: VaultCanvasNodeKind::File,
            x: 40.5,
            y: 64.0,
            width: 260.0,
            height: 120.0,
            text: None,
            file: Some("notes/guide.md".to_string()),
            label: None,
            color: Some("#475569".to_string()),
            background: None,
            extra_fields: BTreeMap::from([("style".to_string(), json!("pill"))]),
        }],
        edges: vec![VaultCanvasEdge {
            id: "edge-1".to_string(),
            from_node: "file-1".to_string(),
            to_node: "file-1".to_string(),
            from_side: Some(VaultCanvasEdgeSide::Right),
            to_side: Some(VaultCanvasEdgeSide::Left),
            label: Some("relates".to_string()),
            color: None,
            extra_fields: BTreeMap::new(),
        }],
        metadata: Some(VaultCanvasDocumentMetadata {
            title: Some("Roadmap".to_string()),
            extra_fields: BTreeMap::new(),
        }),
        extra_fields: BTreeMap::from([("viewport".to_string(), json!({"x": 1.5, "y": 2.5}))]),
    };

    let response = save_vault_canvas_document_in_root(
        &vault.root,
        "boards/roadmap.canvas".to_string(),
        document.clone(),
    )
    .expect("保存结构化 Canvas 文档应成功");

    assert_eq!(response.relative_path, "boards/roadmap.canvas");
    assert!(!response.created);

    let saved = get_vault_canvas_document_in_root(&vault.root, "boards/roadmap.canvas".to_string())
        .expect("重新读取结构化 Canvas 文档应成功");
    assert_eq!(saved.document, document);
}