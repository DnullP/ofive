//! # Semantic Index Facade
//!
//! 为 Host、Vault 与未来的同步链路提供受管控的语义索引消费入口，
//! 避免模块外部直接依赖 `semantic-index` 的私有应用服务或未来 infra 实现。

#![allow(dead_code)]

use std::path::Path;

use crate::app::semantic_index::index_app_service;
use crate::shared::semantic_index_contracts::{
    SemanticIndexBackendCatalog, SemanticIndexedDocumentRecord,
    SemanticIndexModelCatalog, SemanticIndexModelCatalogItem,
    SemanticIndexQueueStatus, SemanticIndexSettings, SemanticIndexStatus,
    SemanticSearchRequest,
    SemanticSearchResponse,
};

/// 读取当前宿主支持的语义索引后端目录。
pub fn load_semantic_index_backend_catalog() -> SemanticIndexBackendCatalog {
    index_app_service::get_semantic_index_backend_catalog()
}

/// 读取指定 Vault 的语义索引设置。
pub fn load_semantic_index_settings(vault_root: &Path) -> Result<SemanticIndexSettings, String> {
    index_app_service::load_semantic_index_settings_in_root(vault_root)
}

/// 保存指定 Vault 的语义索引设置。
pub fn save_semantic_index_settings(
    settings: SemanticIndexSettings,
    vault_root: &Path,
) -> Result<SemanticIndexSettings, String> {
    index_app_service::save_semantic_index_settings_in_root(settings, vault_root)
}

/// 读取指定 Vault 的 embedding 模型目录。
pub fn load_semantic_index_model_catalog(
    vault_root: &Path,
) -> Result<SemanticIndexModelCatalog, String> {
    index_app_service::get_semantic_index_model_catalog_in_root(vault_root)
}

/// 安装指定 embedding 模型。
pub fn install_semantic_index_model(
    model_id: String,
    vault_root: &Path,
) -> Result<SemanticIndexModelCatalogItem, String> {
    index_app_service::install_semantic_index_model_in_root(model_id, vault_root)
}

/// 启动指定 Vault 的后台全量语义索引同步。
pub fn start_semantic_index_full_sync(
    vault_root: &Path,
) -> Result<SemanticIndexQueueStatus, String> {
    index_app_service::start_semantic_index_full_sync_in_root(vault_root)
}

/// 为指定 Markdown 文档建立或更新索引记录。
pub fn upsert_indexed_markdown_document(
    relative_path: String,
    content: String,
    vault_root: &Path,
) -> Result<SemanticIndexedDocumentRecord, String> {
    index_app_service::upsert_indexed_markdown_document_in_root(relative_path, content, vault_root)
}

/// 读取指定 Markdown 文档的索引记录。
pub fn load_indexed_markdown_document(
    relative_path: &str,
    vault_root: &Path,
) -> Result<Option<SemanticIndexedDocumentRecord>, String> {
    index_app_service::load_indexed_markdown_document_in_root(relative_path, vault_root)
}

/// 删除指定 Markdown 文档的索引记录。
pub fn delete_indexed_markdown_document(
    relative_path: &str,
    vault_root: &Path,
) -> Result<bool, String> {
    index_app_service::delete_indexed_markdown_document_in_root(relative_path, vault_root)
}

/// 确保指定 Vault 的语义索引处于当前版本要求的状态。
///
/// # 参数
/// - `vault_root`：目标 Vault 根目录。
///
/// # 返回值
/// - `Ok(SemanticIndexStatus)`：当前结构化状态。
/// - `Err(String)`：未来接入真实索引初始化失败时返回。
pub fn ensure_semantic_index_current(vault_root: &Path) -> Result<SemanticIndexStatus, String> {
    let status = index_app_service::get_semantic_index_status_in_root(vault_root)?;
    log::info!(
        "[semantic-index] ensure current requested: vault_root={} status={}",
        vault_root.display(),
        status.status
    );
    Ok(status)
}

/// 通知语义索引模块某个 Markdown 文件已保存或创建。
///
/// # 参数
/// - `relative_path`：发生变更的文件路径。
/// - `vault_root`：目标 Vault 根目录。
///
/// # 返回值
/// - `Ok(())`：已接收事件。
/// - `Err(String)`：未来接入后台队列失败时返回。
pub fn enqueue_markdown_upsert(relative_path: &str, vault_root: &Path) -> Result<(), String> {
    log::info!(
        "[semantic-index] enqueue markdown upsert: vault_root={} relative_path={}",
        vault_root.display(),
        relative_path
    );
    Ok(())
}

/// 通知语义索引模块某个 Markdown 文件已删除。
pub fn enqueue_markdown_remove(relative_path: &str, vault_root: &Path) -> Result<(), String> {
    log::info!(
        "[semantic-index] enqueue markdown remove: vault_root={} relative_path={}",
        vault_root.display(),
        relative_path
    );
    Ok(())
}

/// 通知语义索引模块某个 Markdown 文件已移动或重命名。
pub fn enqueue_markdown_move(
    old_relative_path: &str,
    new_relative_path: &str,
    vault_root: &Path,
) -> Result<(), String> {
    log::info!(
        "[semantic-index] enqueue markdown move: vault_root={} old_relative_path={} new_relative_path={}",
        vault_root.display(),
        old_relative_path,
        new_relative_path
    );
    Ok(())
}

/// 通知语义索引模块某个目录路径前缀发生移动。
pub fn enqueue_directory_move(
    old_prefix: &str,
    new_prefix: &str,
    vault_root: &Path,
) -> Result<(), String> {
    log::info!(
        "[semantic-index] enqueue directory move: vault_root={} old_prefix={} new_prefix={}",
        vault_root.display(),
        old_prefix,
        new_prefix
    );
    Ok(())
}

/// 通知语义索引模块某个目录已删除。
pub fn enqueue_directory_remove(prefix: &str, vault_root: &Path) -> Result<(), String> {
    log::info!(
        "[semantic-index] enqueue directory remove: vault_root={} prefix={}",
        vault_root.display(),
        prefix
    );
    Ok(())
}

/// 为受控调用方执行一次语义检索。
pub fn search_markdown_chunks_for_consumer(
    request: SemanticSearchRequest,
    vault_root: &Path,
) -> Result<SemanticSearchResponse, String> {
    index_app_service::search_markdown_chunks_in_root(request, vault_root)
}

#[cfg(test)]
mod tests {
    use super::{
        delete_indexed_markdown_document,
        enqueue_directory_move, enqueue_directory_remove, enqueue_markdown_move,
        enqueue_markdown_remove, enqueue_markdown_upsert, ensure_semantic_index_current,
        load_indexed_markdown_document, load_semantic_index_backend_catalog,
        load_semantic_index_settings, save_semantic_index_settings,
        search_markdown_chunks_for_consumer, upsert_indexed_markdown_document,
    };
    use crate::shared::semantic_index_contracts::SemanticSearchRequest;
    use crate::shared::semantic_index_contracts::{
        ChunkingStrategyKind, EmbeddingProviderKind, SemanticIndexSettings, VectorStoreKind,
    };
    use std::fs;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    static TEST_ROOT_SEQ: AtomicU64 = AtomicU64::new(1);

    fn create_test_root() -> PathBuf {
        let sequence = TEST_ROOT_SEQ.fetch_add(1, Ordering::Relaxed);
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0);
        let root = std::env::temp_dir().join(format!(
            "ofive-semantic-index-facade-{}-{}",
            nanos, sequence
        ));
        fs::create_dir_all(&root).expect("test root should be created");
        root
    }

    #[test]
    fn backend_catalog_facade_should_forward_builtin_choices() {
        let catalog = load_semantic_index_backend_catalog();

        assert_eq!(catalog.embedding_providers.len(), 1);
        assert_eq!(catalog.vector_stores.len(), 1);
        assert_eq!(catalog.chunking_strategies.len(), 2);
    }

    #[test]
    fn settings_facade_should_round_trip_configuration() {
        let root = create_test_root();
        let saved = save_semantic_index_settings(
            SemanticIndexSettings {
                enabled: true,
                embedding_provider: EmbeddingProviderKind::FastEmbed,
                vector_store: VectorStoreKind::SqliteVec,
                chunking_strategy: ChunkingStrategyKind::WholeDocument,
                model_id: "BAAI/bge-small-zh-v1.5".to_string(),
                chunk_strategy_version: 2,
            },
            &root,
        )
        .expect("settings facade should save");
        let loaded = load_semantic_index_settings(&root)
            .expect("settings facade should load");

        assert_eq!(saved, loaded);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn indexed_document_facade_should_support_basic_crud() {
        let root = create_test_root();
        save_semantic_index_settings(
            SemanticIndexSettings {
                enabled: true,
                embedding_provider: EmbeddingProviderKind::FastEmbed,
                vector_store: VectorStoreKind::SqliteVec,
                chunking_strategy: ChunkingStrategyKind::WholeDocument,
                model_id: "intfloat/multilingual-e5-small".to_string(),
                chunk_strategy_version: 1,
            },
            &root,
        )
        .expect("settings should enable CRUD facade flow");

        let created = upsert_indexed_markdown_document(
            "Notes/gamma.md".to_string(),
            "gamma text\n\nsecond line".to_string(),
            &root,
        )
        .expect("facade create should succeed");
        assert_eq!(created.chunks.len(), 1);

        let loaded = load_indexed_markdown_document("Notes/gamma.md", &root)
            .expect("facade load should succeed")
            .expect("gamma record should exist");
        assert_eq!(loaded.relative_path, "Notes/gamma.md");

        let deleted = delete_indexed_markdown_document("Notes/gamma.md", &root)
            .expect("facade delete should succeed");
        assert!(deleted);

        let loaded_after_delete = load_indexed_markdown_document("Notes/gamma.md", &root)
            .expect("facade load after delete should succeed");
        assert!(loaded_after_delete.is_none());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn ensure_current_should_return_disabled_status_for_default_settings() {
        let root = create_test_root();
        let status = ensure_semantic_index_current(&root)
            .expect("ensure current should succeed in cold state");

        assert_eq!(status.status, "disabled");

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn enqueue_facade_functions_should_accept_placeholder_requests() {
        let root = create_test_root();

        enqueue_markdown_upsert("Notes/A.md", &root).expect("upsert enqueue should succeed");
        enqueue_markdown_remove("Notes/A.md", &root).expect("remove enqueue should succeed");
        enqueue_markdown_move("Notes/A.md", "Archive/A.md", &root)
            .expect("move enqueue should succeed");
        enqueue_directory_move("Notes", "Archive/Notes", &root)
            .expect("directory move enqueue should succeed");
        enqueue_directory_remove("Archive", &root)
            .expect("directory remove enqueue should succeed");

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn facade_search_should_forward_structured_cold_state() {
        let root = create_test_root();
        let response = search_markdown_chunks_for_consumer(
            SemanticSearchRequest {
                query: "markdown chunk".to_string(),
                limit: Some(3),
                relative_path_prefix: Some("Notes".to_string()),
                exclude_paths: vec!["Archive/Old.md".to_string()],
                score_threshold: Some(0.2),
            },
            &root,
        )
        .expect("facade search should succeed");

        assert_eq!(response.status, "disabled");
        assert!(response.results.is_empty());

        let _ = fs::remove_dir_all(root);
    }
}