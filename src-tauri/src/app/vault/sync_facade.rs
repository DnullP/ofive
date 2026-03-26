//! # Vault Sync Facade
//!
//! 为未来的同步模块提供一个受管控的 Vault 消费入口，避免同步流程直接依赖
//! `vault_app_service`、`query_app_service` 之外更底层的私有实现。
//!
//! 依赖模块：
//! - `crate::app::vault::vault_app_service`
//! - `crate::shared::vault_contracts`
//!
//! 使用示例：
//! ```ignore
//! let tree = crate::app::vault::sync_facade::load_vault_tree_for_sync(vault_root)?;
//! let note = crate::app::vault::sync_facade::load_markdown_file_for_sync(
//!     "Notes/A.md".to_string(),
//!     vault_root,
//! )?;
//! crate::app::vault::sync_facade::save_markdown_file_for_sync(
//!     note.relative_path,
//!     note.content,
//!     vault_root,
//! )?;
//! ```
//!
//! 导出能力：
//! - 读取 vault 树、配置和文件内容
//! - 应用文件/目录级写入、移动、删除与复制操作
//! - 为同步模块提供稳定命名的 Vault 访问 facade

#![allow(dead_code)]

use std::path::Path;

use crate::app::vault::vault_app_service;
use crate::shared::vault_contracts::{
    CopyEntryResponse, ReadBinaryFileResponse, ReadMarkdownResponse, VaultConfig,
    VaultTreeResponse, WriteBinaryFileResponse, WriteMarkdownResponse,
};

/// 读取当前仓库的目录树，供同步模块构建本地快照。
///
/// # 参数
/// - `vault_root`：目标仓库根目录。
///
/// # 返回
/// - `Ok(VaultTreeResponse)`：当前仓库树快照。
/// - `Err(String)`：读取仓库树失败。
pub fn load_vault_tree_for_sync(vault_root: &Path) -> Result<VaultTreeResponse, String> {
    vault_app_service::get_current_vault_tree_in_root(vault_root)
}

/// 读取仓库配置，供同步模块同步配置状态或读取同步元数据。
///
/// # 参数
/// - `vault_root`：目标仓库根目录。
///
/// # 返回
/// - `Ok(VaultConfig)`：当前仓库配置。
/// - `Err(String)`：读取配置失败。
pub fn load_vault_config_for_sync(vault_root: &Path) -> Result<VaultConfig, String> {
    vault_app_service::get_current_vault_config_in_root(vault_root)
}

/// 保存仓库配置，供同步模块回写同步相关配置项。
///
/// # 参数
/// - `config`：待保存配置。
/// - `vault_root`：目标仓库根目录。
///
/// # 返回
/// - `Ok(VaultConfig)`：实际保存后的配置。
/// - `Err(String)`：保存配置失败。
pub fn save_vault_config_for_sync(
    config: VaultConfig,
    vault_root: &Path,
) -> Result<VaultConfig, String> {
    vault_app_service::save_current_vault_config_in_root(config, vault_root)
}

/// 读取一个 Markdown 文件，供同步模块生成上传内容或比对差异。
///
/// # 参数
/// - `relative_path`：相对路径。
/// - `vault_root`：目标仓库根目录。
///
/// # 返回
/// - `Ok(ReadMarkdownResponse)`：文件内容快照。
/// - `Err(String)`：读取失败。
pub fn load_markdown_file_for_sync(
    relative_path: String,
    vault_root: &Path,
) -> Result<ReadMarkdownResponse, String> {
    vault_app_service::read_vault_markdown_file_in_root(relative_path, vault_root)
}

/// 读取一个二进制文件，供同步模块生成上传内容或比对差异。
///
/// # 参数
/// - `relative_path`：相对路径。
/// - `vault_root`：目标仓库根目录。
///
/// # 返回
/// - `Ok(ReadBinaryFileResponse)`：文件内容快照。
/// - `Err(String)`：读取失败。
pub fn load_binary_file_for_sync(
    relative_path: String,
    vault_root: &Path,
) -> Result<ReadBinaryFileResponse, String> {
    vault_app_service::read_vault_binary_file_in_root(relative_path, vault_root)
}

/// 创建一个 Markdown 文件，供同步模块应用远端新增。
///
/// # 参数
/// - `relative_path`：目标路径。
/// - `content`：可选初始内容。
/// - `vault_root`：目标仓库根目录。
///
/// # 返回
/// - `Ok(WriteMarkdownResponse)`：创建结果。
/// - `Err(String)`：创建失败。
pub fn create_markdown_file_for_sync(
    relative_path: String,
    content: Option<String>,
    vault_root: &Path,
) -> Result<WriteMarkdownResponse, String> {
    vault_app_service::create_vault_markdown_file_in_root(relative_path, content, vault_root)
}

/// 保存一个 Markdown 文件，供同步模块应用远端更新。
///
/// # 参数
/// - `relative_path`：目标路径。
/// - `content`：最新内容。
/// - `vault_root`：目标仓库根目录。
///
/// # 返回
/// - `Ok(WriteMarkdownResponse)`：保存结果。
/// - `Err(String)`：保存失败。
pub fn save_markdown_file_for_sync(
    relative_path: String,
    content: String,
    vault_root: &Path,
) -> Result<WriteMarkdownResponse, String> {
    vault_app_service::save_vault_markdown_file_in_root(relative_path, content, vault_root)
}

/// 重命名一个 Markdown 文件，供同步模块应用远端路径变更。
pub fn rename_markdown_file_for_sync(
    from_relative_path: String,
    to_relative_path: String,
    vault_root: &Path,
) -> Result<WriteMarkdownResponse, String> {
    vault_app_service::rename_vault_markdown_file_in_root(
        from_relative_path,
        to_relative_path,
        vault_root,
    )
}

/// 移动一个 Markdown 文件到目录，供同步模块应用远端目录调整。
pub fn move_markdown_file_to_directory_for_sync(
    from_relative_path: String,
    target_directory_relative_path: String,
    vault_root: &Path,
) -> Result<WriteMarkdownResponse, String> {
    vault_app_service::move_vault_markdown_file_to_directory_in_root(
        from_relative_path,
        target_directory_relative_path,
        vault_root,
    )
}

/// 删除一个 Markdown 文件，供同步模块应用远端删除。
pub fn delete_markdown_file_for_sync(
    relative_path: String,
    vault_root: &Path,
) -> Result<(), String> {
    vault_app_service::delete_vault_markdown_file_in_root(relative_path, vault_root)
}

/// 创建一个二进制文件，供同步模块应用远端新增附件。
pub fn create_binary_file_for_sync(
    relative_path: String,
    base64_content: String,
    vault_root: &Path,
) -> Result<WriteBinaryFileResponse, String> {
    vault_app_service::create_vault_binary_file_in_root(relative_path, base64_content, vault_root)
}

/// 删除一个二进制文件，供同步模块应用远端删除附件。
pub fn delete_binary_file_for_sync(relative_path: String, vault_root: &Path) -> Result<(), String> {
    vault_app_service::delete_vault_binary_file_in_root(relative_path, vault_root)
}

/// 创建一个目录，供同步模块应用远端目录新增。
pub fn create_directory_for_sync(
    relative_directory_path: String,
    vault_root: &Path,
) -> Result<(), String> {
    vault_app_service::create_vault_directory_in_root(relative_directory_path, vault_root)
}

/// 重命名一个目录，供同步模块应用远端目录重命名。
pub fn rename_directory_for_sync(
    from_relative_path: String,
    to_relative_path: String,
    vault_root: &Path,
) -> Result<WriteMarkdownResponse, String> {
    vault_app_service::rename_vault_directory_in_root(
        from_relative_path,
        to_relative_path,
        vault_root,
    )
}

/// 移动一个目录到目标目录，供同步模块应用远端目录移动。
pub fn move_directory_to_directory_for_sync(
    from_relative_path: String,
    target_directory_relative_path: String,
    vault_root: &Path,
) -> Result<WriteMarkdownResponse, String> {
    vault_app_service::move_vault_directory_to_directory_in_root(
        from_relative_path,
        target_directory_relative_path,
        vault_root,
    )
}

/// 删除一个目录，供同步模块应用远端目录删除。
pub fn delete_directory_for_sync(relative_path: String, vault_root: &Path) -> Result<(), String> {
    vault_app_service::delete_vault_directory_in_root(relative_path, vault_root)
}

/// 复制一个仓库条目，供同步模块在需要时应用复制型变更。
pub fn copy_entry_for_sync(
    source_relative_path: String,
    target_directory_relative_path: String,
    vault_root: &Path,
) -> Result<CopyEntryResponse, String> {
    vault_app_service::copy_vault_entry_in_root(
        source_relative_path,
        target_directory_relative_path,
        vault_root,
    )
}

#[cfg(test)]
mod tests {
    use super::{
        create_markdown_file_for_sync, load_markdown_file_for_sync, load_vault_tree_for_sync,
        save_vault_config_for_sync,
    };
    use crate::shared::vault_contracts::VaultConfig;
    use serde_json::{Map, Value};
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
        let root = std::env::temp_dir().join(format!(
            "ofive-vault-sync-facade-test-{}-{}",
            unique, sequence
        ));
        fs::create_dir_all(root.join(".ofive")).expect("应成功创建测试根目录");
        root
    }

    #[test]
    fn sync_facade_should_create_and_read_markdown_file() {
        let root = create_test_root();

        let created = create_markdown_file_for_sync(
            "Notes/Sync.md".to_string(),
            Some("# Sync\n\nhello".to_string()),
            &root,
        )
        .expect("sync facade 创建文件应成功");
        let loaded = load_markdown_file_for_sync(created.relative_path.clone(), &root)
            .expect("sync facade 读取文件应成功");

        assert_eq!(created.relative_path, "Notes/Sync.md");
        assert_eq!(loaded.content, "# Sync\n\nhello");

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn sync_facade_should_load_tree_and_save_config() {
        let root = create_test_root();
        fs::create_dir_all(root.join("Notes")).expect("应成功创建测试目录");
        fs::write(root.join("Notes/Tree.md"), "# Tree\n").expect("应成功写入测试文件");

        let tree = load_vault_tree_for_sync(&root).expect("sync facade 读取目录树应成功");
        assert!(tree
            .entries
            .iter()
            .any(|entry| entry.relative_path == "Notes/Tree.md"));

        let mut entries = Map::new();
        entries.insert(
            "sync".to_string(),
            Value::Object(Map::from_iter([(
                "serverUrl".to_string(),
                Value::String("https://sync.example.test".to_string()),
            )])),
        );
        let config = VaultConfig {
            schema_version: 1,
            entries,
        };

        let saved = save_vault_config_for_sync(config, &root).expect("sync facade 保存配置应成功");

        assert_eq!(
            saved.entries["sync"]["serverUrl"],
            "https://sync.example.test"
        );

        let _ = fs::remove_dir_all(root);
    }
}
