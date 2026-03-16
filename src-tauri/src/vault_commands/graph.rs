//! # Markdown 图谱模块
//!
//! 负责从 vault Markdown 文件中提取节点与链接边。

use crate::state::{get_vault_root, AppState};
use crate::vault_commands::query_index;
use crate::vault_commands::types::VaultMarkdownGraphResponse;
use std::path::Path;
use tauri::State;

/// 获取当前 vault 中 Markdown 文件关系图（节点与边）。
pub fn get_current_vault_markdown_graph_in_root(
    vault_root: &Path,
) -> Result<VaultMarkdownGraphResponse, String> {
    log::info!("[vault-graph] get_current_vault_markdown_graph start");
    query_index::ensure_query_index_current(vault_root)?;
    let graph = query_index::load_markdown_graph(vault_root)?;

    log::info!(
        "[vault-graph] get_current_vault_markdown_graph success: nodes={} edges={}",
        graph.nodes.len(),
        graph.edges.len()
    );

    Ok(graph)
}

/// 获取当前 vault 中 Markdown 文件关系图（节点与边）。
pub fn get_current_vault_markdown_graph(
    state: State<'_, AppState>,
) -> Result<VaultMarkdownGraphResponse, String> {
    let vault_root = get_vault_root(&state)?;
    get_current_vault_markdown_graph_in_root(&vault_root)
}

#[cfg(test)]
mod tests {
    use super::get_current_vault_markdown_graph_in_root;
    use crate::vault_commands::query_index::ensure_query_index_current;
    use std::collections::BTreeMap;
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
        let root = std::env::temp_dir().join(format!("ofive-graph-test-{unique}-{sequence}"));
        fs::create_dir_all(root.join(".ofive")).expect("应成功创建测试根目录");
        root
    }

    fn write_markdown_file(root: &Path, relative_path: &str, content: &str) {
        let file_path = root.join(relative_path);
        if let Some(parent) = file_path.parent() {
            fs::create_dir_all(parent).expect("应成功创建测试目录");
        }
        fs::write(file_path, content).expect("应成功写入 Markdown 文件");
    }

    #[test]
    fn get_current_vault_markdown_graph_should_build_nodes_and_weighted_edges() {
        let root = create_test_root();
        write_markdown_file(
            &root,
            "A.md",
            "[[B]] [[B|别名]] [[A]] [to-b](./B) [missing](./Missing)",
        );
        write_markdown_file(&root, "B.md", "[[A]]");
        write_markdown_file(&root, "sub/C.md", "[[../B]]");

        ensure_query_index_current(&root).expect("构建索引应成功");

        let graph = get_current_vault_markdown_graph_in_root(&root).expect("图谱构建应成功");

        let node_paths = graph
            .nodes
            .iter()
            .map(|node| node.path.as_str())
            .collect::<Vec<_>>();
        assert_eq!(node_paths, vec!["A.md", "B.md", "sub/C.md"]);

        let node_titles = graph
            .nodes
            .iter()
            .map(|node| node.title.as_str())
            .collect::<Vec<_>>();
        assert_eq!(node_titles, vec!["A", "B", "C"]);

        let mut edge_weights = BTreeMap::<(String, String), usize>::new();
        for edge in graph.edges {
            edge_weights.insert((edge.source_path, edge.target_path), edge.weight);
        }

        assert_eq!(
            edge_weights.get(&("A.md".to_string(), "B.md".to_string())),
            Some(&3)
        );
        assert_eq!(
            edge_weights.get(&("B.md".to_string(), "A.md".to_string())),
            Some(&1)
        );
        assert_eq!(
            edge_weights.get(&("sub/C.md".to_string(), "B.md".to_string())),
            Some(&1)
        );
        assert!(!edge_weights.contains_key(&("A.md".to_string(), "A.md".to_string())));
        assert_eq!(edge_weights.len(), 3);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn get_current_vault_markdown_graph_should_return_empty_for_no_markdown_files() {
        let root = create_test_root();
        fs::write(root.join("notes.txt"), "plain text").expect("应成功写入非 markdown 文件");

        let graph = get_current_vault_markdown_graph_in_root(&root).expect("图谱构建应成功");

        assert!(graph.nodes.is_empty());
        assert!(graph.edges.is_empty());

        let _ = fs::remove_dir_all(root);
    }
}
