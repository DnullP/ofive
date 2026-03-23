//! # Vault 宿主命令模块
//!
//! 提供 Tauri `command` 包装层，负责记录命令调用耗时并将请求分发到
//! vault 应用服务层。

use crate::app::vault::query_app_service;
use crate::app::vault::vault_app_service;
use crate::shared::vault_contracts::*;
use crate::state::AppState;
use std::time::Instant;
use tauri::{AppHandle, State};

pub(crate) const VAULT_COMMAND_IDS: &[&str] = &[
    "set_current_vault",
    "get_current_vault_tree",
    "read_vault_markdown_file",
    "read_vault_binary_file",
    "create_vault_markdown_file",
    "create_vault_directory",
    "create_vault_binary_file",
    "save_vault_markdown_file",
    "rename_vault_markdown_file",
    "move_vault_markdown_file_to_directory",
    "rename_vault_directory",
    "move_vault_directory_to_directory",
    "delete_vault_directory",
    "delete_vault_markdown_file",
    "delete_vault_binary_file",
    "copy_vault_entry",
    "resolve_wikilink_target",
    "resolve_media_embed_target",
    "search_vault_markdown_files",
    "get_current_vault_markdown_graph",
    "get_vault_markdown_ast",
    "segment_chinese_text",
    "suggest_wikilink_targets",
    "get_current_vault_config",
    "save_current_vault_config",
    "get_backlinks_for_file",
    "get_vault_markdown_outline",
    "query_vault_markdown_frontmatter",
];

/// 包装命令执行并记录耗时。
macro_rules! timed_command {
    ($name:expr, $body:expr) => {{
        log::info!("[command] {} invoked", $name);
        let start = Instant::now();
        let result = $body;
        let elapsed = start.elapsed();
        match &result {
            Ok(_) => log::info!("[command] {} completed in {:?}", $name, elapsed),
            Err(ref err) => {
                log::warn!("[command] {} failed in {:?}: {}", $name, elapsed, err)
            }
        }
        result
    }};
}

/// 设置当前仓库并初始化监听器。
#[tauri::command]
pub fn set_current_vault(
    vault_path: String,
    app_handle: AppHandle,
    state: State<'_, AppState>,
) -> Result<SetVaultResponse, String> {
    timed_command!(
        "set_current_vault",
        vault_app_service::set_current_vault(vault_path, app_handle, state)
    )
}

/// 获取当前仓库树。
#[tauri::command]
pub fn get_current_vault_tree(state: State<'_, AppState>) -> Result<VaultTreeResponse, String> {
    timed_command!(
        "get_current_vault_tree",
        vault_app_service::get_current_vault_tree(state)
    )
}

/// 读取 Markdown 文件。
#[tauri::command]
pub fn read_vault_markdown_file(
    relative_path: String,
    state: State<'_, AppState>,
) -> Result<ReadMarkdownResponse, String> {
    timed_command!(
        "read_vault_markdown_file",
        vault_app_service::read_vault_markdown_file(relative_path, state)
    )
}

/// 读取二进制文件。
#[tauri::command]
pub fn read_vault_binary_file(
    relative_path: String,
    state: State<'_, AppState>,
) -> Result<ReadBinaryFileResponse, String> {
    timed_command!(
        "read_vault_binary_file",
        vault_app_service::read_vault_binary_file(relative_path, state)
    )
}

/// 创建 Markdown 文件。
#[tauri::command]
pub fn create_vault_markdown_file(
    relative_path: String,
    content: Option<String>,
    source_trace_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<WriteMarkdownResponse, String> {
    timed_command!(
        "create_vault_markdown_file",
        vault_app_service::create_vault_markdown_file(
            relative_path,
            content,
            source_trace_id,
            state,
        )
    )
}

/// 创建目录。
#[tauri::command]
pub fn create_vault_directory(
    relative_directory_path: String,
    source_trace_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    timed_command!(
        "create_vault_directory",
        vault_app_service::create_vault_directory(relative_directory_path, source_trace_id, state,)
    )
}

/// 创建二进制文件。
#[tauri::command]
pub fn create_vault_binary_file(
    relative_path: String,
    base64_content: String,
    source_trace_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<WriteBinaryFileResponse, String> {
    timed_command!(
        "create_vault_binary_file",
        vault_app_service::create_vault_binary_file(
            relative_path,
            base64_content,
            source_trace_id,
            state,
        )
    )
}

/// 保存 Markdown 文件。
#[tauri::command]
pub fn save_vault_markdown_file(
    relative_path: String,
    content: String,
    source_trace_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<WriteMarkdownResponse, String> {
    timed_command!(
        "save_vault_markdown_file",
        vault_app_service::save_vault_markdown_file(relative_path, content, source_trace_id, state,)
    )
}

/// 重命名 Markdown 文件。
#[tauri::command]
pub fn rename_vault_markdown_file(
    from_relative_path: String,
    to_relative_path: String,
    source_trace_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<WriteMarkdownResponse, String> {
    timed_command!(
        "rename_vault_markdown_file",
        vault_app_service::rename_vault_markdown_file(
            from_relative_path,
            to_relative_path,
            source_trace_id,
            state,
        )
    )
}

/// 删除 Markdown 文件。
#[tauri::command]
pub fn delete_vault_markdown_file(
    relative_path: String,
    source_trace_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    timed_command!(
        "delete_vault_markdown_file",
        vault_app_service::delete_vault_markdown_file(relative_path, source_trace_id, state)
    )
}

/// 删除二进制文件。
#[tauri::command]
pub fn delete_vault_binary_file(
    relative_path: String,
    source_trace_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    timed_command!(
        "delete_vault_binary_file",
        vault_app_service::delete_vault_binary_file(relative_path, source_trace_id, state)
    )
}

/// 移动 Markdown 文件到目录。
#[tauri::command]
pub fn move_vault_markdown_file_to_directory(
    from_relative_path: String,
    target_directory_relative_path: String,
    source_trace_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<WriteMarkdownResponse, String> {
    timed_command!(
        "move_vault_markdown_file_to_directory",
        vault_app_service::move_vault_markdown_file_to_directory(
            from_relative_path,
            target_directory_relative_path,
            source_trace_id,
            state,
        )
    )
}

/// 重命名目录。
#[tauri::command]
pub fn rename_vault_directory(
    from_relative_path: String,
    to_relative_path: String,
    source_trace_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<WriteMarkdownResponse, String> {
    timed_command!(
        "rename_vault_directory",
        vault_app_service::rename_vault_directory(
            from_relative_path,
            to_relative_path,
            source_trace_id,
            state,
        )
    )
}

/// 移动目录到目录。
#[tauri::command]
pub fn move_vault_directory_to_directory(
    from_relative_path: String,
    target_directory_relative_path: String,
    source_trace_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<WriteMarkdownResponse, String> {
    timed_command!(
        "move_vault_directory_to_directory",
        vault_app_service::move_vault_directory_to_directory(
            from_relative_path,
            target_directory_relative_path,
            source_trace_id,
            state,
        )
    )
}

/// 删除目录。
#[tauri::command]
pub fn delete_vault_directory(
    relative_path: String,
    source_trace_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    timed_command!(
        "delete_vault_directory",
        vault_app_service::delete_vault_directory(relative_path, source_trace_id, state)
    )
}

/// 复制仓库条目。
#[tauri::command]
pub fn copy_vault_entry(
    source_relative_path: String,
    target_directory_relative_path: String,
    source_trace_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<CopyEntryResponse, String> {
    timed_command!(
        "copy_vault_entry",
        vault_app_service::copy_vault_entry(
            source_relative_path,
            target_directory_relative_path,
            source_trace_id,
            state,
        )
    )
}

/// 解析 WikiLink 目标。
#[tauri::command]
pub fn resolve_wikilink_target(
    current_dir: String,
    target: String,
    state: State<'_, AppState>,
) -> Result<Option<ResolveWikiLinkTargetResponse>, String> {
    timed_command!(
        "resolve_wikilink_target",
        query_app_service::resolve_wikilink_target(current_dir, target, state)
    )
}

/// 解析媒体嵌入目标。
#[tauri::command]
pub fn resolve_media_embed_target(
    current_dir: String,
    target: String,
    state: State<'_, AppState>,
) -> Result<Option<ResolveMediaEmbedTargetResponse>, String> {
    timed_command!(
        "resolve_media_embed_target",
        query_app_service::resolve_media_embed_target(current_dir, target, state)
    )
}

/// 搜索仓库 Markdown 文件。
#[tauri::command]
pub fn search_vault_markdown_files(
    query: String,
    limit: Option<usize>,
    state: State<'_, AppState>,
) -> Result<Vec<VaultQuickSwitchItem>, String> {
    timed_command!(
        "search_vault_markdown_files",
        query_app_service::search_vault_markdown_files(query, limit, state)
    )
}

/// 获取当前仓库 Markdown 图谱。
#[tauri::command]
pub fn get_current_vault_markdown_graph(
    state: State<'_, AppState>,
) -> Result<VaultMarkdownGraphResponse, String> {
    timed_command!(
        "get_current_vault_markdown_graph",
        query_app_service::get_current_vault_markdown_graph(state)
    )
}

/// 获取 Markdown AST。
#[tauri::command]
pub fn get_vault_markdown_ast(
    relative_path: String,
    state: State<'_, AppState>,
) -> Result<ReadMarkdownAstResponse, String> {
    timed_command!(
        "get_vault_markdown_ast",
        query_app_service::get_vault_markdown_ast(relative_path, state)
    )
}

/// 中文分词。
#[tauri::command]
pub fn segment_chinese_text(text: String) -> Result<Vec<ChineseSegmentToken>, String> {
    timed_command!(
        "segment_chinese_text",
        query_app_service::segment_chinese_text(text)
    )
}

/// 建议 WikiLink 目标。
#[tauri::command]
pub fn suggest_wikilink_targets(
    query: String,
    limit: Option<usize>,
    state: State<'_, AppState>,
) -> Result<Vec<WikiLinkSuggestionItem>, String> {
    timed_command!(
        "suggest_wikilink_targets",
        query_app_service::suggest_wikilink_targets(query, limit, state)
    )
}

/// 获取当前仓库配置。
#[tauri::command]
pub fn get_current_vault_config(state: State<'_, AppState>) -> Result<VaultConfig, String> {
    timed_command!(
        "get_current_vault_config",
        vault_app_service::get_current_vault_config(state)
    )
}

/// 保存当前仓库配置。
#[tauri::command]
pub fn save_current_vault_config(
    config: VaultConfig,
    source_trace_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<VaultConfig, String> {
    timed_command!(
        "save_current_vault_config",
        vault_app_service::save_current_vault_config(config, source_trace_id, state)
    )
}

/// 获取文件反向链接。
#[tauri::command]
pub fn get_backlinks_for_file(
    relative_path: String,
    state: State<'_, AppState>,
) -> Result<Vec<BacklinkItem>, String> {
    timed_command!(
        "get_backlinks_for_file",
        query_app_service::get_backlinks_for_file(relative_path, state)
    )
}

/// 获取 Markdown 大纲。
#[tauri::command]
pub fn get_vault_markdown_outline(
    relative_path: String,
    state: State<'_, AppState>,
) -> Result<OutlineResponse, String> {
    timed_command!(
        "get_vault_markdown_outline",
        query_app_service::get_vault_markdown_outline(relative_path, state)
    )
}

/// 查询 frontmatter。
#[tauri::command]
pub fn query_vault_markdown_frontmatter(
    field_name: String,
    field_value: Option<String>,
    state: State<'_, AppState>,
) -> Result<FrontmatterQueryResponse, String> {
    timed_command!(
        "query_vault_markdown_frontmatter",
        query_app_service::query_vault_markdown_frontmatter(field_name, field_value, state)
    )
}
