//! # Vault Query Facade
//!
//! 为语义索引等只读消费者提供受管控的 Vault 查询入口，避免跨模块直接依赖
//! `vault_app_service` 与 `infra::query::query_index` 等私有实现。
//!
//! 依赖模块：
//! - `crate::app::vault::vault_app_service`
//! - `crate::infra::query::query_index`
//! - `crate::shared::vault_contracts`
//!
//! 使用示例：
//! ```ignore
//! crate::app::vault::query_facade::ensure_query_index_ready_for_semantic_index(vault_root)?;
//! let files = crate::app::vault::query_facade::list_indexed_markdown_files_for_semantic_index(
//!     vault_root,
//! )?;
//! let note = crate::app::vault::query_facade::load_markdown_file_for_semantic_index(
//!     files[0].relative_path.clone(),
//!     vault_root,
//! )?;
//! ```
//!
//! 导出能力：
//! - 确保 Vault 查询索引处于可读状态
//! - 列出已建立查询索引的 Markdown 文件
//! - 读取指定 Markdown 文件内容供下游消费

#![allow(dead_code)]

use std::path::Path;

use crate::app::vault::vault_app_service;
use crate::infra::query::query_index;
use crate::shared::vault_contracts::{ReadMarkdownResponse, VaultIndexedMarkdownFile};

/// 确保指定仓库根目录的查询索引已构建完成，供语义索引等读侧流程使用。
///
/// # 参数
/// - `vault_root`：目标仓库根目录。
///
/// # 返回
/// - `Ok(())`：查询索引已准备就绪。
/// - `Err(String)`：索引初始化或校验失败。
pub fn ensure_query_index_ready_for_semantic_index(vault_root: &Path) -> Result<(), String> {
    query_index::ensure_query_index_current(vault_root)
}

/// 返回查询索引中登记的全部 Markdown 文件列表，供语义索引遍历构建文档向量。
///
/// # 参数
/// - `vault_root`：目标仓库根目录。
///
/// # 返回
/// - `Ok(Vec<VaultIndexedMarkdownFile>)`：已索引 Markdown 文件列表。
/// - `Err(String)`：读取索引失败。
pub fn list_indexed_markdown_files_for_semantic_index(
    vault_root: &Path,
) -> Result<Vec<VaultIndexedMarkdownFile>, String> {
    query_index::list_markdown_files(vault_root).map(|entries| {
        entries
            .into_iter()
            .map(|entry| VaultIndexedMarkdownFile {
                relative_path: entry.relative_path,
                title: entry.title,
            })
            .collect()
    })
}

/// 读取指定 Markdown 文件内容，供语义索引执行切块、embedding 与向量写入。
///
/// # 参数
/// - `relative_path`：待读取 Markdown 文件相对路径。
/// - `vault_root`：目标仓库根目录。
///
/// # 返回
/// - `Ok(ReadMarkdownResponse)`：文件内容快照。
/// - `Err(String)`：文件不存在或读取失败。
pub fn load_markdown_file_for_semantic_index(
    relative_path: String,
    vault_root: &Path,
) -> Result<ReadMarkdownResponse, String> {
    vault_app_service::read_vault_markdown_file_in_root(relative_path, vault_root)
}

#[cfg(test)]
mod tests {
    use super::{
        ensure_query_index_ready_for_semantic_index,
        list_indexed_markdown_files_for_semantic_index, load_markdown_file_for_semantic_index,
    };
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
            "ofive-vault-query-facade-test-{}-{}",
            unique, sequence
        ));
        fs::create_dir_all(root.join(".ofive")).expect("应成功创建测试根目录");
        root
    }

    #[test]
    fn query_facade_should_list_indexed_markdown_files() {
        let root = create_test_root();
        fs::create_dir_all(root.join("Notes")).expect("应成功创建测试目录");
        fs::write(root.join("Notes/Alpha.md"), "# Alpha\n\nhello").expect("应成功写入测试文件");

        ensure_query_index_ready_for_semantic_index(&root)
            .expect("query facade 应成功准备查询索引");
        let entries = list_indexed_markdown_files_for_semantic_index(&root)
            .expect("query facade 应成功列出 markdown 文件");

        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].relative_path, "Notes/Alpha.md");
        assert_eq!(entries[0].title, "Alpha");

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn query_facade_should_load_markdown_file() {
        let root = create_test_root();
        fs::create_dir_all(root.join("Notes")).expect("应成功创建测试目录");
        fs::write(root.join("Notes/Beta.md"), "# Beta\n\ncontent").expect("应成功写入测试文件");

        let loaded = load_markdown_file_for_semantic_index("Notes/Beta.md".to_string(), &root)
            .expect("query facade 应成功读取 markdown 文件");

        assert_eq!(loaded.relative_path, "Notes/Beta.md");
        assert_eq!(loaded.content, "# Beta\n\ncontent");

        let _ = fs::remove_dir_all(root);
    }
}
