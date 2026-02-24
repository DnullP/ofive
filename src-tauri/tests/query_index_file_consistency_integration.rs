//! # 查询索引与文件系统一致性集成测试
//!
//! 目标：验证涉及文件创建、修改、移动、删除的后端流程能够维护
//! `SQLite 查询索引` 与 `实际文件系统` 的一致性，且测试可重复执行。

#[path = "support/mod.rs"]
mod support;

use ofive_lib::{
    create_vault_markdown_file_in_root, delete_vault_markdown_file_in_root,
    get_current_vault_markdown_graph_in_root, get_current_vault_tree_in_root,
    move_vault_markdown_file_to_directory_in_root, rename_vault_markdown_file_in_root,
    save_vault_markdown_file_in_root, search_vault_markdown_files_in_root,
};
use std::collections::BTreeSet;
use std::fs;
use support::TestVault;

/// 从目录树响应提取 Markdown 文件路径集合。
fn markdown_paths_from_tree(vault_root: &std::path::Path) -> BTreeSet<String> {
    let tree = get_current_vault_tree_in_root(vault_root).expect("读取目录树应成功");
    tree.entries
        .into_iter()
        .filter(|entry| !entry.is_dir)
        .map(|entry| entry.relative_path)
        .filter(|path| path.ends_with(".md") || path.ends_with(".markdown"))
        .collect::<BTreeSet<_>>()
}

/// 从快速搜索结果提取路径集合。
fn markdown_paths_from_search(vault_root: &std::path::Path) -> BTreeSet<String> {
    search_vault_markdown_files_in_root(vault_root, "".to_string(), Some(200))
        .expect("读取搜索索引应成功")
        .into_iter()
        .map(|item| item.relative_path)
        .collect::<BTreeSet<_>>()
}

/// 从图谱节点提取路径集合。
fn markdown_paths_from_graph(vault_root: &std::path::Path) -> (BTreeSet<String>, Vec<(String, String)>) {
    let graph = get_current_vault_markdown_graph_in_root(vault_root).expect("读取图谱索引应成功");
    let nodes = graph
        .nodes
        .iter()
        .map(|node| node.path.clone())
        .collect::<BTreeSet<_>>();
    let edges = graph
        .edges
        .iter()
        .map(|edge| (edge.source_path.clone(), edge.target_path.clone()))
        .collect::<Vec<_>>();
    (nodes, edges)
}

/// 断言文件系统、搜索索引、图谱索引三者保持一致。
fn assert_query_index_consistency(vault_root: &std::path::Path) {
    let tree_paths = markdown_paths_from_tree(vault_root);
    let search_paths = markdown_paths_from_search(vault_root);
    let (graph_paths, graph_edges) = markdown_paths_from_graph(vault_root);

    assert_eq!(tree_paths, search_paths, "搜索索引应与文件系统一致");
    assert_eq!(tree_paths, graph_paths, "图谱节点应与文件系统一致");

    for (source_path, target_path) in graph_edges {
        assert!(
            graph_paths.contains(&source_path),
            "图谱边 source 必须存在于节点集合: {source_path}"
        );
        assert!(
            graph_paths.contains(&target_path),
            "图谱边 target 必须存在于节点集合: {target_path}"
        );
    }
}

#[test]
fn query_index_should_stay_consistent_across_file_write_lifecycle() {
    let vault = TestVault::new();

    assert_query_index_consistency(&vault.root);

    create_vault_markdown_file_in_root(
        "notes/index-lifecycle.md".to_string(),
        Some("# Lifecycle\n\n[[topic]]".to_string()),
        &vault.root,
    )
    .expect("创建文件应成功");
    assert!(vault.root.join("notes/index-lifecycle.md").exists());
    assert_query_index_consistency(&vault.root);

    save_vault_markdown_file_in_root(
        "notes/index-lifecycle.md".to_string(),
        "# Lifecycle Updated\n\n[[guide]]\n[Topic](./topic.md)".to_string(),
        &vault.root,
    )
    .expect("保存文件应成功");
    assert_query_index_consistency(&vault.root);

    rename_vault_markdown_file_in_root(
        "notes/index-lifecycle.md".to_string(),
        "notes/index-lifecycle-renamed.md".to_string(),
        &vault.root,
    )
    .expect("重命名应成功");
    assert!(vault.root.join("notes/index-lifecycle-renamed.md").exists());
    assert!(!vault.root.join("notes/index-lifecycle.md").exists());
    assert_query_index_consistency(&vault.root);

    move_vault_markdown_file_to_directory_in_root(
        "notes/index-lifecycle-renamed.md".to_string(),
        "archive/index-flow".to_string(),
        &vault.root,
    )
    .expect("移动文件应成功");
    assert!(
        vault.root
            .join("archive/index-flow/index-lifecycle-renamed.md")
            .exists()
    );
    assert_query_index_consistency(&vault.root);

    delete_vault_markdown_file_in_root(
        "archive/index-flow/index-lifecycle-renamed.md".to_string(),
        &vault.root,
    )
    .expect("删除文件应成功");
    assert!(
        !vault
            .root
            .join("archive/index-flow/index-lifecycle-renamed.md")
            .exists()
    );
    assert_query_index_consistency(&vault.root);
}

#[test]
fn query_index_should_rebuild_after_offline_fs_changes() {
    let vault = TestVault::new();

    assert_query_index_consistency(&vault.root);

    fs::write(
        vault.root.join("notes/offline-added.md"),
        "# Offline Added\n\n[[topic]]",
    )
    .expect("离线新增文件应成功");
    assert_query_index_consistency(&vault.root);

    fs::remove_file(vault.root.join("notes/topic.md")).expect("离线删除文件应成功");
    assert_query_index_consistency(&vault.root);
}
