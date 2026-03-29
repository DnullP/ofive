//! # Markdown 增量 patch 集成测试
//!
//! 覆盖后端暴露接口：
//! - `apply_unified_markdown_diff_in_root`

#[path = "support/mod.rs"]
mod support;

use ofive_lib::test_support::apply_unified_markdown_diff_in_root;
use support::TestVault;

#[test]
fn apply_unified_markdown_diff_in_root_should_modify_only_matched_block() {
    let vault = TestVault::new();

    vault.write_markdown("notes/guide.md", "# Guide\n\nalpha\nbeta\ngamma\n");

    let response = apply_unified_markdown_diff_in_root(
        &vault.root,
        "--- a/notes/guide.md\n+++ b/notes/guide.md\n@@ -3,3 +3,3 @@\n alpha\n-beta\n+beta patched\n gamma".to_string(),
    )
    .expect("应用 Markdown patch 应成功");

    assert_eq!(response.relative_path, "notes/guide.md");
    assert_eq!(response.applied_block_count, 1);
    assert_eq!(
        std::fs::read_to_string(vault.root.join("notes/guide.md")).expect("应能读取修改后的文件"),
        "# Guide\n\nalpha\nbeta patched\ngamma\n"
    );
}