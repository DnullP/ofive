//! # Vault 查询应用服务
//!
//! 负责组织搜索、图谱、大纲、前链路解析与分词等只读查询用例，
//! 作为宿主命令层与底层查询模块之间的稳定编排边界。

use std::path::Path;

use tauri::State;

use crate::infra::query::{
    backlinks, frontmatter_query, graph, markdown_ast, outline, search, segment, task_query,
    wikilink,
};
use crate::shared::vault_contracts::{
    BacklinkItem, ChineseSegmentToken, FrontmatterQueryResponse, MarkdownAstNode, OutlineResponse,
    ReadMarkdownAstResponse, ResolveMediaEmbedTargetResponse, ResolveWikiLinkTargetResponse,
    VaultMarkdownGraphResponse, VaultQuickSwitchItem, VaultSearchMatchItem, VaultSearchScope,
    VaultTaskItem, WikiLinkSuggestionItem,
};
use crate::state::AppState;

/// 解析 WikiLink 目标。
pub(crate) fn resolve_wikilink_target(
    current_dir: String,
    target: String,
    state: State<'_, AppState>,
) -> Result<Option<ResolveWikiLinkTargetResponse>, String> {
    let vault_root = crate::state::get_vault_root(&state)?;
    wikilink::resolve_wikilink_target_in_root(&vault_root, current_dir, target)
}

/// 解析媒体嵌入目标。
pub(crate) fn resolve_media_embed_target(
    current_dir: String,
    target: String,
    state: State<'_, AppState>,
) -> Result<Option<ResolveMediaEmbedTargetResponse>, String> {
    let vault_root = crate::state::get_vault_root(&state)?;
    wikilink::resolve_media_embed_target_in_root(&vault_root, current_dir, target)
}

/// 搜索仓库 Markdown 文件。
pub(crate) fn search_vault_markdown_files(
    query: String,
    limit: Option<usize>,
    state: State<'_, AppState>,
) -> Result<Vec<VaultQuickSwitchItem>, String> {
    let vault_root = crate::state::get_vault_root(&state)?;
    search::search_vault_markdown_files_in_root(&vault_root, query, limit)
}

/// 搜索仓库 Markdown 内容。
pub(crate) fn search_vault_markdown(
    query: String,
    tag: Option<String>,
    scope: VaultSearchScope,
    limit: Option<usize>,
    state: State<'_, AppState>,
) -> Result<Vec<VaultSearchMatchItem>, String> {
    let vault_root = crate::state::get_vault_root(&state)?;
    search::search_vault_markdown_in_root(&vault_root, query, tag, scope, limit)
}

/// 查询仓库中的任务条目。
pub(crate) fn query_vault_tasks(state: State<'_, AppState>) -> Result<Vec<VaultTaskItem>, String> {
    let vault_root = crate::state::get_vault_root(&state)?;
    task_query::query_vault_tasks_in_root(&vault_root)
}

/// 获取当前仓库 Markdown 图谱。
pub(crate) fn get_current_vault_markdown_graph(
    state: State<'_, AppState>,
) -> Result<VaultMarkdownGraphResponse, String> {
    let vault_root = crate::state::get_vault_root(&state)?;
    graph::get_current_vault_markdown_graph_in_root(&vault_root)
}

/// 获取 Markdown AST。
pub(crate) fn get_vault_markdown_ast(
    relative_path: String,
    state: State<'_, AppState>,
) -> Result<ReadMarkdownAstResponse, String> {
    let vault_root = crate::state::get_vault_root(&state)?;
    markdown_ast::get_vault_markdown_ast_in_root(&vault_root, relative_path)
}

/// 中文分词。
pub(crate) fn segment_chinese_text(text: String) -> Result<Vec<ChineseSegmentToken>, String> {
    segment::segment_chinese_text(text)
}

/// 建议 WikiLink 目标。
pub(crate) fn suggest_wikilink_targets(
    query: String,
    limit: Option<usize>,
    state: State<'_, AppState>,
) -> Result<Vec<WikiLinkSuggestionItem>, String> {
    let vault_root = crate::state::get_vault_root(&state)?;
    search::suggest_wikilink_targets_in_root(&vault_root, query, limit)
}

/// 获取文件反向链接。
pub(crate) fn get_backlinks_for_file(
    relative_path: String,
    state: State<'_, AppState>,
) -> Result<Vec<BacklinkItem>, String> {
    let vault_root = crate::state::get_vault_root(&state)?;
    backlinks::get_backlinks_for_file_in_root(&vault_root, &relative_path)
}

/// 获取 Markdown 大纲。
pub(crate) fn get_vault_markdown_outline(
    relative_path: String,
    state: State<'_, AppState>,
) -> Result<OutlineResponse, String> {
    let vault_root = crate::state::get_vault_root(&state)?;
    outline::get_vault_markdown_outline_in_root(&vault_root, relative_path)
}

/// 查询 frontmatter。
pub(crate) fn query_vault_markdown_frontmatter(
    field_name: String,
    field_value: Option<String>,
    state: State<'_, AppState>,
) -> Result<FrontmatterQueryResponse, String> {
    let vault_root = crate::state::get_vault_root(&state)?;
    frontmatter_query::query_vault_markdown_frontmatter_in_root(
        &vault_root,
        field_name,
        field_value,
    )
}

/// 在指定仓库根目录下解析 WikiLink 目标。
pub fn resolve_wikilink_target_in_root(
    vault_root: &Path,
    current_dir: String,
    target: String,
) -> Result<Option<ResolveWikiLinkTargetResponse>, String> {
    wikilink::resolve_wikilink_target_in_root(vault_root, current_dir, target)
}

/// 在指定仓库根目录下解析媒体嵌入目标。
pub fn resolve_media_embed_target_in_root(
    vault_root: &Path,
    current_dir: String,
    target: String,
) -> Result<Option<ResolveMediaEmbedTargetResponse>, String> {
    wikilink::resolve_media_embed_target_in_root(vault_root, current_dir, target)
}

/// 在指定仓库根目录下搜索 Markdown 文件。
pub fn search_vault_markdown_files_in_root(
    vault_root: &Path,
    query: String,
    limit: Option<usize>,
) -> Result<Vec<VaultQuickSwitchItem>, String> {
    search::search_vault_markdown_files_in_root(vault_root, query, limit)
}

/// 在指定仓库根目录下搜索 Markdown 内容。
pub fn search_vault_markdown_in_root(
    vault_root: &Path,
    query: String,
    tag: Option<String>,
    scope: VaultSearchScope,
    limit: Option<usize>,
) -> Result<Vec<VaultSearchMatchItem>, String> {
    search::search_vault_markdown_in_root(vault_root, query, tag, scope, limit)
}

/// 在指定仓库根目录下查询任务条目。
pub fn query_vault_tasks_in_root(vault_root: &Path) -> Result<Vec<VaultTaskItem>, String> {
    task_query::query_vault_tasks_in_root(vault_root)
}

/// 在指定仓库根目录下获取 Markdown 图谱。
pub fn get_current_vault_markdown_graph_in_root(
    vault_root: &Path,
) -> Result<VaultMarkdownGraphResponse, String> {
    graph::get_current_vault_markdown_graph_in_root(vault_root)
}

/// 在指定仓库根目录下读取 Markdown AST。
pub fn get_vault_markdown_ast_in_root(
    vault_root: &Path,
    relative_path: String,
) -> Result<ReadMarkdownAstResponse, String> {
    markdown_ast::get_vault_markdown_ast_in_root(vault_root, relative_path)
}

/// 在指定仓库根目录下建议 WikiLink 目标。
pub fn suggest_wikilink_targets_in_root(
    vault_root: &Path,
    query: String,
    limit: Option<usize>,
) -> Result<Vec<WikiLinkSuggestionItem>, String> {
    search::suggest_wikilink_targets_in_root(vault_root, query, limit)
}

/// 在指定仓库根目录下获取反向链接。
pub fn get_backlinks_for_file_in_root(
    vault_root: &Path,
    relative_path: &str,
) -> Result<Vec<BacklinkItem>, String> {
    backlinks::get_backlinks_for_file_in_root(vault_root, relative_path)
}

/// 在指定仓库根目录下获取 Markdown 大纲。
pub fn get_vault_markdown_outline_in_root(
    vault_root: &Path,
    relative_path: String,
) -> Result<OutlineResponse, String> {
    outline::get_vault_markdown_outline_in_root(vault_root, relative_path)
}

/// 在指定仓库根目录下查询 frontmatter。
pub fn query_vault_markdown_frontmatter_in_root(
    vault_root: &Path,
    field_name: String,
    field_value: Option<String>,
) -> Result<FrontmatterQueryResponse, String> {
    frontmatter_query::query_vault_markdown_frontmatter_in_root(vault_root, field_name, field_value)
}

/// 在指定仓库根目录下进行中文分词。
pub fn parse_markdown_to_ast(markdown: &str) -> Result<MarkdownAstNode, String> {
    markdown_ast::parse_markdown_to_ast(markdown)
}
