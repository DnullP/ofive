//! # 快速切换搜索接口集成测试
//!
//! 覆盖后端暴露接口：
//! - `search_vault_markdown_files`

#[path = "support/mod.rs"]
mod support;

use ofive_lib::search_vault_markdown_files_in_root;
use serde_json::Value;
use support::TestVault;

#[test]
fn search_vault_markdown_files_should_match_filename_prefix_first() {
    let vault = TestVault::new();
    vault.write_markdown("notes/topic-advanced.md", "# Topic Advanced\n");

    let results = search_vault_markdown_files_in_root(&vault.root, "topic".to_string(), Some(20))
        .expect("搜索 markdown 文件应成功");

    assert!(!results.is_empty());

    let first = serde_json::to_value(&results[0]).expect("搜索结果应可序列化");
    assert_eq!(
        first.get("relativePath").and_then(Value::as_str),
        Some("notes/topic.md")
    );
}

#[test]
fn search_vault_markdown_files_should_apply_limit() {
    let vault = TestVault::new();
    vault.write_markdown("notes/topic-a.md", "# A\n");
    vault.write_markdown("notes/topic-b.md", "# B\n");

    let results = search_vault_markdown_files_in_root(&vault.root, "topic".to_string(), Some(2))
        .expect("搜索 markdown 文件应成功");

    assert_eq!(results.len(), 2);
}

#[test]
fn search_vault_markdown_files_should_return_sorted_paths_when_query_empty() {
    let vault = TestVault::new();

    let results = search_vault_markdown_files_in_root(&vault.root, "  ".to_string(), Some(3))
        .expect("空关键字搜索应成功");

    let paths = results
        .iter()
        .map(|item| {
            serde_json::to_value(item)
                .ok()
                .and_then(|value| {
                    value
                        .get("relativePath")
                        .and_then(Value::as_str)
                        .map(ToString::to_string)
                })
                .unwrap_or_default()
        })
        .collect::<Vec<_>>();

    assert_eq!(
        paths,
        vec!["docs/readme.md", "notes/guide.md", "notes/topic.md"]
    );
}
