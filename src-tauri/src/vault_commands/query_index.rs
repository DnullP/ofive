//! # SQLite 查询索引模块
//!
//! 为高频读查询提供纯后端索引能力：
//! - 启动/查询前校验索引与实际仓库一致性，不一致时重建；
//! - 写操作后做对应表更新；
//! - 索引仅保存查询源数据，不保存笔记正文。

use crate::vault_commands::fs_helpers::{
    collect_markdown_relative_paths, relative_path_from_vault_root,
};
use crate::vault_commands::types::{
    VaultMarkdownGraphEdge, VaultMarkdownGraphNode, VaultMarkdownGraphResponse,
};
use crate::vault_commands::wikilink::{
    extract_markdown_inline_link_targets, extract_wikilink_targets,
    resolve_wikilink_target_path_in_vault_without_index,
};
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use std::collections::BTreeMap;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::time::Duration;

const INDEX_SCHEMA_VERSION: &str = "1";
const META_KEY_SCHEMA_VERSION: &str = "schema_version";
const META_KEY_MANIFEST_FINGERPRINT: &str = "manifest_fingerprint";
const INDEX_DB_RELATIVE_PATH: &str = ".ofive/query-index.sqlite";

#[derive(Clone)]
struct ManifestEntry {
    relative_path: String,
    title: String,
    stem_lower: String,
    parent_dir: String,
    mtime_ms: i64,
    size_bytes: i64,
}

/// 索引中的 Markdown 文件条目。
#[derive(Debug, Clone)]
pub struct IndexedMarkdownFile {
    pub relative_path: String,
    pub title: String,
}

fn index_db_path(vault_root: &Path) -> PathBuf {
    vault_root.join(INDEX_DB_RELATIVE_PATH)
}

fn open_index_connection(vault_root: &Path) -> Result<Connection, String> {
    let path = index_db_path(vault_root);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("创建索引目录失败 {}: {error}", parent.display()))?;
    }

    let connection = Connection::open(&path)
        .map_err(|error| format!("打开索引数据库失败 {}: {error}", path.display()))?;
    connection
        .busy_timeout(Duration::from_secs(5))
        .map_err(|error| format!("设置索引数据库超时失败 {}: {error}", path.display()))?;
    Ok(connection)
}

fn ensure_schema(connection: &Connection) -> Result<(), String> {
    connection
        .execute_batch(
            "
            PRAGMA journal_mode = WAL;
            PRAGMA synchronous = NORMAL;
            CREATE TABLE IF NOT EXISTS query_meta (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS markdown_files (
                relative_path TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                stem_lower TEXT NOT NULL,
                parent_dir TEXT NOT NULL,
                mtime_ms INTEGER NOT NULL,
                size_bytes INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS markdown_links (
                source_path TEXT NOT NULL,
                target_path TEXT NOT NULL,
                weight INTEGER NOT NULL,
                PRIMARY KEY(source_path, target_path)
            );
            CREATE INDEX IF NOT EXISTS idx_markdown_files_stem_lower
                ON markdown_files(stem_lower);
            CREATE INDEX IF NOT EXISTS idx_markdown_links_source
                ON markdown_links(source_path);
            CREATE INDEX IF NOT EXISTS idx_markdown_links_target
                ON markdown_links(target_path);
            ",
        )
        .map_err(|error| format!("初始化索引表结构失败: {error}"))
}

fn upsert_meta(connection: &Connection, key: &str, value: &str) -> Result<(), String> {
    connection
        .execute(
            "INSERT INTO query_meta(key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![key, value],
        )
        .map_err(|error| format!("写入索引元信息失败 key={key}: {error}"))?;
    Ok(())
}

fn get_meta(connection: &Connection, key: &str) -> Result<Option<String>, String> {
    connection
        .query_row(
            "SELECT value FROM query_meta WHERE key = ?1",
            params![key],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| format!("读取索引元信息失败 key={key}: {error}"))
}

fn scan_manifest(vault_root: &Path) -> Result<Vec<ManifestEntry>, String> {
    let mut markdown_paths = Vec::new();
    collect_markdown_relative_paths(vault_root, vault_root, &mut markdown_paths)?;
    markdown_paths.sort();

    let mut output = Vec::with_capacity(markdown_paths.len());
    for relative_path in markdown_paths {
        let absolute_path = vault_root.join(&relative_path);
        let metadata = fs::metadata(&absolute_path)
            .map_err(|error| format!("读取文件元信息失败 {}: {error}", absolute_path.display()))?;
        let modified = metadata.modified().map_err(|error| {
            format!("读取文件修改时间失败 {}: {error}", absolute_path.display())
        })?;
        let modified_ms = modified
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|error| format!("计算文件时间戳失败 {}: {error}", absolute_path.display()))?
            .as_millis() as i64;

        let title = Path::new(&relative_path)
            .file_stem()
            .and_then(|item| item.to_str())
            .unwrap_or(&relative_path)
            .to_string();
        let stem_lower = title.to_lowercase();
        let parent_dir = Path::new(&relative_path)
            .parent()
            .map(|item| item.to_string_lossy().replace('\\', "/"))
            .unwrap_or_default();

        output.push(ManifestEntry {
            relative_path,
            title,
            stem_lower,
            parent_dir,
            mtime_ms: modified_ms,
            size_bytes: metadata.len() as i64,
        });
    }

    Ok(output)
}

fn compute_manifest_fingerprint(entries: &[ManifestEntry]) -> String {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    INDEX_SCHEMA_VERSION.hash(&mut hasher);
    entries.len().hash(&mut hasher);
    for entry in entries {
        entry.relative_path.hash(&mut hasher);
        entry.mtime_ms.hash(&mut hasher);
        entry.size_bytes.hash(&mut hasher);
    }
    format!("{:016x}", hasher.finish())
}

fn parse_file_links(
    vault_root: &Path,
    source_relative_path: &str,
    content: &str,
) -> Result<BTreeMap<String, usize>, String> {
    let current_dir = Path::new(source_relative_path)
        .parent()
        .map(|item| item.to_string_lossy().replace('\\', "/"))
        .unwrap_or_default();

    let mut edge_weights = BTreeMap::<String, usize>::new();

    for target in extract_wikilink_targets(content) {
        let resolved =
            resolve_wikilink_target_path_in_vault_without_index(vault_root, &current_dir, &target)?;
        let Some(target_absolute_path) = resolved else {
            continue;
        };

        let target_relative_path =
            relative_path_from_vault_root(vault_root, &target_absolute_path)?;
        if target_relative_path == source_relative_path {
            continue;
        }

        *edge_weights.entry(target_relative_path).or_insert(0) += 1;
    }

    for target in extract_markdown_inline_link_targets(content) {
        let resolved =
            resolve_wikilink_target_path_in_vault_without_index(vault_root, &current_dir, &target)?;
        let Some(target_absolute_path) = resolved else {
            continue;
        };

        let target_relative_path =
            relative_path_from_vault_root(vault_root, &target_absolute_path)?;
        if target_relative_path == source_relative_path {
            continue;
        }

        *edge_weights.entry(target_relative_path).or_insert(0) += 1;
    }

    Ok(edge_weights)
}

fn clear_all_index_data(transaction: &Transaction<'_>) -> Result<(), String> {
    transaction
        .execute("DELETE FROM markdown_links", [])
        .map_err(|error| format!("清理索引边数据失败: {error}"))?;
    transaction
        .execute("DELETE FROM markdown_files", [])
        .map_err(|error| format!("清理索引节点数据失败: {error}"))?;
    Ok(())
}

fn rebuild_index_data(
    transaction: &Transaction<'_>,
    vault_root: &Path,
    manifest: &[ManifestEntry],
) -> Result<(), String> {
    let mut insert_file = transaction
        .prepare(
            "INSERT INTO markdown_files(relative_path, title, stem_lower, parent_dir, mtime_ms, size_bytes)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        )
        .map_err(|error| format!("构建文件索引语句失败: {error}"))?;

    let mut insert_link = transaction
        .prepare(
            "INSERT INTO markdown_links(source_path, target_path, weight)
             VALUES (?1, ?2, ?3)",
        )
        .map_err(|error| format!("构建边索引语句失败: {error}"))?;

    for entry in manifest {
        insert_file
            .execute(params![
                entry.relative_path,
                entry.title,
                entry.stem_lower,
                entry.parent_dir,
                entry.mtime_ms,
                entry.size_bytes
            ])
            .map_err(|error| format!("写入文件索引失败 path={}: {error}", entry.relative_path))?;

        let content =
            fs::read_to_string(vault_root.join(&entry.relative_path)).map_err(|error| {
                format!("读取索引构建文件内容失败 {}: {error}", entry.relative_path)
            })?;

        let edge_weights = parse_file_links(vault_root, &entry.relative_path, &content)?;
        for (target, weight) in edge_weights {
            insert_link
                .execute(params![entry.relative_path, target, weight as i64])
                .map_err(|error| {
                    format!("写入边索引失败 source={}: {error}", entry.relative_path)
                })?;
        }
    }

    Ok(())
}

fn refresh_manifest_meta(connection: &Connection, vault_root: &Path) -> Result<(), String> {
    let manifest = scan_manifest(vault_root)?;
    let fingerprint = compute_manifest_fingerprint(&manifest);
    upsert_meta(connection, META_KEY_MANIFEST_FINGERPRINT, &fingerprint)
}

/// 确保索引与当前仓库状态一致；若检测到离线变更则重建。
pub fn ensure_query_index_current(vault_root: &Path) -> Result<(), String> {
    println!("[query-index] ensure current start");

    let manifest = scan_manifest(vault_root)?;
    let runtime_fingerprint = compute_manifest_fingerprint(&manifest);

    let mut connection = open_index_connection(vault_root)?;
    ensure_schema(&connection)?;

    let stored_schema = get_meta(&connection, META_KEY_SCHEMA_VERSION)?;
    let stored_fingerprint = get_meta(&connection, META_KEY_MANIFEST_FINGERPRINT)?;

    let need_rebuild = stored_schema.as_deref() != Some(INDEX_SCHEMA_VERSION)
        || stored_fingerprint.as_deref() != Some(runtime_fingerprint.as_str());

    if !need_rebuild {
        println!("[query-index] ensure current success: unchanged");
        return Ok(());
    }

    println!(
        "[query-index] manifest changed, rebuilding index: files={}",
        manifest.len()
    );

    let transaction = connection
        .transaction()
        .map_err(|error| format!("开始索引重建事务失败: {error}"))?;

    clear_all_index_data(&transaction)?;
    rebuild_index_data(&transaction, vault_root, &manifest)?;
    transaction
        .execute(
            "INSERT INTO query_meta(key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![META_KEY_SCHEMA_VERSION, INDEX_SCHEMA_VERSION],
        )
        .map_err(|error| format!("写入索引 schema_version 失败: {error}"))?;
    transaction
        .execute(
            "INSERT INTO query_meta(key, value) VALUES (?1, ?2)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            params![META_KEY_MANIFEST_FINGERPRINT, runtime_fingerprint],
        )
        .map_err(|error| format!("写入索引 fingerprint 失败: {error}"))?;

    transaction
        .commit()
        .map_err(|error| format!("提交索引重建事务失败: {error}"))?;

    println!("[query-index] ensure current success: rebuilt");
    Ok(())
}

/// 读取索引中的 Markdown 文件列表。
pub fn list_markdown_files(vault_root: &Path) -> Result<Vec<IndexedMarkdownFile>, String> {
    ensure_query_index_current(vault_root)?;
    let connection = open_index_connection(vault_root)?;

    let mut statement = connection
        .prepare(
            "SELECT relative_path, title
             FROM markdown_files
             ORDER BY relative_path ASC",
        )
        .map_err(|error| format!("构建文件索引查询失败: {error}"))?;

    let rows = statement
        .query_map([], |row| {
            Ok(IndexedMarkdownFile {
                relative_path: row.get(0)?,
                title: row.get(1)?,
            })
        })
        .map_err(|error| format!("执行文件索引查询失败: {error}"))?;

    let mut output = Vec::new();
    for row in rows {
        output.push(row.map_err(|error| format!("解析文件索引行失败: {error}"))?);
    }

    Ok(output)
}

/// 读取索引中的图谱节点与边。
pub fn load_markdown_graph(vault_root: &Path) -> Result<VaultMarkdownGraphResponse, String> {
    ensure_query_index_current(vault_root)?;
    let connection = open_index_connection(vault_root)?;

    let mut node_statement = connection
        .prepare(
            "SELECT relative_path, title
             FROM markdown_files
             ORDER BY relative_path ASC",
        )
        .map_err(|error| format!("构建图谱节点查询失败: {error}"))?;

    let node_rows = node_statement
        .query_map([], |row| {
            Ok(VaultMarkdownGraphNode {
                path: row.get(0)?,
                title: row.get(1)?,
            })
        })
        .map_err(|error| format!("执行图谱节点查询失败: {error}"))?;

    let mut nodes = Vec::new();
    for row in node_rows {
        nodes.push(row.map_err(|error| format!("解析图谱节点失败: {error}"))?);
    }

    let mut edge_statement = connection
        .prepare(
            "SELECT l.source_path, l.target_path, l.weight
             FROM markdown_links l
             INNER JOIN markdown_files s ON s.relative_path = l.source_path
             INNER JOIN markdown_files t ON t.relative_path = l.target_path
             WHERE l.source_path <> l.target_path
             ORDER BY l.source_path ASC, l.target_path ASC",
        )
        .map_err(|error| format!("构建图谱边查询失败: {error}"))?;

    let edge_rows = edge_statement
        .query_map([], |row| {
            Ok(VaultMarkdownGraphEdge {
                source_path: row.get(0)?,
                target_path: row.get(1)?,
                weight: row.get::<_, i64>(2)? as usize,
            })
        })
        .map_err(|error| format!("执行图谱边查询失败: {error}"))?;

    let mut edges = Vec::new();
    for row in edge_rows {
        edges.push(row.map_err(|error| format!("解析图谱边失败: {error}"))?);
    }

    Ok(VaultMarkdownGraphResponse { nodes, edges })
}

/// 通过文件 stem（不含扩展名，小写匹配）查询候选 Markdown 绝对路径。
pub fn find_markdown_candidates_by_stem(
    vault_root: &Path,
    stem: &str,
) -> Result<Vec<PathBuf>, String> {
    ensure_query_index_current(vault_root)?;
    let connection = open_index_connection(vault_root)?;

    let mut statement = connection
        .prepare(
            "SELECT relative_path
             FROM markdown_files
             WHERE stem_lower = ?1
             ORDER BY relative_path ASC",
        )
        .map_err(|error| format!("构建 stem 候选查询失败: {error}"))?;

    let stem_lower = stem.to_lowercase();
    let rows = statement
        .query_map(params![stem_lower], |row| row.get::<_, String>(0))
        .map_err(|error| format!("执行 stem 候选查询失败: {error}"))?;

    let mut output = Vec::new();
    for row in rows {
        let relative_path = row.map_err(|error| format!("解析 stem 候选行失败: {error}"))?;
        output.push(vault_root.join(relative_path));
    }

    Ok(output)
}

fn upsert_single_file(
    transaction: &Transaction<'_>,
    vault_root: &Path,
    relative_path: &str,
) -> Result<(), String> {
    let absolute_path = vault_root.join(relative_path);
    if !absolute_path.exists() {
        return Ok(());
    }

    let metadata = fs::metadata(&absolute_path)
        .map_err(|error| format!("读取文件元信息失败 {}: {error}", absolute_path.display()))?;

    let modified = metadata
        .modified()
        .map_err(|error| format!("读取文件修改时间失败 {}: {error}", absolute_path.display()))?;
    let modified_ms = modified
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|error| format!("计算文件时间戳失败 {}: {error}", absolute_path.display()))?
        .as_millis() as i64;

    let title = Path::new(relative_path)
        .file_stem()
        .and_then(|item| item.to_str())
        .unwrap_or(relative_path)
        .to_string();
    let stem_lower = title.to_lowercase();
    let parent_dir = Path::new(relative_path)
        .parent()
        .map(|item| item.to_string_lossy().replace('\\', "/"))
        .unwrap_or_default();

    transaction
        .execute(
            "INSERT INTO markdown_files(relative_path, title, stem_lower, parent_dir, mtime_ms, size_bytes)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(relative_path) DO UPDATE SET
                title = excluded.title,
                stem_lower = excluded.stem_lower,
                parent_dir = excluded.parent_dir,
                mtime_ms = excluded.mtime_ms,
                size_bytes = excluded.size_bytes",
            params![
                relative_path,
                title,
                stem_lower,
                parent_dir,
                modified_ms,
                metadata.len() as i64
            ],
        )
        .map_err(|error| format!("写入单文件索引失败 path={relative_path}: {error}"))?;

    transaction
        .execute(
            "DELETE FROM markdown_links WHERE source_path = ?1",
            params![relative_path],
        )
        .map_err(|error| format!("清理单文件边索引失败 path={relative_path}: {error}"))?;

    let content = fs::read_to_string(&absolute_path)
        .map_err(|error| format!("读取单文件内容失败 {}: {error}", absolute_path.display()))?;
    let edge_weights = parse_file_links(vault_root, relative_path, &content)?;

    for (target, weight) in edge_weights {
        transaction
            .execute(
                "INSERT INTO markdown_links(source_path, target_path, weight)
                 VALUES (?1, ?2, ?3)
                 ON CONFLICT(source_path, target_path) DO UPDATE SET weight = excluded.weight",
                params![relative_path, target, weight as i64],
            )
            .map_err(|error| format!("写入单文件边索引失败 source={relative_path}: {error}"))?;
    }

    Ok(())
}

/// 在写入后增量刷新单个 Markdown 文件索引。
pub fn reindex_markdown_file(vault_root: &Path, relative_path: &str) -> Result<(), String> {
    ensure_query_index_current(vault_root)?;
    let mut connection = open_index_connection(vault_root)?;
    let transaction = connection
        .transaction()
        .map_err(|error| format!("开始单文件索引事务失败: {error}"))?;

    upsert_single_file(&transaction, vault_root, relative_path)?;
    transaction
        .commit()
        .map_err(|error| format!("提交单文件索引事务失败: {error}"))?;

    refresh_manifest_meta(&connection, vault_root)?;
    println!("[query-index] reindex file success: path={}", relative_path);
    Ok(())
}

/// 在删除后增量刷新单个 Markdown 文件索引。
pub fn remove_markdown_file(vault_root: &Path, relative_path: &str) -> Result<(), String> {
    ensure_query_index_current(vault_root)?;
    let mut connection = open_index_connection(vault_root)?;
    let transaction = connection
        .transaction()
        .map_err(|error| format!("开始删除索引事务失败: {error}"))?;

    transaction
        .execute(
            "DELETE FROM markdown_links WHERE source_path = ?1 OR target_path = ?1",
            params![relative_path],
        )
        .map_err(|error| format!("删除边索引失败 path={relative_path}: {error}"))?;
    transaction
        .execute(
            "DELETE FROM markdown_files WHERE relative_path = ?1",
            params![relative_path],
        )
        .map_err(|error| format!("删除文件索引失败 path={relative_path}: {error}"))?;

    transaction
        .commit()
        .map_err(|error| format!("提交删除索引事务失败: {error}"))?;

    refresh_manifest_meta(&connection, vault_root)?;
    println!("[query-index] remove file success: path={}", relative_path);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{ensure_query_index_current, list_markdown_files, load_markdown_graph};
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    static TEST_ROOT_SEQ: AtomicU64 = AtomicU64::new(1);

    fn create_test_root() -> PathBuf {
        let sequence = TEST_ROOT_SEQ.fetch_add(1, Ordering::Relaxed);
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0);
        let root = std::env::temp_dir().join(format!("ofive-query-index-test-{unique}-{sequence}"));
        fs::create_dir_all(root.join(".ofive")).expect("应成功创建测试根目录");
        root
    }

    fn write_markdown_file(root: &Path, relative_path: &str, content: &str) {
        let file_path = root.join(relative_path);
        if let Some(parent) = file_path.parent() {
            fs::create_dir_all(parent).expect("应成功创建测试目录");
        }
        fs::write(file_path, content).expect("应成功写入测试文件");
    }

    #[test]
    fn query_index_should_rebuild_and_query_graph() {
        let root = create_test_root();
        write_markdown_file(&root, "A.md", "[[B]] [b](./B)");
        write_markdown_file(&root, "B.md", "[[A]]");

        ensure_query_index_current(&root).expect("应成功构建索引");

        let files = list_markdown_files(&root).expect("应成功读取文件索引");
        assert_eq!(files.len(), 2);

        let graph = load_markdown_graph(&root).expect("应成功读取图谱索引");
        assert_eq!(graph.nodes.len(), 2);
        assert_eq!(graph.edges.len(), 2);
        assert!(graph.edges.iter().any(|edge| {
            edge.source_path == "A.md" && edge.target_path == "B.md" && edge.weight == 2
        }));

        let _ = fs::remove_dir_all(root);
    }
}
