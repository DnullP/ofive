//! # Project Reader App Service
//!
//! 外部项目只读阅读器的应用服务：记录项目根目录、维护 SQLite 文件索引，
//! 并用 Tree-sitter 建立轻量级符号索引。

use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tree_sitter::{Language, Node, Parser, Point};

use crate::app::app_storage::storage_registry_facade;
use crate::infra::fs::fs_helpers::collect_markdown_relative_paths;
use crate::shared::project_reader_contracts::{
    ProjectReaderCodeReference, ProjectReaderCodeReferenceResponse, ProjectReaderFileResponse,
    ProjectReaderLinkTarget, ProjectReaderProject, ProjectReaderProjectListResponse,
    ProjectReaderSymbolLocation, ProjectReaderSymbolResolveContext,
    ProjectReaderSymbolResolveResponse, ProjectReaderTreeEntry, ProjectReaderTreeResponse,
};

const MODULE_ID: &str = "project-reader";
const STORAGE_OWNER: &str = "project-reader";
const REGISTRY_STATE_KEY: &str = "projects";
const INDEX_DB_FILE: &str = "project-index.sqlite";
const MAX_INDEXED_ENTRIES: usize = 50_000;
const MAX_INDEXED_SYMBOLS: usize = 200_000;
const MAX_READ_FILE_BYTES: u64 = 4 * 1024 * 1024;
const MAX_PARSE_FILE_BYTES: u64 = 512 * 1024;
const MAX_SYMBOL_LOCATIONS: usize = 80;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectReaderRegistryState {
    projects: Vec<ProjectReaderProject>,
}

#[derive(Debug, Clone)]
struct IndexedProjectEntry {
    relative_path: String,
    is_dir: bool,
    size_bytes: Option<i64>,
    modified_at_unix_ms: Option<i64>,
    extension: Option<String>,
    language: Option<String>,
}

#[derive(Debug, Clone)]
struct ProjectSymbolIndexEntry {
    name: String,
    kind: String,
    language: String,
    relative_path: String,
    line_number: usize,
    column_number: usize,
    end_line_number: usize,
    end_column_number: usize,
    preview: String,
}

/// 列出已导入的外部项目。
pub(crate) fn list_projects() -> Result<ProjectReaderProjectListResponse, String> {
    let mut state = load_registry_state()?;
    state
        .projects
        .sort_by(|left, right| left.name.to_lowercase().cmp(&right.name.to_lowercase()));
    Ok(ProjectReaderProjectListResponse {
        projects: state.projects,
    })
}

/// 添加外部项目并重建基础文件索引与 Tree-sitter 符号索引。
pub(crate) fn add_project(root_path: String) -> Result<ProjectReaderProject, String> {
    let canonical_root = canonicalize_existing_directory(&root_path)?;
    let root_path_string = canonical_root.to_string_lossy().to_string();
    let mut state = load_registry_state()?;

    if let Some(existing) = state
        .projects
        .iter()
        .find(|project| project.root_path == root_path_string)
        .cloned()
    {
        rebuild_file_index(&existing)?;
        return Ok(existing);
    }

    let now = current_time_millis();
    let base_name = canonical_root
        .file_name()
        .and_then(|name| name.to_str())
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .unwrap_or("project")
        .to_string();
    let name = resolve_unique_project_name(&state.projects, &base_name);
    let id = build_project_id(&name, &root_path_string);

    let project = ProjectReaderProject {
        id,
        name,
        root_path: root_path_string,
        created_at_unix_ms: now,
        updated_at_unix_ms: now,
    };

    rebuild_file_index(&project)?;
    state.projects.push(project.clone());
    save_registry_state(&state)?;

    Ok(project)
}

/// 获取指定外部项目的文件树索引。
pub(crate) fn get_project_tree(project_id: String) -> Result<ProjectReaderTreeResponse, String> {
    let project = require_project(&project_id)?;
    ensure_index_schema(&open_index_connection()?)?;

    let mut entries = load_tree_entries_from_index(&project.id)?;
    if entries.is_empty() {
        rebuild_file_index(&project)?;
        entries = load_tree_entries_from_index(&project.id)?;
    }

    Ok(ProjectReaderTreeResponse {
        project_id: project.id,
        root_path: project.root_path,
        entries,
    })
}

/// 读取外部项目中的文本文件。该接口只读，不提供任何写入能力。
pub(crate) fn read_project_file(
    project_id: String,
    relative_path: String,
) -> Result<ProjectReaderFileResponse, String> {
    let project = require_project(&project_id)?;
    let normalized_relative_path = normalize_relative_project_path(&relative_path)?;
    let path = resolve_project_file_path(&project, &normalized_relative_path)?;
    let metadata = fs::metadata(&path).map_err(|error| {
        format!(
            "读取外部项目文件元数据失败 project_id={} relative_path={}: {error}",
            project.id, normalized_relative_path
        )
    })?;

    if metadata.is_dir() {
        return Err(format!(
            "外部项目路径是目录，不能作为文件读取: {normalized_relative_path}"
        ));
    }

    if metadata.len() > MAX_READ_FILE_BYTES {
        return Err(format!(
            "外部项目文件过大，已拒绝读取 relative_path={} size={} limit={}",
            normalized_relative_path,
            metadata.len(),
            MAX_READ_FILE_BYTES
        ));
    }

    let content = fs::read_to_string(&path).map_err(|error| {
        format!(
            "读取外部项目文本文件失败 project_id={} relative_path={}: {error}",
            project.id, normalized_relative_path
        )
    })?;

    Ok(ProjectReaderFileResponse {
        project_id: project.id,
        relative_path: normalized_relative_path.clone(),
        content,
        language: detect_language_from_path(&normalized_relative_path),
        size_bytes: i64::try_from(metadata.len()).unwrap_or(i64::MAX),
        modified_at_unix_ms: metadata.modified().ok().and_then(system_time_to_millis),
    })
}

/// 从 Tree-sitter 符号索引中解析候选定义/实现位置。
pub(crate) fn resolve_symbol(
    project_id: String,
    symbol: String,
    context: Option<ProjectReaderSymbolResolveContext>,
) -> Result<ProjectReaderSymbolResolveResponse, String> {
    let project = require_project(&project_id)?;
    let normalized_symbol = normalize_symbol_name(&symbol)?;
    let mut locations = load_symbol_locations_from_index(&project.id, &normalized_symbol)?;

    if locations.is_empty() {
        rebuild_file_index(&project)?;
        locations = load_symbol_locations_from_index(&project.id, &normalized_symbol)?;
    }
    rank_symbol_locations(&mut locations, context.as_ref());

    Ok(ProjectReaderSymbolResolveResponse {
        project_id: project.id,
        symbol: normalized_symbol,
        locations,
    })
}

/// 查询当前 vault 中引用了指定外部项目源码片段的笔记位置。
pub(crate) fn get_code_references(
    project_id: String,
    vault_root: PathBuf,
) -> Result<ProjectReaderCodeReferenceResponse, String> {
    let project = require_project(&project_id)?;
    let references = collect_code_references(&project, &vault_root)?;

    Ok(ProjectReaderCodeReferenceResponse {
        project_id: project.id,
        references,
    })
}

fn load_registry_state() -> Result<ProjectReaderRegistryState, String> {
    storage_registry_facade::load_app_storage_state::<ProjectReaderRegistryState>(
        MODULE_ID,
        STORAGE_OWNER,
        REGISTRY_STATE_KEY,
    )
    .map(|state| state.unwrap_or_default())
}

fn save_registry_state(state: &ProjectReaderRegistryState) -> Result<(), String> {
    storage_registry_facade::save_app_storage_state(
        MODULE_ID,
        STORAGE_OWNER,
        REGISTRY_STATE_KEY,
        state,
    )
}

fn require_project(project_id: &str) -> Result<ProjectReaderProject, String> {
    let state = load_registry_state()?;
    state
        .projects
        .into_iter()
        .find(|project| project.id == project_id)
        .ok_or_else(|| format!("未找到外部项目: {project_id}"))
}

fn canonicalize_existing_directory(path: &str) -> Result<PathBuf, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("外部项目路径不能为空".to_string());
    }

    let canonical = fs::canonicalize(trimmed)
        .map_err(|error| format!("外部项目路径不可访问 path={trimmed}: {error}"))?;
    let metadata = fs::metadata(&canonical).map_err(|error| {
        format!(
            "读取外部项目路径元数据失败 path={}: {error}",
            canonical.display()
        )
    })?;
    if !metadata.is_dir() {
        return Err(format!("外部项目路径不是目录: {}", canonical.display()));
    }
    Ok(canonical)
}

fn resolve_unique_project_name(projects: &[ProjectReaderProject], base_name: &str) -> String {
    if !projects.iter().any(|project| project.name == base_name) {
        return base_name.to_string();
    }

    for index in 2..=999 {
        let candidate = format!("{base_name}-{index}");
        if !projects.iter().any(|project| project.name == candidate) {
            return candidate;
        }
    }

    format!("{base_name}-{}", current_time_millis())
}

fn build_project_id(name: &str, root_path: &str) -> String {
    let mut hasher = DefaultHasher::new();
    root_path.hash(&mut hasher);
    let hash = hasher.finish();
    format!("{}-{hash:016x}", slugify_project_name(name))
}

fn slugify_project_name(name: &str) -> String {
    let slug = name
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect::<String>()
        .split('-')
        .filter(|segment| !segment.is_empty())
        .collect::<Vec<_>>()
        .join("-");

    if slug.is_empty() {
        "project".to_string()
    } else {
        slug
    }
}

fn open_index_connection() -> Result<Connection, String> {
    let owner_dir =
        storage_registry_facade::resolve_app_storage_owner_dir(MODULE_ID, STORAGE_OWNER)?;
    let db_path = owner_dir.join(INDEX_DB_FILE);
    Connection::open(&db_path).map_err(|error| {
        format!(
            "打开外部项目索引数据库失败 path={}: {error}",
            db_path.display()
        )
    })
}

fn ensure_index_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS project_files (
            project_id TEXT NOT NULL,
            relative_path TEXT NOT NULL,
            is_dir INTEGER NOT NULL,
            size_bytes INTEGER,
            modified_at_unix_ms INTEGER,
            extension TEXT,
            language TEXT,
            PRIMARY KEY (project_id, relative_path)
        );

        CREATE INDEX IF NOT EXISTS idx_project_files_project_kind
            ON project_files(project_id, is_dir, language);

        CREATE TABLE IF NOT EXISTS project_symbols (
            project_id TEXT NOT NULL,
            name TEXT NOT NULL,
            kind TEXT NOT NULL,
            language TEXT NOT NULL,
            relative_path TEXT NOT NULL,
            line_number INTEGER NOT NULL,
            column_number INTEGER NOT NULL,
            end_line_number INTEGER NOT NULL,
            end_column_number INTEGER NOT NULL,
            preview TEXT NOT NULL,
            PRIMARY KEY (
                project_id,
                name,
                kind,
                language,
                relative_path,
                line_number,
                column_number
            )
        );

        CREATE INDEX IF NOT EXISTS idx_project_symbols_lookup
            ON project_symbols(project_id, name, kind);
        "#,
    )
    .map_err(|error| format!("初始化外部项目索引数据库失败: {error}"))
}

fn rebuild_file_index(project: &ProjectReaderProject) -> Result<(), String> {
    let root = canonicalize_existing_directory(&project.root_path)?;
    let mut entries = Vec::new();
    collect_project_entries(&root, &root, &mut entries)?;
    let symbols = collect_project_symbols(&project.id, &root, &entries)?;

    let mut conn = open_index_connection()?;
    ensure_index_schema(&conn)?;
    let tx = conn
        .transaction()
        .map_err(|error| format!("开启外部项目索引事务失败: {error}"))?;
    tx.execute(
        "DELETE FROM project_files WHERE project_id = ?1",
        params![project.id],
    )
    .map_err(|error| {
        format!(
            "清理外部项目旧文件索引失败 project_id={}: {error}",
            project.id
        )
    })?;
    tx.execute(
        "DELETE FROM project_symbols WHERE project_id = ?1",
        params![project.id],
    )
    .map_err(|error| {
        format!(
            "清理外部项目旧符号索引失败 project_id={}: {error}",
            project.id
        )
    })?;

    {
        let mut file_stmt = tx
            .prepare(
                r#"
                INSERT INTO project_files (
                    project_id,
                    relative_path,
                    is_dir,
                    size_bytes,
                    modified_at_unix_ms,
                    extension,
                    language
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                "#,
            )
            .map_err(|error| format!("准备写入外部项目文件索引失败: {error}"))?;

        for entry in &entries {
            file_stmt
                .execute(params![
                    project.id,
                    entry.relative_path,
                    if entry.is_dir { 1 } else { 0 },
                    entry.size_bytes,
                    entry.modified_at_unix_ms,
                    entry.extension,
                    entry.language,
                ])
                .map_err(|error| {
                    format!(
                        "写入外部项目文件索引失败 project_id={}: {error}",
                        project.id
                    )
                })?;
        }
    }

    {
        let mut symbol_stmt = tx
            .prepare(
                r#"
                INSERT INTO project_symbols (
                    project_id,
                    name,
                    kind,
                    language,
                    relative_path,
                    line_number,
                    column_number,
                    end_line_number,
                    end_column_number,
                    preview
                ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
                "#,
            )
            .map_err(|error| format!("准备写入外部项目符号索引失败: {error}"))?;

        for symbol in &symbols {
            symbol_stmt
                .execute(params![
                    project.id,
                    symbol.name,
                    symbol.kind,
                    symbol.language,
                    symbol.relative_path,
                    symbol.line_number as i64,
                    symbol.column_number as i64,
                    symbol.end_line_number as i64,
                    symbol.end_column_number as i64,
                    symbol.preview,
                ])
                .map_err(|error| {
                    format!(
                        "写入外部项目符号索引失败 project_id={}: {error}",
                        project.id
                    )
                })?;
        }
    }

    tx.commit()
        .map_err(|error| format!("提交外部项目索引事务失败: {error}"))
}

fn collect_project_entries(
    root: &Path,
    current: &Path,
    entries: &mut Vec<IndexedProjectEntry>,
) -> Result<(), String> {
    if entries.len() >= MAX_INDEXED_ENTRIES {
        return Err(format!(
            "外部项目索引项超过上限 limit={} root={}",
            MAX_INDEXED_ENTRIES,
            root.display()
        ));
    }

    let read_dir = fs::read_dir(current)
        .map_err(|error| format!("读取外部项目目录失败 path={}: {error}", current.display()))?;

    for entry in read_dir {
        let entry = match entry {
            Ok(entry) => entry,
            Err(error) => {
                log::warn!("[project-reader] skip unreadable directory entry: {error}");
                continue;
            }
        };
        let file_type = match entry.file_type() {
            Ok(file_type) => file_type,
            Err(error) => {
                log::warn!("[project-reader] skip entry with unreadable file type: {error}");
                continue;
            }
        };

        if file_type.is_symlink() {
            continue;
        }

        let path = entry.path();
        let file_name = entry.file_name();
        let file_name = file_name.to_string_lossy();
        let is_dir = file_type.is_dir();

        if is_dir && should_skip_directory_name(&file_name) {
            continue;
        }

        let relative_path = path
            .strip_prefix(root)
            .map_err(|error| {
                format!(
                    "计算外部项目相对路径失败 root={} path={}: {error}",
                    root.display(),
                    path.display()
                )
            })?
            .to_string_lossy()
            .replace('\\', "/");

        if relative_path.is_empty() {
            continue;
        }

        let metadata = match entry.metadata() {
            Ok(metadata) => metadata,
            Err(error) => {
                log::warn!(
                    "[project-reader] skip entry with unreadable metadata path={} error={}",
                    path.display(),
                    error
                );
                continue;
            }
        };
        let extension = extension_from_path(&relative_path);
        let language = if is_dir {
            None
        } else {
            detect_language_from_path(&relative_path)
        };

        entries.push(IndexedProjectEntry {
            relative_path,
            is_dir,
            size_bytes: if is_dir {
                None
            } else {
                Some(i64::try_from(metadata.len()).unwrap_or(i64::MAX))
            },
            modified_at_unix_ms: metadata.modified().ok().and_then(system_time_to_millis),
            extension,
            language,
        });

        if is_dir {
            collect_project_entries(root, &path, entries)?;
        }
    }

    Ok(())
}

fn collect_project_symbols(
    project_id: &str,
    root: &Path,
    entries: &[IndexedProjectEntry],
) -> Result<Vec<ProjectSymbolIndexEntry>, String> {
    let mut symbols = Vec::new();

    for entry in entries {
        if symbols.len() >= MAX_INDEXED_SYMBOLS {
            return Err(format!(
                "外部项目符号索引超过上限 project_id={} limit={}",
                project_id, MAX_INDEXED_SYMBOLS
            ));
        }

        if entry.is_dir || entry.size_bytes.unwrap_or(0) > MAX_PARSE_FILE_BYTES as i64 {
            continue;
        }

        let language = match entry.language.as_deref() {
            Some(language)
                if tree_sitter_language_for_entry(language, &entry.relative_path).is_some() =>
            {
                language
            }
            _ => continue,
        };

        let path = root.join(&entry.relative_path);
        let content = match fs::read_to_string(&path) {
            Ok(content) => content,
            Err(error) => {
                log::warn!(
                    "[project-reader] skip symbol parse for unreadable file path={} error={}",
                    path.display(),
                    error
                );
                continue;
            }
        };

        match parse_symbols_from_source(project_id, &entry.relative_path, language, &content) {
            Ok(mut parsed_symbols) => symbols.append(&mut parsed_symbols),
            Err(error) => {
                log::warn!(
                    "[project-reader] skip symbol parse project_id={} path={} error={}",
                    project_id,
                    entry.relative_path,
                    error
                );
            }
        }
    }

    Ok(symbols)
}

fn parse_symbols_from_source(
    project_id: &str,
    relative_path: &str,
    language: &str,
    source: &str,
) -> Result<Vec<ProjectSymbolIndexEntry>, String> {
    let tree_sitter_language = tree_sitter_language_for_entry(language, relative_path)
        .ok_or_else(|| format!("不支持 Tree-sitter 解析的语言: {language}"))?;
    let mut parser = Parser::new();
    parser
        .set_language(&tree_sitter_language)
        .map_err(|error| format!("加载 Tree-sitter grammar 失败 language={language}: {error}"))?;
    let tree = parser
        .parse(source, None)
        .ok_or_else(|| format!("Tree-sitter 解析失败 language={language} path={relative_path}"))?;
    let mut symbols = Vec::new();

    visit_symbol_nodes(
        tree.root_node(),
        project_id,
        relative_path,
        language,
        source,
        &mut symbols,
    );

    Ok(symbols)
}

fn visit_symbol_nodes(
    node: Node<'_>,
    project_id: &str,
    relative_path: &str,
    language: &str,
    source: &str,
    symbols: &mut Vec<ProjectSymbolIndexEntry>,
) {
    match language {
        "typescript" | "javascript" => {
            collect_ecmascript_symbol(node, project_id, relative_path, language, source, symbols)
        }
        "rust" => collect_rust_symbol(node, project_id, relative_path, language, source, symbols),
        "go" => collect_go_symbol(node, project_id, relative_path, language, source, symbols),
        "python" => {
            collect_python_symbol(node, project_id, relative_path, language, source, symbols)
        }
        _ => {}
    }

    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        visit_symbol_nodes(child, project_id, relative_path, language, source, symbols);
    }
}

fn collect_ecmascript_symbol(
    node: Node<'_>,
    project_id: &str,
    relative_path: &str,
    language: &str,
    source: &str,
    symbols: &mut Vec<ProjectSymbolIndexEntry>,
) {
    let kind = match node.kind() {
        "class_declaration" => Some("class"),
        "function_declaration" | "generator_function_declaration" => Some("function"),
        "interface_declaration" => Some("interface"),
        "type_alias_declaration" => Some("type"),
        "enum_declaration" => Some("enum"),
        "method_definition" => Some("method"),
        "variable_declarator" => Some("variable"),
        _ => None,
    };

    if let Some(kind) = kind {
        if let Some(name_node) = node.child_by_field_name("name") {
            push_symbol_from_name_node(
                symbols,
                project_id,
                relative_path,
                language,
                kind,
                name_node,
                node,
                source,
            );
        }
    }

    if matches!(node.kind(), "class_declaration" | "class") {
        for implemented_symbol in collect_ecmascript_implemented_symbols(node, source) {
            push_symbol_from_name(
                symbols,
                project_id,
                relative_path,
                language,
                "implementation",
                &implemented_symbol,
                node,
                source,
            );
        }
    }
}

fn collect_ecmascript_implemented_symbols(node: Node<'_>, source: &str) -> Vec<String> {
    let Some(implements_clause) = find_first_descendant_kind(node, "implements_clause") else {
        return Vec::new();
    };

    let mut names = Vec::new();
    collect_identifier_descendants(implements_clause, source, &mut names);
    names
}

fn collect_rust_symbol(
    node: Node<'_>,
    project_id: &str,
    relative_path: &str,
    language: &str,
    source: &str,
    symbols: &mut Vec<ProjectSymbolIndexEntry>,
) {
    let kind = match node.kind() {
        "function_item" => Some("function"),
        "struct_item" => Some("struct"),
        "enum_item" => Some("enum"),
        "trait_item" => Some("trait"),
        "type_item" => Some("type"),
        "const_item" => Some("const"),
        "static_item" => Some("static"),
        "mod_item" => Some("module"),
        _ => None,
    };

    if let Some(kind) = kind {
        if let Some(name_node) = node.child_by_field_name("name") {
            push_symbol_from_name_node(
                symbols,
                project_id,
                relative_path,
                language,
                kind,
                name_node,
                node,
                source,
            );
        }
    }

    if node.kind() == "impl_item" {
        if let Some(trait_node) = node.child_by_field_name("trait") {
            if let Some(name) = node_text(trait_node, source).and_then(last_identifier_segment) {
                push_symbol_from_name(
                    symbols,
                    project_id,
                    relative_path,
                    language,
                    "implementation",
                    &name,
                    node,
                    source,
                );
            }
        }
    }
}

fn collect_go_symbol(
    node: Node<'_>,
    project_id: &str,
    relative_path: &str,
    language: &str,
    source: &str,
    symbols: &mut Vec<ProjectSymbolIndexEntry>,
) {
    let kind = match node.kind() {
        "function_declaration" => Some("function"),
        "method_declaration" => Some("method"),
        "type_spec" => Some("type"),
        "const_spec" => Some("const"),
        "var_spec" => Some("variable"),
        _ => None,
    };

    if let Some(kind) = kind {
        if let Some(name_node) = node.child_by_field_name("name") {
            push_symbol_from_name_node(
                symbols,
                project_id,
                relative_path,
                language,
                kind,
                name_node,
                node,
                source,
            );
        }
    }
}

fn collect_python_symbol(
    node: Node<'_>,
    project_id: &str,
    relative_path: &str,
    language: &str,
    source: &str,
    symbols: &mut Vec<ProjectSymbolIndexEntry>,
) {
    let kind = match node.kind() {
        "function_definition" => Some("function"),
        "class_definition" => Some("class"),
        _ => None,
    };

    if let Some(kind) = kind {
        if let Some(name_node) = node.child_by_field_name("name") {
            push_symbol_from_name_node(
                symbols,
                project_id,
                relative_path,
                language,
                kind,
                name_node,
                node,
                source,
            );
        }
    }
}

fn push_symbol_from_name_node(
    symbols: &mut Vec<ProjectSymbolIndexEntry>,
    project_id: &str,
    relative_path: &str,
    language: &str,
    kind: &str,
    name_node: Node<'_>,
    preview_node: Node<'_>,
    source: &str,
) {
    if let Some(name) = node_text(name_node, source).and_then(normalize_indexed_symbol_name) {
        push_symbol_from_name(
            symbols,
            project_id,
            relative_path,
            language,
            kind,
            &name,
            preview_node,
            source,
        );
    }
}

fn push_symbol_from_name(
    symbols: &mut Vec<ProjectSymbolIndexEntry>,
    _project_id: &str,
    relative_path: &str,
    language: &str,
    kind: &str,
    name: &str,
    preview_node: Node<'_>,
    source: &str,
) {
    let start = preview_node.start_position();
    let end = preview_node.end_position();
    let preview = preview_line(source, start.row);
    if name.is_empty() || preview.is_empty() {
        return;
    }

    symbols.push(ProjectSymbolIndexEntry {
        name: name.to_string(),
        kind: kind.to_string(),
        language: language.to_string(),
        relative_path: relative_path.to_string(),
        line_number: start.row + 1,
        column_number: start.column + 1,
        end_line_number: end.row + 1,
        end_column_number: end.column + 1,
        preview,
    });
}

fn load_tree_entries_from_index(project_id: &str) -> Result<Vec<ProjectReaderTreeEntry>, String> {
    let conn = open_index_connection()?;
    ensure_index_schema(&conn)?;
    let mut stmt = conn
        .prepare(
            r#"
            SELECT relative_path, is_dir, size_bytes, modified_at_unix_ms, language
            FROM project_files
            WHERE project_id = ?1
            ORDER BY relative_path COLLATE NOCASE ASC
            "#,
        )
        .map_err(|error| format!("准备读取外部项目文件树失败: {error}"))?;

    let rows = stmt
        .query_map(params![project_id], |row| {
            Ok(ProjectReaderTreeEntry {
                relative_path: row.get(0)?,
                is_dir: row.get::<_, i64>(1)? != 0,
                size_bytes: row.get(2)?,
                modified_at_unix_ms: row.get(3)?,
                language: row.get(4)?,
            })
        })
        .map_err(|error| format!("读取外部项目文件树失败 project_id={project_id}: {error}"))?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("解析外部项目文件树失败 project_id={project_id}: {error}"))
}

fn load_symbol_locations_from_index(
    project_id: &str,
    symbol: &str,
) -> Result<Vec<ProjectReaderSymbolLocation>, String> {
    let conn = open_index_connection()?;
    ensure_index_schema(&conn)?;
    let mut stmt = conn
        .prepare(
            r#"
            SELECT
                relative_path,
                line_number,
                column_number,
                name,
                kind,
                preview,
                end_line_number,
                end_column_number
            FROM project_symbols
            WHERE project_id = ?1 AND name = ?2
            ORDER BY
                CASE kind WHEN 'implementation' THEN 1 ELSE 0 END,
                relative_path COLLATE NOCASE ASC,
                line_number ASC,
                column_number ASC
            LIMIT ?3
            "#,
        )
        .map_err(|error| format!("准备读取外部项目符号索引失败: {error}"))?;

    let rows = stmt
        .query_map(
            params![project_id, symbol, MAX_SYMBOL_LOCATIONS as i64],
            |row| {
                Ok(ProjectReaderSymbolLocation {
                    project_id: project_id.to_string(),
                    relative_path: row.get(0)?,
                    line_number: row.get::<_, i64>(1)? as usize,
                    column_number: row.get::<_, i64>(2)? as usize,
                    end_line_number: row.get::<_, i64>(6)? as usize,
                    end_column_number: row.get::<_, i64>(7)? as usize,
                    symbol_name: row.get(3)?,
                    kind: row.get(4)?,
                    preview: row.get(5)?,
                })
            },
        )
        .map_err(|error| format!("读取外部项目符号索引失败 project_id={project_id}: {error}"))?;

    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("解析外部项目符号索引失败 project_id={project_id}: {error}"))
}

fn rank_symbol_locations(
    locations: &mut Vec<ProjectReaderSymbolLocation>,
    context: Option<&ProjectReaderSymbolResolveContext>,
) {
    let current_file_path = context
        .and_then(|context| context.current_file_path.as_deref())
        .and_then(|path| normalize_relative_project_path(path).ok());
    let current_line_number = context.and_then(|context| context.current_line_number);
    let qualifier = resolve_qualified_symbol_prefix(context);
    let symbol_context = resolve_symbol_context_for_current_position(context);

    if let (Some(current_file_path), Some(qualifier)) =
        (current_file_path.as_deref(), qualifier.as_deref())
    {
        if let Some(package_segment) =
            resolve_go_imported_package_segment(current_file_path, qualifier)
        {
            let qualified_locations = locations
                .iter()
                .filter(|location| is_location_in_package_segment(location, &package_segment))
                .cloned()
                .collect::<Vec<_>>();
            if !qualified_locations.is_empty() {
                *locations = qualified_locations;
            }
        }
    }

    if let Some(symbol_context) = symbol_context.as_ref() {
        let semantic_locations = locations
            .iter()
            .filter(|location| matches_symbol_kind_for_go_context(location, symbol_context))
            .cloned()
            .collect::<Vec<_>>();
        if !semantic_locations.is_empty() {
            *locations = semantic_locations;
        }
    }

    if let Some(current_file_path) = current_file_path.as_deref() {
        let same_file_locations = locations
            .iter()
            .filter(|location| location.relative_path == current_file_path)
            .cloned()
            .collect::<Vec<_>>();
        if !same_file_locations.is_empty() {
            *locations = same_file_locations;
        }
    }

    locations.sort_by(|left, right| {
        symbol_location_rank(left, current_file_path.as_deref(), current_line_number)
            .cmp(&symbol_location_rank(
                right,
                current_file_path.as_deref(),
                current_line_number,
            ))
            .then_with(|| left.relative_path.cmp(&right.relative_path))
            .then_with(|| left.line_number.cmp(&right.line_number))
            .then_with(|| left.column_number.cmp(&right.column_number))
    });
}

fn symbol_location_rank(
    location: &ProjectReaderSymbolLocation,
    current_file_path: Option<&str>,
    current_line_number: Option<usize>,
) -> (usize, usize, usize) {
    let same_file_penalty = match current_file_path {
        Some(current_file_path) if location.relative_path == current_file_path => 0,
        Some(_) => 1,
        None => 1,
    };
    let kind_penalty = match location.kind.as_str() {
        "implementation" => 1,
        _ => 0,
    };
    let line_distance = current_line_number
        .map(|line_number| location.line_number.abs_diff(line_number))
        .unwrap_or(usize::MAX);

    (same_file_penalty, kind_penalty, line_distance)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum GoSymbolContextKind {
    TypeReference,
    SelectorExpression,
}

fn resolve_symbol_context_for_current_position(
    context: Option<&ProjectReaderSymbolResolveContext>,
) -> Option<GoSymbolContextKind> {
    let context = context?;
    let file_content = context.current_file_content.as_deref()?;
    let file_path = context.current_file_path.as_deref()?;
    if !file_path.ends_with(".go") {
        return None;
    }

    let line_number = context.current_line_number?;
    let column_number = context.current_column_number?;
    let point = point_for_line_and_column(file_content, line_number, column_number)?;

    let mut parser = Parser::new();
    parser.set_language(&tree_sitter_go::LANGUAGE.into()).ok()?;
    let tree = parser.parse(file_content, None)?;
    let node = tree
        .root_node()
        .named_descendant_for_point_range(point, point)?;
    let mut current = Some(node);
    while let Some(node) = current {
        match node.kind() {
            "qualified_type" | "type_identifier" | "_type_identifier" => {
                return Some(GoSymbolContextKind::TypeReference);
            }
            "selector_expression" => {
                return Some(GoSymbolContextKind::SelectorExpression);
            }
            _ => {}
        }
        current = node.parent();
    }

    None
}

fn point_for_line_and_column(
    source: &str,
    line_number: usize,
    column_number: usize,
) -> Option<Point> {
    if line_number == 0 || column_number == 0 {
        return None;
    }

    let line_index = line_number.checked_sub(1)?;
    let column_index = column_number.checked_sub(1)?;
    let line = source.lines().nth(line_index)?;
    let column = line
        .char_indices()
        .nth(column_index)
        .map(|(byte_index, _)| byte_index)
        .unwrap_or_else(|| line.len());
    Some(Point {
        row: line_index,
        column,
    })
}

fn matches_symbol_kind_for_go_context(
    location: &ProjectReaderSymbolLocation,
    context_kind: &GoSymbolContextKind,
) -> bool {
    match context_kind {
        GoSymbolContextKind::TypeReference => {
            matches!(
                location.kind.as_str(),
                "type" | "struct" | "interface" | "enum" | "trait"
            )
        }
        GoSymbolContextKind::SelectorExpression => {
            matches!(location.kind.as_str(), "method" | "function")
        }
    }
}

fn resolve_qualified_symbol_prefix(
    context: Option<&ProjectReaderSymbolResolveContext>,
) -> Option<String> {
    let context = context?;
    let line_text = context.current_line_text.as_deref()?;
    let column_number = context.current_column_number?;
    let symbol_start = column_number.checked_sub(1)?;
    if symbol_start == 0 || symbol_start > line_text.chars().count() {
        return None;
    }

    let prefix = line_text.chars().take(symbol_start).collect::<String>();
    let prefix_before_symbol = prefix.trim_end();
    let qualifier_source = prefix_before_symbol.strip_suffix('.')?.trim_end();
    let mut reversed_qualifier = String::new();
    for character in qualifier_source.chars().rev() {
        if character.is_alphanumeric() || character == '_' || character == '$' {
            reversed_qualifier.push(character);
            continue;
        }
        break;
    }

    if reversed_qualifier.is_empty() {
        return None;
    }

    Some(reversed_qualifier.chars().rev().collect())
}

fn resolve_go_imported_package_segment(current_file_path: &str, qualifier: &str) -> Option<String> {
    let current_directory = current_file_path
        .rsplit_once('/')
        .map(|(directory, _)| directory)?;
    let qualifier_suffix = format!("/{qualifier}");
    let local_candidate = if current_directory == qualifier {
        Some(current_directory.to_string())
    } else if current_directory.ends_with(&qualifier_suffix) {
        Some(current_directory.to_string())
    } else {
        None
    };

    local_candidate.or_else(|| Some(qualifier.to_string()))
}

fn is_location_in_package_segment(
    location: &ProjectReaderSymbolLocation,
    package_segment: &str,
) -> bool {
    location.relative_path == format!("{package_segment}.go")
        || location
            .relative_path
            .starts_with(&format!("{package_segment}/"))
}

fn collect_code_references(
    project: &ProjectReaderProject,
    vault_root: &Path,
) -> Result<Vec<ProjectReaderCodeReference>, String> {
    let mut references = Vec::new();
    let mut markdown_paths = Vec::new();
    collect_markdown_relative_paths(vault_root, vault_root, &mut markdown_paths)?;

    for relative_path in markdown_paths {
        let content = match fs::read_to_string(vault_root.join(&relative_path)) {
            Ok(content) => content,
            Err(error) => {
                log::warn!(
                    "[project-reader] skip code reference scan for unreadable file path={} error={}",
                    relative_path,
                    error
                );
                continue;
            }
        };

        let excluded_ranges = detect_project_reader_markdown_excluded_byte_ranges(&content);
        collect_code_references_from_markdown(
            project,
            &relative_path,
            &content,
            &excluded_ranges,
            &mut references,
        )?;
    }

    references.sort_by(|left, right| {
        left.source_path
            .cmp(&right.source_path)
            .then_with(|| left.source_line_number.cmp(&right.source_line_number))
            .then_with(|| left.source_column_number.cmp(&right.source_column_number))
            .then_with(|| left.link_text.cmp(&right.link_text))
    });

    Ok(references)
}

fn collect_code_references_from_markdown(
    project: &ProjectReaderProject,
    source_path: &str,
    content: &str,
    excluded_ranges: &[ProjectReaderMarkdownExcludedByteRange],
    output: &mut Vec<ProjectReaderCodeReference>,
) -> Result<(), String> {
    let mut cursor = 0usize;

    while cursor < content.len() {
        let Some(start_offset) = content[cursor..].find("[[") else {
            break;
        };
        let match_start = cursor + start_offset;
        if is_project_reader_markdown_byte_offset_excluded(match_start, excluded_ranges) {
            cursor = match_start + 2;
            continue;
        }
        if match_start > 0 && content.as_bytes()[match_start - 1] == b'!' {
            cursor = match_start + 2;
            continue;
        }

        let content_start = match_start + 2;
        let Some(close_offset) = content[content_start..].find("]]") else {
            break;
        };
        let content_end = content_start + close_offset;
        let raw_target = &content[content_start..content_end];
        let target_text = raw_target.split('|').next().unwrap_or(raw_target).trim();
        let Some(target) = parse_project_reader_link_target(target_text) else {
            cursor = content_end + 2;
            continue;
        };

        if target.project_name != project.name && target.project_name != project.id {
            cursor = content_end + 2;
            continue;
        }

        let line_number = content[..match_start]
            .chars()
            .filter(|character| *character == '\n')
            .count()
            + 1;
        let line_start = content[..match_start]
            .rfind('\n')
            .map(|index| index + 1)
            .unwrap_or(0);
        let column_number = content[line_start..match_start].chars().count() + 1;
        let display_text = raw_target
            .split('|')
            .nth(1)
            .map(str::trim)
            .filter(|text| !text.is_empty());
        let link_text = display_text
            .map(ToString::to_string)
            .unwrap_or_else(|| target_text.to_string());

        output.push(ProjectReaderCodeReference {
            source_path: source_path.to_string(),
            title: source_path
                .split('/')
                .last()
                .unwrap_or(source_path)
                .to_string(),
            source_line_number: line_number,
            source_column_number: column_number,
            link_text,
            target,
        });

        cursor = content_end + 2;
    }

    Ok(())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct ProjectReaderMarkdownExcludedByteRange {
    start: usize,
    end: usize,
}

fn detect_project_reader_markdown_excluded_byte_ranges(
    content: &str,
) -> Vec<ProjectReaderMarkdownExcludedByteRange> {
    let mut ranges = Vec::new();
    let mut offset = 0usize;
    let mut line_index = 0usize;
    let mut frontmatter_open = false;
    let mut fence_start: Option<usize> = None;
    let mut fence_marker: Option<char> = None;

    for line_with_ending in content.split_inclusive('\n') {
        let line = line_with_ending
            .strip_suffix('\n')
            .unwrap_or(line_with_ending);
        let trimmed = line.trim_start();

        if line_index == 0 && line.trim() == "---" {
            frontmatter_open = true;
        } else if frontmatter_open {
            if line.trim() == "---" {
                ranges.push(ProjectReaderMarkdownExcludedByteRange {
                    start: 0,
                    end: offset + line_with_ending.len(),
                });
                frontmatter_open = false;
            }
        } else if let Some(start) = fence_start {
            if closes_project_reader_markdown_fence(trimmed, fence_marker) {
                ranges.push(ProjectReaderMarkdownExcludedByteRange {
                    start,
                    end: offset + line_with_ending.len(),
                });
                fence_start = None;
                fence_marker = None;
            }
        } else if let Some(marker) = opens_project_reader_markdown_fence(trimmed) {
            fence_start = Some(offset);
            fence_marker = Some(marker);
        }

        offset += line_with_ending.len();
        line_index += 1;
    }

    if frontmatter_open || fence_start.is_some() {
        ranges.retain(|range| range.end <= content.len());
    }

    ranges
}

fn opens_project_reader_markdown_fence(trimmed_line: &str) -> Option<char> {
    if trimmed_line.starts_with("```") {
        return Some('`');
    }
    if trimmed_line.starts_with("~~~") {
        return Some('~');
    }
    None
}

fn closes_project_reader_markdown_fence(trimmed_line: &str, marker: Option<char>) -> bool {
    match marker {
        Some('`') => trimmed_line.starts_with("```"),
        Some('~') => trimmed_line.starts_with("~~~"),
        _ => false,
    }
}

fn is_project_reader_markdown_byte_offset_excluded(
    offset: usize,
    ranges: &[ProjectReaderMarkdownExcludedByteRange],
) -> bool {
    ranges
        .iter()
        .any(|range| offset >= range.start && offset < range.end)
}

fn parse_project_reader_link_target(raw_target: &str) -> Option<ProjectReaderLinkTarget> {
    let normalized_target = raw_target.trim();
    let project_separator_index = normalized_target.find(':')?;
    if project_separator_index <= 0 {
        return None;
    }

    let project_name = normalized_target[..project_separator_index]
        .trim()
        .to_string();
    let raw_path_and_range = normalized_target[project_separator_index + 1..].trim();
    if project_name.is_empty() || !raw_path_and_range.starts_with('/') {
        return None;
    }

    let parsed = if let Ok(target) = parse_project_reader_link_target_impl(raw_path_and_range) {
        target
    } else {
        return None;
    };

    Some(ProjectReaderLinkTarget {
        project_name,
        relative_path: parsed.relative_path,
        line_number: parsed.line_number,
        column_number: parsed.column_number,
        end_line_number: parsed.end_line_number,
        end_column_number: parsed.end_column_number,
    })
}

#[derive(Debug, Clone)]
struct ParsedProjectReaderTarget {
    relative_path: String,
    line_number: Option<usize>,
    column_number: Option<usize>,
    end_line_number: Option<usize>,
    end_column_number: Option<usize>,
}

fn parse_project_reader_link_target_impl(
    raw_path_and_range: &str,
) -> Result<ParsedProjectReaderTarget, String> {
    let pattern = raw_path_and_range
        .trim()
        .strip_prefix('/')
        .ok_or_else(|| "project reader target path missing leading slash".to_string())?;
    let mut split_index = None;
    for (index, character) in pattern.char_indices() {
        if character == ':' {
            split_index = Some(index);
            break;
        }
    }

    let (relative_path, range_text) = match split_index {
        Some(index) => (&pattern[..index], Some(&pattern[index + 1..])),
        None => (pattern, None),
    };

    let normalized_relative_path = relative_path.trim_matches('/').to_string();
    if normalized_relative_path.is_empty() {
        return Err("project reader target path empty".to_string());
    }

    let parsed_range = range_text.and_then(parse_project_reader_link_target_range);
    Ok(ParsedProjectReaderTarget {
        relative_path: normalized_relative_path,
        line_number: parsed_range.as_ref().and_then(|range| range.line_number),
        column_number: parsed_range.as_ref().and_then(|range| range.column_number),
        end_line_number: parsed_range
            .as_ref()
            .and_then(|range| range.end_line_number),
        end_column_number: parsed_range
            .as_ref()
            .and_then(|range| range.end_column_number),
    })
}

#[derive(Debug, Clone)]
struct ParsedProjectReaderTargetRange {
    line_number: Option<usize>,
    column_number: Option<usize>,
    end_line_number: Option<usize>,
    end_column_number: Option<usize>,
}

fn parse_project_reader_link_target_range(
    range_text: &str,
) -> Option<ParsedProjectReaderTargetRange> {
    let trimmed = range_text.trim();
    if trimmed.is_empty() {
        return None;
    }

    let mut split_range = trimmed.splitn(2, '-');
    let start = split_range.next()?.trim();
    let end = split_range.next().map(str::trim);
    let mut start_parts = start.split(':');
    let line_number = start_parts.next()?.parse::<usize>().ok()?;
    let column_number = start_parts
        .next()
        .and_then(|value| value.parse::<usize>().ok());
    let (end_line_number, end_column_number) = match end {
        Some(end_text) if !end_text.is_empty() => {
            let mut end_parts = end_text.split(':');
            let line = end_parts.next()?.parse::<usize>().ok()?;
            let column = end_parts
                .next()
                .and_then(|value| value.parse::<usize>().ok());
            (Some(line), column)
        }
        _ => (None, None),
    };

    Some(ParsedProjectReaderTargetRange {
        line_number: Some(line_number),
        column_number,
        end_line_number,
        end_column_number,
    })
}

fn resolve_project_file_path(
    project: &ProjectReaderProject,
    relative_path: &str,
) -> Result<PathBuf, String> {
    let root = canonicalize_existing_directory(&project.root_path)?;
    let normalized_relative_path = normalize_relative_project_path(relative_path)?;
    let joined = root.join(&normalized_relative_path);
    let canonical = fs::canonicalize(&joined).map_err(|error| {
        format!(
            "外部项目文件不存在或不可访问 project_id={} relative_path={}: {error}",
            project.id, normalized_relative_path
        )
    })?;

    if !canonical.starts_with(&root) {
        return Err(format!(
            "外部项目路径越界 project_id={} relative_path={}",
            project.id, normalized_relative_path
        ));
    }

    Ok(canonical)
}

fn normalize_relative_project_path(relative_path: &str) -> Result<String, String> {
    let normalized = relative_path
        .replace('\\', "/")
        .trim()
        .trim_start_matches('/')
        .to_string();
    if normalized.is_empty() {
        return Err("外部项目相对路径不能为空".to_string());
    }
    if normalized
        .split('/')
        .any(|segment| segment.is_empty() || segment == "." || segment == "..")
    {
        return Err(format!("外部项目相对路径非法: {relative_path}"));
    }
    Ok(normalized)
}

fn normalize_symbol_name(symbol: &str) -> Result<String, String> {
    let normalized = symbol.trim();
    if normalized.is_empty() {
        return Err("符号名不能为空".to_string());
    }
    if normalized.len() > 128 {
        return Err("符号名过长".to_string());
    }
    if !normalized
        .chars()
        .all(|character| character.is_alphanumeric() || character == '_' || character == '$')
    {
        return Err(format!("符号名包含不支持字符: {normalized}"));
    }
    Ok(normalized.to_string())
}

fn tree_sitter_language_for_entry(language: &str, relative_path: &str) -> Option<Language> {
    match language {
        "rust" => Some(tree_sitter_rust::LANGUAGE.into()),
        "typescript" if relative_path.ends_with(".tsx") => {
            Some(tree_sitter_typescript::LANGUAGE_TSX.into())
        }
        "typescript" => Some(tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into()),
        "javascript" => Some(tree_sitter_javascript::LANGUAGE.into()),
        "go" => Some(tree_sitter_go::LANGUAGE.into()),
        "python" => Some(tree_sitter_python::LANGUAGE.into()),
        _ => None,
    }
}

fn find_first_descendant_kind<'a>(node: Node<'a>, kind: &str) -> Option<Node<'a>> {
    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        if child.kind() == kind {
            return Some(child);
        }
        if let Some(found) = find_first_descendant_kind(child, kind) {
            return Some(found);
        }
    }
    None
}

fn collect_identifier_descendants(node: Node<'_>, source: &str, names: &mut Vec<String>) {
    if matches!(
        node.kind(),
        "identifier" | "type_identifier" | "property_identifier" | "shorthand_property_identifier"
    ) {
        if let Some(name) = node_text(node, source).and_then(normalize_indexed_symbol_name) {
            names.push(name);
        }
    }

    let mut cursor = node.walk();
    for child in node.children(&mut cursor) {
        collect_identifier_descendants(child, source, names);
    }
}

fn node_text<'a>(node: Node<'_>, source: &'a str) -> Option<&'a str> {
    node.utf8_text(source.as_bytes()).ok()
}

fn normalize_indexed_symbol_name(raw_name: &str) -> Option<String> {
    let trimmed = raw_name.trim();
    if trimmed.is_empty() {
        return None;
    }

    let name = last_identifier_segment(trimmed)?;
    if name
        .chars()
        .all(|character| character.is_alphanumeric() || character == '_' || character == '$')
    {
        Some(name)
    } else {
        None
    }
}

fn last_identifier_segment(text: &str) -> Option<String> {
    text.split(|character: char| {
        !(character.is_alphanumeric() || character == '_' || character == '$')
    })
    .filter(|segment| !segment.is_empty())
    .last()
    .map(ToString::to_string)
}

fn preview_line(source: &str, zero_based_row: usize) -> String {
    source
        .lines()
        .nth(zero_based_row)
        .unwrap_or("")
        .trim()
        .chars()
        .take(220)
        .collect()
}

fn should_skip_directory_name(name: &str) -> bool {
    matches!(
        name,
        ".git"
            | ".hg"
            | ".svn"
            | "node_modules"
            | "target"
            | "dist"
            | "build"
            | ".next"
            | ".nuxt"
            | ".turbo"
            | ".cache"
            | "coverage"
            | "vendor"
            | ".venv"
            | "venv"
    )
}

fn extension_from_path(path: &str) -> Option<String> {
    Path::new(path)
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.to_ascii_lowercase())
}

fn detect_language_from_path(path: &str) -> Option<String> {
    let extension = extension_from_path(path)?;
    let language = match extension.as_str() {
        "rs" => "rust",
        "ts" | "tsx" => "typescript",
        "js" | "jsx" | "mjs" | "cjs" => "javascript",
        "json" => "json",
        "css" => "css",
        "html" | "htm" | "xml" | "svg" => "xml",
        "md" | "markdown" => "markdown",
        "yml" | "yaml" => "yaml",
        "go" => "go",
        "py" => "python",
        "java" => "java",
        "kt" | "kts" => "kotlin",
        "swift" => "swift",
        "c" | "h" => "c",
        "cc" | "cpp" | "cxx" | "hpp" | "hh" => "cpp",
        "cs" => "csharp",
        "php" => "php",
        "rb" => "ruby",
        "sh" | "bash" | "zsh" => "bash",
        "toml" => "toml",
        "sql" => "sql",
        "txt" => "plaintext",
        _ => return None,
    };
    Some(language.to_string())
}

fn current_time_millis() -> i64 {
    system_time_to_millis(SystemTime::now()).unwrap_or(0)
}

fn system_time_to_millis(time: SystemTime) -> Option<i64> {
    time.duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|duration| i64::try_from(duration.as_millis()).ok())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_project() -> ProjectReaderProject {
        ProjectReaderProject {
            id: "mock-ofive-project".to_string(),
            name: "mock-ofive".to_string(),
            root_path: "/tmp/mock-ofive".to_string(),
            created_at_unix_ms: 1,
            updated_at_unix_ms: 1,
        }
    }

    #[test]
    fn collect_code_references_from_markdown_should_find_project_wikilinks() {
        let content = [
            "# Note",
            "",
            "源码引用：[[mock-ofive:/src/main.ts:7:1-9:1|createMainRuntime]]",
            "忽略普通链接：[[Other]]",
            "忽略嵌入：![[mock-ofive:/src/ignored.ts:1]]",
            "```",
            "[[mock-ofive:/src/fenced.ts:1]]",
            "```",
        ]
        .join("\n");
        let excluded_ranges = detect_project_reader_markdown_excluded_byte_ranges(&content);
        let mut references = Vec::new();

        collect_code_references_from_markdown(
            &test_project(),
            "README.md",
            &content,
            &excluded_ranges,
            &mut references,
        )
        .expect("scan should succeed");

        assert_eq!(references.len(), 1);
        let reference = &references[0];
        assert_eq!(reference.source_path, "README.md");
        assert_eq!(reference.source_line_number, 3);
        assert_eq!(reference.link_text, "createMainRuntime");
        assert_eq!(reference.target.project_name, "mock-ofive");
        assert_eq!(reference.target.relative_path, "src/main.ts");
        assert_eq!(reference.target.line_number, Some(7));
        assert_eq!(reference.target.column_number, Some(1));
        assert_eq!(reference.target.end_line_number, Some(9));
        assert_eq!(reference.target.end_column_number, Some(1));
    }

    #[test]
    fn rank_symbol_locations_should_prefer_same_file_context_when_available() {
        let mut locations = vec![
            ProjectReaderSymbolLocation {
                project_id: "project".to_string(),
                relative_path: "src/alternate.ts".to_string(),
                line_number: 1,
                column_number: 18,
                end_line_number: 1,
                end_column_number: 28,
                symbol_name: "AppRuntime".to_string(),
                kind: "interface".to_string(),
                preview: "export interface AppRuntime {}".to_string(),
            },
            ProjectReaderSymbolLocation {
                project_id: "project".to_string(),
                relative_path: "src/main.ts".to_string(),
                line_number: 3,
                column_number: 18,
                end_line_number: 3,
                end_column_number: 28,
                symbol_name: "AppRuntime".to_string(),
                kind: "interface".to_string(),
                preview: "export interface AppRuntime {}".to_string(),
            },
        ];

        rank_symbol_locations(
            &mut locations,
            Some(&ProjectReaderSymbolResolveContext {
                current_file_path: Some("src/main.ts".to_string()),
                current_line_number: Some(7),
                current_column_number: Some(39),
                current_line_text: None,
                current_file_content: None,
            }),
        );

        assert_eq!(locations.len(), 1);
        assert_eq!(locations[0].relative_path, "src/main.ts");
    }

    #[test]
    fn rank_symbol_locations_should_filter_go_qualified_package_context() {
        let mut locations = vec![
            ProjectReaderSymbolLocation {
                project_id: "project".to_string(),
                relative_path: "artifact/service.go".to_string(),
                line_number: 25,
                column_number: 6,
                end_line_number: 35,
                end_column_number: 2,
                symbol_name: "Service".to_string(),
                kind: "type".to_string(),
                preview: "type Service interface {".to_string(),
            },
            ProjectReaderSymbolLocation {
                project_id: "project".to_string(),
                relative_path: "memory/service.go".to_string(),
                line_number: 28,
                column_number: 6,
                end_line_number: 38,
                end_column_number: 2,
                symbol_name: "Service".to_string(),
                kind: "type".to_string(),
                preview: "type Service interface {".to_string(),
            },
            ProjectReaderSymbolLocation {
                project_id: "project".to_string(),
                relative_path: "session/service.go".to_string(),
                line_number: 25,
                column_number: 6,
                end_line_number: 35,
                end_column_number: 2,
                symbol_name: "Service".to_string(),
                kind: "type".to_string(),
                preview: "type Service interface {".to_string(),
            },
        ];

        rank_symbol_locations(
            &mut locations,
            Some(&ProjectReaderSymbolResolveContext {
                current_file_path: Some("runner/runner.go".to_string()),
                current_line_number: Some(2),
                current_column_number: Some(23),
                current_line_text: Some("\tMemoryService memory.Service".to_string()),
                current_file_content: Some(
                    "type Config struct {\n\tMemoryService memory.Service\n}".to_string(),
                ),
            }),
        );

        assert_eq!(locations.len(), 1);
        assert_eq!(locations[0].relative_path, "memory/service.go");
    }

    #[test]
    fn rank_symbol_locations_should_filter_go_qualified_type_context() {
        let mut locations = vec![
            ProjectReaderSymbolLocation {
                project_id: "project".to_string(),
                relative_path: "agent/agent.go".to_string(),
                line_number: 43,
                column_number: 6,
                end_line_number: 54,
                end_column_number: 2,
                symbol_name: "Agent".to_string(),
                kind: "type".to_string(),
                preview: "type Agent interface {".to_string(),
            },
            ProjectReaderSymbolLocation {
                project_id: "project".to_string(),
                relative_path: "agent/agent.go".to_string(),
                line_number: 461,
                column_number: 6,
                end_line_number: 463,
                end_column_number: 2,
                symbol_name: "Agent".to_string(),
                kind: "method".to_string(),
                preview: "func (c *invocationContext) Agent() Agent {".to_string(),
            },
        ];

        rank_symbol_locations(
            &mut locations,
            Some(&ProjectReaderSymbolResolveContext {
                current_file_path: Some("runner/runner.go".to_string()),
                current_line_number: Some(2),
                current_column_number: Some(24),
                current_line_text: Some("\trootAgent       agent.Agent".to_string()),
                current_file_content: Some(
                    "type Runner struct {\n\trootAgent       agent.Agent\n}".to_string(),
                ),
            }),
        );

        assert_eq!(locations.len(), 1);
        assert_eq!(locations[0].kind, "type");
        assert_eq!(locations[0].line_number, 43);
    }

    #[test]
    fn tree_sitter_should_index_typescript_definitions_and_implementations() {
        let source = r#"
export interface Service {
  run(): void
}

export class Runtime implements Service {
  run(): void {}
}

export function createRuntime() {
  return new Runtime()
}
"#;

        let symbols = parse_symbols_from_source("project", "src/runtime.ts", "typescript", source)
            .expect("typescript symbols should parse");

        assert!(symbols
            .iter()
            .any(|symbol| symbol.name == "Service" && symbol.kind == "interface"));
        assert!(symbols
            .iter()
            .any(|symbol| symbol.name == "Runtime" && symbol.kind == "class"));
        assert!(symbols
            .iter()
            .any(|symbol| symbol.name == "Service" && symbol.kind == "implementation"));
        assert!(symbols
            .iter()
            .any(|symbol| symbol.name == "createRuntime" && symbol.kind == "function"));
    }

    #[test]
    fn tree_sitter_should_index_rust_definitions() {
        let source = r#"
pub trait Store {
    fn load(&self);
}

pub struct SqlStore;

impl Store for SqlStore {
    fn load(&self) {}
}
"#;

        let symbols = parse_symbols_from_source("project", "src/lib.rs", "rust", source)
            .expect("rust symbols should parse");

        assert!(symbols
            .iter()
            .any(|symbol| symbol.name == "Store" && symbol.kind == "trait"));
        assert!(symbols
            .iter()
            .any(|symbol| symbol.name == "SqlStore" && symbol.kind == "struct"));
        assert!(symbols
            .iter()
            .any(|symbol| symbol.name == "Store" && symbol.kind == "implementation"));
    }
}
