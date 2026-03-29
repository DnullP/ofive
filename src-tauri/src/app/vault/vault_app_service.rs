//! # Vault 核心应用服务
//!
//! 负责当前仓库切换、目录树读取、文件读取与配置读写等核心用例编排。

use std::path::Path;

use tauri::{AppHandle, State};

use crate::infra::fs::{vault_runtime, write_runtime};
use crate::shared::vault_contracts::{
    CopyEntryResponse, ReadBinaryFileResponse, ReadMarkdownResponse, SetVaultResponse,
    VaultConfig, VaultTreeResponse, WriteBinaryFileResponse, WriteMarkdownResponse,
};
use crate::state::AppState;

/// 设置当前仓库并初始化运行时依赖。
pub(crate) fn set_current_vault(
    vault_path: String,
    app_handle: AppHandle,
    state: State<'_, AppState>,
) -> Result<SetVaultResponse, String> {
    vault_runtime::set_current_vault(vault_path, app_handle, state)
}

/// 获取当前仓库目录树。
pub(crate) fn get_current_vault_tree(
    state: State<'_, AppState>,
) -> Result<VaultTreeResponse, String> {
    vault_runtime::get_current_vault_tree(state)
}

/// 读取当前仓库中的 Markdown 文件。
pub(crate) fn read_vault_markdown_file(
    relative_path: String,
    state: State<'_, AppState>,
) -> Result<ReadMarkdownResponse, String> {
    vault_runtime::read_vault_markdown_file(relative_path, state)
}

/// 读取当前仓库中的二进制文件。
pub(crate) fn read_vault_binary_file(
    relative_path: String,
    state: State<'_, AppState>,
) -> Result<ReadBinaryFileResponse, String> {
    vault_runtime::read_vault_binary_file(relative_path, state)
}

/// 读取当前仓库中的 Canvas 文件。
pub(crate) fn read_vault_canvas_file(
    relative_path: String,
    state: State<'_, AppState>,
) -> Result<ReadMarkdownResponse, String> {
    vault_runtime::read_vault_canvas_file(relative_path, state)
}

/// 在当前仓库中创建 Markdown 文件。
pub(crate) fn create_vault_markdown_file(
    relative_path: String,
    content: Option<String>,
    source_trace_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<WriteMarkdownResponse, String> {
    write_runtime::create_vault_markdown_file(relative_path, content, source_trace_id, state)
}

/// 在当前仓库中创建目录。
pub(crate) fn create_vault_directory(
    relative_directory_path: String,
    source_trace_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    write_runtime::create_vault_directory(relative_directory_path, source_trace_id, state)
}

/// 在当前仓库中创建二进制文件。
pub(crate) fn create_vault_binary_file(
    relative_path: String,
    base64_content: String,
    source_trace_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<WriteBinaryFileResponse, String> {
    write_runtime::create_vault_binary_file(relative_path, base64_content, source_trace_id, state)
}

/// 在当前仓库中创建 Canvas 文件。
pub(crate) fn create_vault_canvas_file(
    relative_path: String,
    content: Option<String>,
    source_trace_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<WriteMarkdownResponse, String> {
    write_runtime::create_vault_canvas_file(relative_path, content, source_trace_id, state)
}

/// 保存当前仓库中的 Markdown 文件。
pub(crate) fn save_vault_markdown_file(
    relative_path: String,
    content: String,
    source_trace_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<WriteMarkdownResponse, String> {
    write_runtime::save_vault_markdown_file(relative_path, content, source_trace_id, state)
}

/// 保存当前仓库中的 Canvas 文件。
pub(crate) fn save_vault_canvas_file(
    relative_path: String,
    content: String,
    source_trace_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<WriteMarkdownResponse, String> {
    write_runtime::save_vault_canvas_file(relative_path, content, source_trace_id, state)
}

/// 重命名当前仓库中的 Markdown 文件。
pub(crate) fn rename_vault_markdown_file(
    from_relative_path: String,
    to_relative_path: String,
    source_trace_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<WriteMarkdownResponse, String> {
    write_runtime::rename_vault_markdown_file(
        from_relative_path,
        to_relative_path,
        source_trace_id,
        state,
    )
}

/// 重命名当前仓库中的 Canvas 文件。
pub(crate) fn rename_vault_canvas_file(
    from_relative_path: String,
    to_relative_path: String,
    source_trace_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<WriteMarkdownResponse, String> {
    write_runtime::rename_vault_canvas_file(
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
    write_runtime::delete_vault_markdown_file(relative_path, source_trace_id, state)
}

/// 删除当前仓库中的 Canvas 文件。
pub(crate) fn delete_vault_canvas_file(
    relative_path: String,
    source_trace_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    write_runtime::delete_vault_canvas_file(relative_path, source_trace_id, state)
}

/// 删除当前仓库中的二进制文件。
pub(crate) fn delete_vault_binary_file(
    relative_path: String,
    source_trace_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    write_runtime::delete_vault_binary_file(relative_path, source_trace_id, state)
}

/// 将当前仓库中的 Markdown 文件移动到目标目录。
pub(crate) fn move_vault_markdown_file_to_directory(
    from_relative_path: String,
    target_directory_relative_path: String,
    source_trace_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<WriteMarkdownResponse, String> {
    write_runtime::move_vault_markdown_file_to_directory(
        from_relative_path,
        target_directory_relative_path,
        source_trace_id,
        state,
    )
}

/// 将当前仓库中的 Canvas 文件移动到目标目录。
pub(crate) fn move_vault_canvas_file_to_directory(
    from_relative_path: String,
    target_directory_relative_path: String,
    source_trace_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<WriteMarkdownResponse, String> {
    write_runtime::move_vault_canvas_file_to_directory(
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
    write_runtime::rename_vault_directory(
        from_relative_path,
        to_relative_path,
        source_trace_id,
        state,
    )
}

/// 将当前仓库中的目录移动到目标目录。
pub(crate) fn move_vault_directory_to_directory(
    from_relative_path: String,
    target_directory_relative_path: String,
    source_trace_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<WriteMarkdownResponse, String> {
    write_runtime::move_vault_directory_to_directory(
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
    write_runtime::delete_vault_directory(relative_path, source_trace_id, state)
}

/// 复制当前仓库中的条目。
pub(crate) fn copy_vault_entry(
    source_relative_path: String,
    target_directory_relative_path: String,
    source_trace_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<CopyEntryResponse, String> {
    write_runtime::copy_vault_entry(
        source_relative_path,
        target_directory_relative_path,
        source_trace_id,
        state,
    )
}

/// 读取当前仓库配置。
pub(crate) fn get_current_vault_config(state: State<'_, AppState>) -> Result<VaultConfig, String> {
    vault_runtime::get_current_vault_config(state)
}

/// 保存当前仓库配置。
pub(crate) fn save_current_vault_config(
    config: VaultConfig,
    source_trace_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<VaultConfig, String> {
    write_runtime::save_current_vault_config(config, source_trace_id, state)
}

/// 在指定仓库根目录下读取 Markdown 文件。
pub fn read_vault_markdown_file_in_root(
    relative_path: String,
    vault_root: &Path,
) -> Result<ReadMarkdownResponse, String> {
    vault_runtime::read_vault_markdown_file_in_root(relative_path, vault_root)
}

/// 在指定仓库根目录下读取 Canvas 文件。
pub fn read_vault_canvas_file_in_root(
    relative_path: String,
    vault_root: &Path,
) -> Result<ReadMarkdownResponse, String> {
    vault_runtime::read_vault_canvas_file_in_root(relative_path, vault_root)
}

/// 在指定仓库根目录下创建 Markdown 文件。
pub fn create_vault_markdown_file_in_root(
    relative_path: String,
    content: Option<String>,
    vault_root: &Path,
) -> Result<WriteMarkdownResponse, String> {
    write_runtime::create_vault_markdown_file_in_root(relative_path, content, vault_root)
}

/// 在指定仓库根目录下创建 Canvas 文件。
pub fn create_vault_canvas_file_in_root(
    relative_path: String,
    content: Option<String>,
    vault_root: &Path,
) -> Result<WriteMarkdownResponse, String> {
    write_runtime::create_vault_canvas_file_in_root(relative_path, content, vault_root)
}

/// 在指定仓库根目录下保存 Markdown 文件。
pub fn save_vault_markdown_file_in_root(
    relative_path: String,
    content: String,
    vault_root: &Path,
) -> Result<WriteMarkdownResponse, String> {
    write_runtime::save_vault_markdown_file_in_root(relative_path, content, vault_root)
}

/// 在指定仓库根目录下保存 Canvas 文件。
pub fn save_vault_canvas_file_in_root(
    relative_path: String,
    content: String,
    vault_root: &Path,
) -> Result<WriteMarkdownResponse, String> {
    write_runtime::save_vault_canvas_file_in_root(relative_path, content, vault_root)
}

/// 在指定仓库根目录下重命名 Markdown 文件。
pub fn rename_vault_markdown_file_in_root(
    from_relative_path: String,
    to_relative_path: String,
    vault_root: &Path,
) -> Result<WriteMarkdownResponse, String> {
    write_runtime::rename_vault_markdown_file_in_root(
        from_relative_path,
        to_relative_path,
        vault_root,
    )
}

/// 在指定仓库根目录下重命名 Canvas 文件。
pub fn rename_vault_canvas_file_in_root(
    from_relative_path: String,
    to_relative_path: String,
    vault_root: &Path,
) -> Result<WriteMarkdownResponse, String> {
    write_runtime::rename_vault_canvas_file_in_root(
        from_relative_path,
        to_relative_path,
        vault_root,
    )
}

/// 在指定仓库根目录下删除 Markdown 文件。
pub fn delete_vault_markdown_file_in_root(
    relative_path: String,
    vault_root: &Path,
) -> Result<(), String> {
    write_runtime::delete_vault_markdown_file_in_root(relative_path, vault_root)
}

/// 在指定仓库根目录下删除 Canvas 文件。
pub fn delete_vault_canvas_file_in_root(
    relative_path: String,
    vault_root: &Path,
) -> Result<(), String> {
    write_runtime::delete_vault_canvas_file_in_root(relative_path, vault_root)
}

/// 在指定仓库根目录下创建目录。
pub fn create_vault_directory_in_root(
    relative_directory_path: String,
    vault_root: &Path,
) -> Result<(), String> {
    write_runtime::create_vault_directory_in_root(relative_directory_path, vault_root)
}

/// 在指定仓库根目录下复制仓库条目。
pub fn copy_vault_entry_in_root(
    source_relative_path: String,
    target_directory_relative_path: String,
    vault_root: &Path,
) -> Result<CopyEntryResponse, String> {
    write_runtime::copy_vault_entry_in_root(
        &source_relative_path,
        &target_directory_relative_path,
        vault_root,
    )
}

/// 在指定仓库根目录下创建二进制文件。
pub fn create_vault_binary_file_in_root(
    relative_path: String,
    base64_content: String,
    vault_root: &Path,
) -> Result<WriteBinaryFileResponse, String> {
    write_runtime::create_vault_binary_file_in_root(relative_path, base64_content, vault_root)
}

/// 在指定仓库根目录下读取二进制文件。
pub fn read_vault_binary_file_in_root(
    relative_path: String,
    vault_root: &Path,
) -> Result<ReadBinaryFileResponse, String> {
    vault_runtime::read_vault_binary_file_in_root(relative_path, vault_root)
}

/// 在指定仓库根目录下移动 Markdown 文件到目录。
pub fn move_vault_markdown_file_to_directory_in_root(
    from_relative_path: String,
    target_directory_relative_path: String,
    vault_root: &Path,
) -> Result<WriteMarkdownResponse, String> {
    write_runtime::move_vault_markdown_file_to_directory_in_root(
        from_relative_path,
        target_directory_relative_path,
        vault_root,
    )
}

/// 在指定仓库根目录下移动 Canvas 文件到目录。
pub fn move_vault_canvas_file_to_directory_in_root(
    from_relative_path: String,
    target_directory_relative_path: String,
    vault_root: &Path,
) -> Result<WriteMarkdownResponse, String> {
    write_runtime::move_vault_canvas_file_to_directory_in_root(
        from_relative_path,
        target_directory_relative_path,
        vault_root,
    )
}

/// 在指定仓库根目录下重命名目录。
pub fn rename_vault_directory_in_root(
    from_relative_path: String,
    to_relative_path: String,
    vault_root: &Path,
) -> Result<WriteMarkdownResponse, String> {
    write_runtime::rename_vault_directory_in_root(from_relative_path, to_relative_path, vault_root)
}

/// 在指定仓库根目录下移动目录到目录。
pub fn move_vault_directory_to_directory_in_root(
    from_relative_path: String,
    target_directory_relative_path: String,
    vault_root: &Path,
) -> Result<WriteMarkdownResponse, String> {
    write_runtime::move_vault_directory_to_directory_in_root(
        from_relative_path,
        target_directory_relative_path,
        vault_root,
    )
}

/// 在指定仓库根目录下删除目录。
pub fn delete_vault_directory_in_root(
    relative_path: String,
    vault_root: &Path,
) -> Result<(), String> {
    write_runtime::delete_vault_directory_in_root(relative_path, vault_root)
}

/// 在指定仓库根目录下删除二进制文件。
pub fn delete_vault_binary_file_in_root(
    relative_path: String,
    vault_root: &Path,
) -> Result<(), String> {
    write_runtime::delete_vault_binary_file_in_root(relative_path, vault_root)
}

/// 在指定仓库根目录下读取仓库配置。
pub fn get_current_vault_config_in_root(vault_root: &Path) -> Result<VaultConfig, String> {
    vault_runtime::get_current_vault_config_in_root(vault_root)
}

/// 在指定仓库根目录下保存仓库配置。
pub fn save_current_vault_config_in_root(
    config: VaultConfig,
    vault_root: &Path,
) -> Result<VaultConfig, String> {
    write_runtime::save_current_vault_config_in_root(config, vault_root)
}

/// 校验并切换当前仓库路径。
pub fn set_current_vault_precheck(
    vault_path: String,
) -> Result<crate::shared::vault_contracts::SetVaultResponse, String> {
    vault_runtime::set_current_vault_precheck(vault_path)
}

/// 在指定仓库根目录下读取目录树。
pub fn get_current_vault_tree_in_root(vault_root: &Path) -> Result<VaultTreeResponse, String> {
    vault_runtime::get_current_vault_tree_in_root(vault_root)
}

#[cfg(test)]
mod tests {
    use super::move_vault_markdown_file_to_directory_in_root;
    use std::fs;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    static TEST_ROOT_SEQ: AtomicU64 = AtomicU64::new(1);

    fn create_test_root() -> PathBuf {
        let sequence = TEST_ROOT_SEQ.fetch_add(1, Ordering::Relaxed);
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0);
        let root = std::env::temp_dir().join(format!("ofive-vault-app-test-{unique}-{sequence}"));
        fs::create_dir_all(root.join(".ofive")).expect("应成功创建测试根目录");
        root
    }

    #[test]
    fn move_vault_markdown_file_to_directory_should_move_file_and_keep_filename() {
        let root = create_test_root();
        let source = root.join("notes/source.md");
        if let Some(parent) = source.parent() {
            fs::create_dir_all(parent).expect("应成功创建测试目录");
        }
        fs::write(&source, "# test\n").expect("应成功写入测试文件");

        let response = move_vault_markdown_file_to_directory_in_root(
            "notes/source.md".to_string(),
            "archive/2026".to_string(),
            &root,
        )
        .expect("移动应成功");

        assert_eq!(response.relative_path, "archive/2026/source.md");
        assert!(!root.join("notes/source.md").exists());
        assert!(root.join("archive/2026/source.md").exists());

        let _ = fs::remove_dir_all(root);
    }
}
