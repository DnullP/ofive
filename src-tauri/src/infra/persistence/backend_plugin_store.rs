//! # 后端插件配置持久化模块
//!
//! 由宿主统一管理后端插件的启停配置。
//! 当前实现将插件状态持久化到 `vault config` 的 `backendPluginStates` 条目中，
//! 作为宿主能力边界的一部分，与插件私有状态分离。

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::Path;

use crate::infra::persistence::vault_config_store::{load_vault_config, save_vault_config};
use crate::shared::backend_plugin_contracts::BackendPluginConfig;

const BACKEND_PLUGIN_STATES_CONFIG_KEY: &str = "backendPluginStates";
pub(crate) const AI_BACKEND_PLUGIN_ID: &str = "ai-chat";

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct BackendPluginStateEntry {
    enabled: bool,
}

/// 读取指定后端插件启停配置。
///
/// # 参数
/// - `vault_root`：当前仓库根目录。
/// - `plugin_id`：插件唯一标识。
///
/// # 返回
/// - `Ok(BackendPluginConfig)`：当前插件配置。
/// - `Err(String)`：配置读取或解析失败。
pub(crate) fn load_backend_plugin_config(
    vault_root: &Path,
    plugin_id: &str,
) -> Result<BackendPluginConfig, String> {
    validate_plugin_id(plugin_id)?;

    let config = load_vault_config(vault_root)?;
    let default_enabled = default_plugin_enabled(plugin_id);
    let enabled = config
        .entries
        .get(BACKEND_PLUGIN_STATES_CONFIG_KEY)
        .and_then(Value::as_object)
        .and_then(|states| states.get(plugin_id))
        .cloned()
        .and_then(|value| serde_json::from_value::<BackendPluginStateEntry>(value).ok())
        .map(|entry| entry.enabled)
        .unwrap_or(default_enabled);

    Ok(BackendPluginConfig {
        plugin_id: plugin_id.to_string(),
        enabled,
    })
}

/// 保存指定后端插件启停配置。
///
/// # 参数
/// - `vault_root`：当前仓库根目录。
/// - `plugin_config`：待保存插件配置。
///
/// # 返回
/// - `Ok(BackendPluginConfig)`：实际保存后的插件配置。
/// - `Err(String)`：配置读取、序列化或写入失败。
pub(crate) fn save_backend_plugin_config(
    vault_root: &Path,
    plugin_config: BackendPluginConfig,
) -> Result<BackendPluginConfig, String> {
    validate_plugin_id(&plugin_config.plugin_id)?;

    let mut config = load_vault_config(vault_root)?;
    let mut state_entries = config
        .entries
        .get(BACKEND_PLUGIN_STATES_CONFIG_KEY)
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();

    let entry = serde_json::to_value(BackendPluginStateEntry {
        enabled: plugin_config.enabled,
    })
    .map_err(|error| {
        format!(
            "序列化后端插件配置失败 plugin_id={}: {error}",
            plugin_config.plugin_id
        )
    })?;
    state_entries.insert(plugin_config.plugin_id.clone(), entry);
    config.entries.insert(
        BACKEND_PLUGIN_STATES_CONFIG_KEY.to_string(),
        Value::Object(state_entries),
    );
    save_vault_config(vault_root, &config)?;

    Ok(plugin_config)
}

/// 判断指定后端插件当前是否启用。
pub(crate) fn is_backend_plugin_enabled(
    vault_root: &Path,
    plugin_id: &str,
) -> Result<bool, String> {
    Ok(load_backend_plugin_config(vault_root, plugin_id)?.enabled)
}

fn default_plugin_enabled(plugin_id: &str) -> bool {
    match plugin_id {
        AI_BACKEND_PLUGIN_ID => true,
        _ => false,
    }
}

fn validate_plugin_id(plugin_id: &str) -> Result<(), String> {
    if plugin_id.trim().is_empty() {
        return Err("plugin_id 不能为空".to_string());
    }

    let is_valid = plugin_id.chars().all(|character| {
        character.is_ascii_lowercase()
            || character.is_ascii_digit()
            || character == '-'
            || character == '_'
    });
    if !is_valid {
        return Err("plugin_id 非法，仅允许小写字母、数字、-、_".to_string());
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        is_backend_plugin_enabled, load_backend_plugin_config, save_backend_plugin_config,
        AI_BACKEND_PLUGIN_ID,
    };
    use crate::shared::backend_plugin_contracts::BackendPluginConfig;
    use std::fs;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    static TEST_ROOT_SEQ: AtomicU64 = AtomicU64::new(1);

    fn create_test_root() -> PathBuf {
        let sequence = TEST_ROOT_SEQ.fetch_add(1, Ordering::Relaxed);
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0);
        let root = std::env::temp_dir().join(format!(
            "ofive-backend-plugin-store-test-{}-{}",
            unique, sequence
        ));
        fs::create_dir_all(root.join(".ofive")).expect("应成功创建测试根目录");
        root
    }

    #[test]
    fn backend_plugin_store_should_default_ai_plugin_to_enabled() {
        let root = create_test_root();

        let config = load_backend_plugin_config(&root, AI_BACKEND_PLUGIN_ID)
            .expect("读取默认 AI 插件配置应成功");

        assert!(config.enabled);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn backend_plugin_store_should_roundtrip_saved_state() {
        let root = create_test_root();
        let saved = save_backend_plugin_config(
            &root,
            BackendPluginConfig {
                plugin_id: AI_BACKEND_PLUGIN_ID.to_string(),
                enabled: false,
            },
        )
        .expect("保存插件配置应成功");
        let loaded =
            load_backend_plugin_config(&root, AI_BACKEND_PLUGIN_ID).expect("读取插件配置应成功");

        assert!(!saved.enabled);
        assert_eq!(loaded, saved);
        assert!(!is_backend_plugin_enabled(&root, AI_BACKEND_PLUGIN_ID).unwrap());

        let _ = fs::remove_dir_all(root);
    }
}
