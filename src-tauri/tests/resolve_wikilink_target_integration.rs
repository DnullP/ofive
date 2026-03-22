//! # WikiLink 目标解析集成测试
//!
//! 验证后端 WikiLink 解析核心能力在真实文件系统下可用：
//! - 支持文件名、相对路径、绝对路径
//! - 多同名文件时按“与当前目录路径树距离”选择最近项

use ofive_lib::resolve_wikilink_target_path_in_vault;
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
    let root = std::env::temp_dir().join(format!("ofive-wikilink-int-{unique}-{sequence}"));
    fs::create_dir_all(&root).expect("应成功创建测试根目录");
    root
}

fn create_markdown_file(root: &Path, relative_path: &str) -> PathBuf {
    let target = root.join(relative_path);
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).expect("应成功创建测试目录");
    }
    fs::write(&target, "# test\n").expect("应成功写入测试文件");
    target
}

#[test]
fn resolve_by_plain_filename_should_pick_nearest_file() {
    let root = create_test_root();
    create_markdown_file(&root, "docs/readme.md");
    create_markdown_file(&root, "notes/topic/readme.md");

    let resolved = resolve_wikilink_target_path_in_vault(&root, "notes/topic", "readme")
        .expect("解析应成功")
        .expect("应命中文件");

    assert!(resolved.ends_with(Path::new("notes/topic/readme.md")));
    let _ = fs::remove_dir_all(root);
}

#[test]
fn resolve_by_relative_path_should_work() {
    let root = create_test_root();
    create_markdown_file(&root, "knowledge/rust/ownership.md");

    let resolved = resolve_wikilink_target_path_in_vault(&root, "knowledge/rust", "./ownership")
        .expect("解析应成功")
        .expect("应命中文件");

    assert!(resolved.ends_with(Path::new("knowledge/rust/ownership.md")));
    let _ = fs::remove_dir_all(root);
}

#[test]
fn resolve_by_absolute_path_should_work() {
    let root = create_test_root();
    let file = create_markdown_file(&root, "refs/protocol/stack.md");

    let resolved =
        resolve_wikilink_target_path_in_vault(&root, "refs", file.to_string_lossy().as_ref())
            .expect("解析应成功")
            .expect("应命中文件");

    assert_eq!(resolved, file.canonicalize().expect("应能 canonicalize"));
    let _ = fs::remove_dir_all(root);
}
