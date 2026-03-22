//! # 反向链接查询基础设施模块
//!
//! 提供查询指定 Markdown 文件被哪些文件引用的能力。
//! 该模块直接依赖索引层，不承担 Tauri 状态解析与命令包装职责。

use crate::infra::query::query_index;
use crate::shared::vault_contracts::BacklinkItem;
use std::path::Path;

/// 查询指定文件的反向链接。
///
/// # 参数
/// - `vault_root`：仓库根目录
/// - `relative_path`：目标文件相对路径
///
/// # 返回
/// - 成功时返回 `Vec<BacklinkItem>`
/// - 失败时返回错误描述
///
/// # 副作用
/// - 触发索引一致性检查
pub(crate) fn get_backlinks_for_file_in_root(
    vault_root: &Path,
    relative_path: &str,
) -> Result<Vec<BacklinkItem>, String> {
    log::info!(
        "[vault-backlinks] get_backlinks_for_file start: path={}",
        relative_path
    );
    let items = query_index::get_backlinks_for_file(vault_root, relative_path)?;
    log::info!(
        "[vault-backlinks] get_backlinks_for_file success: path={} count={}",
        relative_path,
        items.len()
    );
    Ok(items)
}

#[cfg(test)]
mod tests {
    use super::get_backlinks_for_file_in_root;
    use crate::infra::query::query_index::ensure_query_index_current;
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
        let root = std::env::temp_dir().join(format!("ofive-backlinks-test-{unique}-{sequence}"));
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
    fn backlinks_should_return_sources_referencing_target() {
        let root = create_test_root();
        write_markdown_file(&root, "A.md", "# A\n\n[[B]]");
        write_markdown_file(&root, "B.md", "# B");
        write_markdown_file(&root, "C.md", "# C\n\n[[B]] [[B]]");

        ensure_query_index_current(&root).expect("构建索引应成功");

        let items = get_backlinks_for_file_in_root(&root, "B.md").expect("查询反向链接应成功");

        assert_eq!(items.len(), 2, "B.md 应有 2 个反向链接源");
        assert_eq!(items[0].source_path, "C.md");
        assert_eq!(items[0].weight, 2);
        assert_eq!(items[1].source_path, "A.md");
        assert_eq!(items[1].weight, 1);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn backlinks_should_return_empty_for_unreferenced_file() {
        let root = create_test_root();
        write_markdown_file(&root, "A.md", "# A");
        write_markdown_file(&root, "B.md", "# B\n\n[[A]]");

        ensure_query_index_current(&root).expect("构建索引应成功");

        let items = get_backlinks_for_file_in_root(&root, "B.md").expect("查询反向链接应成功");

        assert!(items.is_empty(), "B.md 未被任何文件引用，应返回空列表");

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn backlinks_should_exclude_self_references() {
        let root = create_test_root();
        write_markdown_file(&root, "A.md", "# A\n\n[[A]]");

        ensure_query_index_current(&root).expect("构建索引应成功");

        let items = get_backlinks_for_file_in_root(&root, "A.md").expect("查询反向链接应成功");

        assert!(items.is_empty(), "自引用不应出现在反向链接中");

        let _ = fs::remove_dir_all(root);
    }
}
