//! # 集成测试夹具
//!
//! 提供临时 vault 构建、样例文件写入与自动清理能力，避免文件操作测试互相污染。

use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

static TEST_VAULT_SEQUENCE: AtomicU64 = AtomicU64::new(0);

/// 测试用临时仓库。
pub struct TestVault {
    pub root: PathBuf,
}

impl TestVault {
    /// 创建临时仓库并写入基础样例文件。
    pub fn new() -> Self {
        let timestamp_nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0);
        let sequence = TEST_VAULT_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let root = std::env::temp_dir().join(format!(
            "ofive-backend-int-{}-{}",
            timestamp_nanos,
            sequence
        ));
        fs::create_dir_all(&root).expect("应成功创建临时仓库目录");

        let vault = Self { root };
        vault.seed_basic_files();
        vault
    }

    /// 在仓库中写入 Markdown 文件。
    pub fn write_markdown(&self, relative_path: &str, content: &str) {
        let target = self.root.join(relative_path);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).expect("应成功创建父目录");
        }
        fs::write(target, content).expect("应成功写入 Markdown 文件");
    }

    /// 在仓库中写入二进制文件。
    pub fn write_binary(&self, relative_path: &str, bytes: &[u8]) {
        let target = self.root.join(relative_path);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).expect("应成功创建父目录");
        }
        fs::write(target, bytes).expect("应成功写入二进制文件");
    }

    fn seed_basic_files(&self) {
        self.write_markdown(
            "notes/guide.md",
            "# Guide\n\nLink to [[notes/topic]].\n\nInline [Topic](notes/topic.md)",
        );
        self.write_markdown("notes/topic.md", "# Topic\n\nHello topic.");
        self.write_markdown("docs/readme.md", "# Readme\n");
        self.write_binary("assets/icon.png", &[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A]);
    }
}

impl Drop for TestVault {
    fn drop(&mut self) {
        if self.root.exists() {
            let _ = fs::remove_dir_all(&self.root);
        }
    }
}
