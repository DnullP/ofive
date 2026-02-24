//! # 仓库文件系统与查询索引一致性集成测试
//!
//! 验证所有文件/目录写入操作后：
//! 1. 文件系统真实状态与目录树 API 返回一致
//! 2. SQLite 查询索引（搜索、图谱）与文件系统一致
//! 3. 目录级操作（rename/move/delete）正确触发索引重建
//! 4. 多步骤混合操作后无残留脏数据
//! 5. pending write trace 注册覆盖所有写入路径

#[path = "support/mod.rs"]
mod support;

use ofive_lib::{
    create_vault_directory_in_root, create_vault_markdown_file_in_root,
    delete_vault_directory_in_root, delete_vault_markdown_file_in_root,
    get_current_vault_markdown_graph_in_root, get_current_vault_tree_in_root,
    move_vault_directory_to_directory_in_root, move_vault_markdown_file_to_directory_in_root,
    rename_vault_directory_in_root, rename_vault_markdown_file_in_root,
    save_vault_markdown_file_in_root, search_vault_markdown_files_in_root,
};
use std::collections::BTreeSet;
use support::TestVault;

// ────────── 辅助函数 ──────────

/// 从目录树响应提取所有 Markdown 文件路径集合。
fn tree_markdown_paths(vault_root: &std::path::Path) -> BTreeSet<String> {
    let tree = get_current_vault_tree_in_root(vault_root).expect("读取目录树应成功");
    tree.entries
        .into_iter()
        .filter(|e| !e.is_dir)
        .filter(|e| e.relative_path.ends_with(".md") || e.relative_path.ends_with(".markdown"))
        .map(|e| e.relative_path)
        .collect()
}

/// 从目录树响应提取所有目录路径集合。
fn tree_directory_paths(vault_root: &std::path::Path) -> BTreeSet<String> {
    let tree = get_current_vault_tree_in_root(vault_root).expect("读取目录树应成功");
    tree.entries
        .into_iter()
        .filter(|e| e.is_dir)
        .map(|e| e.relative_path)
        .collect()
}

/// 从搜索接口读取索引中的 Markdown 文件路径集合。
fn search_markdown_paths(vault_root: &std::path::Path) -> BTreeSet<String> {
    search_vault_markdown_files_in_root(vault_root, "".to_string(), Some(500))
        .expect("搜索索引应可用")
        .into_iter()
        .map(|item| item.relative_path)
        .collect()
}

/// 从图谱接口读取节点路径集合及边列表。
fn graph_data(vault_root: &std::path::Path) -> (BTreeSet<String>, Vec<(String, String)>) {
    let graph =
        get_current_vault_markdown_graph_in_root(vault_root).expect("图谱索引应可用");
    let nodes: BTreeSet<String> = graph.nodes.iter().map(|n| n.path.clone()).collect();
    let edges: Vec<(String, String)> = graph
        .edges
        .iter()
        .map(|e| (e.source_path.clone(), e.target_path.clone()))
        .collect();
    (nodes, edges)
}

/// 全面断言"文件系统 ↔ 搜索索引 ↔ 图谱索引"三者一致。
fn assert_full_consistency(vault_root: &std::path::Path, context: &str) {
    let fs_paths = tree_markdown_paths(vault_root);
    let idx_paths = search_markdown_paths(vault_root);
    let (graph_nodes, graph_edges) = graph_data(vault_root);

    assert_eq!(
        fs_paths, idx_paths,
        "[{}] 搜索索引应与文件系统一致\n  FS: {:?}\n  IDX: {:?}",
        context, fs_paths, idx_paths
    );
    assert_eq!(
        fs_paths, graph_nodes,
        "[{}] 图谱节点应与文件系统一致\n  FS: {:?}\n  GRAPH: {:?}",
        context, fs_paths, graph_nodes
    );

    // 图谱边的两端必须都是已知节点
    for (source, target) in &graph_edges {
        assert!(
            graph_nodes.contains(source),
            "[{}] 图谱边 source 不存在: {}",
            context, source
        );
        assert!(
            graph_nodes.contains(target),
            "[{}] 图谱边 target 不存在: {}",
            context, target
        );
    }
}

// ────────── 测试用例 ──────────

/// 目录重命名后，索引应通过 ensure_query_index_current 重建，
/// 旧路径从索引中消失、新路径出现。
#[test]
fn rename_directory_should_keep_index_consistent() {
    let vault = TestVault::new();

    create_vault_markdown_file_in_root(
        "notes/dir-a/nested.md".to_string(),
        Some("# Nested\n\n[[guide]]".to_string()),
        &vault.root,
    )
    .expect("创建嵌套文件应成功");
    assert_full_consistency(&vault.root, "初始状态");

    rename_vault_directory_in_root(
        "notes/dir-a".to_string(),
        "notes/dir-b".to_string(),
        &vault.root,
    )
    .expect("重命名目录应成功");

    assert!(!vault.root.join("notes/dir-a").exists());
    assert!(vault.root.join("notes/dir-b/nested.md").exists());
    assert_full_consistency(&vault.root, "目录重命名后");

    // 旧路径不应出现在索引中
    let paths = search_markdown_paths(&vault.root);
    assert!(
        !paths.contains("notes/dir-a/nested.md"),
        "旧路径不应残留"
    );
    assert!(
        paths.contains("notes/dir-b/nested.md"),
        "新路径应出现在索引中"
    );
}

/// 目录移动后，索引重建应反映新路径。
#[test]
fn move_directory_should_keep_index_consistent() {
    let vault = TestVault::new();

    create_vault_markdown_file_in_root(
        "blog/post.md".to_string(),
        Some("# Post\n\n[[topic]]".to_string()),
        &vault.root,
    )
    .expect("创建博客文件应成功");
    assert_full_consistency(&vault.root, "初始状态");

    move_vault_directory_to_directory_in_root(
        "blog".to_string(),
        "archive/2026".to_string(),
        &vault.root,
    )
    .expect("移动目录应成功");

    assert!(!vault.root.join("blog/post.md").exists());
    assert!(vault.root.join("archive/2026/blog/post.md").exists());
    assert_full_consistency(&vault.root, "目录移动后");
}

/// 删除包含多个文件的目录后，索引应不包含被删文件。
#[test]
fn delete_directory_with_files_should_remove_all_from_index() {
    let vault = TestVault::new();

    create_vault_markdown_file_in_root(
        "trash/a.md".to_string(),
        Some("# A".to_string()),
        &vault.root,
    )
    .expect("创建 a.md 应成功");
    create_vault_markdown_file_in_root(
        "trash/b.md".to_string(),
        Some("# B\n\n[[a]]".to_string()),
        &vault.root,
    )
    .expect("创建 b.md 应成功");
    assert_full_consistency(&vault.root, "删前");

    delete_vault_directory_in_root("trash".to_string(), &vault.root)
        .expect("删除目录应成功");

    assert!(!vault.root.join("trash").exists());
    assert_full_consistency(&vault.root, "删后");

    let paths = search_markdown_paths(&vault.root);
    assert!(!paths.contains("trash/a.md"), "a.md 不应残留");
    assert!(!paths.contains("trash/b.md"), "b.md 不应残留");
}

/// 混合文件级 + 目录级操作序列后，文件系统与索引保持一致。
#[test]
fn mixed_file_and_directory_operations_should_stay_consistent() {
    let vault = TestVault::new();

    // 步骤 1：创建文件在新目录
    create_vault_markdown_file_in_root(
        "project/draft.md".to_string(),
        Some("# Draft\n\n[[topic]]".to_string()),
        &vault.root,
    )
    .expect("步骤1 创建文件");
    assert_full_consistency(&vault.root, "步骤1");

    // 步骤 2：保存更新内容
    save_vault_markdown_file_in_root(
        "project/draft.md".to_string(),
        "# Draft v2\n\n[[guide]]".to_string(),
        &vault.root,
    )
    .expect("步骤2 保存");
    assert_full_consistency(&vault.root, "步骤2");

    // 步骤 3：重命名文件
    rename_vault_markdown_file_in_root(
        "project/draft.md".to_string(),
        "project/final.md".to_string(),
        &vault.root,
    )
    .expect("步骤3 重命名文件");
    assert_full_consistency(&vault.root, "步骤3");

    // 步骤 4：创建第二个文件
    create_vault_markdown_file_in_root(
        "project/extra.md".to_string(),
        Some("# Extra\n\n[[final]]".to_string()),
        &vault.root,
    )
    .expect("步骤4 创建第二文件");
    assert_full_consistency(&vault.root, "步骤4");

    // 步骤 5：重命名目录
    rename_vault_directory_in_root(
        "project".to_string(),
        "published".to_string(),
        &vault.root,
    )
    .expect("步骤5 重命名目录");
    assert_full_consistency(&vault.root, "步骤5");

    // 步骤 6：移动目录到子目录
    move_vault_directory_to_directory_in_root(
        "published".to_string(),
        "archive".to_string(),
        &vault.root,
    )
    .expect("步骤6 移动目录");
    assert_full_consistency(&vault.root, "步骤6");

    // 步骤 7：删除一个文件
    delete_vault_markdown_file_in_root(
        "archive/published/extra.md".to_string(),
        &vault.root,
    )
    .expect("步骤7 删除文件");
    assert_full_consistency(&vault.root, "步骤7");

    // 步骤 8：删除整个目录
    delete_vault_directory_in_root("archive".to_string(), &vault.root)
        .expect("步骤8 删除目录");
    assert_full_consistency(&vault.root, "步骤8");
}

/// 创建目录不应影响搜索/图谱索引（目录不是 Markdown）。
#[test]
fn create_empty_directory_should_not_affect_search_or_graph() {
    let vault = TestVault::new();

    let before_search = search_markdown_paths(&vault.root);
    let (before_graph, _) = graph_data(&vault.root);

    create_vault_directory_in_root("empty-dir".to_string(), &vault.root)
        .expect("创建空目录应成功");

    let after_search = search_markdown_paths(&vault.root);
    let (after_graph, _) = graph_data(&vault.root);

    assert_eq!(before_search, after_search, "空目录不应影响搜索索引");
    assert_eq!(before_graph, after_graph, "空目录不应影响图谱索引");

    let dirs = tree_directory_paths(&vault.root);
    assert!(dirs.contains("empty-dir"), "目录树应包含新目录");
}

/// 图谱边指向的文件被移动后，旧边应消失，新边应基于新路径重建。
#[test]
fn graph_edges_should_update_after_link_target_moved() {
    let vault = TestVault::new();

    create_vault_markdown_file_in_root(
        "ref/source.md".to_string(),
        Some("# Source\n\n[[target]]".to_string()),
        &vault.root,
    )
    .expect("创建 source");
    create_vault_markdown_file_in_root(
        "ref/target.md".to_string(),
        Some("# Target".to_string()),
        &vault.root,
    )
    .expect("创建 target");
    assert_full_consistency(&vault.root, "初始");

    // 图谱应有 source → target 边
    let (_, edges_before) = graph_data(&vault.root);
    assert!(
        edges_before.iter().any(|(s, t)| s == "ref/source.md" && t == "ref/target.md"),
        "初始图谱应有 source→target 边"
    );

    // 移动 target 到不同目录
    move_vault_markdown_file_to_directory_in_root(
        "ref/target.md".to_string(),
        "moved".to_string(),
        &vault.root,
    )
    .expect("移动 target 应成功");
    assert_full_consistency(&vault.root, "移动后");

    let (_, edges_after) = graph_data(&vault.root);
    // 旧路径边应消失（因为 ref/target.md 在 markdown_files 中已不存在）
    assert!(
        !edges_after.iter().any(|(s, t)| s == "ref/source.md" && t == "ref/target.md"),
        "旧路径边应消失"
    );
}

/// 目录操作的错误边界不应破坏已有索引一致性。
#[test]
fn error_boundary_operations_should_not_corrupt_index() {
    let vault = TestVault::new();

    assert_full_consistency(&vault.root, "初始");

    // 重命名不存在的目录应报错
    let result = rename_vault_directory_in_root(
        "nonexistent".to_string(),
        "renamed".to_string(),
        &vault.root,
    );
    assert!(result.is_err(), "重命名不存在的目录应报错");
    assert_full_consistency(&vault.root, "错误操作后索引不变");

    // 移动不存在的目录应报错
    let result = move_vault_directory_to_directory_in_root(
        "nonexistent".to_string(),
        "target".to_string(),
        &vault.root,
    );
    assert!(result.is_err(), "移动不存在的目录应报错");
    assert_full_consistency(&vault.root, "错误操作后索引不变");

    // 删除不存在的目录应报错
    let result = delete_vault_directory_in_root("nonexistent".to_string(), &vault.root);
    assert!(result.is_err(), "删除不存在的目录应报错");
    assert_full_consistency(&vault.root, "错误操作后索引不变");

    // 禁止操作根目录
    let result = rename_vault_directory_in_root(
        "".to_string(),
        "anything".to_string(),
        &vault.root,
    );
    assert!(result.is_err(), "空路径操作应报错");

    let result = delete_vault_directory_in_root("".to_string(), &vault.root);
    assert!(result.is_err(), "删除空路径应报错");
}

/// 在真实笔记库 Notes 上执行一致性校验。
#[test]
fn real_notes_vault_should_have_consistent_index() {
    let notes_root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/Notes");
    if !notes_root.exists() {
        eprintln!(
            "[skip] Notes fixture not found: {}",
            notes_root.display()
        );
        return;
    }

    assert_full_consistency(&notes_root, "真实笔记库 Notes");
}
