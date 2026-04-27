//! # 应用级私有存储模块
//!
//! 为宿主后端模块提供跨仓库复用的应用级命名空间存储能力。
//! 当前实现采用文件级 JSON envelope：
//!
//! - 存储根目录：系统应用数据目录下的 `app-storage/extensions/<owner>/`
//! - 单个状态文件：`<state_key>.json`
//! - envelope 字段：`schemaVersion`、`owner`、`data`
//!
//! 该模块只负责应用级存储基础设施，不承载具体业务语义。

use directories::ProjectDirs;
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::Value;
use std::ffi::OsStr;
use std::fs;
use std::path::{Path, PathBuf};

const APP_PRIVATE_STORE_SCHEMA_VERSION: u32 = 1;
const APP_PRIVATE_STORE_ENV_KEY: &str = "OFIVE_APP_STORAGE_ROOT";
const APP_PRIVATE_STORE_ROOT_DIR: &str = "app-storage/extensions";
const APP_PRIVATE_STORE_QUALIFIER: &str = "com";
const APP_PRIVATE_STORE_ORGANIZATION: &str = "kaiqiu";
const APP_PRIVATE_STORE_APPLICATION: &str = "ofive";

#[cfg(test)]
static APP_PRIVATE_TEST_ROOT: std::sync::OnceLock<std::sync::Mutex<Option<PathBuf>>> =
    std::sync::OnceLock::new();

/// 应用级私有状态文件 envelope。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AppPrivateStoreEnvelope {
    /// 状态文件 schema 版本。
    schema_version: u32,
    /// 扩展 owner 标识。
    owner: String,
    /// 扩展自定义状态数据。
    data: Value,
}

/// 应用级私有状态记录。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AppPrivateStateRecord {
    /// 扩展 owner 标识。
    pub owner: String,
    /// 状态键。
    pub state_key: String,
    /// 状态 schema 版本。
    pub schema_version: u32,
    /// 当前记录 revision。
    pub revision: String,
    /// 原始 JSON 载荷。
    pub data: Value,
}

/// 读取应用级私有状态。
pub(crate) fn load_app_private_state<T>(owner: &str, state_key: &str) -> Result<Option<T>, String>
where
    T: DeserializeOwned,
{
    let Some(record) = load_app_private_state_value(owner, state_key)? else {
        return Ok(None);
    };

    let state = serde_json::from_value::<T>(record.data).map_err(|error| {
        format!(
            "反序列化应用级私有状态失败 owner={} state_key={}: {error}",
            owner, state_key
        )
    })?;

    Ok(Some(state))
}

/// 保存应用级私有状态。
pub(crate) fn save_app_private_state<T>(
    owner: &str,
    state_key: &str,
    state: &T,
) -> Result<(), String>
where
    T: Serialize,
{
    let data = serde_json::to_value(state).map_err(|error| {
        format!(
            "序列化应用级私有状态失败 owner={} state_key={}: {error}",
            owner, state_key
        )
    })?;
    save_app_private_state_value(owner, state_key, APP_PRIVATE_STORE_SCHEMA_VERSION, &data)?;
    Ok(())
}

/// 读取应用级私有状态的原始 JSON 记录。
pub(crate) fn load_app_private_state_value(
    owner: &str,
    state_key: &str,
) -> Result<Option<AppPrivateStateRecord>, String> {
    let file_path = app_private_state_file_path(owner, state_key)?;
    if !file_path.exists() {
        return Ok(None);
    }

    let envelope = read_app_private_envelope(&file_path, owner, state_key)?;
    Ok(Some(record_from_envelope(
        state_key,
        envelope.schema_version,
        envelope.owner,
        envelope.data,
    )?))
}

/// 保存应用级私有状态的原始 JSON 记录。
pub(crate) fn save_app_private_state_value(
    owner: &str,
    state_key: &str,
    schema_version: u32,
    data: &Value,
) -> Result<AppPrivateStateRecord, String> {
    if schema_version == 0 {
        return Err(format!(
            "应用级私有状态 schema_version 非法 owner={} state_key={}",
            owner, state_key
        ));
    }

    let file_path = app_private_state_file_path(owner, state_key)?;
    let parent = file_path.parent().ok_or_else(|| {
        format!(
            "应用级私有状态目录缺失 owner={} state_key={}",
            owner, state_key
        )
    })?;
    fs::create_dir_all(parent).map_err(|error| {
        format!(
            "创建应用级私有状态目录失败 owner={} state_key={} path={}: {error}",
            owner,
            state_key,
            parent.display()
        )
    })?;

    let envelope = AppPrivateStoreEnvelope {
        schema_version,
        owner: owner.to_string(),
        data: data.clone(),
    };
    let serialized = serde_json::to_string_pretty(&envelope).map_err(|error| {
        format!(
            "序列化应用级私有状态 envelope 失败 owner={} state_key={}: {error}",
            owner, state_key
        )
    })?;

    fs::write(&file_path, serialized).map_err(|error| {
        format!(
            "写入应用级私有状态失败 owner={} state_key={} path={}: {error}",
            owner,
            state_key,
            file_path.display()
        )
    })?;

    record_from_envelope(state_key, schema_version, owner.to_string(), data.clone())
}

/// 列出指定 owner 下的全部应用级私有状态。
#[cfg_attr(not(test), allow(dead_code))]
pub(crate) fn list_app_private_states(owner: &str) -> Result<Vec<AppPrivateStateRecord>, String> {
    validate_app_private_store_segment(owner, "owner")?;

    let owner_dir = app_private_owner_dir(owner)?;
    if !owner_dir.exists() {
        return Ok(Vec::new());
    }

    let read_dir = fs::read_dir(&owner_dir).map_err(|error| {
        format!(
            "读取应用级私有状态目录失败 owner={} path={}: {error}",
            owner,
            owner_dir.display()
        )
    })?;

    let mut records = Vec::new();
    for entry in read_dir {
        let entry = entry.map_err(|error| format!("读取应用级私有状态目录项失败: {error}"))?;
        let file_path = entry.path();
        if !file_path.is_file() {
            continue;
        }
        if file_path.extension() != Some(OsStr::new("json")) {
            continue;
        }

        let Some(state_key) = file_path.file_stem().and_then(|item| item.to_str()) else {
            continue;
        };
        validate_app_private_store_segment(state_key, "state_key")?;
        let envelope = read_app_private_envelope(&file_path, owner, state_key)?;
        records.push(record_from_envelope(
            state_key,
            envelope.schema_version,
            envelope.owner,
            envelope.data,
        )?);
    }

    records.sort_by(|left, right| left.state_key.cmp(&right.state_key));
    Ok(records)
}

/// 返回应用级私有存储根目录。
pub(crate) fn app_private_root_dir() -> Result<PathBuf, String> {
    #[cfg(test)]
    {
        if let Some(path) = app_private_store_test_root()? {
            return Ok(path);
        }
    }

    if let Ok(root) = std::env::var(APP_PRIVATE_STORE_ENV_KEY) {
        let trimmed = root.trim();
        if !trimmed.is_empty() {
            return Ok(PathBuf::from(trimmed));
        }
    }

    let project_dirs = ProjectDirs::from(
        APP_PRIVATE_STORE_QUALIFIER,
        APP_PRIVATE_STORE_ORGANIZATION,
        APP_PRIVATE_STORE_APPLICATION,
    )
    .ok_or_else(|| "无法解析应用级存储目录".to_string())?;

    Ok(project_dirs
        .data_local_dir()
        .join(APP_PRIVATE_STORE_ROOT_DIR))
}

/// 返回应用级 owner 对应的私有目录路径。
pub(crate) fn app_private_owner_dir(owner: &str) -> Result<PathBuf, String> {
    validate_app_private_store_segment(owner, "owner")?;
    Ok(app_private_root_dir()?.join(owner))
}

#[cfg(test)]
pub(crate) fn set_app_private_store_test_root(root: Option<PathBuf>) -> Result<(), String> {
    let registry = APP_PRIVATE_TEST_ROOT.get_or_init(|| std::sync::Mutex::new(None));
    let mut guard = registry
        .lock()
        .map_err(|error| format!("app private store test root lock poisoned: {error}"))?;
    *guard = root;
    Ok(())
}

fn app_private_state_file_path(owner: &str, state_key: &str) -> Result<PathBuf, String> {
    validate_app_private_store_segment(owner, "owner")?;
    validate_app_private_store_segment(state_key, "state_key")?;

    Ok(app_private_owner_dir(owner)?.join(format!("{state_key}.json")))
}

fn read_app_private_envelope(
    file_path: &Path,
    owner: &str,
    state_key: &str,
) -> Result<AppPrivateStoreEnvelope, String> {
    let raw = fs::read_to_string(file_path).map_err(|error| {
        format!(
            "读取应用级私有状态失败 owner={} state_key={} path={}: {error}",
            owner,
            state_key,
            file_path.display()
        )
    })?;
    let envelope = serde_json::from_str::<AppPrivateStoreEnvelope>(&raw).map_err(|error| {
        format!(
            "解析应用级私有状态失败 owner={} state_key={} path={}: {error}",
            owner,
            state_key,
            file_path.display()
        )
    })?;

    if envelope.owner != owner {
        return Err(format!(
            "应用级私有状态 owner 不匹配 state_key={} expected={} actual={}",
            state_key, owner, envelope.owner
        ));
    }
    if envelope.schema_version == 0 {
        return Err(format!(
            "应用级私有状态 schema_version 非法 owner={} state_key={}",
            owner, state_key
        ));
    }

    Ok(envelope)
}

fn record_from_envelope(
    state_key: &str,
    schema_version: u32,
    owner: String,
    data: Value,
) -> Result<AppPrivateStateRecord, String> {
    validate_app_private_store_segment(state_key, "state_key")?;
    Ok(AppPrivateStateRecord {
        revision: compute_revision(&owner, state_key, schema_version, &data),
        owner,
        state_key: state_key.to_string(),
        schema_version,
        data,
    })
}

fn compute_revision(owner: &str, state_key: &str, schema_version: u32, data: &Value) -> String {
    let data_string = serde_json::to_string(data).unwrap_or_else(|_| "null".to_string());
    let mut hash = 0xcbf29ce484222325u64;

    for byte in owner
        .bytes()
        .chain([0u8])
        .chain(state_key.bytes())
        .chain([0u8])
        .chain(schema_version.to_string().bytes())
        .chain([0u8])
        .chain(data_string.bytes())
    {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }

    format!("rev-{hash:016x}")
}

fn validate_app_private_store_segment(segment: &str, label: &str) -> Result<(), String> {
    if segment.trim().is_empty() {
        return Err(format!("应用级私有存储 {} 不能为空", label));
    }

    let is_valid = segment.chars().all(|character| {
        character.is_ascii_lowercase()
            || character.is_ascii_digit()
            || character == '-'
            || character == '_'
    });
    if !is_valid {
        return Err(format!(
            "应用级私有存储 {} 非法，仅允许小写字母、数字、-、_",
            label
        ));
    }

    Ok(())
}

#[cfg(test)]
fn app_private_store_test_root() -> Result<Option<PathBuf>, String> {
    let registry = APP_PRIVATE_TEST_ROOT.get_or_init(|| std::sync::Mutex::new(None));
    let guard = registry
        .lock()
        .map_err(|error| format!("app private store test root lock poisoned: {error}"))?;
    Ok(guard.clone())
}

#[cfg(test)]
mod tests {
    use super::{
        app_private_owner_dir, list_app_private_states, load_app_private_state,
        save_app_private_state, set_app_private_store_test_root,
    };
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
    struct MockAppState {
        enabled: bool,
        value: String,
    }

    fn create_test_root() -> PathBuf {
        let sequence = TEST_ROOT_SEQ.fetch_add(1, Ordering::Relaxed);
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0);
        std::env::temp_dir().join(format!(
            "ofive-app-private-store-test-{}-{}",
            unique, sequence
        ))
    }

    #[test]
    fn app_private_store_should_roundtrip_typed_state() {
        let _lock = TEST_LOCK
            .get_or_init(|| Mutex::new(()))
            .lock()
            .expect("test lock should succeed");
        let root = create_test_root();
        set_app_private_store_test_root(Some(root.clone())).expect("test root should set");

        save_app_private_state(
            "semantic-index",
            "settings",
            &MockAppState {
                enabled: true,
                value: "alpha".to_string(),
            },
        )
        .expect("state should save");

        let loaded = load_app_private_state::<MockAppState>("semantic-index", "settings")
            .expect("state should load")
            .expect("state should exist");

        assert_eq!(loaded.value, "alpha");

        set_app_private_store_test_root(None).expect("test root should reset");
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn app_private_store_should_list_owner_states() {
        let _lock = TEST_LOCK
            .get_or_init(|| Mutex::new(()))
            .lock()
            .expect("test lock should succeed");
        let root = create_test_root();
        set_app_private_store_test_root(Some(root.clone())).expect("test root should set");

        save_app_private_state(
            "semantic-index",
            "models",
            &MockAppState {
                enabled: true,
                value: "models".to_string(),
            },
        )
        .expect("models should save");
        save_app_private_state(
            "semantic-index",
            "settings",
            &MockAppState {
                enabled: false,
                value: "settings".to_string(),
            },
        )
        .expect("settings should save");

        let items = list_app_private_states("semantic-index").expect("states should list");
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].state_key, "models");
        assert_eq!(items[1].state_key, "settings");

        let owner_dir = app_private_owner_dir("semantic-index").expect("owner dir should resolve");
        assert!(owner_dir.starts_with(&root));

        set_app_private_store_test_root(None).expect("test root should reset");
        let _ = fs::remove_dir_all(root);
    }
}
