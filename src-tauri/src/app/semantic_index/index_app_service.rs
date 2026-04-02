//! # Semantic Index 应用服务
//!
//! 负责语义索引模块的用例编排。当前阶段先提供稳定的冷态响应，
//! 为后续接入 fastembed-rs 与 sqlite-vec 保留不变的应用层边界。

use std::collections::HashSet;
use std::fs;
use std::path::Path;
use std::sync::{Mutex, OnceLock};

use crate::app::vault::query_facade;
use crate::infra::persistence::extension_private_store;
use crate::infra::vector::{
    available_chunking_strategies, available_embedding_providers, available_vector_stores,
    build_chunking_strategy, build_embedding_provider, build_vector_store,
    ensure_sqlite_vec_runtime, semantic_index_embedding_cache_dir,
    SemanticIndexDocumentWrite,
};
use crate::shared::semantic_index_contracts::{
    SemanticIndexBackendCatalog, SemanticIndexedChunkRecord,
    SemanticIndexedDocumentRecord, SemanticIndexModelCatalog,
    SemanticIndexModelCatalogItem, SemanticIndexModelInstallStatus,
    SemanticIndexQueueStatus, SemanticIndexSettings, SemanticIndexSnapshot,
    SemanticIndexStatus, SemanticSearchRequest, SemanticSearchResponse,
};
use serde::{Deserialize, Serialize};

const SEMANTIC_INDEX_SCHEMA_VERSION: u32 = 1;
const SEMANTIC_INDEX_OWNER: &str = "semantic-index";
const SEMANTIC_INDEX_SETTINGS_STATE_KEY: &str = "settings";
const SEMANTIC_INDEX_MODEL_INSTALLS_STATE_KEY: &str = "model-installs";
const SEMANTIC_INDEX_QUEUE_STATUS_STATE_KEY: &str = "queue-status";

static FULL_SYNC_RUNNING_ROOTS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();

/// 已安装模型注册表。
#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct SemanticIndexModelInstallRegistry {
    /// 已知模型安装记录。
    models: Vec<SemanticIndexInstalledModelRecord>,
}

/// 单个模型安装记录。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct SemanticIndexInstalledModelRecord {
    /// 模型 ID。
    model_id: String,
    /// 安装完成时间戳。
    installed_at_ms: Option<i64>,
    /// 当前模型维度。
    dimensions: Option<usize>,
    /// 最近一次安装错误摘要。
    last_error: Option<String>,
}

/// 返回当前宿主支持的语义索引后端目录。
pub(crate) fn get_semantic_index_backend_catalog() -> SemanticIndexBackendCatalog {
    SemanticIndexBackendCatalog {
        embedding_providers: available_embedding_providers(),
        vector_stores: available_vector_stores(),
        chunking_strategies: available_chunking_strategies(),
    }
}

/// 返回指定 Vault 下的 embedding 模型目录。
pub(crate) fn get_semantic_index_model_catalog_in_root(
    vault_root: &Path,
) -> Result<SemanticIndexModelCatalog, String> {
    let settings = load_semantic_index_settings_in_root(vault_root)?;
    let embedding_provider = build_embedding_provider(settings.embedding_provider)?;
    let descriptor = embedding_provider.descriptor();
    let install_registry = load_semantic_index_model_install_registry(vault_root)?;

    let mut models = Vec::new();
    for model_id in descriptor.supported_model_ids {
        let install_record = install_registry
            .models
            .iter()
            .find(|record| record.model_id == model_id);
        let install_status = resolve_model_install_status(vault_root, &model_id, install_record)?;
        let dimensions = install_record.and_then(|record| record.dimensions);
        let installed_at_ms = install_record.and_then(|record| record.installed_at_ms);
        let last_error = install_record.and_then(|record| record.last_error.clone());
        models.push(SemanticIndexModelCatalogItem {
            model_id: model_id.clone(),
            display_name: semantic_index_model_display_name(&model_id),
            embedding_provider: settings.embedding_provider,
            is_default: model_id == descriptor.default_model_id,
            is_selected: model_id == settings.model_id,
            install_status,
            dimensions,
            installed_at_ms,
            last_error,
        });
    }

    Ok(SemanticIndexModelCatalog {
        enabled: settings.enabled,
        embedding_provider: settings.embedding_provider,
        selected_model_id: settings.model_id,
        models,
    })
}

/// 安装指定 embedding 模型并更新本地安装状态。
pub(crate) fn install_semantic_index_model_in_root(
    model_id: String,
    vault_root: &Path,
) -> Result<SemanticIndexModelCatalogItem, String> {
    let normalized_model_id = model_id.trim().to_string();
    if normalized_model_id.is_empty() {
        return Err("semantic-index model_id must not be empty".to_string());
    }

    let settings = load_semantic_index_settings_in_root(vault_root)?;
    let embedding_provider = build_embedding_provider(settings.embedding_provider)?;
    embedding_provider.validate_model_id(&normalized_model_id)?;
    let dimensions = embedding_provider.embedding_dimensions(&normalized_model_id, vault_root)?;
    let mut install_registry = load_semantic_index_model_install_registry(vault_root)?;
    let install_record = SemanticIndexInstalledModelRecord {
        model_id: normalized_model_id.clone(),
        installed_at_ms: Some(now_unix_ms()),
        dimensions: Some(dimensions),
        last_error: None,
    };
    upsert_model_install_record(&mut install_registry, install_record.clone());
    save_semantic_index_model_install_registry(vault_root, &install_registry)?;

    Ok(SemanticIndexModelCatalogItem {
        model_id: normalized_model_id.clone(),
        display_name: semantic_index_model_display_name(&normalized_model_id),
        embedding_provider: settings.embedding_provider,
        is_default: normalized_model_id == embedding_provider.descriptor().default_model_id,
        is_selected: normalized_model_id == settings.model_id,
        install_status: SemanticIndexModelInstallStatus::Installed,
        dimensions: install_record.dimensions,
        installed_at_ms: install_record.installed_at_ms,
        last_error: None,
    })
}

/// 返回指定 Vault 下的语义索引设置。
///
/// # 参数
/// - `vault_root`：目标 Vault 根目录。
///
/// # 返回值
/// - `SemanticIndexSettings`：当前语义索引设置。
///
/// # 异常
/// - 若模块私有设置文件损坏或读取失败，则返回 `Err(String)`。
pub(crate) fn load_semantic_index_settings_in_root(
    vault_root: &Path,
) -> Result<SemanticIndexSettings, String> {
    let loaded = extension_private_store::load_extension_private_state::<SemanticIndexSettings>(
        vault_root,
        SEMANTIC_INDEX_OWNER,
        SEMANTIC_INDEX_SETTINGS_STATE_KEY,
    )?;

    let settings = sanitize_semantic_index_settings(loaded.unwrap_or_default());

    log::info!(
        "[semantic-index] settings loaded: vault_root={} enabled={} embedding_provider={:?} vector_store={:?} chunking_strategy={:?} model_id={}",
        vault_root.display(),
        settings.enabled,
        settings.embedding_provider,
        settings.vector_store,
        settings.chunking_strategy,
        settings.model_id
    );

    Ok(settings)
}

/// 保存指定 Vault 下的语义索引设置。
pub(crate) fn save_semantic_index_settings_in_root(
    settings: SemanticIndexSettings,
    vault_root: &Path,
) -> Result<SemanticIndexSettings, String> {
    let sanitized = sanitize_semantic_index_settings(settings);
    extension_private_store::save_extension_private_state(
        vault_root,
        SEMANTIC_INDEX_OWNER,
        SEMANTIC_INDEX_SETTINGS_STATE_KEY,
        &sanitized,
    )?;

    log::info!(
        "[semantic-index] settings saved: vault_root={} enabled={} embedding_provider={:?} vector_store={:?} chunking_strategy={:?} model_id={}",
        vault_root.display(),
        sanitized.enabled,
        sanitized.embedding_provider,
        sanitized.vector_store,
        sanitized.chunking_strategy,
        sanitized.model_id
    );

    if !sanitized.enabled {
        save_semantic_index_queue_status_in_root(
            vault_root,
            &default_semantic_index_queue_status(false),
        )?;
    }

    Ok(sanitized)
}

/// 启动指定 Vault 的全量语义索引同步。
pub(crate) fn start_semantic_index_full_sync_in_root(
    vault_root: &Path,
) -> Result<SemanticIndexQueueStatus, String> {
    let settings = load_semantic_index_settings_in_root(vault_root)?;
    if !settings.enabled {
        return Err("semantic index full sync requires enabled settings".to_string());
    }

    validate_runtime_selection(&settings)?;
    if !is_model_ready_for_sync(vault_root, &settings.model_id)? {
        return Err(format!(
            "semantic index active model is not ready: {}",
            settings.model_id
        ));
    }

    let root_key = vault_root_key(vault_root);
    {
        let mut running_roots = full_sync_running_roots()
            .lock()
            .map_err(|error| format!("semantic-index full sync lock poisoned: {error}"))?;
        if !running_roots.insert(root_key.clone()) {
            return load_semantic_index_queue_status_in_root(vault_root, settings.enabled);
        }
    }

    let queue_status = SemanticIndexQueueStatus {
        worker_status: "running".to_string(),
        pending_file_count: 0,
        has_pending_rebuild: true,
        last_enqueued_at_ms: Some(now_unix_ms()),
        last_processed_at_ms: None,
        total_file_count: 0,
        processed_file_count: 0,
        failed_file_count: 0,
        current_file_path: None,
        last_error: None,
    };
    save_semantic_index_queue_status_in_root(vault_root, &queue_status)?;

    let owned_root = vault_root.to_path_buf();
    let root_key_for_thread = root_key.clone();
    let spawn_result = std::thread::Builder::new()
        .name(format!("semantic-index-full-sync-{}", now_unix_ms()))
        .spawn(move || {
            let task_result = run_semantic_index_full_sync_in_root(&owned_root);
            if let Err(error) = task_result {
                let _ = mark_semantic_index_full_sync_failed(&owned_root, error);
            }

            if let Ok(mut running_roots) = full_sync_running_roots().lock() {
                running_roots.remove(&root_key_for_thread);
            }
        });

    if let Err(error) = spawn_result {
        if let Ok(mut running_roots) = full_sync_running_roots().lock() {
            running_roots.remove(&root_key);
        }
        return Err(format!(
            "failed to spawn semantic-index full sync worker: {error}"
        ));
    }

    Ok(queue_status)
}

/// 读取指定 Vault 下的索引快照。
pub(crate) fn load_semantic_index_snapshot_in_root(
    vault_root: &Path,
) -> Result<SemanticIndexSnapshot, String> {
    let settings = load_semantic_index_settings_in_root(vault_root)?;
    validate_runtime_selection(&settings)?;
    let vector_store = build_vector_store(settings.vector_store)?;
    vector_store.load_snapshot(
        vault_root,
        SEMANTIC_INDEX_OWNER,
        SEMANTIC_INDEX_SCHEMA_VERSION,
    )
}

/// 返回指定 Vault 下的语义索引状态。
///
/// # 参数
/// - `vault_root`：目标 Vault 根目录。
///
/// # 返回值
/// - `SemanticIndexStatus`：当前索引状态。
///
/// # 异常
/// - 若读取设置或后端选择校验失败，则返回 `Err(String)`。
pub(crate) fn get_semantic_index_status_in_root(
    vault_root: &Path,
) -> Result<SemanticIndexStatus, String> {
    let settings = load_semantic_index_settings_in_root(vault_root)?;
    validate_runtime_selection(&settings)?;
    let snapshot = load_semantic_index_snapshot_in_root(vault_root)?;
    let queue_status = load_semantic_index_queue_status_in_root(vault_root, settings.enabled)?;
    let status = if !settings.enabled {
        "disabled"
    } else if queue_status.worker_status == "running" {
        "building"
    } else if snapshot.documents.is_empty() {
        "empty"
    } else {
        "ready"
    };

    log::info!(
        "[semantic-index] status requested: vault_root={} status={} embedding_provider={:?} vector_store={:?} chunking_strategy={:?} model_id={}",
        vault_root.display(),
        status,
        settings.embedding_provider,
        settings.vector_store,
        settings.chunking_strategy,
        settings.model_id
    );

    let active_model_ready = is_model_ready_for_sync(vault_root, &settings.model_id)?;

    Ok(SemanticIndexStatus {
        status: status.to_string(),
        enabled: settings.enabled,
        embedding_provider: settings.embedding_provider,
        vector_store: settings.vector_store,
        chunking_strategy: settings.chunking_strategy,
        model_id: settings.model_id,
        active_model_ready,
        schema_version: SEMANTIC_INDEX_SCHEMA_VERSION,
        last_error: queue_status.last_error.clone(),
        queue_status,
    })
}

/// 为指定 Markdown 文档建立或更新索引记录。
pub(crate) fn upsert_indexed_markdown_document_in_root(
    relative_path: String,
    content: String,
    vault_root: &Path,
) -> Result<SemanticIndexedDocumentRecord, String> {
    if relative_path.trim().is_empty() {
        log::warn!(
            "[semantic-index] empty relative_path during upsert: vault_root={}",
            vault_root.display()
        );
        return Err("semantic index relative_path must not be empty".to_string());
    }

    let settings = load_semantic_index_settings_in_root(vault_root)?;
    validate_runtime_selection(&settings)?;
    let chunking_strategy = build_chunking_strategy(settings.chunking_strategy)?;
    let chunk_drafts = chunking_strategy.chunk_markdown(&relative_path, &content);
    let indexed_at_ms = now_unix_ms();
    let content_hash = compute_stable_hash_hex(&content);

    let chunks = chunk_drafts
        .into_iter()
        .enumerate()
        .map(|(index, chunk)| SemanticIndexedChunkRecord {
            chunk_id: format!(
                "{}:{}:{}",
                relative_path,
                index,
                compute_stable_hash_hex(&chunk.text)
            ),
            heading_path: chunk.heading_path,
            start_line: chunk.start_line,
            end_line: chunk.end_line,
            text: chunk.text,
        })
        .collect::<Vec<_>>();

    let record = SemanticIndexedDocumentRecord {
        relative_path: relative_path.trim().replace('\\', "/"),
        content_hash,
        chunking_strategy: settings.chunking_strategy,
        chunk_strategy_version: settings.chunk_strategy_version,
        indexed_at_ms,
        chunks,
    };
    let embedding_provider = build_embedding_provider(settings.embedding_provider)?;
    let embedding_dimensions = embedding_provider.embedding_dimensions(&settings.model_id, vault_root)?;
    let embeddings = embedding_provider.embed_passages(
        &settings.model_id,
        &record
            .chunks
            .iter()
            .map(|chunk| chunk.text.clone())
            .collect::<Vec<_>>(),
        vault_root,
    )?;
    let vector_store = build_vector_store(settings.vector_store)?;
    vector_store.upsert_document(
        vault_root,
        SEMANTIC_INDEX_OWNER,
        SEMANTIC_INDEX_SCHEMA_VERSION,
        &SemanticIndexDocumentWrite {
            document: record.clone(),
            embedding_dimensions,
            chunk_embeddings: embeddings,
        },
    )?;

    log::info!(
        "[semantic-index] document upserted: vault_root={} relative_path={} chunks={}",
        vault_root.display(),
        record.relative_path,
        record.chunks.len()
    );

    Ok(record)
}

/// 读取指定 Markdown 文档的索引记录。
pub(crate) fn load_indexed_markdown_document_in_root(
    relative_path: &str,
    vault_root: &Path,
) -> Result<Option<SemanticIndexedDocumentRecord>, String> {
    let normalized_relative_path = relative_path.trim().replace('\\', "/");
    if normalized_relative_path.is_empty() {
        log::warn!(
            "[semantic-index] empty relative_path during indexed document load: vault_root={}",
            vault_root.display()
        );
        return Ok(None);
    }

    let settings = load_semantic_index_settings_in_root(vault_root)?;
    validate_runtime_selection(&settings)?;
    let vector_store = build_vector_store(settings.vector_store)?;
    vector_store.load_document(
        vault_root,
        SEMANTIC_INDEX_OWNER,
        SEMANTIC_INDEX_SCHEMA_VERSION,
        &normalized_relative_path,
    )
}

/// 删除指定 Markdown 文档的索引记录。
pub(crate) fn delete_indexed_markdown_document_in_root(
    relative_path: &str,
    vault_root: &Path,
) -> Result<bool, String> {
    let normalized_relative_path = relative_path.trim().replace('\\', "/");
    if normalized_relative_path.is_empty() {
        log::warn!(
            "[semantic-index] empty relative_path during delete: vault_root={}",
            vault_root.display()
        );
        return Ok(false);
    }

    let settings = load_semantic_index_settings_in_root(vault_root)?;
    validate_runtime_selection(&settings)?;
    let vector_store = build_vector_store(settings.vector_store)?;
    let deleted = vector_store.delete_document(
        vault_root,
        SEMANTIC_INDEX_OWNER,
        SEMANTIC_INDEX_SCHEMA_VERSION,
        &normalized_relative_path,
    )?;
    if deleted {
        log::info!(
            "[semantic-index] document deleted: vault_root={} relative_path={}",
            vault_root.display(),
            normalized_relative_path
        );
    }

    Ok(deleted)
}

/// 在指定 Vault 下执行语义检索。
///
/// # 参数
/// - `request`：语义检索输入。
/// - `vault_root`：目标 Vault 根目录。
///
/// # 返回值
/// - `Ok(SemanticSearchResponse)`：结构化检索结果。
/// - `Err(String)`：仅在请求非法等非协议冷态场景下返回错误。
///
/// # 异常
/// - 当 `query` 为空字符串时返回错误。
///
/// # 副作用
/// - 会读取模块私有索引并执行 sqlite-vec 向量检索。
pub(crate) fn search_markdown_chunks_in_root(
    request: SemanticSearchRequest,
    vault_root: &Path,
) -> Result<SemanticSearchResponse, String> {
    if request.query.trim().is_empty() {
        log::warn!(
            "[semantic-index] empty query received: vault_root={}",
            vault_root.display()
        );
        return Err("semantic search query must not be empty".to_string());
    }

    let settings = load_semantic_index_settings_in_root(vault_root)?;
    validate_runtime_selection(&settings)?;
    let snapshot = load_semantic_index_snapshot_in_root(vault_root)?;
    let status = if !settings.enabled {
        "disabled"
    } else if snapshot.documents.is_empty() {
        "empty"
    } else {
        "ready"
    };

    log::info!(
        "[semantic-index] search requested: vault_root={} query_len={} limit={:?} path_prefix={:?} exclude_paths={} threshold={:?} status={}",
        vault_root.display(),
        request.query.chars().count(),
        request.limit,
        request.relative_path_prefix,
        request.exclude_paths.len(),
        request.score_threshold,
        status
    );

    if status != "ready" {
        return Ok(SemanticSearchResponse {
            status: status.to_string(),
            model_id: settings.model_id,
            results: Vec::new(),
        });
    }

    let embedding_provider = build_embedding_provider(settings.embedding_provider)?;
    let query_embedding = embedding_provider.embed_query(
        &settings.model_id,
        &request.query,
        vault_root,
    )?;
    let vector_store = build_vector_store(settings.vector_store)?;
    let results = vector_store.search(
        vault_root,
        SEMANTIC_INDEX_OWNER,
        SEMANTIC_INDEX_SCHEMA_VERSION,
        &query_embedding,
        &request,
    )?;

    Ok(SemanticSearchResponse {
        status: status.to_string(),
        model_id: settings.model_id,
        results,
    })
}

/// 清洗并校验语义索引设置，确保可插拔后端选择始终处于受支持集合内。
fn sanitize_semantic_index_settings(settings: SemanticIndexSettings) -> SemanticIndexSettings {
    let mut sanitized = settings;
    let default_settings = SemanticIndexSettings::default();

    let embedding_provider = match build_embedding_provider(sanitized.embedding_provider) {
        Ok(provider) => provider,
        Err(error) => {
            log::warn!(
                "[semantic-index] unsupported embedding provider {:?}, fallback to default: {}",
                sanitized.embedding_provider,
                error
            );
            sanitized.embedding_provider = default_settings.embedding_provider;
            build_embedding_provider(sanitized.embedding_provider)
                .expect("default embedding provider should remain valid")
        }
    };
    if let Err(error) = embedding_provider.validate_model_id(&sanitized.model_id) {
        let default_model_id = embedding_provider.descriptor().default_model_id;
        log::warn!(
            "[semantic-index] unsupported model_id={}, fallback to default model: {}",
            sanitized.model_id,
            error
        );
        sanitized.model_id = default_model_id;
    }

    if let Err(error) = build_vector_store(sanitized.vector_store) {
        log::warn!(
            "[semantic-index] unsupported vector store {:?}, fallback to default: {}",
            sanitized.vector_store,
            error
        );
        sanitized.vector_store = default_settings.vector_store;
    }

    if let Err(error) = build_chunking_strategy(sanitized.chunking_strategy) {
        log::warn!(
            "[semantic-index] unsupported chunking strategy {:?}, fallback to default: {}",
            sanitized.chunking_strategy,
            error
        );
        sanitized.chunking_strategy = default_settings.chunking_strategy;
    }

    if sanitized.chunk_strategy_version == 0 {
        log::warn!(
            "[semantic-index] invalid chunk_strategy_version=0, fallback to default version"
        );
        sanitized.chunk_strategy_version = default_settings.chunk_strategy_version;
    }

    sanitized
}

/// 校验当前设置对应的可插拔后端组合是否合法。
fn validate_runtime_selection(settings: &SemanticIndexSettings) -> Result<(), String> {
    let embedding_provider = build_embedding_provider(settings.embedding_provider)?;
    embedding_provider.validate_model_id(&settings.model_id)?;
    if cfg!(test) {
        return Ok(());
    }

    let vector_store = build_vector_store(settings.vector_store)?;
    vector_store.validate_schema_version(SEMANTIC_INDEX_SCHEMA_VERSION)?;
    let _sqlite_vec_version = ensure_sqlite_vec_runtime()?;

    let _chunking_strategy = build_chunking_strategy(settings.chunking_strategy)?;

    Ok(())
}

/// 读取模型安装注册表。
fn load_semantic_index_model_install_registry(
    vault_root: &Path,
) -> Result<SemanticIndexModelInstallRegistry, String> {
    Ok(extension_private_store::load_extension_private_state::<SemanticIndexModelInstallRegistry>(
        vault_root,
        SEMANTIC_INDEX_OWNER,
        SEMANTIC_INDEX_MODEL_INSTALLS_STATE_KEY,
    )?
    .unwrap_or_default())
}

/// 读取当前队列状态。
fn load_semantic_index_queue_status_in_root(
    vault_root: &Path,
    enabled: bool,
) -> Result<SemanticIndexQueueStatus, String> {
    Ok(extension_private_store::load_extension_private_state::<SemanticIndexQueueStatus>(
        vault_root,
        SEMANTIC_INDEX_OWNER,
        SEMANTIC_INDEX_QUEUE_STATUS_STATE_KEY,
    )?
    .unwrap_or_else(|| default_semantic_index_queue_status(enabled)))
}

/// 保存当前队列状态。
fn save_semantic_index_queue_status_in_root(
    vault_root: &Path,
    queue_status: &SemanticIndexQueueStatus,
) -> Result<(), String> {
    extension_private_store::save_extension_private_state(
        vault_root,
        SEMANTIC_INDEX_OWNER,
        SEMANTIC_INDEX_QUEUE_STATUS_STATE_KEY,
        queue_status,
    )
}

/// 保存模型安装注册表。
fn save_semantic_index_model_install_registry(
    vault_root: &Path,
    registry: &SemanticIndexModelInstallRegistry,
) -> Result<(), String> {
    extension_private_store::save_extension_private_state(
        vault_root,
        SEMANTIC_INDEX_OWNER,
        SEMANTIC_INDEX_MODEL_INSTALLS_STATE_KEY,
        registry,
    )
}

/// 更新模型安装记录。
fn upsert_model_install_record(
    registry: &mut SemanticIndexModelInstallRegistry,
    next_record: SemanticIndexInstalledModelRecord,
) {
    if let Some(existing) = registry
        .models
        .iter_mut()
        .find(|record| record.model_id == next_record.model_id)
    {
        *existing = next_record;
        return;
    }

    registry.models.push(next_record);
    registry
        .models
        .sort_by(|left, right| left.model_id.cmp(&right.model_id));
}

/// 解析模型当前安装状态。
fn resolve_model_install_status(
    vault_root: &Path,
    model_id: &str,
    install_record: Option<&SemanticIndexInstalledModelRecord>,
) -> Result<SemanticIndexModelInstallStatus, String> {
    if is_model_cache_materialized(vault_root, model_id)? {
        return Ok(SemanticIndexModelInstallStatus::Installed);
    }

    if install_record
        .and_then(|record| record.installed_at_ms)
        .is_some()
    {
        return Ok(SemanticIndexModelInstallStatus::Installed);
    }

    if install_record
        .and_then(|record| record.last_error.as_ref())
        .is_some()
    {
        return Ok(SemanticIndexModelInstallStatus::Failed);
    }

    Ok(SemanticIndexModelInstallStatus::NotInstalled)
}

/// 判断指定模型是否已经满足全量同步启动条件。
fn is_model_ready_for_sync(vault_root: &Path, model_id: &str) -> Result<bool, String> {
    if is_model_cache_materialized(vault_root, model_id)? {
        return Ok(true);
    }

    let install_registry = load_semantic_index_model_install_registry(vault_root)?;
    Ok(install_registry.models.iter().any(|record| {
        record.model_id == model_id && record.installed_at_ms.is_some()
    }))
}

/// 判断指定模型缓存目录是否已存在有效文件。
fn is_model_cache_materialized(vault_root: &Path, model_id: &str) -> Result<bool, String> {
    let cache_root = semantic_index_embedding_cache_dir(vault_root)?;
    let cache_dir = cache_root.join(model_id_to_cache_segment(model_id));
    if !cache_dir.exists() {
        return Ok(false);
    }

    let mut entries = fs::read_dir(&cache_dir).map_err(|error| {
        format!(
            "failed to read semantic-index model cache dir path={}: {error}",
            cache_dir.display()
        )
    })?;
    Ok(entries.next().is_some())
}

/// 将模型 ID 映射为缓存子目录名。
fn model_id_to_cache_segment(model_id: &str) -> String {
    model_id
        .chars()
        .map(|character| match character {
            'a'..='z' | 'A'..='Z' | '0'..='9' | '-' | '_' => character,
            _ => '-',
        })
        .collect()
}

/// 返回用户可见的模型展示名。
fn semantic_index_model_display_name(model_id: &str) -> String {
    match model_id {
        "intfloat/multilingual-e5-small" => "Multilingual E5 Small".to_string(),
        "BAAI/bge-small-zh-v1.5" => "BGE Small ZH v1.5".to_string(),
        _ => model_id.to_string(),
    }
}

/// 返回全量同步运行根目录集合。
fn full_sync_running_roots() -> &'static Mutex<HashSet<String>> {
    FULL_SYNC_RUNNING_ROOTS.get_or_init(|| Mutex::new(HashSet::new()))
}

/// 生成用于运行态去重的 Vault 唯一键。
fn vault_root_key(vault_root: &Path) -> String {
    vault_root.to_string_lossy().to_string()
}

/// 执行一次实际的全量语义索引同步。
fn run_semantic_index_full_sync_in_root(vault_root: &Path) -> Result<(), String> {
    let settings = load_semantic_index_settings_in_root(vault_root)?;
    if !settings.enabled {
        return Err("semantic index full sync aborted because settings are disabled".to_string());
    }

    validate_runtime_selection(&settings)?;
    query_facade::ensure_query_index_ready_for_semantic_index(vault_root)?;
    let entries = query_facade::list_indexed_markdown_files_for_semantic_index(vault_root)?;
    let total_file_count = entries.len();
    let started_at_ms = now_unix_ms();
    let mut queue_status = SemanticIndexQueueStatus {
        worker_status: "running".to_string(),
        pending_file_count: total_file_count,
        has_pending_rebuild: true,
        last_enqueued_at_ms: Some(started_at_ms),
        last_processed_at_ms: None,
        total_file_count,
        processed_file_count: 0,
        failed_file_count: 0,
        current_file_path: None,
        last_error: None,
    };
    save_semantic_index_queue_status_in_root(vault_root, &queue_status)?;

    log::info!(
        "[semantic-index] full sync started: vault_root={} total_files={}",
        vault_root.display(),
        total_file_count
    );

    for entry in entries {
        queue_status.current_file_path = Some(entry.relative_path.clone());
        save_semantic_index_queue_status_in_root(vault_root, &queue_status)?;

        let step_result = query_facade::load_markdown_file_for_semantic_index(
            entry.relative_path.clone(),
            vault_root,
        )
        .and_then(|response| {
            upsert_indexed_markdown_document_in_root(
                entry.relative_path.clone(),
                response.content,
                vault_root,
            )
            .map(|_| ())
        });

        match step_result {
            Ok(()) => {
                queue_status.processed_file_count += 1;
            }
            Err(error) => {
                queue_status.failed_file_count += 1;
                queue_status.last_error = Some(format!(
                    "failed to index {}: {}",
                    entry.relative_path, error
                ));
                log::warn!(
                    "[semantic-index] full sync file failed: vault_root={} relative_path={} error={}",
                    vault_root.display(),
                    entry.relative_path,
                    error
                );
            }
        }

        queue_status.pending_file_count = total_file_count
            .saturating_sub(queue_status.processed_file_count + queue_status.failed_file_count);
        save_semantic_index_queue_status_in_root(vault_root, &queue_status)?;
    }

    queue_status.worker_status = "idle".to_string();
    queue_status.pending_file_count = 0;
    queue_status.has_pending_rebuild = false;
    queue_status.current_file_path = None;
    queue_status.last_processed_at_ms = Some(now_unix_ms());
    save_semantic_index_queue_status_in_root(vault_root, &queue_status)?;

    log::info!(
        "[semantic-index] full sync completed: vault_root={} processed={} failed={}",
        vault_root.display(),
        queue_status.processed_file_count,
        queue_status.failed_file_count
    );

    Ok(())
}

/// 在全量同步出现致命错误时写回失败状态。
fn mark_semantic_index_full_sync_failed(
    vault_root: &Path,
    error: String,
) -> Result<(), String> {
    let settings = load_semantic_index_settings_in_root(vault_root).unwrap_or_default();
    let mut queue_status = load_semantic_index_queue_status_in_root(vault_root, settings.enabled)?;
    queue_status.worker_status = "error".to_string();
    queue_status.pending_file_count = 0;
    queue_status.has_pending_rebuild = false;
    queue_status.current_file_path = None;
    queue_status.last_processed_at_ms = Some(now_unix_ms());
    queue_status.last_error = Some(error.clone());
    save_semantic_index_queue_status_in_root(vault_root, &queue_status)?;

    log::error!(
        "[semantic-index] full sync failed: vault_root={} error={}",
        vault_root.display(),
        error
    );

    Ok(())
}

/// 返回默认后台队列摘要。
fn default_semantic_index_queue_status(enabled: bool) -> SemanticIndexQueueStatus {
    SemanticIndexQueueStatus {
        worker_status: if enabled { "idle" } else { "paused" }.to_string(),
        pending_file_count: 0,
        has_pending_rebuild: false,
        last_enqueued_at_ms: None,
        last_processed_at_ms: None,
        total_file_count: 0,
        processed_file_count: 0,
        failed_file_count: 0,
        current_file_path: None,
        last_error: None,
    }
}

/// 返回当前 Unix 毫秒时间戳。
fn now_unix_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

/// 使用稳定 FNV-1a 计算文本哈希。
fn compute_stable_hash_hex(content: &str) -> String {
    let mut hash = 0xcbf29ce484222325u64;
    for byte in content.bytes() {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{hash:016x}")
}

#[cfg(test)]
mod tests {
    use super::{
        get_semantic_index_backend_catalog, get_semantic_index_status_in_root,
        get_semantic_index_model_catalog_in_root,
        install_semantic_index_model_in_root,
        load_indexed_markdown_document_in_root, load_semantic_index_settings_in_root,
        load_semantic_index_snapshot_in_root, save_semantic_index_settings_in_root,
        search_markdown_chunks_in_root, upsert_indexed_markdown_document_in_root,
        delete_indexed_markdown_document_in_root,
        start_semantic_index_full_sync_in_root,
    };
    use crate::shared::semantic_index_contracts::{
        ChunkingStrategyKind, EmbeddingProviderKind, SemanticIndexModelInstallStatus,
        SemanticIndexSettings, SemanticSearchRequest, VectorStoreKind,
    };
    use std::fs;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::thread;
    use std::time::Duration;
    use std::time::{SystemTime, UNIX_EPOCH};

    static TEST_ROOT_SEQ: AtomicU64 = AtomicU64::new(1);

    fn create_test_root() -> PathBuf {
        let sequence = TEST_ROOT_SEQ.fetch_add(1, Ordering::Relaxed);
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0);
        let root = std::env::temp_dir().join(format!(
            "ofive-semantic-index-{}-{}",
            nanos, sequence
        ));
        fs::create_dir_all(&root).expect("test root should be created");
        root
    }

    #[test]
    fn load_settings_should_default_to_disabled_multilingual_model() {
        let root = create_test_root();
        let settings = load_semantic_index_settings_in_root(&root)
            .expect("default settings should load without persistence record");

        assert!(!settings.enabled);
        assert_eq!(settings.embedding_provider, EmbeddingProviderKind::FastEmbed);
        assert_eq!(settings.vector_store, VectorStoreKind::SqliteVec);
        assert_eq!(settings.chunking_strategy, ChunkingStrategyKind::HeadingParagraph);
        assert_eq!(settings.model_id, "intfloat/multilingual-e5-small");
        assert_eq!(settings.chunk_strategy_version, 1);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn save_settings_should_round_trip_supported_backend_selection() {
        let root = create_test_root();
        let saved = save_semantic_index_settings_in_root(
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
        .expect("settings save should succeed");

        let loaded = load_semantic_index_settings_in_root(&root)
            .expect("saved settings should load");

        assert_eq!(saved, loaded);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn model_catalog_should_report_default_models_as_not_installed_before_install() {
        let root = create_test_root();
        let catalog = get_semantic_index_model_catalog_in_root(&root)
            .expect("model catalog should load");

        assert_eq!(catalog.models.len(), 2);
        assert!(catalog.models.iter().any(|item| !item.is_selected));
        assert!(catalog
            .models
            .iter()
            .all(|item| item.install_status == SemanticIndexModelInstallStatus::NotInstalled));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn install_model_should_mark_it_as_installed_in_catalog() {
        let root = create_test_root();
        let installed = install_semantic_index_model_in_root(
            "intfloat/multilingual-e5-small".to_string(),
            &root,
        )
        .expect("model install should succeed in test mode");
        assert_eq!(installed.install_status, SemanticIndexModelInstallStatus::Installed);
        assert_eq!(installed.dimensions, Some(16));

        let catalog = get_semantic_index_model_catalog_in_root(&root)
            .expect("model catalog should load after install");
        let selected = catalog
            .models
            .iter()
            .find(|item| item.model_id == "intfloat/multilingual-e5-small")
            .expect("installed model should remain in catalog");
        assert_eq!(selected.install_status, SemanticIndexModelInstallStatus::Installed);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn indexed_document_crud_should_work_with_simple_texts() {
        let root = create_test_root();
        save_semantic_index_settings_in_root(
            SemanticIndexSettings {
                enabled: true,
                embedding_provider: EmbeddingProviderKind::FastEmbed,
                vector_store: VectorStoreKind::SqliteVec,
                chunking_strategy: ChunkingStrategyKind::HeadingParagraph,
                model_id: "intfloat/multilingual-e5-small".to_string(),
                chunk_strategy_version: 1,
            },
            &root,
        )
        .expect("settings save should enable semantic index for CRUD test");

        let created_alpha = upsert_indexed_markdown_document_in_root(
            "Notes/alpha.md".to_string(),
            "# Intro\n\nalpha paragraph\n\n## Detail\nsecond detail".to_string(),
            &root,
        )
        .expect("alpha document should be indexed");
        let created_beta = upsert_indexed_markdown_document_in_root(
            "Notes/beta.md".to_string(),
            "plain beta line\n\nnext beta line".to_string(),
            &root,
        )
        .expect("beta document should be indexed");

        assert_eq!(created_alpha.chunks.len(), 2);
        assert_eq!(created_beta.chunks.len(), 2);

        let loaded_alpha = load_indexed_markdown_document_in_root("Notes/alpha.md", &root)
            .expect("alpha load should succeed")
            .expect("alpha record should exist");
        assert_eq!(loaded_alpha.relative_path, "Notes/alpha.md");
        assert_eq!(loaded_alpha.chunks[0].text, "alpha paragraph");
        assert_eq!(loaded_alpha.chunks[1].text, "second detail");

        let updated_alpha = upsert_indexed_markdown_document_in_root(
            "Notes/alpha.md".to_string(),
            "# Intro\n\nalpha paragraph updated".to_string(),
            &root,
        )
        .expect("alpha document update should succeed");
        assert_eq!(updated_alpha.chunks.len(), 1);
        assert_eq!(updated_alpha.chunks[0].text, "alpha paragraph updated");

        let snapshot = load_semantic_index_snapshot_in_root(&root)
            .expect("snapshot load should succeed after create/update");
        assert_eq!(snapshot.documents.len(), 2);

        let deleted_beta = delete_indexed_markdown_document_in_root("Notes/beta.md", &root)
            .expect("beta delete should succeed");
        assert!(deleted_beta);
        let loaded_beta = load_indexed_markdown_document_in_root("Notes/beta.md", &root)
            .expect("beta load should succeed after delete");
        assert!(loaded_beta.is_none());

        let status = get_semantic_index_status_in_root(&root)
            .expect("status should succeed after CRUD operations");
        assert_eq!(status.status, "ready");

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn save_settings_should_fallback_unknown_model_to_provider_default() {
        let root = create_test_root();
        let saved = save_semantic_index_settings_in_root(
            SemanticIndexSettings {
                enabled: true,
                embedding_provider: EmbeddingProviderKind::FastEmbed,
                vector_store: VectorStoreKind::SqliteVec,
                chunking_strategy: ChunkingStrategyKind::HeadingParagraph,
                model_id: "unknown/model".to_string(),
                chunk_strategy_version: 1,
            },
            &root,
        )
        .expect("settings save should succeed with sanitization");

        assert_eq!(saved.model_id, "intfloat/multilingual-e5-small");

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn backend_catalog_should_expose_builtin_choices() {
        let catalog = get_semantic_index_backend_catalog();

        assert_eq!(catalog.embedding_providers.len(), 1);
        assert_eq!(catalog.vector_stores.len(), 1);
        assert_eq!(catalog.chunking_strategies.len(), 2);
    }

    #[test]
    fn status_should_report_disabled_when_settings_are_off() {
        let root = create_test_root();
        let status = get_semantic_index_status_in_root(&root)
            .expect("status should load under default settings");

        assert_eq!(status.status, "disabled");
        assert_eq!(status.embedding_provider, EmbeddingProviderKind::FastEmbed);
        assert_eq!(status.vector_store, VectorStoreKind::SqliteVec);
        assert_eq!(status.chunking_strategy, ChunkingStrategyKind::HeadingParagraph);
        assert_eq!(status.model_id, "intfloat/multilingual-e5-small");
        assert_eq!(status.schema_version, 1);
        assert_eq!(status.last_error, None);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn search_should_return_disabled_state_with_empty_results_by_default() {
        let root = create_test_root();
        let response = search_markdown_chunks_in_root(
            SemanticSearchRequest {
                query: "semantic retrieval".to_string(),
                limit: Some(5),
                relative_path_prefix: None,
                exclude_paths: Vec::new(),
                score_threshold: None,
            },
            &root,
        )
        .expect("default semantic search should succeed with structured cold state");

        assert_eq!(response.status, "disabled");
        assert_eq!(response.model_id, "intfloat/multilingual-e5-small");
        assert!(response.results.is_empty());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn search_should_reject_empty_query() {
        let root = create_test_root();
        let error = search_markdown_chunks_in_root(
            SemanticSearchRequest {
                query: "   ".to_string(),
                limit: None,
                relative_path_prefix: None,
                exclude_paths: Vec::new(),
                score_threshold: None,
            },
            &root,
        )
        .expect_err("empty query should be rejected");

        assert!(error.contains("must not be empty"));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn full_sync_should_index_all_markdown_files_and_report_progress() {
        let root = create_test_root();
        fs::create_dir_all(root.join("notes")).expect("notes directory should be created");
        fs::write(root.join("notes/alpha.md"), "# Alpha\n\nhello world")
            .expect("alpha note should be written");
        fs::write(root.join("notes/beta.md"), "# Beta\n\nsecond note")
            .expect("beta note should be written");

        save_semantic_index_settings_in_root(
            SemanticIndexSettings {
                enabled: true,
                embedding_provider: EmbeddingProviderKind::FastEmbed,
                vector_store: VectorStoreKind::SqliteVec,
                chunking_strategy: ChunkingStrategyKind::HeadingParagraph,
                model_id: "intfloat/multilingual-e5-small".to_string(),
                chunk_strategy_version: 1,
            },
            &root,
        )
        .expect("settings save should succeed");
        install_semantic_index_model_in_root(
            "intfloat/multilingual-e5-small".to_string(),
            &root,
        )
        .expect("model install should succeed in test mode");

        let initial_queue_status = start_semantic_index_full_sync_in_root(&root)
            .expect("full sync should start");
        assert_eq!(initial_queue_status.worker_status, "running");

        let final_status = (0..200)
            .find_map(|_| {
                let status = get_semantic_index_status_in_root(&root)
                    .expect("status should load while full sync is running");
                if status.queue_status.worker_status == "running" {
                    thread::sleep(Duration::from_millis(20));
                    return None;
                }

                Some(status)
            })
            .expect("full sync should finish within timeout");

        assert_eq!(final_status.status, "ready");
        assert_eq!(final_status.queue_status.total_file_count, 2);
        assert_eq!(final_status.queue_status.processed_file_count, 2);
        assert_eq!(final_status.queue_status.failed_file_count, 0);
        assert_eq!(final_status.queue_status.pending_file_count, 0);

        let snapshot = load_semantic_index_snapshot_in_root(&root)
            .expect("snapshot should load after full sync");
        assert_eq!(snapshot.documents.len(), 2);

        let _ = fs::remove_dir_all(root);
    }
}