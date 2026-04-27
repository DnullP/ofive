//! # 集成测试夹具
//!
//! 提供临时 vault 构建、样例文件写入与自动清理能力，避免文件操作测试互相污染。

#![allow(dead_code)]

use std::fs;
use std::net::{TcpStream, ToSocketAddrs};
use std::path::Path;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use ofive_lib::test_support::{
    save_semantic_index_settings, semantic_index_embedding_cache_dir_in_root,
    semantic_index_sqlite_vec_runtime_version, semantic_index_vector_store_path_in_root,
    ChunkingStrategyKind, EmbeddingProviderKind, SemanticIndexSettings, VectorStoreKind,
};

static TEST_VAULT_SEQUENCE: AtomicU64 = AtomicU64::new(0);
static TEST_APP_STORAGE_SEQUENCE: AtomicU64 = AtomicU64::new(0);

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
            timestamp_nanos, sequence
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

/// 语义索引 sqlite-vec 集成测试夹具。
pub struct SemanticIndexTestHarness {
    pub vault: TestVault,
    pub store_path: PathBuf,
    pub embedding_cache_dir: PathBuf,
    pub app_storage_root: PathBuf,
}

impl SemanticIndexTestHarness {
    /// 创建语义索引测试夹具并解析 sqlite 数据库路径。
    pub fn new() -> Self {
        let vault = TestVault::new();
        let app_storage_root = std::env::temp_dir().join(format!(
            "ofive-app-storage-int-{}-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|duration| duration.as_nanos())
                .unwrap_or(0),
            TEST_APP_STORAGE_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ));
        unsafe {
            std::env::set_var("OFIVE_APP_STORAGE_ROOT", &app_storage_root);
        }
        let store_path = semantic_index_vector_store_path_in_root(&vault.root)
            .expect("应成功解析语义索引 sqlite 文件路径");
        let embedding_cache_dir = semantic_index_embedding_cache_dir_in_root(&vault.root)
            .expect("应成功解析 fastembed 模型缓存目录");

        Self {
            vault,
            store_path,
            embedding_cache_dir,
            app_storage_root,
        }
    }

    /// 在测试开始前检查 sqlite-vec 环境与目录初始状态。
    pub fn assert_preflight(&self) {
        let version = semantic_index_sqlite_vec_runtime_version().expect("sqlite-vec 运行时应可用");
        assert!(!version.trim().is_empty(), "sqlite-vec 版本信息不应为空");
        assert!(
            !self.store_path.exists(),
            "测试前不应存在旧的 sqlite 向量库: {}",
            self.store_path.display()
        );
        assert!(
            !self.embedding_cache_dir.exists(),
            "测试前不应存在旧的 embedding 模型缓存目录: {}",
            self.embedding_cache_dir.display()
        );
    }

    /// 断言真实 embedding 模型缓存目录已按预期创建。
    pub fn assert_embedding_cache_materialized(&self) {
        assert!(
            self.embedding_cache_dir.exists(),
            "真实 embedding 测试后应生成模型缓存目录: {}",
            self.embedding_cache_dir.display()
        );
    }

    /// 判断当前环境是否满足真实 fastembed 集成测试的执行条件。
    pub fn should_run_real_embedding_flow(&self) -> bool {
        if embedding_cache_has_files(&self.embedding_cache_dir) {
            return true;
        }

        let opt_in = std::env::var("OFIVE_ENABLE_REAL_FASTEMBED_TEST")
            .map(|value| matches!(value.as_str(), "1" | "true" | "TRUE" | "yes" | "YES"))
            .unwrap_or(false);
        if !opt_in {
            eprintln!(
                "skip real fastembed integration: set OFIVE_ENABLE_REAL_FASTEMBED_TEST=1 or pre-seed model cache at {}",
                self.embedding_cache_dir.display()
            );
            return false;
        }

        if !can_connect_to("huggingface.co:443") {
            eprintln!(
                "skip real fastembed integration: model cache is empty and huggingface.co:443 is unreachable"
            );
            return false;
        }

        true
    }

    /// 写入语义索引设置并启用 sqlite-vec 后端。
    pub fn enable_semantic_index(&self) {
        save_semantic_index_settings(
            SemanticIndexSettings {
                enabled: true,
                embedding_provider: EmbeddingProviderKind::FastEmbed,
                vector_store: VectorStoreKind::SqliteVec,
                chunking_strategy: ChunkingStrategyKind::HeadingParagraph,
                model_id: "intfloat/multilingual-e5-small".to_string(),
                chunk_strategy_version: 1,
                ..SemanticIndexSettings::default()
            },
            &self.vault.root,
        )
        .expect("应成功写入语义索引测试设置");
    }

    /// 向测试 Vault 写入一批 Markdown 文档样本。
    pub fn seed_markdown_documents(&self, documents: &[(&str, &str)]) {
        for (relative_path, content) in documents {
            self.vault.write_markdown(relative_path, content);
        }
    }

    /// 读取指定相对路径的 Markdown 文本。
    pub fn read_markdown(&self, relative_path: &str) -> String {
        fs::read_to_string(self.vault.root.join(relative_path))
            .expect("应成功读取测试 Markdown 文本")
    }

    /// 清理语义索引测试产物，确保测试结束后环境恢复。
    pub fn cleanup_semantic_index_artifacts(&self) {
        let owner_dir = self.owner_dir();
        if owner_dir.exists() {
            let _ = fs::remove_dir_all(&owner_dir);
        }
    }

    /// 断言语义索引产物已被清理干净。
    pub fn assert_environment_restored(&self) {
        let owner_dir = self.owner_dir();
        assert!(
            !self.store_path.exists(),
            "测试后 sqlite 向量库应已删除: {}",
            self.store_path.display()
        );
        assert!(
            !self.embedding_cache_dir.exists(),
            "测试后模型缓存目录应已删除: {}",
            self.embedding_cache_dir.display()
        );
        assert!(
            !owner_dir.exists(),
            "测试后 semantic-index 私有目录应已清理: {}",
            owner_dir.display()
        );
    }

    fn owner_dir(&self) -> PathBuf {
        extension_owner_dir(&self.vault.root, "semantic-index")
    }
}

impl Drop for SemanticIndexTestHarness {
    fn drop(&mut self) {
        std::env::remove_var("OFIVE_APP_STORAGE_ROOT");
        if self.app_storage_root.exists() {
            let _ = fs::remove_dir_all(&self.app_storage_root);
        }
        self.cleanup_semantic_index_artifacts();
    }
}

/// 计算扩展 owner 私有目录，用于测试前后状态校验。
fn extension_owner_dir(vault_root: &Path, owner: &str) -> PathBuf {
    vault_root.join(".ofive/extensions").join(owner)
}

/// 判断模型缓存目录是否已存在有效文件。
fn embedding_cache_has_files(cache_dir: &Path) -> bool {
    if !cache_dir.exists() {
        return false;
    }

    fs::read_dir(cache_dir)
        .ok()
        .and_then(|mut entries| entries.next())
        .is_some()
}

/// 检查指定主机端口是否可达。
fn can_connect_to(address: &str) -> bool {
    let Ok(mut addresses) = address.to_socket_addrs() else {
        return false;
    };
    let Some(address) = addresses.next() else {
        return false;
    };

    TcpStream::connect_timeout(&address, std::time::Duration::from_secs(3)).is_ok()
}
