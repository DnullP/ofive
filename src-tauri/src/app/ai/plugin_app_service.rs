//! # AI 插件应用服务
//!
//! 负责 AI 后端插件的宿主级启停配置编排，并在 AI runtime 能力入口前
//! 执行统一门禁检查。

use std::path::Path;

use tauri::State;

use crate::infra::persistence::backend_plugin_store::{self, AI_BACKEND_PLUGIN_ID};
use crate::shared::backend_plugin_contracts::BackendPluginConfig;
use crate::state::{get_vault_root, AppState};

/// 读取当前仓库的 AI 后端插件启停配置。
pub(crate) fn get_ai_backend_plugin_config(
    state: &State<'_, AppState>,
) -> Result<BackendPluginConfig, String> {
    let root = get_vault_root(state)?;
    get_ai_backend_plugin_config_in_root(&root)
}

/// 保存当前仓库的 AI 后端插件启停配置。
pub(crate) fn save_ai_backend_plugin_config(
    plugin_config: BackendPluginConfig,
    state: &State<'_, AppState>,
) -> Result<BackendPluginConfig, String> {
    let root = get_vault_root(state)?;
    save_ai_backend_plugin_config_in_root(plugin_config, &root)
}

/// 在当前仓库上下文中检查 AI 后端插件是否启用。
pub(crate) fn ensure_ai_backend_plugin_enabled(state: &State<'_, AppState>) -> Result<(), String> {
    let root = get_vault_root(state)?;
    ensure_ai_backend_plugin_enabled_in_root(&root)
}

/// 在指定仓库根目录下读取 AI 后端插件启停配置。
pub(crate) fn get_ai_backend_plugin_config_in_root(
    vault_root: &Path,
) -> Result<BackendPluginConfig, String> {
    backend_plugin_store::load_backend_plugin_config(vault_root, AI_BACKEND_PLUGIN_ID)
}

/// 在指定仓库根目录下保存 AI 后端插件启停配置。
pub(crate) fn save_ai_backend_plugin_config_in_root(
    plugin_config: BackendPluginConfig,
    vault_root: &Path,
) -> Result<BackendPluginConfig, String> {
    if plugin_config.plugin_id != AI_BACKEND_PLUGIN_ID {
        return Err(format!(
            "当前应用服务仅管理 AI 插件配置，expected={} actual={}",
            AI_BACKEND_PLUGIN_ID, plugin_config.plugin_id
        ));
    }

    backend_plugin_store::save_backend_plugin_config(vault_root, plugin_config)
}

/// 在指定仓库根目录下检查 AI 后端插件是否启用。
pub(crate) fn ensure_ai_backend_plugin_enabled_in_root(vault_root: &Path) -> Result<(), String> {
    let enabled =
        backend_plugin_store::is_backend_plugin_enabled(vault_root, AI_BACKEND_PLUGIN_ID)?;
    if enabled {
        return Ok(());
    }

    Err("AI 后端插件当前已关闭，请先在宿主插件配置中启用 ai-chat".to_string())
}

#[cfg(test)]
mod tests {
    use super::{ensure_ai_backend_plugin_enabled_in_root, save_ai_backend_plugin_config_in_root};
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
            "ofive-ai-plugin-app-service-test-{}-{}",
            unique, sequence
        ));
        fs::create_dir_all(root.join(".ofive")).expect("应成功创建测试根目录");
        root
    }

    #[test]
    fn ensure_ai_backend_plugin_enabled_should_fail_when_plugin_disabled() {
        let root = create_test_root();
        save_ai_backend_plugin_config_in_root(
            BackendPluginConfig {
                plugin_id: "ai-chat".to_string(),
                enabled: false,
            },
            &root,
        )
        .expect("保存禁用配置应成功");

        let error = ensure_ai_backend_plugin_enabled_in_root(&root)
            .expect_err("AI 插件关闭时应拒绝运行时能力");
        assert!(error.contains("已关闭"));

        let _ = fs::remove_dir_all(root);
    }
}
