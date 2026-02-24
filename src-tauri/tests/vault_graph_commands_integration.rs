//! # 图谱与链接解析接口集成测试
//!
//! 覆盖后端暴露接口：
//! - `get_current_vault_markdown_graph`
//! - `resolve_wikilink_target`

#[path = "support/mod.rs"]
mod support;

use ofive_lib::{get_current_vault_markdown_graph_in_root, resolve_wikilink_target_in_root};
use serde_json::Value;
use support::TestVault;

#[test]
fn get_current_vault_markdown_graph_should_return_nodes_and_edges() {
    let vault = TestVault::new();

    let graph =
        get_current_vault_markdown_graph_in_root(&vault.root).expect("读取 markdown 图谱应成功");
    let graph_json = serde_json::to_value(graph).expect("图谱响应应可序列化");

    let nodes = graph_json
        .get("nodes")
        .and_then(Value::as_array)
        .expect("nodes 应为数组");
    let edges = graph_json
        .get("edges")
        .and_then(Value::as_array)
        .expect("edges 应为数组");

    assert!(!nodes.is_empty());
    assert!(edges.iter().any(|edge| {
        edge.get("sourcePath").and_then(Value::as_str) == Some("notes/guide.md")
            && edge.get("targetPath").and_then(Value::as_str) == Some("notes/topic.md")
    }));
}

#[test]
fn resolve_wikilink_target_should_match_expected_markdown_file() {
    let vault = TestVault::new();

    let resolved = resolve_wikilink_target_in_root(
        &vault.root,
        "notes".to_string(),
        "topic".to_string(),
    )
    .expect("解析 wikilink 应成功")
    .expect("应命中文件");

    let resolved_json = serde_json::to_value(resolved).expect("解析响应应可序列化");
    assert_eq!(
        resolved_json.get("relativePath").and_then(Value::as_str),
        Some("notes/topic.md")
    );
}
