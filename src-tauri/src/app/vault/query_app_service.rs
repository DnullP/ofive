//! # Vault 查询应用服务
//!
//! 负责组织搜索、图谱、大纲、前链路解析与分词等只读查询用例，
//! 作为宿主命令层与底层查询模块之间的稳定编排边界。

use tauri::State;

use crate::state::AppState;
use crate::vault_commands::backlinks;
use crate::vault_commands::frontmatter_query;
use crate::vault_commands::graph;
use crate::vault_commands::markdown_ast;
use crate::vault_commands::outline;
use crate::vault_commands::search;
use crate::vault_commands::segment;
use crate::vault_commands::types::{
    BacklinkItem, ChineseSegmentToken, FrontmatterQueryResponse, ReadMarkdownAstResponse,
    ResolveMediaEmbedTargetResponse, ResolveWikiLinkTargetResponse, VaultMarkdownGraphResponse,
    VaultQuickSwitchItem, WikiLinkSuggestionItem,
};
use crate::vault_commands::wikilink;

/// 解析 WikiLink 目标。
pub(crate) fn resolve_wikilink_target(
    current_dir: String,
    target: String,
    state: State<'_, AppState>,
) -> Result<Option<ResolveWikiLinkTargetResponse>, String> {
    wikilink::resolve_wikilink_target(current_dir, target, state)
}

/// 解析媒体嵌入目标。
pub(crate) fn resolve_media_embed_target(
    current_dir: String,
    target: String,
    state: State<'_, AppState>,
) -> Result<Option<ResolveMediaEmbedTargetResponse>, String> {
    wikilink::resolve_media_embed_target(current_dir, target, state)
}

/// 搜索仓库 Markdown 文件。
pub(crate) fn search_vault_markdown_files(
    query: String,
    limit: Option<usize>,
    state: State<'_, AppState>,
) -> Result<Vec<VaultQuickSwitchItem>, String> {
    search::search_vault_markdown_files(query, limit, state)
}

/// 获取当前仓库 Markdown 图谱。
pub(crate) fn get_current_vault_markdown_graph(
    state: State<'_, AppState>,
) -> Result<VaultMarkdownGraphResponse, String> {
    graph::get_current_vault_markdown_graph(state)
}

/// 获取 Markdown AST。
pub(crate) fn get_vault_markdown_ast(
    relative_path: String,
    state: State<'_, AppState>,
) -> Result<ReadMarkdownAstResponse, String> {
    markdown_ast::get_vault_markdown_ast(relative_path, state)
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
    search::suggest_wikilink_targets(query, limit, state)
}

/// 获取文件反向链接。
pub(crate) fn get_backlinks_for_file(
    relative_path: String,
    state: State<'_, AppState>,
) -> Result<Vec<BacklinkItem>, String> {
    backlinks::get_backlinks_for_file(relative_path, state)
}

/// 获取 Markdown 大纲。
pub(crate) fn get_vault_markdown_outline(
    relative_path: String,
    state: State<'_, AppState>,
) -> Result<outline::OutlineResponse, String> {
    outline::get_vault_markdown_outline(relative_path, state)
}

/// 查询 frontmatter。
pub(crate) fn query_vault_markdown_frontmatter(
    field_name: String,
    field_value: Option<String>,
    state: State<'_, AppState>,
) -> Result<FrontmatterQueryResponse, String> {
    frontmatter_query::query_vault_markdown_frontmatter(field_name, field_value, state)
}
