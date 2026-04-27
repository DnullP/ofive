//! # SQLite 查询索引模块
//!
//! 为高频读查询提供纯后端索引能力，采用**读写分离**架构：
//!
//! ## 写路径（维护索引一致性）
//!
//! - **冷启动**：`set_current_vault` 调用 `ensure_query_index_current`，
//!   扫描全仓库检查指纹，如有差异则全量重建。
//! - **单文件变更**：`reindex_markdown_file` / `remove_markdown_file`
//!   增量更新单个文件的索引与链接，O(1)。
//! - **目录移动/重命名**：`relocate_directory_in_index` 批量更新路径
//!   前缀 + 重新解析受影响文件的链接关系，O(K)（K = 目录内文件数）。
//! - **目录删除**：`remove_directory_from_index` 批量删除，O(K)。
//!
//! ## 读路径（直接查询，零开销）
//!
//! `list_markdown_files`、`load_markdown_graph`、`get_backlinks_for_file` 等
//! 读函数直接查询 SQLite，不做一致性校验或文件系统扫描。
//! 索引一致性完全由写路径保证。
//!
//! ## 并发安全
//!
//! 所有涉及索引写入的操作均通过全局 `INDEX_WRITE_LOCK` 互斥锁串行化，
//! 避免多线程（后台 reindex / Tauri 命令线程）同时写入 SQLite 导致
//! "database is locked" 超时错误。读操作不加锁，可并发执行。

use crate::infra::fs::fs_helpers::{
    collect_markdown_relative_paths, is_markdown_file, relative_path_from_vault_root,
    with_markdown_extension_candidates,
};
use crate::infra::query::wikilink::{
    extract_markdown_inline_link_targets, extract_wikilink_targets, path_tree_distance,
    resolve_wikilink_target_path_in_vault_without_index,
};
use crate::shared::vault_contracts::{
    BacklinkItem, VaultMarkdownGraphEdge, VaultMarkdownGraphNode, VaultMarkdownGraphResponse,
};
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

#[cfg(test)]
#[path = "query_index_tests.rs"]
mod query_index_tests;

/// 全局索引写锁，串行化所有 SQLite 索引写入操作。
///
/// SQLite WAL 模式允许并发读，但写事务互斥。当多个线程
/// （后台 `spawn_background_reindex`、Tauri 命令线程的 backlinks/graph 查询）
/// 同时触发 `ensure_query_index_current` 或增量 reindex 时，
/// 仅靠 `busy_timeout(5s)` 不足以应对大仓库（1500+ 文件）的全量重建耗时，
/// 导致 "database is locked" 错误。
///
/// 该锁确保同一时刻只有一个线程执行索引写入，其他线程排队等待。
fn index_write_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

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

/// 打开用于只读查询的索引数据库连接。
///
/// 仅确保表结构存在（CREATE TABLE IF NOT EXISTS），
/// 不进行一致性检查或重建。如果索引尚未构建（冷启动前），
/// 查询将返回空结果。
///
/// # 参数
/// - `vault_root`：仓库根目录
///
/// # 返回
/// - 成功返回可用于 SELECT 查询的 Connection
fn open_index_for_read(vault_root: &Path) -> Result<Connection, String> {
    let connection = open_index_connection(vault_root)?;
    ensure_schema(&connection)?;
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

/// 内存中的 stem 索引，用于全量重建时快速查找文件。
///
/// key 为 stem_lower（文件名小写不含扩展名），
/// value 为该 stem 对应的所有文件绝对路径列表。
type StemIndex = HashMap<String, Vec<PathBuf>>;

/// 从 manifest 构建内存 stem 索引。
///
/// 遍历 manifest 中所有文件，以 stem_lower 为键，绝对路径列表为值，
/// 构建 HashMap 供全量重建时链接解析使用。
///
/// # 参数
/// - `vault_root`：仓库根目录（已 canonicalize）
/// - `manifest`：文件清单
///
/// # 返回
/// stem_lower → Vec<PathBuf> 的映射
fn build_stem_index(vault_root: &Path, manifest: &[ManifestEntry]) -> StemIndex {
    let mut index: StemIndex = HashMap::with_capacity(manifest.len());
    for entry in manifest {
        let abs_path = vault_root.join(&entry.relative_path);
        index
            .entry(entry.stem_lower.clone())
            .or_default()
            .push(abs_path);
    }
    index
}

/// 使用内存 stem 索引解析单个 wikilink/inline-link 目标。
///
/// 解析策略与 `resolve_wikilink_target_path_in_vault_internal` 保持一致：
/// 1. 相对路径（`./`、`../`）、多组件路径：直接检查文件系统候选
/// 2. 单组件 bare stem：从 `stem_index` 查找，按路径树距离排序选最近者
///
/// # 参数
/// - `canonical_vault_root`：已 canonicalize 的仓库根目录
/// - `current_dir_path`：源文件所在目录的绝对路径
/// - `target`：链接目标文本（已经过 extract 提取）
/// - `stem_index`：预构建的 stem → 绝对路径映射
///
/// # 返回
/// 解析成功返回目标文件相对路径，无法解析返回 None
fn resolve_link_target_with_stem_index(
    canonical_vault_root: &Path,
    current_dir_path: &Path,
    target: &str,
    stem_index: &StemIndex,
) -> Result<Option<String>, String> {
    let normalized_target = target.trim().replace('\\', "/");
    if normalized_target.is_empty() {
        return Ok(None);
    }

    let target_path = PathBuf::from(&normalized_target);

    // 处理直接路径候选（绝对路径、相对路径、多组件路径）
    let mut direct_candidates: Vec<PathBuf> = Vec::new();
    if target_path.is_absolute() {
        direct_candidates.extend(with_markdown_extension_candidates(&target_path));
    } else if normalized_target.starts_with("./") || normalized_target.starts_with("../") {
        direct_candidates.extend(with_markdown_extension_candidates(
            &current_dir_path.join(&target_path),
        ));
    } else if target_path.components().count() > 1 {
        direct_candidates.extend(with_markdown_extension_candidates(
            &canonical_vault_root.join(&target_path),
        ));
        direct_candidates.extend(with_markdown_extension_candidates(
            &current_dir_path.join(&target_path),
        ));
    }

    for candidate in direct_candidates {
        if candidate.is_file() && is_markdown_file(&candidate) {
            let canonical = candidate
                .canonicalize()
                .map_err(|error| format!("解析目标文件失败 {}: {error}", candidate.display()))?;
            if canonical.starts_with(canonical_vault_root) {
                let rel = canonical
                    .strip_prefix(canonical_vault_root)
                    .map_err(|e| format!("计算相对路径失败: {e}"))?
                    .to_string_lossy()
                    .replace('\\', "/");
                return Ok(Some(rel));
            }
        }
    }

    // 多组件路径或包含 '/' 的目标不做 stem 匹配
    if target_path.components().count() > 1 || normalized_target.contains('/') {
        return Ok(None);
    }

    // 使用内存 stem 索引进行 bare stem 查找
    let stem_lower = normalized_target.to_lowercase();
    let Some(candidates) = stem_index.get(&stem_lower) else {
        return Ok(None);
    };
    if candidates.is_empty() {
        return Ok(None);
    }

    // 按路径树距离排序，选最近者（与原始逻辑一致）
    let mut sorted: Vec<&PathBuf> = candidates.iter().collect();
    sorted.sort_by(|left, right| {
        let left_parent = left.parent().unwrap_or(canonical_vault_root);
        let right_parent = right.parent().unwrap_or(canonical_vault_root);
        let left_dist = path_tree_distance(current_dir_path, left_parent);
        let right_dist = path_tree_distance(current_dir_path, right_parent);
        left_dist
            .cmp(&right_dist)
            .then_with(|| left.to_string_lossy().cmp(&right.to_string_lossy()))
    });

    let best = sorted[0];
    let rel = best
        .strip_prefix(canonical_vault_root)
        .map_err(|e| format!("计算相对路径失败: {e}"))?
        .to_string_lossy()
        .replace('\\', "/");
    Ok(Some(rel))
}

/// 使用内存 stem 索引解析文件中所有链接。
///
/// 全量重建专用版本，避免每个链接都做文件系统递归遍历。
/// 解析策略与 `parse_file_links` 保持一致，但 bare stem 查找
/// 使用内存索引代替 `collect_markdown_candidates_by_stem`。
///
/// # 参数
/// - `canonical_vault_root`：已 canonicalize 的仓库根目录
/// - `source_relative_path`：源文件相对路径
/// - `content`：源文件内容
/// - `stem_index`：预构建的 stem → 绝对路径映射
///
/// # 返回
/// target_relative_path → 引用权重的映射
fn parse_file_links_with_stem_index(
    canonical_vault_root: &Path,
    source_relative_path: &str,
    content: &str,
    stem_index: &StemIndex,
) -> Result<BTreeMap<String, usize>, String> {
    let current_dir_path = {
        let parent = Path::new(source_relative_path)
            .parent()
            .map(|item| item.to_string_lossy().replace('\\', "/"))
            .unwrap_or_default();
        let raw = if parent.is_empty() {
            canonical_vault_root.to_path_buf()
        } else {
            canonical_vault_root.join(&parent)
        };
        // 与 resolve_current_dir_for_wikilink 行为对齐：
        // canonicalize 消除符号链接，确保 path_tree_distance 计算一致
        raw.canonicalize().unwrap_or(raw)
    };

    let mut edge_weights = BTreeMap::<String, usize>::new();

    for target in extract_wikilink_targets(content) {
        let resolved = resolve_link_target_with_stem_index(
            canonical_vault_root,
            &current_dir_path,
            &target,
            stem_index,
        )?;
        let Some(target_relative_path) = resolved else {
            continue;
        };
        if target_relative_path == source_relative_path {
            continue;
        }
        *edge_weights.entry(target_relative_path).or_insert(0) += 1;
    }

    for target in extract_markdown_inline_link_targets(content) {
        let resolved = resolve_link_target_with_stem_index(
            canonical_vault_root,
            &current_dir_path,
            &target,
            stem_index,
        )?;
        let Some(target_relative_path) = resolved else {
            continue;
        };
        if target_relative_path == source_relative_path {
            continue;
        }
        *edge_weights.entry(target_relative_path).or_insert(0) += 1;
    }

    Ok(edge_weights)
}

/// 使用文件系统遍历解析文件中所有链接（增量更新场景）。
///
/// 用于单文件增量 reindex 时，仓库规模下单次遍历开销可接受。
/// 全量重建应使用 `parse_file_links_with_stem_index` 避免 N×M 遍历。
///
/// # 参数
/// - `vault_root`：仓库根目录
/// - `source_relative_path`：源文件相对路径
/// - `content`：源文件内容
///
/// # 返回
/// target_relative_path → 引用权重的映射
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
    use std::time::Instant;

    let phase_start = Instant::now();

    // 预计算 canonical vault root，避免后续每次链接解析都调用 canonicalize
    let canonical_vault_root = vault_root
        .canonicalize()
        .map_err(|e| format!("canonicalize vault root 失败: {e}"))?;

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

    let prepare_elapsed = phase_start.elapsed();

    // ── Phase 1：写入全部文件索引 ──
    let t_phase1 = Instant::now();
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
    }
    let phase1_elapsed = t_phase1.elapsed();

    // ── 构建内存 stem 索引，用于 Phase 2 链接解析 ──
    let t_stem = Instant::now();
    let stem_index = build_stem_index(&canonical_vault_root, manifest);
    let stem_build_elapsed = t_stem.elapsed();

    // ── Phase 2：读取文件内容并解析链接，使用内存 stem 索引 ──
    let mut total_file_read = Duration::ZERO;
    let mut total_parse_links = Duration::ZERO;
    let mut total_insert_link = Duration::ZERO;
    let mut total_links_inserted: usize = 0;

    for entry in manifest {
        let t1 = Instant::now();
        let content =
            fs::read_to_string(vault_root.join(&entry.relative_path)).map_err(|error| {
                format!("读取索引构建文件内容失败 {}: {error}", entry.relative_path)
            })?;
        total_file_read += t1.elapsed();

        let t2 = Instant::now();
        let edge_weights = parse_file_links_with_stem_index(
            &canonical_vault_root,
            &entry.relative_path,
            &content,
            &stem_index,
        )?;
        total_parse_links += t2.elapsed();

        let t3 = Instant::now();
        for (target, weight) in edge_weights {
            insert_link
                .execute(params![entry.relative_path, target, weight as i64])
                .map_err(|error| {
                    format!("写入边索引失败 source={}: {error}", entry.relative_path)
                })?;
            total_links_inserted += 1;
        }
        total_insert_link += t3.elapsed();
    }

    let total_elapsed = phase_start.elapsed();

    log::info!(
        "[query-index][profile] rebuild_index_data 耗时分解 (files={}, links={}):\n\
         \x20 prepare_stmt   : {:>8.2?}\n\
         \x20 phase1_files   : {:>8.2?}\n\
         \x20 build_stem_idx : {:>8.2?}\n\
         \x20 file_read      : {:>8.2?}\n\
         \x20 parse_links    : {:>8.2?}\n\
         \x20 insert_link    : {:>8.2?}\n\
         \x20 total          : {:>8.2?}",
        manifest.len(),
        total_links_inserted,
        prepare_elapsed,
        phase1_elapsed,
        stem_build_elapsed,
        total_file_read,
        total_parse_links,
        total_insert_link,
        total_elapsed,
    );

    Ok(())
}

fn refresh_manifest_meta(connection: &Connection, vault_root: &Path) -> Result<(), String> {
    let manifest = scan_manifest(vault_root)?;
    let fingerprint = compute_manifest_fingerprint(&manifest);
    upsert_meta(connection, META_KEY_MANIFEST_FINGERPRINT, &fingerprint)
}

/// 仅确保索引数据库与表结构可用，不做完整性校验或重建。
///
/// 用于增量操作（reindex / remove）场景，避免因文件刚刚写入导致
/// manifest fingerprint 不一致而触发全库重建。
///
/// 如果索引从未初始化（schema_version 缺失），则触发一次全量重建以确保索引可用。
///
/// # 前置条件
/// - 调用方必须已持有 `INDEX_WRITE_LOCK`，本函数不再加锁。
///
/// # 参数
/// - `vault_root`：仓库根目录
///
/// # 返回
/// - 成功返回 Ok(Connection)
/// - 失败返回 Err(String)
fn ensure_index_ready_for_incremental(vault_root: &Path) -> Result<Connection, String> {
    let connection = open_index_connection(vault_root)?;
    ensure_schema(&connection)?;

    // 如果索引从未初始化过（schema_version 缺失），需要先做一次全量重建
    let stored_schema = get_meta(&connection, META_KEY_SCHEMA_VERSION)?;
    if stored_schema.as_deref() != Some(INDEX_SCHEMA_VERSION) {
        log::info!("[query-index] index not initialized, performing initial build");
        drop(connection);
        // 调用 _inner 避免重复加锁（调用方已持有锁）
        ensure_query_index_current_inner(vault_root)?;
        let connection = open_index_connection(vault_root)?;
        return Ok(connection);
    }

    Ok(connection)
}

/// 确保索引与当前仓库状态一致（内部实现，不加锁）。
///
/// # 前置条件
/// - 调用方必须已持有 `INDEX_WRITE_LOCK`。
fn ensure_query_index_current_inner(vault_root: &Path) -> Result<(), String> {
    use std::time::Instant;

    log::info!("[query-index] ensure current start");
    let total_start = Instant::now();

    let t_scan = Instant::now();
    let manifest = scan_manifest(vault_root)?;
    let scan_elapsed = t_scan.elapsed();

    let runtime_fingerprint = compute_manifest_fingerprint(&manifest);

    let mut connection = open_index_connection(vault_root)?;
    ensure_schema(&connection)?;

    let stored_schema = get_meta(&connection, META_KEY_SCHEMA_VERSION)?;
    let stored_fingerprint = get_meta(&connection, META_KEY_MANIFEST_FINGERPRINT)?;

    let need_rebuild = stored_schema.as_deref() != Some(INDEX_SCHEMA_VERSION)
        || stored_fingerprint.as_deref() != Some(runtime_fingerprint.as_str());

    if !need_rebuild {
        log::info!("[query-index] ensure current success: unchanged");
        return Ok(());
    }

    log::info!(
        "[query-index] manifest changed, rebuilding index: files={}",
        manifest.len()
    );

    let t_tx = Instant::now();
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
    let tx_elapsed = t_tx.elapsed();

    let total_elapsed = total_start.elapsed();
    log::info!(
        "[query-index][profile] ensure_query_index_current_inner 耗时分解:\n\
         \x20 scan_manifest  : {:>8.2?}\n\
         \x20 transaction    : {:>8.2?}\n\
         \x20 total          : {:>8.2?}",
        scan_elapsed,
        tx_elapsed,
        total_elapsed,
    );

    log::info!("[query-index] ensure current success: rebuilt");
    Ok(())
}

/// 确保索引与当前仓库状态一致；若检测到离线变更则重建。
///
/// 获取全局 `INDEX_WRITE_LOCK` 后委托 `ensure_query_index_current_inner`。
/// 若另一线程正在重建索引，本调用会阻塞等待（而非 SQLite busy_timeout 超时报错）。
///
/// # 参数
/// - `vault_root`：仓库根目录
///
/// # 副作用
/// - 如果索引过期，会在锁内执行全量重建
/// - 持有 `INDEX_WRITE_LOCK` 期间阻塞其他索引写操作
pub fn ensure_query_index_current(vault_root: &Path) -> Result<(), String> {
    let _guard = index_write_lock()
        .lock()
        .map_err(|error| format!("索引写锁获取失败: {error}"))?;
    ensure_query_index_current_inner(vault_root)
}

/// 读取索引中的 Markdown 文件列表。
///
/// 直接查询索引，不做一致性校验。索引由写路径负责维护。
pub fn list_markdown_files(vault_root: &Path) -> Result<Vec<IndexedMarkdownFile>, String> {
    let connection = open_index_for_read(vault_root)?;

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
///
/// 直接查询索引，不做一致性校验。索引由写路径负责维护。
pub fn load_markdown_graph(vault_root: &Path) -> Result<VaultMarkdownGraphResponse, String> {
    let connection = open_index_for_read(vault_root)?;

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
///
/// 直接查询索引，不做一致性校验。索引由写路径负责维护。
pub fn find_markdown_candidates_by_stem(
    vault_root: &Path,
    stem: &str,
) -> Result<Vec<PathBuf>, String> {
    let connection = open_index_for_read(vault_root)?;

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

/// 查询每个 Markdown 文件被引用（入链）的次数。
///
/// 返回 `(relative_path, inbound_link_count)` 列表，
/// 包含所有文件（无入链的文件 count = 0）。
///
/// 直接查询索引，不做一致性校验。索引由写路径负责维护。
pub fn list_markdown_files_with_inbound_count(
    vault_root: &Path,
) -> Result<Vec<(String, usize)>, String> {
    let connection = open_index_for_read(vault_root)?;

    let mut statement = connection
        .prepare(
            "SELECT f.relative_path,
                    COALESCE(SUM(l.weight), 0) AS inbound_count
             FROM markdown_files f
             LEFT JOIN markdown_links l ON l.target_path = f.relative_path
             GROUP BY f.relative_path
             ORDER BY f.relative_path ASC",
        )
        .map_err(|error| format!("构建入链统计查询失败: {error}"))?;

    let rows = statement
        .query_map([], |row| {
            let path: String = row.get(0)?;
            let count: i64 = row.get(1)?;
            Ok((path, count as usize))
        })
        .map_err(|error| format!("执行入链统计查询失败: {error}"))?;

    let mut output = Vec::new();
    for row in rows {
        output.push(row.map_err(|error| format!("解析入链统计行失败: {error}"))?);
    }

    Ok(output)
}

/// 查询指定 Markdown 文件的所有反向链接（被哪些文件引用）。
///
/// 返回引用该文件的源文件列表，包含源文件路径、标题和引用权重。
///
/// # 参数
/// - `vault_root`：仓库根目录
/// - `relative_path`：目标文件的相对路径
///
/// # 返回
/// - `Vec<BacklinkItem>`：反向链接条目列表
///
/// 直接查询索引，不做一致性校验。索引由写路径负责维护。
pub fn get_backlinks_for_file(
    vault_root: &Path,
    relative_path: &str,
) -> Result<Vec<BacklinkItem>, String> {
    ensure_query_index_current(vault_root)?;
    let connection = open_index_for_read(vault_root)?;

    let mut statement = connection
        .prepare(
            "SELECT l.source_path, f.title, l.weight
             FROM markdown_links l
             INNER JOIN markdown_files f ON f.relative_path = l.source_path
             WHERE l.target_path = ?1
               AND l.source_path <> ?1
             ORDER BY l.weight DESC, l.source_path ASC",
        )
        .map_err(|error| format!("构建反向链接查询失败: {error}"))?;

    let rows = statement
        .query_map(params![relative_path], |row| {
            Ok(BacklinkItem {
                source_path: row.get(0)?,
                title: row.get(1)?,
                weight: row.get::<_, i64>(2)? as usize,
            })
        })
        .map_err(|error| format!("执行反向链接查询失败: {error}"))?;

    let mut output = Vec::new();
    for row in rows {
        output.push(row.map_err(|error| format!("解析反向链接行失败: {error}"))?);
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
///
/// 获取全局 `INDEX_WRITE_LOCK` 后执行增量更新。
/// 仅对指定文件执行 upsert + 链接刷新，不触发全库重建。
/// 如果索引数据库尚未初始化，会先执行一次全量构建，
/// 之后再进行增量操作。
///
/// # 参数
/// - `vault_root`：仓库根目录
/// - `relative_path`：变更文件相对路径
///
/// # 副作用
/// - 持有 `INDEX_WRITE_LOCK` 期间阻塞其他索引写操作
/// - 更新 markdown_files 与 markdown_links 表中该文件相关行
/// - 更新 manifest_fingerprint 元信息
pub fn reindex_markdown_file(vault_root: &Path, relative_path: &str) -> Result<(), String> {
    let _guard = index_write_lock()
        .lock()
        .map_err(|error| format!("索引写锁获取失败: {error}"))?;

    let mut connection = ensure_index_ready_for_incremental(vault_root)?;
    let transaction = connection
        .transaction()
        .map_err(|error| format!("开始单文件索引事务失败: {error}"))?;

    upsert_single_file(&transaction, vault_root, relative_path)?;
    transaction
        .commit()
        .map_err(|error| format!("提交单文件索引事务失败: {error}"))?;

    refresh_manifest_meta(&connection, vault_root)?;
    log::info!("[query-index] reindex file success: path={}", relative_path);
    Ok(())
}

/// 在删除后增量刷新单个 Markdown 文件索引。
///
/// 获取全局 `INDEX_WRITE_LOCK` 后执行增量删除。
/// 仅删除指定文件的索引记录与关联边，不触发全库重建。
///
/// # 参数
/// - `vault_root`：仓库根目录
/// - `relative_path`：已删除文件的相对路径
///
/// # 副作用
/// - 持有 `INDEX_WRITE_LOCK` 期间阻塞其他索引写操作
/// - 删除 markdown_files 与 markdown_links 表中该文件相关行
/// - 更新 manifest_fingerprint 元信息
pub fn remove_markdown_file(vault_root: &Path, relative_path: &str) -> Result<(), String> {
    let _guard = index_write_lock()
        .lock()
        .map_err(|error| format!("索引写锁获取失败: {error}"))?;

    let mut connection = ensure_index_ready_for_incremental(vault_root)?;
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
    log::info!("[query-index] remove file success: path={}", relative_path);
    Ok(())
}

/// 在目录移动/重命名后，批量更新索引中的路径前缀并重新解析链接关系。
///
/// 将索引中所有以 `old_prefix` 开头的文件路径替换为 `new_prefix`，
/// 同时重新解析受影响文件的链接（因为相对链接解析依赖文件所在目录）。
///
/// 时间复杂度 O(K)（K = 被移动的文件数），远优于全量重建 O(N)。
///
/// # 参数
/// - `vault_root`：仓库根目录
/// - `old_prefix`：旧目录相对路径（如 `"Entry/Business"`）
/// - `new_prefix`：新目录相对路径（如 `"Archive/Business"`）
///
/// # 副作用
/// - 持有 `INDEX_WRITE_LOCK` 期间阻塞其他索引写操作
/// - 批量更新 markdown_files 中的 relative_path 和 parent_dir
/// - 批量更新 markdown_links 中受影响的 source_path / target_path
/// - 重新解析被移动文件的出链关系
/// - 更新 manifest_fingerprint 元信息
pub fn relocate_directory_in_index(
    vault_root: &Path,
    old_prefix: &str,
    new_prefix: &str,
) -> Result<(), String> {
    let _guard = index_write_lock()
        .lock()
        .map_err(|error| format!("索引写锁获取失败: {error}"))?;

    let mut connection = ensure_index_ready_for_incremental(vault_root)?;

    // 规范化：确保带尾部 "/" 用于 LIKE 匹配
    let old_dir = if old_prefix.ends_with('/') {
        old_prefix.to_string()
    } else {
        format!("{}/", old_prefix)
    };
    let new_dir = if new_prefix.ends_with('/') {
        new_prefix.to_string()
    } else {
        format!("{}/", new_prefix)
    };
    let old_dir_no_slash = old_dir.trim_end_matches('/');
    let new_dir_no_slash = new_dir.trim_end_matches('/');
    // SQLite SUBSTR 按字符计数，用 chars().count() 而非 len()（兼容非 ASCII 路径）
    let old_dir_chars = old_dir.chars().count() as i64;
    let old_dir_no_slash_chars = old_dir_no_slash.chars().count() as i64;
    let like_pattern = format!("{}%", old_dir);

    let transaction = connection
        .transaction()
        .map_err(|error| format!("开始目录重定位索引事务失败: {error}"))?;

    // 1. 计算被移动文件的新路径（在 UPDATE 之前）
    let new_paths: Vec<String> = {
        let mut stmt = transaction
            .prepare(
                "SELECT ?1 || SUBSTR(relative_path, ?2)
                 FROM markdown_files
                 WHERE relative_path LIKE ?3",
            )
            .map_err(|e| format!("查询受影响文件失败: {e}"))?;
        let rows = stmt
            .query_map(params![&new_dir, old_dir_chars + 1, &like_pattern], |row| {
                row.get::<_, String>(0)
            })
            .map_err(|e| format!("查询受影响文件失败: {e}"))?;
        let mut paths = Vec::new();
        for row in rows {
            paths.push(row.map_err(|e| format!("解析文件路径失败: {e}"))?);
        }
        paths
    };

    if new_paths.is_empty() {
        log::info!(
            "[query-index] relocate directory: no files affected old={} new={}",
            old_dir_no_slash,
            new_dir_no_slash
        );
        return Ok(());
    }

    log::info!(
        "[query-index] relocate directory start: old={} new={} files={}",
        old_dir_no_slash,
        new_dir_no_slash,
        new_paths.len()
    );

    // 2. 批量更新 markdown_files 路径
    transaction
        .execute(
            "UPDATE markdown_files SET
                relative_path = ?1 || SUBSTR(relative_path, ?2),
                parent_dir = ?3 || SUBSTR(parent_dir, ?4)
             WHERE relative_path LIKE ?5",
            params![
                &new_dir,
                old_dir_chars + 1,
                new_dir_no_slash,
                old_dir_no_slash_chars + 1,
                &like_pattern,
            ],
        )
        .map_err(|e| format!("批量更新文件路径失败: {e}"))?;

    // 3. 批量更新 markdown_links 中的 target_path（非移动文件指向移动文件的入链）
    transaction
        .execute(
            "UPDATE markdown_links SET
                target_path = ?1 || SUBSTR(target_path, ?2)
             WHERE target_path LIKE ?3",
            params![&new_dir, old_dir_chars + 1, &like_pattern],
        )
        .map_err(|e| format!("批量更新链接目标路径失败: {e}"))?;

    // 4. 删除被移动文件的所有出链（按旧 source_path 匹配）并重新解析
    //    先批量删除旧出链
    transaction
        .execute(
            "DELETE FROM markdown_links WHERE source_path LIKE ?1",
            params![&like_pattern],
        )
        .map_err(|e| format!("批量删除旧出链失败: {e}"))?;

    // 5. 重新解析每个被移动文件的链接关系
    let mut insert_link = transaction
        .prepare(
            "INSERT INTO markdown_links(source_path, target_path, weight)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(source_path, target_path) DO UPDATE SET weight = excluded.weight",
        )
        .map_err(|e| format!("构建边索引语句失败: {e}"))?;

    for new_path in &new_paths {
        let absolute_path = vault_root.join(new_path);
        if !absolute_path.exists() {
            log::warn!(
                "[query-index] relocated file not found on disk: {}",
                new_path
            );
            continue;
        }
        let content = match fs::read_to_string(&absolute_path) {
            Ok(c) => c,
            Err(e) => {
                log::warn!(
                    "[query-index] failed to read relocated file {}: {}",
                    new_path,
                    e
                );
                continue;
            }
        };
        let edge_weights = parse_file_links(vault_root, new_path, &content)?;
        for (target, weight) in edge_weights {
            insert_link
                .execute(params![new_path, target, weight as i64])
                .map_err(|e| format!("写入重定位文件边索引失败 source={new_path}: {e}"))?;
        }
    }

    drop(insert_link);
    transaction
        .commit()
        .map_err(|error| format!("提交目录重定位索引事务失败: {error}"))?;

    refresh_manifest_meta(&connection, vault_root)?;
    log::info!(
        "[query-index] relocate directory success: old={} new={} files={}",
        old_dir_no_slash,
        new_dir_no_slash,
        new_paths.len()
    );

    Ok(())
}

/// 在目录删除后，批量移除索引中指定前缀下的所有文件及其关联链接。
///
/// 时间复杂度 O(K)（K = 被删除目录内文件数），远优于全量重建 O(N)。
///
/// # 参数
/// - `vault_root`：仓库根目录
/// - `dir_prefix`：已删除目录的相对路径（如 `"old_folder"`）
///
/// # 副作用
/// - 持有 `INDEX_WRITE_LOCK` 期间阻塞其他索引写操作
/// - 删除 markdown_files 和 markdown_links 中该目录下所有记录
/// - 更新 manifest_fingerprint 元信息
pub fn remove_directory_from_index(vault_root: &Path, dir_prefix: &str) -> Result<(), String> {
    let _guard = index_write_lock()
        .lock()
        .map_err(|error| format!("索引写锁获取失败: {error}"))?;

    let mut connection = ensure_index_ready_for_incremental(vault_root)?;

    let dir_pattern = if dir_prefix.ends_with('/') {
        format!("{}%", dir_prefix)
    } else {
        format!("{}/%", dir_prefix)
    };

    let transaction = connection
        .transaction()
        .map_err(|error| format!("开始目录删除索引事务失败: {error}"))?;

    let links_removed = transaction
        .execute(
            "DELETE FROM markdown_links WHERE source_path LIKE ?1 OR target_path LIKE ?1",
            params![&dir_pattern],
        )
        .map_err(|e| format!("批量删除目录关联边索引失败: {e}"))?;

    let files_removed = transaction
        .execute(
            "DELETE FROM markdown_files WHERE relative_path LIKE ?1",
            params![&dir_pattern],
        )
        .map_err(|e| format!("批量删除目录文件索引失败: {e}"))?;

    transaction
        .commit()
        .map_err(|error| format!("提交目录删除索引事务失败: {error}"))?;

    refresh_manifest_meta(&connection, vault_root)?;
    log::info!(
        "[query-index] remove directory success: prefix={} files={} links={}",
        dir_prefix,
        files_removed,
        links_removed
    );

    Ok(())
}
