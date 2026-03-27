//! # 查询索引单元测试模块
//!
//! 承载 `query_index` 的纯 Rust 单元测试，覆盖冷启动重建、
//! 增量更新、目录重命名与目录删除等核心索引维护路径。

use super::{
    ensure_query_index_current, list_markdown_files, load_markdown_graph,
    reindex_markdown_file, relocate_directory_in_index, remove_directory_from_index,
    remove_markdown_file,
};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

static TEST_ROOT_SEQ: AtomicU64 = AtomicU64::new(1);

/// 创建当前测试用例专属的临时 vault 根目录。
///
/// # 返回
/// - 返回一个已经创建 `.ofive` 目录的临时路径。
fn create_test_root() -> PathBuf {
    let sequence = TEST_ROOT_SEQ.fetch_add(1, Ordering::Relaxed);
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    let root = std::env::temp_dir().join(format!("ofive-query-index-test-{unique}-{sequence}"));
    fs::create_dir_all(root.join(".ofive")).expect("应成功创建测试根目录");
    root
}

/// 在测试 vault 中写入一份 Markdown 文件。
///
/// # 参数
/// - `root`：测试 vault 根目录
/// - `relative_path`：相对路径
/// - `content`：文件内容
fn write_markdown_file(root: &Path, relative_path: &str, content: &str) {
    let file_path = root.join(relative_path);
    if let Some(parent) = file_path.parent() {
        fs::create_dir_all(parent).expect("应成功创建测试目录");
    }
    fs::write(file_path, content).expect("应成功写入测试文件");
}

#[test]
fn query_index_should_rebuild_and_query_graph() {
    let root = create_test_root();
    write_markdown_file(&root, "A.md", "[[B]] [b](./B)");
    write_markdown_file(&root, "B.md", "[[A]]");

    ensure_query_index_current(&root).expect("应成功构建索引");

    let files = list_markdown_files(&root).expect("应成功读取文件索引");
    assert_eq!(files.len(), 2);

    let graph = load_markdown_graph(&root).expect("应成功读取图谱索引");
    assert_eq!(graph.nodes.len(), 2);
    assert_eq!(graph.edges.len(), 2);
    assert!(graph.edges.iter().any(|edge| {
        edge.source_path == "A.md" && edge.target_path == "B.md" && edge.weight == 2
    }));

    let _ = fs::remove_dir_all(root);
}

/// 验证增量 reindex：在索引已初始化的前提下，
/// 新增文件后调用 reindex_markdown_file 应只更新单文件，
/// 不触发全库重建，且索引数据正确反映变更。
#[test]
fn reindex_should_incrementally_add_file_when_index_exists() {
    let root = create_test_root();
    write_markdown_file(&root, "A.md", "# A");

    ensure_query_index_current(&root).expect("初始构建应成功");
    let files = list_markdown_files(&root).expect("读取索引应成功");
    assert_eq!(files.len(), 1, "初始应有 1 个文件");

    write_markdown_file(&root, "B.md", "# B\n\n[[A]]");
    reindex_markdown_file(&root, "B.md").expect("增量 reindex 应成功");

    let files = list_markdown_files(&root).expect("增量后读取索引应成功");
    assert_eq!(files.len(), 2, "增量 reindex 后应有 2 个文件");

    let graph = load_markdown_graph(&root).expect("读取图谱应成功");
    assert!(
        graph
            .edges
            .iter()
            .any(|e| e.source_path == "B.md" && e.target_path == "A.md"),
        "应存在 B→A 边"
    );

    let _ = fs::remove_dir_all(root);
}

/// 验证增量 reindex：修改已有文件内容后，
/// 调用 reindex_markdown_file 应更新链接关系。
#[test]
fn reindex_should_update_links_on_content_change() {
    let root = create_test_root();
    write_markdown_file(&root, "A.md", "# A\n\n[[B]]");
    write_markdown_file(&root, "B.md", "# B");
    write_markdown_file(&root, "C.md", "# C");

    ensure_query_index_current(&root).expect("初始构建应成功");

    let graph = load_markdown_graph(&root).expect("初始图谱应可读");
    assert!(
        graph
            .edges
            .iter()
            .any(|e| e.source_path == "A.md" && e.target_path == "B.md"),
        "初始应有 A→B 边"
    );

    write_markdown_file(&root, "A.md", "# A\n\n[[C]]");
    reindex_markdown_file(&root, "A.md").expect("增量 reindex 应成功");

    let graph = load_markdown_graph(&root).expect("更新后图谱应可读");
    assert!(
        !graph
            .edges
            .iter()
            .any(|e| e.source_path == "A.md" && e.target_path == "B.md"),
        "A→B 边应消失"
    );
    assert!(
        graph
            .edges
            .iter()
            .any(|e| e.source_path == "A.md" && e.target_path == "C.md"),
        "A→C 边应出现"
    );

    let _ = fs::remove_dir_all(root);
}

/// 验证增量 remove：删除文件后调用 remove_markdown_file
/// 应从索引中移除该文件及其相关边。
#[test]
fn remove_should_delete_file_and_edges_from_index() {
    let root = create_test_root();
    write_markdown_file(&root, "A.md", "# A\n\n[[B]]");
    write_markdown_file(&root, "B.md", "# B\n\n[[A]]");

    ensure_query_index_current(&root).expect("初始构建应成功");
    let files = list_markdown_files(&root).expect("读取索引应成功");
    assert_eq!(files.len(), 2);

    fs::remove_file(root.join("B.md")).expect("删除文件应成功");
    remove_markdown_file(&root, "B.md").expect("增量 remove 应成功");

    let files = list_markdown_files(&root).expect("移除后读取索引应成功");
    assert_eq!(files.len(), 1, "移除后应只剩 1 个文件");
    assert_eq!(files[0].relative_path, "A.md");

    let graph = load_markdown_graph(&root).expect("移除后读取图谱应成功");
    assert!(graph.edges.is_empty(), "所有涉及 B.md 的边应消失");

    let _ = fs::remove_dir_all(root);
}

/// 验证 reindex 在索引未初始化时能自动触发全量构建。
/// 即使不先调用 ensure_query_index_current，
/// reindex_markdown_file 也应正确工作。
#[test]
fn reindex_should_bootstrap_index_when_not_initialized() {
    let root = create_test_root();
    write_markdown_file(&root, "A.md", "# A");
    write_markdown_file(&root, "B.md", "# B\n\n[[A]]");

    reindex_markdown_file(&root, "A.md").expect("首次 reindex 应自动构建索引");

    let files = list_markdown_files(&root).expect("读取索引应成功");
    assert_eq!(files.len(), 2, "自动构建后应包含所有文件");

    let _ = fs::remove_dir_all(root);
}

/// 验证增量 reindex 后 manifest fingerprint 更新正确，
/// 再次调用 ensure_query_index_current 不应触发全量重建。
#[test]
fn reindex_should_update_fingerprint_to_avoid_unnecessary_rebuild() {
    let root = create_test_root();
    write_markdown_file(&root, "A.md", "# A");

    ensure_query_index_current(&root).expect("初始构建应成功");

    write_markdown_file(&root, "B.md", "# B");
    reindex_markdown_file(&root, "B.md").expect("增量 reindex 应成功");

    ensure_query_index_current(&root).expect("二次 ensure 应成功");
    let files = list_markdown_files(&root).expect("读取索引应成功");
    assert_eq!(files.len(), 2, "ensure 不应重建导致数据丢失");

    let _ = fs::remove_dir_all(root);
}

/// 验证目录重定位：移动目录后，索引中的路径和链接应正确更新。
#[test]
fn relocate_directory_should_update_paths_and_links() {
    let root = create_test_root();
    write_markdown_file(&root, "dir_a/X.md", "# X\n\n[[Y]]");
    write_markdown_file(&root, "dir_a/Y.md", "# Y\n\n[[X]]");
    write_markdown_file(&root, "other/Z.md", "# Z\n\n[[X]]");

    ensure_query_index_current(&root).expect("初始构建应成功");

    let files = list_markdown_files(&root).expect("读取索引应成功");
    assert_eq!(files.len(), 3);

    fs::rename(root.join("dir_a"), root.join("dir_b")).expect("rename 应成功");

    relocate_directory_in_index(&root, "dir_a", "dir_b").expect("目录重定位索引应成功");

    let files = list_markdown_files(&root).expect("重定位后读取索引应成功");
    assert_eq!(files.len(), 3, "文件数应不变");
    assert!(
        files.iter().any(|f| f.relative_path == "dir_b/X.md"),
        "X.md 路径应更新为 dir_b/X.md"
    );
    assert!(
        files.iter().any(|f| f.relative_path == "dir_b/Y.md"),
        "Y.md 路径应更新为 dir_b/Y.md"
    );
    assert!(
        !files.iter().any(|f| f.relative_path.starts_with("dir_a/")),
        "不应存在旧路径 dir_a/"
    );

    let graph = load_markdown_graph(&root).expect("读取图谱应成功");
    assert!(
        graph
            .edges
            .iter()
            .any(|e| e.source_path == "dir_b/X.md" && e.target_path == "dir_b/Y.md"),
        "应存在 dir_b/X.md → dir_b/Y.md 边"
    );

    let _ = fs::remove_dir_all(root);
}

/// 验证目录重定位：嵌套子目录的路径也应正确更新。
#[test]
fn relocate_directory_should_handle_nested_subdirectories() {
    let root = create_test_root();
    write_markdown_file(&root, "parent/child/A.md", "# A");
    write_markdown_file(&root, "parent/child/deep/B.md", "# B\n\n[[A]]");

    ensure_query_index_current(&root).expect("初始构建应成功");

    fs::rename(root.join("parent"), root.join("moved")).expect("rename 应成功");

    relocate_directory_in_index(&root, "parent", "moved").expect("嵌套目录重定位应成功");

    let files = list_markdown_files(&root).expect("读取索引应成功");
    assert_eq!(files.len(), 2);
    assert!(
        files.iter().any(|f| f.relative_path == "moved/child/A.md"),
        "A.md 路径应更新"
    );
    assert!(
        files
            .iter()
            .any(|f| f.relative_path == "moved/child/deep/B.md"),
        "B.md 路径应更新"
    );

    let _ = fs::remove_dir_all(root);
}

/// 验证目录重定位：不存在的目录前缀应安全返回。
#[test]
fn relocate_directory_should_be_noop_for_nonexistent_prefix() {
    let root = create_test_root();
    write_markdown_file(&root, "A.md", "# A");
    ensure_query_index_current(&root).expect("初始构建应成功");

    relocate_directory_in_index(&root, "nonexistent", "somewhere")
        .expect("不存在的前缀应安全返回");

    let files = list_markdown_files(&root).expect("读取索引应成功");
    assert_eq!(files.len(), 1);

    let _ = fs::remove_dir_all(root);
}

/// 验证目录删除索引：删除目录后索引应移除该目录下所有文件和链接。
#[test]
fn remove_directory_should_delete_files_and_links() {
    let root = create_test_root();
    write_markdown_file(&root, "keep/A.md", "# A");
    write_markdown_file(&root, "delete_me/B.md", "# B\n\n[[A]]");
    write_markdown_file(&root, "delete_me/C.md", "# C");

    ensure_query_index_current(&root).expect("初始构建应成功");
    let files = list_markdown_files(&root).expect("读取索引应成功");
    assert_eq!(files.len(), 3);

    fs::remove_dir_all(root.join("delete_me")).expect("删除目录应成功");
    remove_directory_from_index(&root, "delete_me").expect("目录删除索引应成功");

    let files = list_markdown_files(&root).expect("删除后读取索引应成功");
    assert_eq!(files.len(), 1, "应只剩 1 个文件");
    assert_eq!(files[0].relative_path, "keep/A.md");

    let graph = load_markdown_graph(&root).expect("删除后读取图谱应成功");
    assert!(graph.edges.is_empty(), "所有涉及已删除目录的边应消失");

    let _ = fs::remove_dir_all(root);
}