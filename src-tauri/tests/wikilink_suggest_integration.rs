//! # WikiLink 补全建议接口集成测试
//!
//! 覆盖后端暴露接口：
//! - `suggest_wikilink_targets`
//!
//! 验证：
//! 1. 空查询按热度排序
//! 2. 有查询时关键字匹配度为主排序维度
//! 3. 被引用次数正确反映到 reference_count
//! 4. limit 参数正确截断

#[path = "support/mod.rs"]
mod support;

use ofive_lib::suggest_wikilink_targets_in_root;
use serde_json::Value;
use support::TestVault;

#[test]
fn suggest_wikilink_should_return_results_with_reference_count() {
    let vault = TestVault::new();

    // notes/guide.md 包含 [[notes/topic]] 和 [Topic](notes/topic.md)
    // → notes/topic.md 的入链计数 ≥ 1

    let results = suggest_wikilink_targets_in_root(&vault.root, "topic".to_string(), Some(10))
        .expect("wiki link 建议查询应成功");

    assert!(!results.is_empty(), "应返回至少一个建议");

    let topic_item = results.iter().find(|item| {
        let value = serde_json::to_value(item).unwrap_or(Value::Null);
        value
            .get("relativePath")
            .and_then(Value::as_str)
            .is_some_and(|path| path == "notes/topic.md")
    });

    assert!(
        topic_item.is_some(),
        "应包含 notes/topic.md，实际结果: {:?}",
        results
            .iter()
            .map(|item| serde_json::to_value(item).unwrap_or_default())
            .collect::<Vec<_>>()
    );

    let topic_value =
        serde_json::to_value(topic_item.unwrap()).expect("应可序列化");
    let ref_count = topic_value
        .get("referenceCount")
        .and_then(Value::as_u64)
        .unwrap_or(0);

    assert!(
        ref_count >= 1,
        "notes/topic.md 的引用计数应 ≥ 1，实际: {}",
        ref_count
    );
}

#[test]
fn suggest_wikilink_empty_query_should_return_by_hotness() {
    let vault = TestVault::new();

    let results =
        suggest_wikilink_targets_in_root(&vault.root, "".to_string(), Some(10))
            .expect("空查询建议应成功");

    assert_eq!(results.len(), 3, "应返回全部 3 个笔记");

    // 被引用最多的文件（notes/topic.md）应排在前面
    let first_value = serde_json::to_value(&results[0]).unwrap_or_default();
    let first_path = first_value
        .get("relativePath")
        .and_then(Value::as_str)
        .unwrap_or("__missing__");

    assert_eq!(
        first_path, "notes/topic.md",
        "空查询时最热门的 notes/topic.md 应排第一, 实际: {}",
        first_path
    );
}

#[test]
fn suggest_wikilink_should_apply_limit() {
    let vault = TestVault::new();
    vault.write_markdown("extra/a.md", "# A\n");
    vault.write_markdown("extra/b.md", "# B\n");

    let results =
        suggest_wikilink_targets_in_root(&vault.root, "".to_string(), Some(2))
            .expect("限制条数查询应成功");

    assert_eq!(results.len(), 2, "limit=2 时应恰好返回 2 条");
}

#[test]
fn suggest_wikilink_keyword_match_takes_priority() {
    let vault = TestVault::new();
    // guide 没有入链，topic 有入链
    // 当查询 "guide" 时，guide 应排在 topic 前面（关键字优先）
    let results =
        suggest_wikilink_targets_in_root(&vault.root, "guide".to_string(), Some(10))
            .expect("关键字查询应成功");

    assert!(!results.is_empty());

    let first_value = serde_json::to_value(&results[0]).unwrap_or_default();
    let first_path = first_value
        .get("relativePath")
        .and_then(Value::as_str)
        .unwrap_or("__missing__");

    assert_eq!(
        first_path, "notes/guide.md",
        "关键字匹配应优先于热度，实际第一: {}",
        first_path
    );
}
