//! # Embedding Provider 抽象
//!
//! 定义语义索引模块对 embedding provider 的最小抽象边界。

use std::path::{Path, PathBuf};

use crate::app::app_storage::storage_registry_facade;
use crate::shared::semantic_index_contracts::{EmbeddingProviderDescriptor, EmbeddingProviderKind};

#[cfg(not(test))]
use std::collections::HashMap;

#[cfg(not(test))]
use std::fs;

#[cfg(not(test))]
use std::sync::{Arc, Mutex, OnceLock};

#[cfg(not(test))]
use fastembed::{EmbeddingModel, InitOptions, TextEmbedding};

const FASTEMBED_SUPPORTED_MODEL_IDS: &[&str] =
    &["intfloat/multilingual-e5-small", "BAAI/bge-small-zh-v1.5"];
const FASTEMBED_CONSUMER_MODULE_ID: &str = "semantic-index";
#[cfg(test)]
const FASTEMBED_PLACEHOLDER_DIMENSIONS: usize = 16;
const FASTEMBED_OWNER: &str = "semantic-index";
#[cfg(not(test))]
const FASTEMBED_BATCH_SIZE: usize = 32;
#[cfg(not(test))]
static FASTEMBED_RUNTIME_BY_KEY: OnceLock<Mutex<HashMap<String, Arc<Mutex<FastEmbedRuntime>>>>> =
    OnceLock::new();

/// FastEmbed 运行时缓存实体。
#[cfg(not(test))]
struct FastEmbedRuntime {
    /// 当前模型实例。
    model: TextEmbedding,
    /// 当前模型维度。
    dimensions: usize,
}

/// Embedding provider 抽象。
pub(crate) trait EmbeddingProvider: Send + Sync {
    /// 返回 provider 描述。
    fn descriptor(&self) -> EmbeddingProviderDescriptor;

    /// 校验模型 ID 是否受当前 provider 支持。
    fn validate_model_id(&self, model_id: &str) -> Result<(), String>;

    /// 返回当前模型输出的 embedding 维度。
    fn embedding_dimensions(&self, model_id: &str, vault_root: &Path) -> Result<usize, String>;

    /// 为输入文本批量生成 passage embedding。
    fn embed_passages(
        &self,
        model_id: &str,
        texts: &[String],
        vault_root: &Path,
    ) -> Result<Vec<Vec<f32>>, String>;

    /// 为检索 query 生成单条 embedding。
    fn embed_query(
        &self,
        model_id: &str,
        text: &str,
        vault_root: &Path,
    ) -> Result<Vec<f32>, String>;
}

/// 返回当前宿主支持的 embedding provider 列表。
pub(crate) fn available_embedding_providers() -> Vec<EmbeddingProviderDescriptor> {
    vec![FastEmbedEmbeddingProvider.descriptor()]
}

/// 根据设置构建 embedding provider。
pub(crate) fn build_embedding_provider(
    kind: EmbeddingProviderKind,
) -> Result<Box<dyn EmbeddingProvider>, String> {
    match kind {
        EmbeddingProviderKind::FastEmbed => Ok(Box::new(FastEmbedEmbeddingProvider)),
    }
}

/// 基于 fastembed-rs 的 provider 实现。
struct FastEmbedEmbeddingProvider;

impl EmbeddingProvider for FastEmbedEmbeddingProvider {
    fn descriptor(&self) -> EmbeddingProviderDescriptor {
        EmbeddingProviderDescriptor {
            kind: EmbeddingProviderKind::FastEmbed,
            display_name: "FastEmbed".to_string(),
            supported_model_ids: FASTEMBED_SUPPORTED_MODEL_IDS
                .iter()
                .map(|item| item.to_string())
                .collect(),
            default_model_id: "intfloat/multilingual-e5-small".to_string(),
        }
    }

    fn validate_model_id(&self, model_id: &str) -> Result<(), String> {
        if FASTEMBED_SUPPORTED_MODEL_IDS.contains(&model_id) {
            return Ok(());
        }

        Err(format!("unsupported fastembed model_id: {}", model_id))
    }

    fn embedding_dimensions(&self, model_id: &str, vault_root: &Path) -> Result<usize, String> {
        self.validate_model_id(model_id)?;

        #[cfg(test)]
        {
            let _ = vault_root;
            Ok(FASTEMBED_PLACEHOLDER_DIMENSIONS)
        }

        #[cfg(not(test))]
        {
            let runtime = get_or_create_fastembed_runtime(model_id, vault_root)?;
            let runtime = runtime.lock().map_err(|error| {
                format!("failed to lock fastembed runtime for dimension lookup: {error}")
            })?;
            Ok(runtime.dimensions)
        }
    }

    fn embed_passages(
        &self,
        model_id: &str,
        texts: &[String],
        vault_root: &Path,
    ) -> Result<Vec<Vec<f32>>, String> {
        self.validate_model_id(model_id)?;

        #[cfg(test)]
        {
            let _ = vault_root;
            Ok(texts
                .iter()
                .map(|text| embed_text_deterministically(text, FASTEMBED_PLACEHOLDER_DIMENSIONS))
                .collect())
        }

        #[cfg(not(test))]
        {
            let runtime = get_or_create_fastembed_runtime(model_id, vault_root)?;
            let mut runtime = runtime.lock().map_err(|error| {
                format!("failed to lock fastembed runtime for passage embedding: {error}")
            })?;
            let inputs = texts
                .iter()
                .map(|text| normalize_fastembed_input("passage", text))
                .collect::<Vec<_>>();

            runtime
                .model
                .embed(inputs, Some(FASTEMBED_BATCH_SIZE))
                .map_err(|error| {
                    format!("failed to generate fastembed passage embeddings: {error}")
                })
        }
    }

    fn embed_query(
        &self,
        model_id: &str,
        text: &str,
        vault_root: &Path,
    ) -> Result<Vec<f32>, String> {
        self.validate_model_id(model_id)?;

        #[cfg(test)]
        {
            let _ = vault_root;
            Ok(embed_text_deterministically(
                text,
                FASTEMBED_PLACEHOLDER_DIMENSIONS,
            ))
        }

        #[cfg(not(test))]
        {
            let runtime = get_or_create_fastembed_runtime(model_id, vault_root)?;
            let mut runtime = runtime.lock().map_err(|error| {
                format!("failed to lock fastembed runtime for query embedding: {error}")
            })?;
            let embeddings = runtime
                .model
                .embed(vec![normalize_fastembed_input("query", text)], Some(1))
                .map_err(|error| {
                    format!("failed to generate fastembed query embedding: {error}")
                })?;

            embeddings
                .into_iter()
                .next()
                .ok_or_else(|| "fastembed query embedding returned no vectors".to_string())
        }
    }
}

/// 返回 semantic-index 的应用级 fastembed 模型缓存目录。
pub(crate) fn semantic_index_embedding_cache_dir() -> Result<PathBuf, String> {
    let owner_dir = storage_registry_facade::resolve_app_storage_owner_dir(
        FASTEMBED_CONSUMER_MODULE_ID,
        FASTEMBED_OWNER,
    )?;
    Ok(owner_dir.join("models"))
}

/// 返回指定模型的独立缓存目录。
#[cfg(not(test))]
fn semantic_index_embedding_model_cache_dir(
    _vault_root: &Path,
    model_id: &str,
) -> Result<PathBuf, String> {
    let cache_root = semantic_index_embedding_cache_dir()?;
    Ok(cache_root.join(sanitize_model_id_for_cache(model_id)))
}

/// 获取或创建模型运行时。
#[cfg(not(test))]
fn get_or_create_fastembed_runtime(
    model_id: &str,
    vault_root: &Path,
) -> Result<Arc<Mutex<FastEmbedRuntime>>, String> {
    let cache_dir = semantic_index_embedding_model_cache_dir(vault_root, model_id)?;
    fs::create_dir_all(&cache_dir).map_err(|error| {
        format!(
            "failed to create semantic-index fastembed cache directory path={}: {error}",
            cache_dir.display()
        )
    })?;

    let cache_key = format!("{}::{}", model_id, cache_dir.display());
    let runtimes = FASTEMBED_RUNTIME_BY_KEY.get_or_init(|| Mutex::new(HashMap::new()));
    let mut runtimes = runtimes
        .lock()
        .map_err(|error| format!("failed to lock fastembed runtime registry: {error}"))?;
    if let Some(runtime) = runtimes.get(&cache_key) {
        return Ok(runtime.clone());
    }

    let model = parse_fastembed_model(model_id)?;
    let mut embedding = TextEmbedding::try_new(
        InitOptions::new(model)
            .with_cache_dir(cache_dir)
            .with_show_download_progress(true),
    )
    .map_err(|error| format!("failed to initialize fastembed model_id={model_id}: {error}"))?;
    let probe = embedding
        .embed(
            vec![normalize_fastembed_input("query", "dimension probe")],
            Some(1),
        )
        .map_err(|error| format!("failed to probe fastembed model dimensions: {error}"))?;
    let dimensions = probe
        .first()
        .map(Vec::len)
        .ok_or_else(|| "fastembed dimension probe returned no vectors".to_string())?;

    let runtime = Arc::new(Mutex::new(FastEmbedRuntime {
        model: embedding,
        dimensions,
    }));
    runtimes.insert(cache_key, runtime.clone());
    Ok(runtime)
}

/// 将模型 ID 映射为适合做目录名的稳定片段。
#[cfg(not(test))]
fn sanitize_model_id_for_cache(model_id: &str) -> String {
    model_id
        .chars()
        .map(|character| match character {
            'a'..='z' | 'A'..='Z' | '0'..='9' | '-' | '_' => character,
            _ => '-',
        })
        .collect()
}

/// 解析模型 ID 到 fastembed 枚举。
#[cfg(not(test))]
fn parse_fastembed_model(model_id: &str) -> Result<EmbeddingModel, String> {
    match model_id {
        "intfloat/multilingual-e5-small" => Ok(EmbeddingModel::MultilingualE5Small),
        "BAAI/bge-small-zh-v1.5" => Ok(EmbeddingModel::BGESmallZHV15),
        _ => Err(format!("unsupported fastembed model_id: {model_id}")),
    }
}

/// 规范化检索前缀，兼容 E5 系列 query/passage 约定。
#[cfg(not(test))]
fn normalize_fastembed_input(prefix: &str, text: &str) -> String {
    let trimmed = text.trim();
    let expected_prefix = format!("{prefix}:");
    if trimmed.to_ascii_lowercase().starts_with(&expected_prefix) {
        return trimmed.to_string();
    }

    format!("{prefix}: {trimmed}")
}

/// 使用稳定哈希与词项分布生成可重复的开发期 embedding。
#[cfg(test)]
fn embed_text_deterministically(text: &str, dimensions: usize) -> Vec<f32> {
    let normalized = text.trim().to_lowercase();
    if normalized.is_empty() {
        return vec![0.0; dimensions];
    }

    let mut vector = vec![0.0f32; dimensions];
    for (token_index, token) in normalized.split_whitespace().enumerate() {
        let token_hash = stable_hash(token);
        let primary_bucket = (token_hash as usize) % dimensions;
        let secondary_bucket = ((token_hash >> 16) as usize) % dimensions;
        let length_bucket = token.len() % dimensions;

        vector[primary_bucket] += 1.0;
        vector[secondary_bucket] += 0.5;
        vector[length_bucket] += 0.25;

        for (byte_index, byte) in token.bytes().enumerate() {
            let bucket = (primary_bucket + byte_index + token_index) % dimensions;
            vector[bucket] += f32::from(byte) / 255.0 * 0.125;
        }
    }

    let norm = vector.iter().map(|value| value * value).sum::<f32>().sqrt();
    if norm > 0.0 {
        vector.iter_mut().for_each(|value| *value /= norm);
    }

    vector
}

/// 计算稳定的 FNV-1a 哈希，用于开发期 embedding 桶映射。
#[cfg(test)]
fn stable_hash(text: &str) -> u64 {
    let mut hash = 0xcbf29ce484222325u64;
    for byte in text.bytes() {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

#[cfg(test)]
mod tests {
    use super::{
        available_embedding_providers, build_embedding_provider, semantic_index_embedding_cache_dir,
    };
    use crate::app::app_storage::storage_registry_facade::{
        resolve_app_storage_owner_dir, set_app_storage_test_root,
    };
    use crate::shared::semantic_index_contracts::EmbeddingProviderKind;
    use std::fs;
    use std::path::Path;
    use std::path::PathBuf;
    use std::sync::{Mutex, OnceLock};
    use std::time::{SystemTime, UNIX_EPOCH};

    static TEST_APP_STORAGE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

    struct AppStorageTestGuard {
        _lock: std::sync::MutexGuard<'static, ()>,
        root: PathBuf,
    }

    impl AppStorageTestGuard {
        fn new() -> Self {
            let lock = TEST_APP_STORAGE_LOCK
                .get_or_init(|| Mutex::new(()))
                .lock()
                .expect("app storage test lock should succeed");
            let root = std::env::temp_dir().join(format!(
                "ofive-fastembed-app-storage-{}",
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .map(|duration| duration.as_nanos())
                    .unwrap_or(0)
            ));
            set_app_storage_test_root(Some(root.clone())).expect("test root should set");
            Self { _lock: lock, root }
        }
    }

    impl Drop for AppStorageTestGuard {
        fn drop(&mut self) {
            let _ = set_app_storage_test_root(None);
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    #[test]
    fn available_embedding_providers_should_expose_fastembed() {
        let descriptors = available_embedding_providers();

        assert_eq!(descriptors.len(), 1);
        assert_eq!(descriptors[0].kind, EmbeddingProviderKind::FastEmbed);
        assert!(descriptors[0]
            .supported_model_ids
            .contains(&"intfloat/multilingual-e5-small".to_string()));
    }

    #[test]
    fn fastembed_provider_should_validate_supported_model_ids() {
        let provider = build_embedding_provider(EmbeddingProviderKind::FastEmbed)
            .expect("fastembed provider should build");

        provider
            .validate_model_id("intfloat/multilingual-e5-small")
            .expect("known model should pass validation");
        assert!(provider.validate_model_id("unknown/model").is_err());
    }

    #[test]
    fn fastembed_provider_should_generate_repeatable_embeddings() {
        let provider = build_embedding_provider(EmbeddingProviderKind::FastEmbed)
            .expect("fastembed provider should build");
        let embeddings = provider
            .embed_passages(
                "intfloat/multilingual-e5-small",
                &["alpha beta".to_string(), "alpha beta".to_string()],
                Path::new("/tmp/ofive-fastembed-test"),
            )
            .expect("placeholder embedding should succeed");

        assert_eq!(embeddings.len(), 2);
        assert_eq!(embeddings[0].len(), 16);
        assert_eq!(embeddings[0], embeddings[1]);
    }

    #[test]
    fn fastembed_provider_should_resolve_module_private_cache_dir() {
        let _guard = AppStorageTestGuard::new();
        let cache_dir = semantic_index_embedding_cache_dir().expect("cache dir should resolve");
        let owner_dir = resolve_app_storage_owner_dir("semantic-index", "semantic-index")
            .expect("owner dir should resolve");

        assert_eq!(cache_dir, owner_dir.join("models"));
    }
}
