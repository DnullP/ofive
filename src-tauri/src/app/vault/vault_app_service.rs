//! # Vault 核心应用服务
//!
//! 负责当前仓库切换、目录树读取、文件读取与配置读写等核心用例编排。

use tauri::{AppHandle, State};

use crate::state::AppState;
use crate::vault_commands::types::{
    CopyEntryResponse, ReadBinaryFileResponse, ReadMarkdownResponse, SetVaultResponse,
    VaultTreeResponse, WriteBinaryFileResponse, WriteMarkdownResponse,
};
use crate::vault_commands::vault_ops;
use crate::vault_config::VaultConfig;

/// 设置当前仓库并初始化运行时依赖。
pub(crate) fn set_current_vault(
    vault_path: String,
    app_handle: AppHandle,
    state: State<'_, AppState>,
) -> Result<SetVaultResponse, String> {
    vault_ops::set_current_vault(vault_path, app_handle, state)
}

/// 获取当前仓库目录树。
pub(crate) fn get_current_vault_tree(
    state: State<'_, AppState>,
) -> Result<VaultTreeResponse, String> {
    vault_ops::get_current_vault_tree(state)
}

/// 读取当前仓库中的 Markdown 文件。
pub(crate) fn read_vault_markdown_file(
    relative_path: String,
    state: State<'_, AppState>,
) -> Result<ReadMarkdownResponse, String> {
    vault_ops::read_vault_markdown_file(relative_path, state)
}

/// 读取当前仓库中的二进制文件。
pub(crate) fn read_vault_binary_file(
    relative_path: String,
    state: State<'_, AppState>,
) -> Result<ReadBinaryFileResponse, String> {
    vault_ops::read_vault_binary_file(relative_path, state)
}

/// 在当前仓库中创建 Markdown 文件。
pub(crate) fn create_vault_markdown_file(
    relative_path: String,
    content: Option<String>,
    source_trace_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<WriteMarkdownResponse, String> {
    vault_ops::create_vault_markdown_file(relative_path, content, source_trace_id, state)
}

/// 在当前仓库中创建目录。
pub(crate) fn create_vault_directory(
    relative_directory_path: String,
    source_trace_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    vault_ops::create_vault_directory(relative_directory_path, source_trace_id, state)
}

/// 在当前仓库中创建二进制文件。
pub(crate) fn create_vault_binary_file(
    relative_path: String,
    base64_content: String,
    source_trace_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<WriteBinaryFileResponse, String> {
    vault_ops::create_vault_binary_file(relative_path, base64_content, source_trace_id, state)
}

/// 保存当前仓库中的 Markdown 文件。
pub(crate) fn save_vault_markdown_file(
    relative_path: String,
    content: String,
    source_trace_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<WriteMarkdownResponse, String> {
    vault_ops::save_vault_markdown_file(relative_path, content, source_trace_id, state)
}

/// 重命名当前仓库中的 Markdown 文件。
pub(crate) fn rename_vault_markdown_file(
    from_relative_path: String,
    to_relative_path: String,
    source_trace_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<WriteMarkdownResponse, String> {
    vault_ops::rename_vault_markdown_file(
        from_relative_path,
        to_relative_path,
        source_trace_id,
        state,
    )
}

/// 删除当前仓库中的 Markdown 文件。
pub(crate) fn delete_vault_markdown_file(
    relative_path: String,
    source_trace_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    vault_ops::delete_vault_markdown_file(relative_path, source_trace_id, state)
}

/// 删除当前仓库中的二进制文件。
pub(crate) fn delete_vault_binary_file(
    relative_path: String,
    source_trace_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    vault_ops::delete_vault_binary_file(relative_path, source_trace_id, state)
}

/// 将当前仓库中的 Markdown 文件移动到目标目录。
pub(crate) fn move_vault_markdown_file_to_directory(
    from_relative_path: String,
    target_directory_relative_path: String,
    source_trace_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<WriteMarkdownResponse, String> {
    vault_ops::move_vault_markdown_file_to_directory(
        from_relative_path,
        target_directory_relative_path,
        source_trace_id,
        state,
    )
}

/// 重命名当前仓库中的目录。
pub(crate) fn rename_vault_directory(
    from_relative_path: String,
    to_relative_path: String,
    source_trace_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<WriteMarkdownResponse, String> {
    vault_ops::rename_vault_directory(from_relative_path, to_relative_path, source_trace_id, state)
}

/// 将当前仓库中的目录移动到目标目录。
pub(crate) fn move_vault_directory_to_directory(
    from_relative_path: String,
    target_directory_relative_path: String,
    source_trace_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<WriteMarkdownResponse, String> {
    vault_ops::move_vault_directory_to_directory(
        from_relative_path,
        target_directory_relative_path,
        source_trace_id,
        state,
    )
}

/// 删除当前仓库中的目录。
pub(crate) fn delete_vault_directory(
    relative_path: String,
    source_trace_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    vault_ops::delete_vault_directory(relative_path, source_trace_id, state)
}

/// 复制当前仓库中的条目。
pub(crate) fn copy_vault_entry(
    source_relative_path: String,
    target_directory_relative_path: String,
    source_trace_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<CopyEntryResponse, String> {
    vault_ops::copy_vault_entry(
        source_relative_path,
        target_directory_relative_path,
        source_trace_id,
        state,
    )
}

/// 读取当前仓库配置。
pub(crate) fn get_current_vault_config(state: State<'_, AppState>) -> Result<VaultConfig, String> {
    vault_ops::get_current_vault_config(state)
}

/// 保存当前仓库配置。
pub(crate) fn save_current_vault_config(
    config: VaultConfig,
    source_trace_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<VaultConfig, String> {
    vault_ops::save_current_vault_config(config, source_trace_id, state)
}
