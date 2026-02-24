//! # 仓库文件操作接口集成测试
//!
//! 覆盖后端暴露接口：
//! - `get_current_vault_tree`
//! - `read_vault_markdown_file`
//! - `read_vault_binary_file`
//! - `create_vault_markdown_file`
//! - `save_vault_markdown_file`
//! - `rename_vault_markdown_file`
//! - `delete_vault_markdown_file`

#[path = "support/mod.rs"]
mod support;

use std::fs;

use ofive_lib::{
    create_vault_directory_in_root, create_vault_markdown_file_in_root,
    delete_vault_directory_in_root,
    delete_vault_markdown_file_in_root,
    get_current_vault_tree_in_root, move_vault_directory_to_directory_in_root,
    move_vault_markdown_file_to_directory_in_root, read_vault_binary_file_in_root,
    read_vault_markdown_file_in_root, rename_vault_directory_in_root,
    rename_vault_markdown_file_in_root,
    save_vault_markdown_file_in_root,
};
use serde_json::Value;
use support::TestVault;

#[test]
fn get_current_vault_tree_should_list_seeded_entries() {
    let vault = TestVault::new();
    fs::create_dir_all(vault.root.join(".ofive")).expect("应创建系统目录");
    fs::write(vault.root.join(".ofive/internal.md"), "# internal")
        .expect("应写入系统目录测试文件");

    let tree = get_current_vault_tree_in_root(&vault.root).expect("读取目录树应成功");
    let value = serde_json::to_value(tree).expect("目录树响应应可序列化");
    let entries = value
        .get("entries")
        .and_then(Value::as_array)
        .expect("entries 应为数组");

    let has_guide = entries.iter().any(|item| {
        item.get("relativePath").and_then(Value::as_str) == Some("notes/guide.md")
    });
    let has_assets_dir = entries.iter().any(|item| {
        item.get("relativePath").and_then(Value::as_str) == Some("assets")
            && item.get("isDir").and_then(Value::as_bool) == Some(true)
    });
    let has_ofive = entries.iter().any(|item| {
        item.get("relativePath")
            .and_then(Value::as_str)
            .is_some_and(|path| path == ".ofive" || path.starts_with(".ofive/"))
    });

    assert!(has_guide);
    assert!(has_assets_dir);
    assert!(!has_ofive);
}

#[test]
fn create_directory_should_create_empty_folder_entry() {
    let vault = TestVault::new();

    create_vault_directory_in_root("notes/empty-dir".to_string(), &vault.root)
        .expect("创建目录应成功");

    assert!(vault.root.join("notes/empty-dir").is_dir());

    let tree = get_current_vault_tree_in_root(&vault.root).expect("读取目录树应成功");
    let value = serde_json::to_value(tree).expect("目录树响应应可序列化");
    let entries = value
        .get("entries")
        .and_then(Value::as_array)
        .expect("entries 应为数组");

    let has_empty_dir = entries.iter().any(|item| {
        item.get("relativePath").and_then(Value::as_str) == Some("notes/empty-dir")
            && item.get("isDir").and_then(Value::as_bool) == Some(true)
    });

    assert!(has_empty_dir);
}

#[test]
fn read_markdown_and_binary_should_return_expected_payload() {
    let vault = TestVault::new();

    let markdown = read_vault_markdown_file_in_root("notes/guide.md".to_string(), &vault.root)
        .expect("读取 Markdown 应成功");
    let markdown_json = serde_json::to_value(markdown).expect("Markdown 响应应可序列化");
    assert_eq!(
        markdown_json.get("relativePath").and_then(Value::as_str),
        Some("notes/guide.md")
    );
    assert!(markdown_json
        .get("content")
        .and_then(Value::as_str)
        .is_some_and(|content| content.contains("Link to")));

    let binary = read_vault_binary_file_in_root("assets/icon.png".to_string(), &vault.root)
        .expect("读取二进制应成功");
    let binary_json = serde_json::to_value(binary).expect("二进制响应应可序列化");
    assert_eq!(
        binary_json.get("mimeType").and_then(Value::as_str),
        Some("image/png")
    );
    assert!(binary_json
        .get("base64Content")
        .and_then(Value::as_str)
        .is_some_and(|content| !content.is_empty()));
}

#[test]
fn create_save_rename_delete_should_mutate_filesystem() {
    let vault = TestVault::new();

    create_vault_markdown_file_in_root(
        "notes/new-note.md".to_string(),
        Some("# New".to_string()),
        &vault.root,
    )
    .expect("创建文件应成功");
    assert!(vault.root.join("notes/new-note.md").exists());

    save_vault_markdown_file_in_root(
        "notes/new-note.md".to_string(),
        "# New\n\nupdated".to_string(),
        &vault.root,
    )
    .expect("保存文件应成功");
    assert!(
        fs::read_to_string(vault.root.join("notes/new-note.md"))
            .expect("应成功读取保存后的 Markdown")
            .contains("updated")
    );

    rename_vault_markdown_file_in_root(
        "notes/new-note.md".to_string(),
        "notes/renamed-note.md".to_string(),
        &vault.root,
    )
    .expect("重命名文件应成功");
    assert!(!vault.root.join("notes/new-note.md").exists());
    assert!(vault.root.join("notes/renamed-note.md").exists());

    delete_vault_markdown_file_in_root("notes/renamed-note.md".to_string(), &vault.root)
        .expect("删除文件应成功");
    assert!(!vault.root.join("notes/renamed-note.md").exists());
}

#[test]
fn move_command_should_preserve_filename_and_content() {
    let vault = TestVault::new();

    create_vault_markdown_file_in_root(
        "notes/move-source.md".to_string(),
        Some("# Move Source\n\ncontent before move".to_string()),
        &vault.root,
    )
    .expect("创建待移动文件应成功");

    let moved = move_vault_markdown_file_to_directory_in_root(
        "notes/move-source.md".to_string(),
        "archive/2026".to_string(),
        &vault.root,
    )
    .expect("移动文件应成功");

    assert_eq!(moved.relative_path, "archive/2026/move-source.md");
    assert!(!vault.root.join("notes/move-source.md").exists());
    assert!(vault.root.join("archive/2026/move-source.md").exists());

    let moved_content = fs::read_to_string(vault.root.join("archive/2026/move-source.md"))
        .expect("应能读取移动后的文件内容");
    assert!(moved_content.contains("content before move"));
}

#[test]
fn multi_step_write_flow_should_keep_tree_and_content_consistent() {
    let vault = TestVault::new();

    create_vault_markdown_file_in_root(
        "notes/flow.md".to_string(),
        Some("# Flow\n\nstep-1".to_string()),
        &vault.root,
    )
    .expect("步骤1 创建文件应成功");

    save_vault_markdown_file_in_root(
        "notes/flow.md".to_string(),
        "# Flow\n\nstep-2".to_string(),
        &vault.root,
    )
    .expect("步骤2 保存文件应成功");

    rename_vault_markdown_file_in_root(
        "notes/flow.md".to_string(),
        "notes/flow-renamed.md".to_string(),
        &vault.root,
    )
    .expect("步骤3 重命名应成功");

    move_vault_markdown_file_to_directory_in_root(
        "notes/flow-renamed.md".to_string(),
        "archive".to_string(),
        &vault.root,
    )
    .expect("步骤4 移动应成功");

    let final_path = vault.root.join("archive/flow-renamed.md");
    assert!(final_path.exists());
    assert!(
        fs::read_to_string(&final_path)
            .expect("应能读取最终文件")
            .contains("step-2")
    );

    let tree = get_current_vault_tree_in_root(&vault.root).expect("读取目录树应成功");
    let tree_json = serde_json::to_value(tree).expect("目录树响应应可序列化");
    let entries = tree_json
        .get("entries")
        .and_then(Value::as_array)
        .expect("entries 应为数组");

    let has_final = entries.iter().any(|item| {
        item.get("relativePath").and_then(Value::as_str) == Some("archive/flow-renamed.md")
    });
    let has_intermediate = entries.iter().any(|item| {
        item.get("relativePath").and_then(Value::as_str) == Some("notes/flow.md")
            || item.get("relativePath").and_then(Value::as_str)
                == Some("notes/flow-renamed.md")
    });

    assert!(has_final);
    assert!(!has_intermediate);
}

#[test]
fn markdown_write_commands_should_reject_ofive_directory_paths() {
    let vault = TestVault::new();

    let create_result = create_vault_markdown_file_in_root(
        ".ofive/blocked.md".to_string(),
        Some("# blocked".to_string()),
        &vault.root,
    );
    assert!(create_result.is_err());

    let save_result = save_vault_markdown_file_in_root(
        ".ofive/blocked.md".to_string(),
        "# blocked".to_string(),
        &vault.root,
    );
    assert!(save_result.is_err());
}

#[test]
fn rename_directory_should_move_nested_files() {
    let vault = TestVault::new();

    create_vault_markdown_file_in_root(
        "notes/folder/a.md".to_string(),
        Some("# A".to_string()),
        &vault.root,
    )
    .expect("应成功创建目录内文件");

    rename_vault_directory_in_root(
        "notes/folder".to_string(),
        "notes/folder-renamed".to_string(),
        &vault.root,
    )
    .expect("目录重命名应成功");

    assert!(!vault.root.join("notes/folder/a.md").exists());
    assert!(vault.root.join("notes/folder-renamed/a.md").exists());
}

#[test]
fn move_directory_to_directory_should_keep_subtree() {
    let vault = TestVault::new();

    create_vault_markdown_file_in_root(
        "notes/folder/b.md".to_string(),
        Some("# B".to_string()),
        &vault.root,
    )
    .expect("应成功创建目录内文件");

    let moved = move_vault_directory_to_directory_in_root(
        "notes/folder".to_string(),
        "archive/2026".to_string(),
        &vault.root,
    )
    .expect("目录移动应成功");

    assert_eq!(moved.relative_path, "archive/2026/folder");
    assert!(!vault.root.join("notes/folder/b.md").exists());
    assert!(vault.root.join("archive/2026/folder/b.md").exists());
}

#[test]
fn delete_directory_should_remove_subtree() {
    let vault = TestVault::new();

    create_vault_markdown_file_in_root(
        "notes/folder/c.md".to_string(),
        Some("# C".to_string()),
        &vault.root,
    )
    .expect("应成功创建目录内文件");

    delete_vault_directory_in_root("notes/folder".to_string(), &vault.root)
        .expect("删除目录应成功");

    assert!(!vault.root.join("notes/folder").exists());
}
