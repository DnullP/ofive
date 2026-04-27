//! # Canvas 文件搜索集成测试
//!
//! 覆盖后端暴露接口：
//! - `search_vault_canvas_files_in_root`

#[path = "support/mod.rs"]
mod support;

use ofive_lib::test_support::{
    create_vault_canvas_file_in_root, search_vault_canvas_files_in_root,
};
use support::TestVault;

#[test]
fn search_vault_canvas_files_in_root_should_return_matching_canvas_files() {
    let vault = TestVault::new();

    create_vault_canvas_file_in_root(
        "boards/product-roadmap.canvas".to_string(),
        Some("{\n  \"nodes\": [],\n  \"edges\": []\n}\n".to_string()),
        &vault.root,
    )
    .expect("创建 product roadmap canvas 应成功");
    create_vault_canvas_file_in_root(
        "boards/archive/weekly.canvas".to_string(),
        Some("{\n  \"nodes\": [],\n  \"edges\": []\n}\n".to_string()),
        &vault.root,
    )
    .expect("创建 weekly canvas 应成功");

    let results = search_vault_canvas_files_in_root(&vault.root, "roadmap".to_string(), Some(10))
        .expect("搜索 Canvas 文件应成功");

    assert_eq!(results.len(), 1);
    assert_eq!(results[0].relative_path, "boards/product-roadmap.canvas");
    assert_eq!(results[0].title, "product-roadmap");
}

#[test]
fn search_vault_canvas_files_in_root_should_list_canvas_files_when_query_is_empty() {
    let vault = TestVault::new();

    create_vault_canvas_file_in_root(
        "boards/a.canvas".to_string(),
        Some("{\n  \"nodes\": [],\n  \"edges\": []\n}\n".to_string()),
        &vault.root,
    )
    .expect("创建 a canvas 应成功");
    create_vault_canvas_file_in_root(
        "boards/b.canvas".to_string(),
        Some("{\n  \"nodes\": [],\n  \"edges\": []\n}\n".to_string()),
        &vault.root,
    )
    .expect("创建 b canvas 应成功");

    let results = search_vault_canvas_files_in_root(&vault.root, "".to_string(), Some(10))
        .expect("列出 Canvas 文件应成功");

    assert_eq!(results.len(), 2);
    assert_eq!(results[0].relative_path, "boards/a.canvas");
    assert_eq!(results[1].relative_path, "boards/b.canvas");
}
