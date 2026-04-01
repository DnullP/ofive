//! # Semantic Index 宿主命令模块
//!
//! 提供语义索引用户功能所需的 Tauri `command` 包装层，
//! 包括设置、状态、模型目录与后台模型安装入口。

use std::time::Instant;

use tauri::{async_runtime, State};

use crate::app::semantic_index::index_facade;
use crate::shared::semantic_index_contracts::{
    SemanticIndexBackendCatalog, SemanticIndexModelCatalog, SemanticIndexModelCatalogItem,
    SemanticIndexQueueStatus, SemanticIndexSettings, SemanticIndexStatus,
};
use crate::state::{get_vault_root, AppState};

pub(crate) const SEMANTIC_INDEX_COMMAND_IDS: &[&str] = &[
    "get_semantic_index_backend_catalog",
    "get_semantic_index_settings",
    "save_semantic_index_settings",
    "get_semantic_index_status",
    "get_semantic_index_model_catalog",
    "install_semantic_index_model",
    "start_semantic_index_full_sync",
];

/// 包装命令执行并记录耗时。
macro_rules! timed_command {
    ($name:expr, $body:expr) => {{
        log::info!("[command] {} invoked", $name);
        let start = Instant::now();
        let result = $body;
        let elapsed = start.elapsed();
        match &result {
            Ok(_) => log::info!("[command] {} completed in {:?}", $name, elapsed),
            Err(ref err) => {
                log::warn!("[command] {} failed in {:?}: {}", $name, elapsed, err)
            }
        }
        result
    }};
}

/// 获取当前宿主支持的语义索引后端目录。
#[tauri::command]
pub fn get_semantic_index_backend_catalog() -> Result<SemanticIndexBackendCatalog, String> {
    timed_command!(
        "get_semantic_index_backend_catalog",
        Ok(index_facade::load_semantic_index_backend_catalog())
    )
}

/// 获取当前 Vault 的语义索引设置。
#[tauri::command]
pub fn get_semantic_index_settings(
    state: State<'_, AppState>,
) -> Result<SemanticIndexSettings, String> {
    timed_command!(
        "get_semantic_index_settings",
        index_facade::load_semantic_index_settings(&get_vault_root(&state)?)
    )
}

/// 保存当前 Vault 的语义索引设置。
#[tauri::command]
pub fn save_semantic_index_settings(
    settings: SemanticIndexSettings,
    state: State<'_, AppState>,
) -> Result<SemanticIndexSettings, String> {
    timed_command!(
        "save_semantic_index_settings",
        index_facade::save_semantic_index_settings(settings, &get_vault_root(&state)?)
    )
}

/// 获取当前 Vault 的语义索引状态。
#[tauri::command]
pub fn get_semantic_index_status(
    state: State<'_, AppState>,
) -> Result<SemanticIndexStatus, String> {
    timed_command!(
        "get_semantic_index_status",
        index_facade::ensure_semantic_index_current(&get_vault_root(&state)?)
    )
}

/// 获取当前 Vault 的 embedding 模型目录。
#[tauri::command]
pub fn get_semantic_index_model_catalog(
    state: State<'_, AppState>,
) -> Result<SemanticIndexModelCatalog, String> {
    timed_command!(
        "get_semantic_index_model_catalog",
        index_facade::load_semantic_index_model_catalog(&get_vault_root(&state)?)
    )
}

/// 在后台安装指定 embedding 模型。
#[tauri::command]
pub async fn install_semantic_index_model(
    model_id: String,
    state: State<'_, AppState>,
) -> Result<SemanticIndexModelCatalogItem, String> {
    let vault_root = get_vault_root(&state)?;
    timed_command!(
        "install_semantic_index_model",
        async_runtime::spawn_blocking(move || {
            index_facade::install_semantic_index_model(model_id, &vault_root)
        })
        .await
        .map_err(|error| format!("semantic-index model installation join failed: {error}"))?
    )
}

/// 在后台启动一次全量语义索引同步。
#[tauri::command]
pub fn start_semantic_index_full_sync(
    state: State<'_, AppState>,
) -> Result<SemanticIndexQueueStatus, String> {
    timed_command!(
        "start_semantic_index_full_sync",
        index_facade::start_semantic_index_full_sync(&get_vault_root(&state)?)
    )
}