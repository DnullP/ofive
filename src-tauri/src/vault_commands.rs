//! # 仓库命令模块
//!
//! 提供仓库目录设置、目录树读取、Markdown 文件读写、
//! WikiLink 解析、图谱构建、快速切换搜索、反向链接与中文分词命令。

mod backlinks;
mod fs_helpers;
mod graph;
mod markdown_block_detector;
mod query_index;
mod search;
mod segment;
mod types;
mod vault_ops;
mod wikilink;

use crate::state::AppState;
use crate::vault_config::VaultConfig;
use std::time::Instant;
use tauri::{AppHandle, State};

/// 包装命令执行并记录耗时的宏。
///
/// 记录命令的调用、成功耗时或失败耗时日志。
/// 要求 `$body` 返回 `Result<_, String>`。
///
/// # 参数
/// - `$name`：命令名称字符串
/// - `$body`：命令执行表达式
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

pub use backlinks::get_backlinks_for_file_in_root;
pub use graph::get_current_vault_markdown_graph_in_root;
pub use search::search_vault_markdown_files_in_root;
pub use search::suggest_wikilink_targets_in_root;
pub use types::*;
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

#[tauri::command]
pub fn set_current_vault(
    vault_path: String,
    app_handle: AppHandle,
    state: State<'_, AppState>,
) -> Result<SetVaultResponse, String> {
    timed_command!(
        "set_current_vault",
        vault_ops::set_current_vault(vault_path, app_handle, state)
    )
}

#[tauri::command]
pub fn get_current_vault_tree(state: State<'_, AppState>) -> Result<VaultTreeResponse, String> {
    timed_command!(
        "get_current_vault_tree",
        vault_ops::get_current_vault_tree(state)
    )
}

#[tauri::command]
pub fn read_vault_markdown_file(
    relative_path: String,
    state: State<'_, AppState>,
) -> Result<ReadMarkdownResponse, String> {
    timed_command!(
        "read_vault_markdown_file",
        vault_ops::read_vault_markdown_file(relative_path, state)
    )
}

#[tauri::command]
pub fn read_vault_binary_file(
    relative_path: String,
    state: State<'_, AppState>,
) -> Result<ReadBinaryFileResponse, String> {
    timed_command!(
        "read_vault_binary_file",
        vault_ops::read_vault_binary_file(relative_path, state)
    )
}

#[tauri::command]
pub fn create_vault_markdown_file(
    relative_path: String,
    content: Option<String>,
    source_trace_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<WriteMarkdownResponse, String> {
    timed_command!(
        "create_vault_markdown_file",
        vault_ops::create_vault_markdown_file(relative_path, content, source_trace_id, state)
    )
}

#[tauri::command]
pub fn create_vault_directory(
    relative_directory_path: String,
    source_trace_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    timed_command!(
        "create_vault_directory",
        vault_ops::create_vault_directory(relative_directory_path, source_trace_id, state)
    )
}

#[tauri::command]
pub fn create_vault_binary_file(
    relative_path: String,
    base64_content: String,
    source_trace_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<WriteBinaryFileResponse, String> {
    timed_command!(
        "create_vault_binary_file",
        vault_ops::create_vault_binary_file(relative_path, base64_content, source_trace_id, state)
    )
}

#[tauri::command]
pub fn save_vault_markdown_file(
    relative_path: String,
    content: String,
    source_trace_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<WriteMarkdownResponse, String> {
    timed_command!(
        "save_vault_markdown_file",
        vault_ops::save_vault_markdown_file(relative_path, content, source_trace_id, state)
    )
}

#[tauri::command]
pub fn rename_vault_markdown_file(
    from_relative_path: String,
    to_relative_path: String,
    source_trace_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<WriteMarkdownResponse, String> {
    timed_command!(
        "rename_vault_markdown_file",
        vault_ops::rename_vault_markdown_file(
            from_relative_path,
            to_relative_path,
            source_trace_id,
            state,
        )
    )
}

#[tauri::command]
pub fn delete_vault_markdown_file(
    relative_path: String,
    source_trace_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    timed_command!(
        "delete_vault_markdown_file",
        vault_ops::delete_vault_markdown_file(relative_path, source_trace_id, state)
    )
}
/// 删除仓库中的二进制文件（图片等非 Markdown 文件）。
///
/// # 参数
/// - `relative_path` - 目标文件相对路径。
/// - `source_trace_id` - 前端写入追踪 ID（可选）。
/// - `state` - 应用共享状态。
///
/// # 返回
/// - 成功返回 `Ok(())`。
#[tauri::command]
pub fn delete_vault_binary_file(
    relative_path: String,
    source_trace_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    vault_ops::delete_vault_binary_file(relative_path, source_trace_id, state)
}
#[tauri::command]
pub fn move_vault_markdown_file_to_directory(
    from_relative_path: String,
    target_directory_relative_path: String,
    source_trace_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<WriteMarkdownResponse, String> {
    timed_command!(
        "move_vault_markdown_file_to_directory",
        vault_ops::move_vault_markdown_file_to_directory(
            from_relative_path,
            target_directory_relative_path,
            source_trace_id,
            state,
        )
    )
}

#[tauri::command]
pub fn rename_vault_directory(
    from_relative_path: String,
    to_relative_path: String,
    source_trace_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<WriteMarkdownResponse, String> {
    timed_command!(
        "rename_vault_directory",
        vault_ops::rename_vault_directory(
            from_relative_path,
            to_relative_path,
            source_trace_id,
            state
        )
    )
}

#[tauri::command]
pub fn move_vault_directory_to_directory(
    from_relative_path: String,
    target_directory_relative_path: String,
    source_trace_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<WriteMarkdownResponse, String> {
    timed_command!(
        "move_vault_directory_to_directory",
        vault_ops::move_vault_directory_to_directory(
            from_relative_path,
            target_directory_relative_path,
            source_trace_id,
            state,
        )
    )
}

#[tauri::command]
pub fn delete_vault_directory(
    relative_path: String,
    source_trace_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    timed_command!(
        "delete_vault_directory",
        vault_ops::delete_vault_directory(relative_path, source_trace_id, state)
    )
}

#[tauri::command]
pub fn copy_vault_entry(
    source_relative_path: String,
    target_directory_relative_path: String,
    source_trace_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<CopyEntryResponse, String> {
    timed_command!(
        "copy_vault_entry",
        vault_ops::copy_vault_entry(
            source_relative_path,
            target_directory_relative_path,
            source_trace_id,
            state,
        )
    )
}

#[tauri::command]
pub fn resolve_wikilink_target(
    current_dir: String,
    target: String,
    state: State<'_, AppState>,
) -> Result<Option<ResolveWikiLinkTargetResponse>, String> {
    timed_command!(
        "resolve_wikilink_target",
        wikilink::resolve_wikilink_target(current_dir, target, state)
    )
}

#[tauri::command]
pub fn resolve_media_embed_target(
    current_dir: String,
    target: String,
    state: State<'_, AppState>,
) -> Result<Option<ResolveMediaEmbedTargetResponse>, String> {
    timed_command!(
        "resolve_media_embed_target",
        wikilink::resolve_media_embed_target(current_dir, target, state)
    )
}

#[tauri::command]
pub fn search_vault_markdown_files(
    query: String,
    limit: Option<usize>,
    state: State<'_, AppState>,
) -> Result<Vec<VaultQuickSwitchItem>, String> {
    timed_command!(
        "search_vault_markdown_files",
        search::search_vault_markdown_files(query, limit, state)
    )
}

#[tauri::command]
pub fn get_current_vault_markdown_graph(
    state: State<'_, AppState>,
) -> Result<VaultMarkdownGraphResponse, String> {
    timed_command!(
        "get_current_vault_markdown_graph",
        graph::get_current_vault_markdown_graph(state)
    )
}

#[tauri::command]
pub fn segment_chinese_text(text: String) -> Result<Vec<ChineseSegmentToken>, String> {
    timed_command!("segment_chinese_text", segment::segment_chinese_text(text))
}

#[tauri::command]
pub fn suggest_wikilink_targets(
    query: String,
    limit: Option<usize>,
    state: State<'_, AppState>,
) -> Result<Vec<WikiLinkSuggestionItem>, String> {
    timed_command!(
        "suggest_wikilink_targets",
        search::suggest_wikilink_targets(query, limit, state)
    )
}

#[tauri::command]
pub fn get_current_vault_config(state: State<'_, AppState>) -> Result<VaultConfig, String> {
    timed_command!(
        "get_current_vault_config",
        vault_ops::get_current_vault_config(state)
    )
}

#[tauri::command]
pub fn save_current_vault_config(
    config: VaultConfig,
    source_trace_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<VaultConfig, String> {
    timed_command!(
        "save_current_vault_config",
        vault_ops::save_current_vault_config(config, source_trace_id, state)
    )
}

#[tauri::command]
pub fn get_backlinks_for_file(
    relative_path: String,
    state: State<'_, AppState>,
) -> Result<Vec<BacklinkItem>, String> {
    timed_command!(
        "get_backlinks_for_file",
        backlinks::get_backlinks_for_file(relative_path, state)
    )
}

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
