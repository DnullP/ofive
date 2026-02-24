//! # 仓库配置模块
//!
//! 该模块负责仓库级配置文件的读写与初始化。
//! 当前阶段仅提供“配置持久化骨架能力”，不承载具体业务功能。
//!
//! ## 配置存储规则
//! - 配置目录：`<vault>/.ofive/`
//! - 配置文件：`<vault>/.ofive/config.json`
//!
//! ## 使用示例
//! ```ignore
//! let config = load_vault_config(vault_root)?;
//! save_vault_config(vault_root, &config)?;
//! ```

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::fs;
use std::path::{Path, PathBuf};

/// 仓库配置对象。
///
/// 当前为预留结构：
/// - `schema_version` 用于未来配置升级
/// - `entries` 用于后续扩展具体配置项
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultConfig {
    /// 配置结构版本。
    pub schema_version: u32,
    /// 预留配置项集合。
    pub entries: Map<String, Value>,
}

impl Default for VaultConfig {
    fn default() -> Self {
        Self {
            schema_version: 1,
            entries: Map::new(),
        }
    }
}

/// 计算仓库配置目录。
fn vault_config_dir(vault_root: &Path) -> PathBuf {
    vault_root.join(".ofive")
}

/// 计算仓库配置文件路径。
fn vault_config_file(vault_root: &Path) -> PathBuf {
    vault_config_dir(vault_root).join("config.json")
}

/// 确保仓库配置文件存在。
///
/// 若文件不存在，会写入默认配置。
pub fn ensure_vault_config_file(vault_root: &Path) -> Result<PathBuf, String> {
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
pub fn load_vault_config(vault_root: &Path) -> Result<VaultConfig, String> {
    let file = ensure_vault_config_file(vault_root)?;
    let raw = fs::read_to_string(&file)
        .map_err(|error| format!("读取仓库配置失败 {}: {error}", file.to_string_lossy()))?;

    serde_json::from_str::<VaultConfig>(&raw)
        .map_err(|error| format!("解析仓库配置失败 {}: {error}", file.to_string_lossy()))
}

/// 保存仓库配置。
pub fn save_vault_config(vault_root: &Path, config: &VaultConfig) -> Result<(), String> {
    let file = ensure_vault_config_file(vault_root)?;
    let serialized = serde_json::to_string_pretty(config)
        .map_err(|error| format!("序列化仓库配置失败: {error}"))?;

    fs::write(&file, serialized)
        .map_err(|error| format!("写入仓库配置失败 {}: {error}", file.to_string_lossy()))
}
