//! # Vector Store 抽象
//!
//! 定义语义索引模块对向量数据库后端的最小抽象边界。

use std::fs;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use rusqlite::ffi::sqlite3_auto_extension;
use rusqlite::types::Value;
use rusqlite::{params, params_from_iter, Connection, OptionalExtension};
use sqlite_vec::sqlite3_vec_init;

use crate::infra::persistence::extension_private_store;
use crate::shared::semantic_index_contracts::{VectorStoreDescriptor, VectorStoreKind};
use crate::shared::semantic_index_contracts::{
    SemanticIndexedChunkRecord, SemanticIndexedDocumentRecord, SemanticIndexSnapshot,
    SemanticSearchRequest, SemanticSearchResultItem,
};

const SQLITE_VEC_STORE_FILE_NAME: &str = "semantic-index.sqlite";
static SQLITE_VEC_REGISTRATION: OnceLock<Result<(), String>> = OnceLock::new();

/// 文档写入载荷，包含文档记录与对应 chunk embedding。
#[derive(Debug, Clone)]
pub(crate) struct SemanticIndexDocumentWrite {
    /// 文档结构化记录。
    pub document: SemanticIndexedDocumentRecord,
    /// 当前写入使用的 embedding 维度。
    pub embedding_dimensions: usize,
    /// 与 chunk 顺序一一对应的 embedding。
    pub chunk_embeddings: Vec<Vec<f32>>,
}

/// Vector store 后端抽象。
pub(crate) trait VectorStoreBackend: Send + Sync {
    /// 返回 store 描述。
    fn descriptor(&self) -> VectorStoreDescriptor;

    /// 校验当前后端是否支持指定 schema 版本。
    fn validate_schema_version(&self, schema_version: u32) -> Result<(), String>;

    /// 返回指定 Vault 下的底层数据库文件路径。
    fn store_file_path(&self, vault_root: &Path, owner: &str) -> Result<PathBuf, String>;

    /// 读取当前索引快照。
    fn load_snapshot(
        &self,
        vault_root: &Path,
        owner: &str,
        schema_version: u32,
    ) -> Result<SemanticIndexSnapshot, String>;

    /// 写入单个文档及其 chunk embedding。
    fn upsert_document(
        &self,
        vault_root: &Path,
        owner: &str,
        schema_version: u32,
        payload: &SemanticIndexDocumentWrite,
    ) -> Result<(), String>;

    /// 读取单个文档记录。
    fn load_document(
        &self,
        vault_root: &Path,
        owner: &str,
        schema_version: u32,
        relative_path: &str,
    ) -> Result<Option<SemanticIndexedDocumentRecord>, String>;

    /// 删除单个文档记录。
    fn delete_document(
        &self,
        vault_root: &Path,
        owner: &str,
        schema_version: u32,
        relative_path: &str,
    ) -> Result<bool, String>;

    /// 执行一次向量检索。
    fn search(
        &self,
        vault_root: &Path,
        owner: &str,
        schema_version: u32,
        query_embedding: &[f32],
        request: &SemanticSearchRequest,
    ) -> Result<Vec<SemanticSearchResultItem>, String>;
}

/// 返回当前宿主支持的 vector store 列表。
pub(crate) fn available_vector_stores() -> Vec<VectorStoreDescriptor> {
    vec![SqliteVecStoreBackend.descriptor()]
}

/// 根据设置构建 vector store 后端。
pub(crate) fn build_vector_store(
    kind: VectorStoreKind,
) -> Result<Box<dyn VectorStoreBackend>, String> {
    match kind {
        VectorStoreKind::SqliteVec => Ok(Box::new(SqliteVecStoreBackend)),
    }
}

/// 确保 sqlite-vec 运行时可用，并返回版本信息。
pub(crate) fn ensure_sqlite_vec_runtime() -> Result<String, String> {
    ensure_sqlite_vec_registered()?;
    let connection = Connection::open_in_memory()
        .map_err(|error| format!("failed to open in-memory sqlite connection: {error}"))?;
    connection
        .query_row("select vec_version()", [], |row| row.get::<_, String>(0))
        .map_err(|error| format!("failed to query sqlite-vec runtime version: {error}"))
}

/// 返回语义索引模块在指定 Vault 下的 sqlite 数据库文件路径。
pub(crate) fn semantic_index_vector_store_path(
    vault_root: &Path,
    owner: &str,
) -> Result<PathBuf, String> {
    let owner_dir = extension_private_store::extension_private_owner_dir(vault_root, owner)?;
    Ok(owner_dir.join(SQLITE_VEC_STORE_FILE_NAME))
}

/// 基于 sqlite-vec 的 store 实现。
struct SqliteVecStoreBackend;

impl VectorStoreBackend for SqliteVecStoreBackend {
    fn descriptor(&self) -> VectorStoreDescriptor {
        VectorStoreDescriptor {
            kind: VectorStoreKind::SqliteVec,
            display_name: "sqlite-vec".to_string(),
            description: "Local SQLite vector store powered by sqlite-vec.".to_string(),
        }
    }

    fn validate_schema_version(&self, schema_version: u32) -> Result<(), String> {
        if schema_version == 0 {
            return Err("semantic index schema version must not be zero".to_string());
        }

        Ok(())
    }

    fn store_file_path(&self, vault_root: &Path, owner: &str) -> Result<PathBuf, String> {
        semantic_index_vector_store_path(vault_root, owner)
    }

    fn load_snapshot(
        &self,
        vault_root: &Path,
        owner: &str,
        schema_version: u32,
    ) -> Result<SemanticIndexSnapshot, String> {
        self.validate_schema_version(schema_version)?;
        let db_path = self.store_file_path(vault_root, owner)?;
        if !db_path.exists() {
            return Ok(SemanticIndexSnapshot {
                schema_version,
                documents: Vec::new(),
            });
        }

        let connection = open_sqlite_vec_connection(&db_path, schema_version)?;
        let document_paths = load_document_paths(&connection)?;
        let mut documents = Vec::with_capacity(document_paths.len());
        for relative_path in document_paths {
            if let Some(document) = load_document_record(&connection, &relative_path)? {
                documents.push(document);
            }
        }

        Ok(SemanticIndexSnapshot {
            schema_version,
            documents,
        })
    }

    fn upsert_document(
        &self,
        vault_root: &Path,
        owner: &str,
        schema_version: u32,
        payload: &SemanticIndexDocumentWrite,
    ) -> Result<(), String> {
        self.validate_schema_version(schema_version)?;
        if payload.document.chunks.len() != payload.chunk_embeddings.len() {
            return Err(format!(
                "chunk embeddings length mismatch: chunks={} embeddings={}",
                payload.document.chunks.len(),
                payload.chunk_embeddings.len()
            ));
        }
        if payload.embedding_dimensions == 0 {
            return Err("semantic-index embedding dimensions must not be zero".to_string());
        }

        let db_path = self.store_file_path(vault_root, owner)?;
        let connection = open_sqlite_vec_connection(&db_path, schema_version)?;
        persist_embedding_dimensions(&connection, payload.embedding_dimensions)?;
        let transaction = connection
            .unchecked_transaction()
            .map_err(|error| format!("failed to start sqlite-vec transaction: {error}"))?;

        transaction
            .execute(
                "insert into semantic_index_documents(
                    relative_path,
                    content_hash,
                    chunking_strategy,
                    chunk_strategy_version,
                    indexed_at_ms
                ) values (?1, ?2, ?3, ?4, ?5)
                on conflict(relative_path) do update set
                    content_hash=excluded.content_hash,
                    chunking_strategy=excluded.chunking_strategy,
                    chunk_strategy_version=excluded.chunk_strategy_version,
                    indexed_at_ms=excluded.indexed_at_ms",
                params![
                    payload.document.relative_path,
                    payload.document.content_hash,
                    chunking_strategy_name(payload.document.chunking_strategy),
                    i64::from(payload.document.chunk_strategy_version),
                    payload.document.indexed_at_ms,
                ],
            )
            .map_err(|error| format!("failed to upsert semantic-index document row: {error}"))?;

        transaction
            .execute(
                "delete from semantic_index_chunks where relative_path = ?1",
                params![payload.document.relative_path],
            )
            .map_err(|error| format!("failed to clear semantic-index chunk rows: {error}"))?;

        for (chunk, embedding) in payload
            .document
            .chunks
            .iter()
            .zip(payload.chunk_embeddings.iter())
        {
            validate_embedding_dimensions(&connection, embedding)?;
            transaction
                .execute(
                    "insert into semantic_index_chunks(
                        chunk_id,
                        relative_path,
                        heading_path,
                        start_line,
                        end_line,
                        chunk_text,
                        embedding
                    ) values (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                    params![
                        chunk.chunk_id,
                        payload.document.relative_path,
                        chunk.heading_path,
                        chunk.start_line as i64,
                        chunk.end_line as i64,
                        chunk.text,
                        f32s_to_blob(embedding),
                    ],
                )
                .map_err(|error| format!("failed to insert semantic-index chunk row: {error}"))?;
        }

        transaction
            .commit()
            .map_err(|error| format!("failed to commit semantic-index sqlite transaction: {error}"))
    }

    fn load_document(
        &self,
        vault_root: &Path,
        owner: &str,
        schema_version: u32,
        relative_path: &str,
    ) -> Result<Option<SemanticIndexedDocumentRecord>, String> {
        self.validate_schema_version(schema_version)?;
        let db_path = self.store_file_path(vault_root, owner)?;
        if !db_path.exists() {
            return Ok(None);
        }

        let connection = open_sqlite_vec_connection(&db_path, schema_version)?;
        load_document_record(&connection, relative_path)
    }

    fn delete_document(
        &self,
        vault_root: &Path,
        owner: &str,
        schema_version: u32,
        relative_path: &str,
    ) -> Result<bool, String> {
        self.validate_schema_version(schema_version)?;
        let db_path = self.store_file_path(vault_root, owner)?;
        if !db_path.exists() {
            return Ok(false);
        }

        let connection = open_sqlite_vec_connection(&db_path, schema_version)?;
        let deleted = connection
            .execute(
                "delete from semantic_index_documents where relative_path = ?1",
                params![relative_path],
            )
            .map_err(|error| format!("failed to delete semantic-index document row: {error}"))?
            > 0;

        Ok(deleted)
    }

    fn search(
        &self,
        vault_root: &Path,
        owner: &str,
        schema_version: u32,
        query_embedding: &[f32],
        request: &SemanticSearchRequest,
    ) -> Result<Vec<SemanticSearchResultItem>, String> {
        self.validate_schema_version(schema_version)?;

        let db_path = self.store_file_path(vault_root, owner)?;
        if !db_path.exists() {
            return Ok(Vec::new());
        }

        let connection = open_sqlite_vec_connection(&db_path, schema_version)?;
        validate_embedding_dimensions(&connection, query_embedding)?;
        let limit = request.limit.unwrap_or(10).max(1) as i64;
        let mut query = String::from(
            "select * from (\n                select\n                    d.relative_path,\n                    c.heading_path,\n                    c.start_line,\n                    c.end_line,\n                    c.chunk_text,\n                    d.indexed_at_ms,\n                    vec_distance_cosine(c.embedding, ?1) as distance\n                from semantic_index_chunks c\n                join semantic_index_documents d\n                  on d.relative_path = c.relative_path\n                where 1 = 1",
        );

        let mut parameters = vec![Value::Blob(f32s_to_blob(query_embedding))];

        if let Some(prefix) = request
            .relative_path_prefix
            .as_ref()
            .map(|item| item.trim())
            .filter(|item| !item.is_empty())
        {
            query.push_str(" and d.relative_path like ?");
            parameters.push(Value::Text(format!("{}%", prefix.replace('\\', "/"))));
        }

        for excluded_path in request.exclude_paths.iter().map(|item| item.trim()) {
            if excluded_path.is_empty() {
                continue;
            }
            query.push_str(" and d.relative_path != ?");
            parameters.push(Value::Text(excluded_path.replace('\\', "/")));
        }

        query.push_str("\n            ) where 1 = 1");
        if let Some(score_threshold) = request.score_threshold {
            query.push_str(" and distance <= ?");
            parameters.push(Value::Real(f64::from(score_threshold)));
        }
        query.push_str(" order by distance asc limit ?");
        parameters.push(Value::Integer(limit));

        let mut statement = connection
            .prepare(&query)
            .map_err(|error| format!("failed to prepare semantic-index search query: {error}"))?;
        let rows = statement
            .query_map(params_from_iter(parameters), |row| {
                Ok(SemanticSearchResultItem {
                    relative_path: row.get(0)?,
                    heading_path: row.get(1)?,
                    start_line: row.get::<_, i64>(2)? as usize,
                    end_line: row.get::<_, i64>(3)? as usize,
                    chunk_text: row.get(4)?,
                    indexed_at_ms: row.get(5)?,
                    distance: row.get::<_, f64>(6)? as f32,
                })
            })
            .map_err(|error| format!("failed to execute semantic-index search query: {error}"))?;

        let mut items = Vec::new();
        for row in rows {
            items.push(row.map_err(|error| {
                format!("failed to decode semantic-index search result row: {error}")
            })?);
        }

        Ok(items)
    }
}

/// 注册 sqlite-vec 自动扩展。
fn ensure_sqlite_vec_registered() -> Result<(), String> {
    SQLITE_VEC_REGISTRATION
        .get_or_init(|| unsafe {
            sqlite3_auto_extension(Some(std::mem::transmute(sqlite3_vec_init as *const ())));
            Ok(())
        })
        .clone()
}

/// 打开 sqlite-vec 连接并确保 schema 可用。
fn open_sqlite_vec_connection(db_path: &Path, schema_version: u32) -> Result<Connection, String> {
    ensure_sqlite_vec_registered()?;
    if let Some(parent) = db_path.parent() {
        fs::create_dir_all(parent).map_err(|error| {
            format!(
                "failed to create semantic-index sqlite parent directory path={}: {error}",
                parent.display()
            )
        })?;
    }

    let connection = Connection::open(db_path).map_err(|error| {
        format!(
            "failed to open semantic-index sqlite database path={}: {error}",
            db_path.display()
        )
    })?;
    connection
        .execute_batch(
            "pragma foreign_keys = on;
             create table if not exists semantic_index_meta(
                key text primary key,
                value text not null
             ) strict;
             create table if not exists semantic_index_documents(
                relative_path text primary key,
                content_hash text not null,
                chunking_strategy text not null,
                chunk_strategy_version integer not null,
                indexed_at_ms integer not null
             ) strict;
             create table if not exists semantic_index_chunks(
                chunk_id text primary key,
                relative_path text not null,
                heading_path text,
                start_line integer not null,
                end_line integer not null,
                chunk_text text not null,
                     embedding blob not null check(vec_length(embedding) > 0),
                foreign key(relative_path) references semantic_index_documents(relative_path) on delete cascade
             ) strict;
             create index if not exists idx_semantic_index_chunks_relative_path
                on semantic_index_chunks(relative_path);",
        )
        .map_err(|error| format!("failed to initialize semantic-index sqlite schema: {error}"))?;

    let vec_version = connection
        .query_row("select vec_version()", [], |row| row.get::<_, String>(0))
        .map_err(|error| format!("failed to verify sqlite-vec runtime availability: {error}"))?;
    log::debug!(
        "[semantic-index] sqlite-vec runtime ready: version={} path={}",
        vec_version,
        db_path.display()
    );

    let persisted_schema_version = connection
        .query_row(
            "select value from semantic_index_meta where key = 'schema_version'",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| format!("failed to read semantic-index schema version: {error}"))?;

    match persisted_schema_version {
        Some(value) => {
            let parsed = value.parse::<u32>().map_err(|error| {
                format!("failed to parse semantic-index schema version value={value}: {error}")
            })?;
            if parsed != schema_version {
                return Err(format!(
                    "semantic-index sqlite schema mismatch: expected={} actual={parsed}",
                    schema_version
                ));
            }
        }
        None => {
            connection
                .execute(
                    "insert into semantic_index_meta(key, value) values('schema_version', ?1)",
                    params![schema_version.to_string()],
                )
                .map_err(|error| {
                    format!("failed to persist semantic-index schema version metadata: {error}")
                })?;
        }
    }

    Ok(connection)
}

/// 读取全部文档路径。
fn load_document_paths(connection: &Connection) -> Result<Vec<String>, String> {
    let mut statement = connection
        .prepare(
            "select relative_path
             from semantic_index_documents
             order by relative_path asc",
        )
        .map_err(|error| format!("failed to prepare semantic-index path query: {error}"))?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|error| format!("failed to execute semantic-index path query: {error}"))?;

    let mut relative_paths = Vec::new();
    for row in rows {
        relative_paths.push(
            row.map_err(|error| format!("failed to decode semantic-index path row: {error}"))?,
        );
    }

    Ok(relative_paths)
}

/// 读取单个文档记录及其 chunk。
fn load_document_record(
    connection: &Connection,
    relative_path: &str,
) -> Result<Option<SemanticIndexedDocumentRecord>, String> {
    let document_row = connection
        .query_row(
            "select content_hash, chunking_strategy, chunk_strategy_version, indexed_at_ms
             from semantic_index_documents
             where relative_path = ?1",
            params![relative_path],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, i64>(2)?,
                    row.get::<_, i64>(3)?,
                ))
            },
        )
        .optional()
        .map_err(|error| format!("failed to load semantic-index document row: {error}"))?;

    let Some((content_hash, chunking_strategy, chunk_strategy_version, indexed_at_ms)) =
        document_row
    else {
        return Ok(None);
    };

    let mut statement = connection
        .prepare(
            "select chunk_id, heading_path, start_line, end_line, chunk_text
             from semantic_index_chunks
             where relative_path = ?1
             order by start_line asc, end_line asc, chunk_id asc",
        )
        .map_err(|error| format!("failed to prepare semantic-index chunk query: {error}"))?;
    let rows = statement
        .query_map(params![relative_path], |row| {
            Ok(SemanticIndexedChunkRecord {
                chunk_id: row.get(0)?,
                heading_path: row.get(1)?,
                start_line: row.get::<_, i64>(2)? as usize,
                end_line: row.get::<_, i64>(3)? as usize,
                text: row.get(4)?,
            })
        })
        .map_err(|error| format!("failed to execute semantic-index chunk query: {error}"))?;

    let mut chunks = Vec::new();
    for row in rows {
        chunks.push(
            row.map_err(|error| format!("failed to decode semantic-index chunk row: {error}"))?,
        );
    }

    Ok(Some(SemanticIndexedDocumentRecord {
        relative_path: relative_path.to_string(),
        content_hash,
        chunking_strategy: parse_chunking_strategy_name(&chunking_strategy)?,
        chunk_strategy_version: chunk_strategy_version as u32,
        indexed_at_ms,
        chunks,
    }))
}

/// 将 chunking strategy 枚举转换为稳定字符串。
fn chunking_strategy_name(
    kind: crate::shared::semantic_index_contracts::ChunkingStrategyKind,
) -> &'static str {
    match kind {
        crate::shared::semantic_index_contracts::ChunkingStrategyKind::HeadingParagraph => {
            "heading-paragraph"
        }
        crate::shared::semantic_index_contracts::ChunkingStrategyKind::WholeDocument => {
            "whole-document"
        }
    }
}

/// 解析持久化的 chunking strategy 名称。
fn parse_chunking_strategy_name(
    value: &str,
) -> Result<crate::shared::semantic_index_contracts::ChunkingStrategyKind, String> {
    match value {
        "heading-paragraph" => Ok(
            crate::shared::semantic_index_contracts::ChunkingStrategyKind::HeadingParagraph,
        ),
        "whole-document" => Ok(
            crate::shared::semantic_index_contracts::ChunkingStrategyKind::WholeDocument,
        ),
        _ => Err(format!("unknown semantic-index chunking strategy persisted in sqlite: {value}")),
    }
}

/// 校验 embedding 维度与 sqlite schema 约束一致。
fn validate_embedding_dimensions(connection: &Connection, embedding: &[f32]) -> Result<(), String> {
    if embedding.is_empty() {
        return Err("semantic-index embedding must not be empty".to_string());
    }

    let Some(expected_dimensions) = load_persisted_embedding_dimensions(connection)? else {
        return Ok(());
    };

    if embedding.len() != expected_dimensions {
        return Err(format!(
            "semantic-index embedding dimension mismatch: expected={} actual={}",
            expected_dimensions,
            embedding.len()
        ));
    }

    Ok(())
}

/// 持久化当前索引使用的 embedding 维度。
fn persist_embedding_dimensions(connection: &Connection, dimensions: usize) -> Result<(), String> {
    let persisted = load_persisted_embedding_dimensions(connection)?;
    if let Some(persisted_dimensions) = persisted {
        if persisted_dimensions != dimensions {
            return Err(format!(
                "semantic-index stored embedding dimension mismatch: expected={} actual={}",
                persisted_dimensions,
                dimensions
            ));
        }

        return Ok(());
    }

    connection
        .execute(
            "insert into semantic_index_meta(key, value) values('embedding_dimensions', ?1)",
            params![dimensions.to_string()],
        )
        .map_err(|error| {
            format!("failed to persist semantic-index embedding dimension metadata: {error}")
        })?;
    Ok(())
}

/// 读取已持久化的 embedding 维度。
fn load_persisted_embedding_dimensions(connection: &Connection) -> Result<Option<usize>, String> {
    let value = connection
        .query_row(
            "select value from semantic_index_meta where key = 'embedding_dimensions'",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| format!("failed to read semantic-index embedding dimensions: {error}"))?;

    value
        .map(|value| {
            value.parse::<usize>().map_err(|error| {
                format!(
                    "failed to parse semantic-index embedding dimensions value={value}: {error}"
                )
            })
        })
        .transpose()
}

/// 将 `f32` 向量编码为 sqlite-vec 兼容的 little-endian BLOB。
fn f32s_to_blob(values: &[f32]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(values.len() * std::mem::size_of::<f32>());
    for value in values {
        bytes.extend_from_slice(&value.to_le_bytes());
    }
    bytes
}

#[cfg(test)]
mod tests {
    use super::{
        available_vector_stores, build_vector_store, ensure_sqlite_vec_runtime,
        semantic_index_vector_store_path, SemanticIndexDocumentWrite,
    };
    use crate::shared::semantic_index_contracts::{
        ChunkingStrategyKind, SemanticIndexedChunkRecord, SemanticIndexedDocumentRecord,
        SemanticSearchRequest, VectorStoreKind,
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
            "ofive-sqlite-vec-store-{}-{}",
            nanos, sequence
        ));
        fs::create_dir_all(&root).expect("test root should be created");
        root
    }

    #[test]
    fn available_vector_stores_should_expose_sqlite_vec() {
        let descriptors = available_vector_stores();

        assert_eq!(descriptors.len(), 1);
        assert_eq!(descriptors[0].kind, VectorStoreKind::SqliteVec);
    }

    #[test]
    fn sqlite_vec_store_should_validate_non_zero_schema_version() {
        let backend = build_vector_store(VectorStoreKind::SqliteVec)
            .expect("sqlite-vec backend should build");

        backend
            .validate_schema_version(1)
            .expect("positive schema version should be accepted");
        assert!(backend.validate_schema_version(0).is_err());
    }

    #[test]
    fn sqlite_vec_runtime_should_report_version() {
        let version = ensure_sqlite_vec_runtime().expect("sqlite-vec runtime should load");

        assert!(!version.trim().is_empty());
    }

    #[test]
    fn sqlite_vec_store_should_persist_and_search_document_chunks() {
        let root = create_test_root();
        let backend = build_vector_store(VectorStoreKind::SqliteVec)
            .expect("sqlite-vec backend should build");
        let payload = SemanticIndexDocumentWrite {
            document: SemanticIndexedDocumentRecord {
                relative_path: "notes/example.md".to_string(),
                content_hash: "abc123".to_string(),
                chunking_strategy: ChunkingStrategyKind::HeadingParagraph,
                chunk_strategy_version: 1,
                indexed_at_ms: 42,
                chunks: vec![SemanticIndexedChunkRecord {
                    chunk_id: "notes/example.md:0:abc".to_string(),
                    heading_path: Some("Intro".to_string()),
                    start_line: 2,
                    end_line: 2,
                    text: "alpha beta paragraph".to_string(),
                }],
            },
            embedding_dimensions: 16,
            chunk_embeddings: vec![vec![0.25; 16]],
        };

        backend
            .upsert_document(&root, "semantic-index", 1, &payload)
            .expect("sqlite-vec upsert should succeed");

        let store_path = semantic_index_vector_store_path(&root, "semantic-index")
            .expect("store path should resolve");
        assert!(store_path.exists());

        let loaded = backend
            .load_document(&root, "semantic-index", 1, "notes/example.md")
            .expect("sqlite-vec load should succeed")
            .expect("document should exist after upsert");
        assert_eq!(loaded.chunks.len(), 1);

        let results = backend
            .search(
                &root,
                "semantic-index",
                1,
                &[0.25; 16],
                &SemanticSearchRequest {
                    query: "alpha".to_string(),
                    limit: Some(5),
                    relative_path_prefix: Some("notes/".to_string()),
                    exclude_paths: Vec::new(),
                    score_threshold: Some(0.01),
                },
            )
            .expect("sqlite-vec search should succeed");
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].relative_path, "notes/example.md");

        let deleted = backend
            .delete_document(&root, "semantic-index", 1, "notes/example.md")
            .expect("sqlite-vec delete should succeed");
        assert!(deleted);

        let _ = fs::remove_dir_all(root);
    }
}