//! # 仓库命令模块
//!
//! 提供仓库目录设置、目录树读取、Markdown 文件读写、
//! WikiLink 解析、图谱构建、快速切换搜索、反向链接与中文分词命令。

pub(crate) mod backlinks;
pub(crate) mod frontmatter_query;
mod fs_helpers;
pub(crate) mod graph;
pub(crate) mod markdown_ast;
mod markdown_block_detector;
pub(crate) mod outline;
mod query_index;
pub(crate) mod search;
pub(crate) mod segment;
pub(crate) mod types;
pub(crate) mod vault_ops;
pub(crate) mod wikilink;

pub use backlinks::get_backlinks_for_file_in_root;
pub use frontmatter_query::query_vault_markdown_frontmatter_in_root;
pub use graph::get_current_vault_markdown_graph_in_root;
pub use markdown_ast::get_vault_markdown_ast_in_root;
pub use markdown_ast::parse_markdown_to_ast;
pub use outline::get_vault_markdown_outline_in_root;
pub use search::search_vault_markdown_files_in_root;
pub use search::suggest_wikilink_targets_in_root;
pub use vault_ops::{
    copy_vault_entry_in_root, create_vault_binary_file_in_root, create_vault_directory_in_root,
    create_vault_markdown_file_in_root, delete_vault_binary_file_in_root,
    delete_vault_directory_in_root, delete_vault_markdown_file_in_root,
    get_current_vault_config_in_root, get_current_vault_tree_in_root,
    move_vault_directory_to_directory_in_root, move_vault_markdown_file_to_directory_in_root,
    read_vault_binary_file_in_root, read_vault_markdown_file_in_root,
    rename_vault_directory_in_root, rename_vault_markdown_file_in_root,
    save_current_vault_config_in_root, save_vault_markdown_file_in_root,
    set_current_vault_precheck,
};
pub use wikilink::{
    resolve_media_embed_target_in_root, resolve_wikilink_target_in_root,
    resolve_wikilink_target_path_in_vault,
};

/// 对外导出索引构建与查询函数以支持基准测试。
pub use query_index::ensure_query_index_current;
pub use query_index::list_markdown_files;
pub use query_index::load_markdown_graph;

#[cfg(test)]
pub(crate) use wikilink::path_tree_distance;
#[cfg(test)]
pub(crate) use wikilink::resolve_media_embed_target_path_in_vault;
#[cfg(test)]
pub(crate) use wikilink::{extract_markdown_inline_link_targets, extract_wikilink_targets};

#[cfg(test)]
mod tests {
    use super::{
        extract_markdown_inline_link_targets, extract_wikilink_targets,
        move_vault_markdown_file_to_directory_in_root, path_tree_distance,
        resolve_media_embed_target_path_in_vault, resolve_wikilink_target_path_in_vault,
    };
    use crate::vault_commands::query_index::ensure_query_index_current;
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
        let root = std::env::temp_dir().join(format!("ofive-wikilink-test-{unique}-{sequence}"));
        fs::create_dir_all(root.join(".ofive")).expect("应成功创建测试根目录");
        root
    }

    fn create_markdown_file(root: &Path, relative_path: &str) {
        let target = root.join(relative_path);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).expect("应成功创建测试目录");
        }
        fs::write(&target, "# test\n").expect("应成功写入测试文件");
    }

    #[test]
    fn path_tree_distance_should_compute_expected_steps() {
        let left = Path::new("a/b/c");
        let right = Path::new("a/d/e");
        assert_eq!(path_tree_distance(left, right), 4);

        let same = Path::new("a/b");
        assert_eq!(path_tree_distance(same, same), 0);
    }

    #[test]
    fn resolve_wikilink_target_should_match_relative_path_from_vault_root() {
        let root = create_test_root();
        create_markdown_file(&root, "docs/guide.md");

        let result = resolve_wikilink_target_path_in_vault(&root, "docs", "docs/guide")
            .expect("解析应成功")
            .expect("应命中文件");

        assert!(result.ends_with(Path::new("docs/guide.md")));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn resolve_wikilink_target_should_match_relative_path_from_current_dir() {
        let root = create_test_root();
        create_markdown_file(&root, "notes/topic/intro.md");

        let result = resolve_wikilink_target_path_in_vault(&root, "notes/topic", "./intro")
            .expect("解析应成功")
            .expect("应命中文件");

        assert!(result.ends_with(Path::new("notes/topic/intro.md")));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn resolve_wikilink_target_should_match_absolute_path() {
        let root = create_test_root();
        create_markdown_file(&root, "refs/network/protocol.md");
        let absolute = root.join("refs/network/protocol.md");

        let result = resolve_wikilink_target_path_in_vault(
            &root,
            "refs",
            absolute.to_string_lossy().as_ref(),
        )
        .expect("解析应成功")
        .expect("应命中文件");

        assert_eq!(result, absolute.canonicalize().expect("应能 canonicalize"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn resolve_wikilink_target_should_pick_nearest_named_file() {
        let root = create_test_root();
        create_markdown_file(&root, "notes/topic/readme.md");
        create_markdown_file(&root, "archive/2024/readme.md");

        ensure_query_index_current(&root).expect("构建索引应成功");

        let result = resolve_wikilink_target_path_in_vault(&root, "notes/topic", "readme")
            .expect("解析应成功")
            .expect("应命中文件");

        assert!(result.ends_with(Path::new("notes/topic/readme.md")));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn resolve_wikilink_target_should_match_case_insensitively() {
        let root = create_test_root();
        create_markdown_file(&root, "notes/topic/Information-Science.md");

        ensure_query_index_current(&root).expect("构建索引应成功");

        let result =
            resolve_wikilink_target_path_in_vault(&root, "notes/topic", "information-science")
                .expect("解析应成功")
                .expect("应命中文件");

        assert!(result.ends_with(Path::new("notes/topic/Information-Science.md")));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn resolve_wikilink_target_should_return_none_when_target_missing() {
        let root = create_test_root();
        create_markdown_file(&root, "notes/exists.md");

        let result =
            resolve_wikilink_target_path_in_vault(&root, "notes", "not-found").expect("解析应成功");

        assert!(result.is_none());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn move_vault_markdown_file_to_directory_should_move_file_and_keep_filename() {
        let root = create_test_root();
        create_markdown_file(&root, "notes/source.md");

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

    #[test]
    fn extract_wikilink_targets_should_parse_alias_and_heading() {
        let content = "[[A/B|别名]] [[Topic#Section]] [[  Plain  ]]";
        let targets = extract_wikilink_targets(content);

        assert_eq!(targets, vec!["A/B", "Topic", "Plain"]);
    }

    #[test]
    fn extract_markdown_inline_link_targets_should_ignore_external_and_images() {
        let content = "[Doc](notes/guide.md) ![img](assets/a.png) [Web](https://example.com) [Relative](../topic/readme#part)";
        let targets = extract_markdown_inline_link_targets(content);

        assert_eq!(targets, vec!["notes/guide.md", "../topic/readme"]);
    }

    #[test]
    fn resolve_media_embed_target_should_match_relative_image_path() {
        let root = create_test_root();
        fs::create_dir_all(root.join("notes")).expect("应成功创建当前目录");
        let image_path = root.join("assets/images/logo.png");
        if let Some(parent) = image_path.parent() {
            fs::create_dir_all(parent).expect("应成功创建图片目录");
        }
        fs::write(&image_path, [1u8, 2u8, 3u8]).expect("应成功写入图片文件");

        let result =
            resolve_media_embed_target_path_in_vault(&root, "notes", "assets/images/logo.png")
                .expect("解析应成功")
                .expect("应命中图片文件");

        assert!(result.ends_with(Path::new("assets/images/logo.png")));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn resolve_media_embed_target_should_pick_nearest_stem_match() {
        let root = create_test_root();
        let near_image = root.join("notes/topic/pasted-image-1.png");
        let far_image = root.join("archive/2025/pasted-image-1.jpg");

        if let Some(parent) = near_image.parent() {
            fs::create_dir_all(parent).expect("应成功创建近目录");
        }
        if let Some(parent) = far_image.parent() {
            fs::create_dir_all(parent).expect("应成功创建远目录");
        }

        fs::write(&near_image, [1u8]).expect("应成功写入近图片文件");
        fs::write(&far_image, [2u8]).expect("应成功写入远图片文件");

        let result =
            resolve_media_embed_target_path_in_vault(&root, "notes/topic", "pasted-image-1")
                .expect("解析应成功")
                .expect("应命中图片文件");

        assert!(result.ends_with(Path::new("notes/topic/pasted-image-1.png")));
        let _ = fs::remove_dir_all(root);
    }

    // ---- 追加：提取函数应跳过块级结构内的匹配 ----

    #[test]
    fn extract_wikilink_targets_should_skip_code_block() {
        let content = "[[real]]\n```\n[[fake]]\n```\n[[also-real]]";
        let targets = extract_wikilink_targets(content);
        assert_eq!(targets, vec!["real", "also-real"]);
    }

    #[test]
    fn extract_wikilink_targets_should_skip_frontmatter() {
        let content = "---\ntags: [[not-a-link]]\n---\n[[actual-link]]";
        let targets = extract_wikilink_targets(content);
        assert_eq!(targets, vec!["actual-link"]);
    }

    #[test]
    fn extract_wikilink_targets_should_skip_latex_block() {
        let content = "[[before]]\n$$\n[[latex-fake]]\n$$\n[[after]]";
        let targets = extract_wikilink_targets(content);
        assert_eq!(targets, vec!["before", "after"]);
    }

    #[test]
    fn extract_wikilink_targets_should_skip_all_block_types() {
        let content = concat!(
            "---\ntitle: [[fm]]\n---\n",
            "[[real-1]]\n",
            "```\n[[code]]\n```\n",
            "[[real-2]]\n",
            "$$\n[[latex]]\n$$\n",
            "[[real-3]]"
        );
        let targets = extract_wikilink_targets(content);
        assert_eq!(targets, vec!["real-1", "real-2", "real-3"]);
    }

    #[test]
    fn extract_inline_link_targets_should_skip_code_block() {
        let content = "[real](real.md)\n```\n[fake](fake.md)\n```\n[also](also.md)";
        let targets = extract_markdown_inline_link_targets(content);
        assert_eq!(targets, vec!["real.md", "also.md"]);
    }

    #[test]
    fn extract_inline_link_targets_should_skip_frontmatter() {
        let content = "---\nref: [link](not-real.md)\n---\n[ok](ok.md)";
        let targets = extract_markdown_inline_link_targets(content);
        assert_eq!(targets, vec!["ok.md"]);
    }

    #[test]
    fn extract_inline_link_targets_should_skip_latex_block() {
        let content = "[a](a.md)\n$$\n[b](b.md)\n$$\n[c](c.md)";
        let targets = extract_markdown_inline_link_targets(content);
        assert_eq!(targets, vec!["a.md", "c.md"]);
    }
}
