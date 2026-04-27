//! # Vault 配置持久化模块
//!
//! 该模块负责仓库级配置文件的读写与初始化。
//! 当前阶段仅提供配置持久化基础能力，不承载具体业务规则。

use std::fs;
use std::path::{Path, PathBuf};

use crate::shared::vault_contracts::VaultConfig;

fn vault_config_dir(vault_root: &Path) -> PathBuf {
    vault_root.join(".ofive")
}

fn vault_config_file(vault_root: &Path) -> PathBuf {
    vault_config_dir(vault_root).join("config.json")
}

/// 确保仓库配置文件存在。
pub(crate) fn ensure_vault_config_file(vault_root: &Path) -> Result<PathBuf, String> {
    let dir = vault_config_dir(vault_root);
    fs::create_dir_all(&dir)
        .map_err(|error| format!("创建仓库配置目录失败 {}: {error}", dir.to_string_lossy()))?;

    let file = vault_config_file(vault_root);
    if !file.exists() {
        let initial = serde_json::to_string_pretty(&VaultConfig::default())
            .map_err(|error| format!("序列化默认仓库配置失败: {error}"))?;
        fs::write(&file, initial)
            .map_err(|error| format!("写入默认仓库配置失败 {}: {error}", file.to_string_lossy()))?;
    }

    Ok(file)
}

/// 读取仓库配置。
pub(crate) fn load_vault_config(vault_root: &Path) -> Result<VaultConfig, String> {
    let file = ensure_vault_config_file(vault_root)?;
    let raw = fs::read_to_string(&file)
        .map_err(|error| format!("读取仓库配置失败 {}: {error}", file.to_string_lossy()))?;

    serde_json::from_str::<VaultConfig>(&raw)
        .map_err(|error| format!("解析仓库配置失败 {}: {error}", file.to_string_lossy()))
}

/// 保存仓库配置。
pub(crate) fn save_vault_config(vault_root: &Path, config: &VaultConfig) -> Result<(), String> {
    let file = ensure_vault_config_file(vault_root)?;
    let serialized = serde_json::to_string_pretty(config)
        .map_err(|error| format!("序列化仓库配置失败: {error}"))?;

    fs::write(&file, serialized)
        .map_err(|error| format!("写入仓库配置失败 {}: {error}", file.to_string_lossy()))
}
