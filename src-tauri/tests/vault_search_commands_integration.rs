//! # 快速切换搜索接口集成测试
//!
//! 覆盖后端暴露接口：
//! - `search_vault_markdown_files`

#[path = "support/mod.rs"]
mod support;

use ofive_lib::test_support::{
    query_vault_tasks_in_root, search_vault_markdown_files_in_root, search_vault_markdown_in_root,
    VaultSearchScope,
};
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

#[test]
fn search_vault_markdown_should_support_full_text_tag_filter_and_file_name_scope() {
    let vault = TestVault::new();
    vault.write_markdown(
        "notes/topic-roadmap.md",
        "---\ntags:\n  - project\n---\n# Topic\n\nAlpha beta roadmap\n",
    );
    vault.write_markdown(
        "notes/roadmap-log.md",
        "# Log\n\nroadmap in content only\n#weekly\n",
    );

    let content_results = search_vault_markdown_in_root(
        &vault.root,
        "roadmap".to_string(),
        Some("project".to_string()),
        VaultSearchScope::All,
        Some(20),
    )
    .expect("全文搜索应成功");

    assert_eq!(content_results.len(), 1);
    let first_content = serde_json::to_value(&content_results[0]).expect("结果应可序列化");
    assert_eq!(
        first_content.get("relativePath").and_then(Value::as_str),
        Some("notes/topic-roadmap.md")
    );
    assert_eq!(
        first_content.get("matchedContent").and_then(Value::as_bool),
        Some(true)
    );
    assert_eq!(
        first_content.get("matchedTag").and_then(Value::as_bool),
        Some(true)
    );

    let file_name_results = search_vault_markdown_in_root(
        &vault.root,
        "topic-road".to_string(),
        None,
        VaultSearchScope::FileName,
        Some(20),
    )
    .expect("文件名搜索应成功");

    assert_eq!(file_name_results.len(), 1);
    let first_file_name = serde_json::to_value(&file_name_results[0]).expect("结果应可序列化");
    assert_eq!(
        first_file_name.get("relativePath").and_then(Value::as_str),
        Some("notes/topic-roadmap.md")
    );
    assert_eq!(
        first_file_name
            .get("matchedFileName")
            .and_then(Value::as_bool),
        Some(true)
    );
}

#[test]
fn query_vault_tasks_should_collect_repo_tasks_and_skip_code_blocks() {
    let vault = TestVault::new();
    vault.write_markdown(
        "notes/tasks.md",
        concat!(
            "# Tasks\n",
            "- [ ] Release prep @2026-03-25 10:00 !high\n",
            "```md\n",
            "- [ ] Hidden task @2026-03-25 11:00 !low\n",
            "```\n",
            "- [x] Done task @2026-03-24 08:00 !medium\n",
        ),
    );

    let results = query_vault_tasks_in_root(&vault.root).expect("任务查询应成功");

    assert_eq!(results.len(), 2);

    let first = serde_json::to_value(&results[0]).expect("结果应可序列化");
    assert_eq!(
        first.get("relativePath").and_then(Value::as_str),
        Some("notes/tasks.md")
    );
    assert_eq!(first.get("line").and_then(Value::as_u64), Some(2));
    assert_eq!(
        first.get("content").and_then(Value::as_str),
        Some("Release prep")
    );
    assert_eq!(first.get("checked").and_then(Value::as_bool), Some(false));

    let second = serde_json::to_value(&results[1]).expect("结果应可序列化");
    assert_eq!(second.get("line").and_then(Value::as_u64), Some(6));
    assert_eq!(second.get("checked").and_then(Value::as_bool), Some(true));
}
