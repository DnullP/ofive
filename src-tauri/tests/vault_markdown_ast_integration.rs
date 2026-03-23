//! # Markdown AST 接口集成测试
//!
//! 覆盖后端暴露接口：
//! - `get_vault_markdown_ast`

#[path = "support/mod.rs"]
mod support;

use ofive_lib::test_support::{get_vault_markdown_ast_in_root, parse_markdown_to_ast};
use serde_json::Value;
use support::TestVault;

#[test]
fn parse_markdown_to_ast_should_serialize_expected_shape() {
    let ast = parse_markdown_to_ast("# Title\n\n[Topic](notes/topic.md)")
        .expect("解析 Markdown AST 应成功");
    let ast_json = serde_json::to_value(ast).expect("AST 应可序列化");

    let children = ast_json
        .get("children")
        .and_then(Value::as_array)
        .expect("document.children 应为数组");
    assert_eq!(
        children[0].get("kind").and_then(Value::as_str),
        Some("heading")
    );
    assert_eq!(
        children[0]
            .get("attributes")
            .and_then(Value::as_object)
            .and_then(|attrs| attrs.get("level"))
            .and_then(Value::as_str),
        Some("1")
    );
}

#[test]
fn get_vault_markdown_ast_should_return_note_ast_data() {
    let vault = TestVault::new();

    let response = get_vault_markdown_ast_in_root(&vault.root, "notes/guide.md".to_string())
        .expect("读取 Markdown AST 应成功");
    let response_json = serde_json::to_value(response).expect("AST 响应应可序列化");

    assert_eq!(
        response_json.get("relativePath").and_then(Value::as_str),
        Some("notes/guide.md")
    );

    let ast = response_json
        .get("ast")
        .and_then(Value::as_object)
        .expect("ast 应为对象");
    assert_eq!(ast.get("kind").and_then(Value::as_str), Some("document"));

    let children = ast
        .get("children")
        .and_then(Value::as_array)
        .expect("ast.children 应为数组");
    assert!(children
        .iter()
        .any(|node| { node.get("kind").and_then(Value::as_str) == Some("heading") }));
}
