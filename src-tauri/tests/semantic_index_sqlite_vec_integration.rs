//! # semantic-index sqlite-vec 集成测试
//!
//! 验证语义索引模块在真实 sqlite-vec 后端上的基本流程：
//! 测试前环境预检、测试数据构造、CRUD/KNN 执行、测试后清理与环境恢复。

#[path = "support/mod.rs"]
mod support;

use ofive_lib::test_support::{
    delete_indexed_markdown_document, load_indexed_markdown_document,
    search_markdown_chunks_for_consumer, upsert_indexed_markdown_document,
    SemanticSearchRequest,
};
use support::SemanticIndexTestHarness;

/// 断言 sqlite-vec 后端在完整测试流程中保持可控。
#[test]
fn semantic_index_should_manage_sqlite_vec_lifecycle_end_to_end() {
    let harness = SemanticIndexTestHarness::new();
    harness.assert_preflight();
    if !harness.should_run_real_embedding_flow() {
        return;
    }
    harness.enable_semantic_index();
    harness.seed_markdown_documents(&[
        (
            "notes/alpha.md",
            "# Alpha\n\nalpha vector paragraph\n\n## Details\nalpha detail line",
        ),
        (
            "notes/beta.md",
            "# Beta\n\nbeta context paragraph\n\n## Follow\nbeta detail line",
        ),
    ]);

    let created_alpha = upsert_indexed_markdown_document(
        "notes/alpha.md".to_string(),
        harness.read_markdown("notes/alpha.md"),
        &harness.vault.root,
    )
    .expect("alpha 文档应成功建立 sqlite-vec 索引");
    let created_beta = upsert_indexed_markdown_document(
        "notes/beta.md".to_string(),
        harness.read_markdown("notes/beta.md"),
        &harness.vault.root,
    )
    .expect("beta 文档应成功建立 sqlite-vec 索引");

    assert!(harness.store_path.exists(), "sqlite 向量库文件应已创建");
    harness.assert_embedding_cache_materialized();
    assert_eq!(created_alpha.chunks.len(), 2);
    assert_eq!(created_beta.chunks.len(), 2);

    let loaded_alpha = load_indexed_markdown_document("notes/alpha.md", &harness.vault.root)
        .expect("应成功读取 alpha 索引记录")
        .expect("alpha 索引记录应存在");
    assert_eq!(loaded_alpha.relative_path, "notes/alpha.md");
    assert_eq!(loaded_alpha.chunks[0].text, "alpha vector paragraph");

    let search = search_markdown_chunks_for_consumer(
        SemanticSearchRequest {
            query: "alpha detail".to_string(),
            limit: Some(3),
            relative_path_prefix: Some("notes/".to_string()),
            exclude_paths: vec!["notes/beta.md".to_string()],
            score_threshold: None,
        },
        &harness.vault.root,
    )
    .expect("应成功执行 sqlite-vec 检索");
    assert_eq!(search.status, "ready");
    assert!(!search.results.is_empty(), "检索结果不应为空");
    assert_eq!(search.results[0].relative_path, "notes/alpha.md");
    assert!(
        search.results[0].chunk_text.contains("alpha"),
        "真实 embedding 检索结果应优先命中 alpha 相关 chunk"
    );

    let deleted_beta = delete_indexed_markdown_document("notes/beta.md", &harness.vault.root)
        .expect("应成功删除 beta 索引记录");
    assert!(deleted_beta);
    let loaded_beta = load_indexed_markdown_document("notes/beta.md", &harness.vault.root)
        .expect("应成功读取 beta 删除后的状态");
    assert!(loaded_beta.is_none(), "beta 索引记录应已删除");

    harness.cleanup_semantic_index_artifacts();
    harness.assert_environment_restored();
}