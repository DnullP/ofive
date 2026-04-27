//! # App Storage Registry 应用服务
//!
//! 统一管理宿主内建模块声明的应用级存储 owner，并负责校验消费者
//! 是否有权访问对应命名空间。

use serde::{de::DeserializeOwned, Serialize};
use std::path::PathBuf;

use crate::infra::persistence::app_private_store;

const SEMANTIC_INDEX_CONSUMERS: &[&str] = &["semantic-index"];

#[derive(Clone, Copy)]
struct AppStorageOwnerDescriptor {
    owner: &'static str,
    consumer_module_ids: &'static [&'static str],
    description: &'static str,
}

const BUILTIN_APP_STORAGE_OWNERS: &[AppStorageOwnerDescriptor] = &[AppStorageOwnerDescriptor {
    owner: "semantic-index",
    consumer_module_ids: SEMANTIC_INDEX_CONSUMERS,
    description: "Semantic-index shared application assets such as embedding models.",
}];

/// 解析应用级 owner 目录，并校验消费者是否有权访问。
pub(crate) fn resolve_app_storage_owner_dir(
    consumer_module_id: &str,
    owner: &str,
) -> Result<PathBuf, String> {
    let descriptor = require_app_storage_owner_descriptor(owner)?;
    ensure_consumer_allowed(consumer_module_id, descriptor)?;
    let owner_dir = app_private_store::app_private_owner_dir(owner)?;
    std::fs::create_dir_all(&owner_dir).map_err(|error| {
        format!(
            "创建应用级存储 owner 目录失败 consumer_module_id={} owner={} path={}: {error}",
            consumer_module_id,
            owner,
            owner_dir.display()
        )
    })?;
    Ok(owner_dir)
}

/// 读取指定 owner 下的应用级状态。
pub(crate) fn load_app_storage_state<T>(
    consumer_module_id: &str,
    owner: &str,
    state_key: &str,
) -> Result<Option<T>, String>
where
    T: DeserializeOwned,
{
    let descriptor = require_app_storage_owner_descriptor(owner)?;
    ensure_consumer_allowed(consumer_module_id, descriptor)?;
    app_private_store::load_app_private_state(owner, state_key)
}

/// 保存指定 owner 下的应用级状态。
pub(crate) fn save_app_storage_state<T>(
    consumer_module_id: &str,
    owner: &str,
    state_key: &str,
    state: &T,
) -> Result<(), String>
where
    T: Serialize,
{
    let descriptor = require_app_storage_owner_descriptor(owner)?;
    ensure_consumer_allowed(consumer_module_id, descriptor)?;
    let _owner_dir = resolve_app_storage_owner_dir(consumer_module_id, owner)?;
    app_private_store::save_app_private_state(owner, state_key, state)
}

fn require_app_storage_owner_descriptor(
    owner: &str,
) -> Result<&'static AppStorageOwnerDescriptor, String> {
    BUILTIN_APP_STORAGE_OWNERS
        .iter()
        .find(|descriptor| descriptor.owner == owner)
        .ok_or_else(|| format!("未注册的应用级存储 owner: {owner}"))
}

fn ensure_consumer_allowed(
    consumer_module_id: &str,
    descriptor: &AppStorageOwnerDescriptor,
) -> Result<(), String> {
    if descriptor.consumer_module_ids.contains(&consumer_module_id) {
        return Ok(());
    }

    Err(format!(
        "应用级存储 owner 不允许该消费者访问 owner={} consumer_module_id={} description={}",
        descriptor.owner, consumer_module_id, descriptor.description
    ))
}

#[cfg(test)]
pub(crate) fn set_app_storage_test_root(root: Option<PathBuf>) -> Result<(), String> {
    app_private_store::set_app_private_store_test_root(root)
}

#[cfg(test)]
mod tests {
    use super::{load_app_storage_state, resolve_app_storage_owner_dir, save_app_storage_state};
    use crate::infra::persistence::app_private_store::set_app_private_store_test_root;
    use serde::{Deserialize, Serialize};
    use std::fs;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::{Mutex, OnceLock};
    use std::time::{SystemTime, UNIX_EPOCH};

    static TEST_ROOT_SEQ: AtomicU64 = AtomicU64::new(1);
    static TEST_LOCK: OnceLock<Mutex<()>> = OnceLock::new();

    #[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
    #[serde(rename_all = "camelCase")]
    struct MockOwnerState {
        ready: bool,
    }

    fn create_test_root() -> PathBuf {
        let sequence = TEST_ROOT_SEQ.fetch_add(1, Ordering::Relaxed);
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0);
        std::env::temp_dir().join(format!(
            "ofive-app-storage-registry-test-{}-{}",
            unique, sequence
        ))
    }

    #[test]
    fn app_storage_should_resolve_registered_owner_dir() {
        let _lock = TEST_LOCK
            .get_or_init(|| Mutex::new(()))
            .lock()
            .expect("test lock should succeed");
        let root = create_test_root();
        set_app_private_store_test_root(Some(root.clone())).expect("test root should set");

        let owner_dir = resolve_app_storage_owner_dir("semantic-index", "semantic-index")
            .expect("registered owner should resolve");

        assert!(owner_dir.exists());
        assert!(owner_dir.starts_with(&root));

        set_app_private_store_test_root(None).expect("test root should reset");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn app_storage_should_roundtrip_owner_state() {
        let _lock = TEST_LOCK
            .get_or_init(|| Mutex::new(()))
            .lock()
            .expect("test lock should succeed");
        let root = create_test_root();
        set_app_private_store_test_root(Some(root.clone())).expect("test root should set");

        save_app_storage_state(
            "semantic-index",
            "semantic-index",
            "model-installs",
            &MockOwnerState { ready: true },
        )
        .expect("state should save");

        let loaded = load_app_storage_state::<MockOwnerState>(
            "semantic-index",
            "semantic-index",
            "model-installs",
        )
        .expect("state should load")
        .expect("state should exist");

        assert!(loaded.ready);

        set_app_private_store_test_root(None).expect("test root should reset");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn app_storage_should_reject_unknown_consumer() {
        let error = resolve_app_storage_owner_dir("vault", "semantic-index")
            .expect_err("unknown consumer should be rejected");

        assert!(error.contains("不允许该消费者访问"));
    }
}
