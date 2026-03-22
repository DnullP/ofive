//! # 扩展私有存储模块
//!
//! 为宿主托管的后端扩展提供命名空间隔离的持久化能力。
//! 当前实现采用文件级 JSON envelope：
//!
//! - 存储根目录：`.ofive/extensions/<owner>/`
//! - 单个状态文件：`<state_key>.json`
//! - envelope 字段：`schemaVersion`、`owner`、`data`
//!
//! 该模块只负责宿主持久化基础设施，不承载具体扩展的产品语义。

use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::Value;
use std::ffi::OsStr;
use std::fs;
use std::path::{Path, PathBuf};

const EXTENSION_PRIVATE_STORE_SCHEMA_VERSION: u32 = 1;
const EXTENSION_PRIVATE_STORE_ROOT_DIR: &str = ".ofive/extensions";

/// 扩展私有状态文件 envelope。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExtensionPrivateStoreEnvelope {
    /// 状态文件 schema 版本。
    schema_version: u32,
    /// 扩展 owner 标识。
    owner: String,
    /// 扩展自定义状态数据。
    data: Value,
}

/// 扩展私有状态记录。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExtensionPrivateStateRecord {
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

/// 读取扩展私有状态。
///
/// # 参数
/// - `vault_root`：当前仓库根目录。
/// - `owner`：扩展 owner 标识，例如 `ai-chat`。
/// - `state_key`：状态键，例如 `settings`、`history`。
///
/// # 返回
/// - `Ok(Some(T))`：成功读取并反序列化。
/// - `Ok(None)`：状态文件不存在。
/// - `Err(String)`：路径、读取或反序列化失败。
pub(crate) fn load_extension_private_state<T>(
    vault_root: &Path,
    owner: &str,
    state_key: &str,
) -> Result<Option<T>, String>
where
    T: DeserializeOwned,
{
    let Some(record) = load_extension_private_state_value(vault_root, owner, state_key)? else {
        return Ok(None);
    };

    let state = serde_json::from_value::<T>(record.data).map_err(|error| {
        format!(
            "反序列化扩展私有状态失败 owner={} state_key={}: {error}",
            owner, state_key
        )
    })?;

    Ok(Some(state))
}

/// 保存扩展私有状态。
///
/// # 参数
/// - `vault_root`：当前仓库根目录。
/// - `owner`：扩展 owner 标识。
/// - `state_key`：状态键。
/// - `state`：待保存状态。
///
/// # 返回
/// - `Ok(())`：保存成功。
/// - `Err(String)`：路径、序列化或写入失败。
pub(crate) fn save_extension_private_state<T>(
    vault_root: &Path,
    owner: &str,
    state_key: &str,
    state: &T,
) -> Result<(), String>
where
    T: Serialize,
{
    let data = serde_json::to_value(state).map_err(|error| {
        format!(
            "序列化扩展私有状态失败 owner={} state_key={}: {error}",
            owner, state_key
        )
    })?;
    save_extension_private_state_value(
        vault_root,
        owner,
        state_key,
        EXTENSION_PRIVATE_STORE_SCHEMA_VERSION,
        &data,
    )?;
    Ok(())
}

/// 读取扩展私有状态的原始 JSON 记录。
pub(crate) fn load_extension_private_state_value(
    vault_root: &Path,
    owner: &str,
    state_key: &str,
) -> Result<Option<ExtensionPrivateStateRecord>, String> {
    let file_path = extension_private_state_file_path(vault_root, owner, state_key)?;
    if !file_path.exists() {
        return Ok(None);
    }

    let envelope = read_extension_private_envelope(&file_path, owner, state_key)?;
    Ok(Some(record_from_envelope(
        state_key,
        envelope.schema_version,
        envelope.owner,
        envelope.data,
    )?))
}

/// 保存扩展私有状态的原始 JSON 记录。
pub(crate) fn save_extension_private_state_value(
    vault_root: &Path,
    owner: &str,
    state_key: &str,
    schema_version: u32,
    data: &Value,
) -> Result<ExtensionPrivateStateRecord, String> {
    if schema_version == 0 {
        return Err(format!(
            "扩展私有状态 schema_version 非法 owner={} state_key={}",
            owner, state_key
        ));
    }

    let file_path = extension_private_state_file_path(vault_root, owner, state_key)?;
    let parent = file_path.parent().ok_or_else(|| {
        format!(
            "扩展私有状态目录缺失 owner={} state_key={}",
            owner, state_key
        )
    })?;
    fs::create_dir_all(parent).map_err(|error| {
        format!(
            "创建扩展私有状态目录失败 owner={} state_key={} path={}: {error}",
            owner,
            state_key,
            parent.display()
        )
    })?;

    let envelope = ExtensionPrivateStoreEnvelope {
        schema_version,
        owner: owner.to_string(),
        data: data.clone(),
    };
    let serialized = serde_json::to_string_pretty(&envelope).map_err(|error| {
        format!(
            "序列化扩展私有状态 envelope 失败 owner={} state_key={}: {error}",
            owner, state_key
        )
    })?;

    fs::write(&file_path, serialized).map_err(|error| {
        format!(
            "写入扩展私有状态失败 owner={} state_key={} path={}: {error}",
            owner,
            state_key,
            file_path.display()
        )
    })?;

    record_from_envelope(state_key, schema_version, owner.to_string(), data.clone())
}

/// 删除扩展私有状态。
pub(crate) fn delete_extension_private_state(
    vault_root: &Path,
    owner: &str,
    state_key: &str,
) -> Result<bool, String> {
    let file_path = extension_private_state_file_path(vault_root, owner, state_key)?;
    if !file_path.exists() {
        return Ok(false);
    }

    fs::remove_file(&file_path).map_err(|error| {
        format!(
            "删除扩展私有状态失败 owner={} state_key={} path={}: {error}",
            owner,
            state_key,
            file_path.display()
        )
    })?;
    Ok(true)
}

/// 列出指定 owner 下的全部扩展私有状态。
pub(crate) fn list_extension_private_states(
    vault_root: &Path,
    owner: &str,
) -> Result<Vec<ExtensionPrivateStateRecord>, String> {
    validate_extension_private_store_segment(owner, "owner")?;

    let owner_dir = vault_root
        .join(EXTENSION_PRIVATE_STORE_ROOT_DIR)
        .join(owner);
    if !owner_dir.exists() {
        return Ok(Vec::new());
    }

    let read_dir = fs::read_dir(&owner_dir).map_err(|error| {
        format!(
            "读取扩展私有状态目录失败 owner={} path={}: {error}",
            owner,
            owner_dir.display()
        )
    })?;

    let mut records = Vec::new();
    for entry in read_dir {
        let entry = entry.map_err(|error| format!("读取扩展私有状态目录项失败: {error}"))?;
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
        validate_extension_private_store_segment(state_key, "state_key")?;
        let envelope = read_extension_private_envelope(&file_path, owner, state_key)?;
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

/// 解析扩展私有状态文件路径。
fn extension_private_state_file_path(
    vault_root: &Path,
    owner: &str,
    state_key: &str,
) -> Result<PathBuf, String> {
    validate_extension_private_store_segment(owner, "owner")?;
    validate_extension_private_store_segment(state_key, "state_key")?;

    Ok(vault_root
        .join(EXTENSION_PRIVATE_STORE_ROOT_DIR)
        .join(owner)
        .join(format!("{state_key}.json")))
}

fn read_extension_private_envelope(
    file_path: &Path,
    owner: &str,
    state_key: &str,
) -> Result<ExtensionPrivateStoreEnvelope, String> {
    let raw = fs::read_to_string(file_path).map_err(|error| {
        format!(
            "读取扩展私有状态失败 owner={} state_key={} path={}: {error}",
            owner,
            state_key,
            file_path.display()
        )
    })?;
    let envelope =
        serde_json::from_str::<ExtensionPrivateStoreEnvelope>(&raw).map_err(|error| {
            format!(
                "解析扩展私有状态失败 owner={} state_key={} path={}: {error}",
                owner,
                state_key,
                file_path.display()
            )
        })?;

    if envelope.owner != owner {
        return Err(format!(
            "扩展私有状态 owner 不匹配 state_key={} expected={} actual={}",
            state_key, owner, envelope.owner
        ));
    }
    if envelope.schema_version == 0 {
        return Err(format!(
            "扩展私有状态 schema_version 非法 owner={} state_key={}",
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
) -> Result<ExtensionPrivateStateRecord, String> {
    validate_extension_private_store_segment(state_key, "state_key")?;
    Ok(ExtensionPrivateStateRecord {
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

/// 校验扩展 owner / state_key 片段，避免路径逃逸。
fn validate_extension_private_store_segment(segment: &str, label: &str) -> Result<(), String> {
    if segment.trim().is_empty() {
        return Err(format!("扩展私有存储 {} 不能为空", label));
    }

    let is_valid = segment.chars().all(|character| {
        character.is_ascii_lowercase()
            || character.is_ascii_digit()
            || character == '-'
            || character == '_'
    });
    if !is_valid {
        return Err(format!(
            "扩展私有存储 {} 非法，仅允许小写字母、数字、-、_",
            label
        ));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        delete_extension_private_state, list_extension_private_states,
        load_extension_private_state, load_extension_private_state_value,
        save_extension_private_state, save_extension_private_state_value,
    };
    use serde::{Deserialize, Serialize};
    use serde_json::json;
    use std::fs;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    static TEST_ROOT_SEQ: AtomicU64 = AtomicU64::new(1);

    #[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
    #[serde(rename_all = "camelCase")]
    struct MockExtensionState {
        enabled: bool,
        value: String,
    }

    fn create_test_root() -> PathBuf {
        let sequence = TEST_ROOT_SEQ.fetch_add(1, Ordering::Relaxed);
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0);
        let root = std::env::temp_dir().join(format!(
            "ofive-extension-private-store-test-{}-{}",
            unique, sequence
        ));
        fs::create_dir_all(root.join(".ofive")).expect("应成功创建测试根目录");
        root
    }

    #[test]
    fn extension_private_store_should_roundtrip_typed_state() {
        let root = create_test_root();
        let state = MockExtensionState {
            enabled: true,
            value: "ok".to_string(),
        };

        save_extension_private_state(&root, "ai_chat", "settings", &state)
            .expect("保存扩展私有状态应成功");
        let loaded =
            load_extension_private_state::<MockExtensionState>(&root, "ai_chat", "settings")
                .expect("读取扩展私有状态应成功")
                .expect("状态应存在");

        assert_eq!(loaded, state);
        assert!(root
            .join(".ofive/extensions/ai_chat/settings.json")
            .exists());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn extension_private_store_should_reject_invalid_owner_segment() {
        let root = create_test_root();
        let state = MockExtensionState {
            enabled: true,
            value: "ok".to_string(),
        };

        let error = save_extension_private_state(&root, "AI Chat", "settings", &state)
            .expect_err("非法 owner 应返回错误");
        assert!(error.contains("owner"));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn extension_private_store_should_roundtrip_raw_state_with_revision() {
        let root = create_test_root();

        let saved = save_extension_private_state_value(
            &root,
            "ai-chat",
            "history",
            2,
            &json!({"messages": ["hello"]}),
        )
        .expect("保存原始状态应成功");
        let loaded = load_extension_private_state_value(&root, "ai-chat", "history")
            .expect("读取原始状态应成功")
            .expect("状态应存在");

        assert_eq!(saved.schema_version, 2);
        assert_eq!(loaded.revision, saved.revision);
        assert_eq!(loaded.data, json!({"messages": ["hello"]}));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn extension_private_store_should_list_and_delete_owner_states() {
        let root = create_test_root();

        save_extension_private_state_value(&root, "ai-chat", "history", 1, &json!({}))
            .expect("保存 history 应成功");
        save_extension_private_state_value(&root, "ai-chat", "settings", 1, &json!({}))
            .expect("保存 settings 应成功");

        let items = list_extension_private_states(&root, "ai-chat").expect("列出状态应成功");
        assert_eq!(items.len(), 2);
        assert_eq!(items[0].state_key, "history");
        assert_eq!(items[1].state_key, "settings");

        let deleted =
            delete_extension_private_state(&root, "ai-chat", "history").expect("删除状态应成功");
        assert!(deleted);

        let after_delete =
            list_extension_private_states(&root, "ai-chat").expect("再次列出状态应成功");
        assert_eq!(after_delete.len(), 1);
        assert_eq!(after_delete[0].state_key, "settings");

        let _ = fs::remove_dir_all(root);
    }
}
