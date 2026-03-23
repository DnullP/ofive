//! # 任务查询资源目录集成测试
//!
//! 覆盖真实仓库资源目录 `test-resources/notes` 下的任务查询行为，
//! 避免只在极小临时样本上验证任务扫描逻辑。

#[path = "support/mod.rs"]
mod support;

use ofive_lib::test_support::query_vault_tasks_in_root;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

static RESOURCE_TEST_SEQUENCE: AtomicU64 = AtomicU64::new(0);

fn create_temp_root() -> PathBuf {
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    let sequence = RESOURCE_TEST_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let root = std::env::temp_dir().join(format!(
        "ofive-task-query-resource-int-{}-{}",
        unique, sequence
    ));
    fs::create_dir_all(&root).expect("应成功创建临时目录");
    root
}

fn copy_dir_recursive(from: &Path, to: &Path) {
    fs::create_dir_all(to).expect("应成功创建目标目录");

    for entry in fs::read_dir(from).expect("应成功读取源目录") {
        let entry = entry.expect("目录项应可读取");
        let source_path = entry.path();
        let target_path = to.join(entry.file_name());

        if source_path.is_dir() {
            copy_dir_recursive(&source_path, &target_path);
        } else {
            fs::copy(&source_path, &target_path).expect("应成功复制文件");
        }
    }
}

#[test]
fn query_vault_tasks_should_work_with_real_test_resources_notes_tree() {
    let temp_root = create_temp_root();
    let source_notes_root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("src-tauri 应存在父目录")
        .join("test-resources/notes");
    copy_dir_recursive(&source_notes_root, &temp_root);

    let tasks = query_vault_tasks_in_root(&temp_root).expect("任务查询应成功");

    assert!(tasks.iter().any(|item| {
        item.relative_path == "task-board-e2e.md"
            && item.content == "Verify task board flow"
            && item.due.as_deref() == Some("2026-03-24 09:00")
            && item.priority.as_deref() == Some("high")
    }));
    assert!(tasks.iter().any(|item| {
        item.relative_path == "task-board-e2e.md"
            && item.content == "Completed task"
            && item.checked
            && item.priority.as_deref() == Some("medium")
    }));
    assert!(!tasks.iter().any(|item| item.content == "Hidden task"));

    let _ = fs::remove_dir_all(temp_root);
}
