//! # Frontmatter 查询接口集成测试
//!
//! 覆盖后端暴露接口：
//! - `query_vault_markdown_frontmatter_in_root`

#[path = "support/mod.rs"]
mod support;

use ofive_lib::test_support::query_vault_markdown_frontmatter_in_root;
use serde_json::Value;
use support::TestVault;

#[test]
fn query_vault_markdown_frontmatter_should_return_date_matches() {
    let vault = TestVault::new();
    vault.write_markdown(
        "daily/2024-07-09.md",
        "---\ndate: 2024-07-09\ntitle: Daily Journal\n---\n# Daily\n",
    );
    vault.write_markdown(
        "notes/meeting.md",
        "---\ndate: 2024-07-09 09:30:00\n---\n# Meeting\n",
    );
    vault.write_markdown("notes/plain.md", "# Plain\n");

    let response = query_vault_markdown_frontmatter_in_root(&vault.root, "date".to_string(), None)
        .expect("按 frontmatter 字段查询应成功");
    let response_json = serde_json::to_value(response).expect("查询响应应可序列化");

    let matches = response_json
        .get("matches")
        .and_then(Value::as_array)
        .expect("matches 应为数组");

    assert!(matches.iter().any(|item| {
        item.get("relativePath").and_then(Value::as_str) == Some("daily/2024-07-09.md")
            && item.get("title").and_then(Value::as_str) == Some("Daily Journal")
    }));
    assert!(matches.iter().any(|item| {
        item.get("relativePath").and_then(Value::as_str) == Some("notes/meeting.md")
    }));
}

#[test]
fn query_vault_markdown_frontmatter_should_filter_exact_date_value() {
    let vault = TestVault::new();
    vault.write_markdown("notes/a.md", "---\ndate: 2024-07-09\n---\n# A\n");
    vault.write_markdown("notes/b.md", "---\ndate: 2024-07-10\n---\n# B\n");

    let response = query_vault_markdown_frontmatter_in_root(
        &vault.root,
        "date".to_string(),
        Some("2024-07-09".to_string()),
    )
    .expect("按 exact date 过滤应成功");
    let response_json = serde_json::to_value(response).expect("查询响应应可序列化");

    let matches = response_json
        .get("matches")
        .and_then(Value::as_array)
        .expect("matches 应为数组");
    assert_eq!(matches.len(), 1);
    assert_eq!(
        matches[0].get("relativePath").and_then(Value::as_str),
        Some("notes/a.md")
    );
}
