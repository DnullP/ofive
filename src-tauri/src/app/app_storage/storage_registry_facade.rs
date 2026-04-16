//! # App Storage Registry Facade
//!
//! 对外暴露应用级存储资源注册表的稳定入口。

use serde::{de::DeserializeOwned, Serialize};
use std::path::PathBuf;

use super::storage_registry_app_service;

/// 解析指定 owner 的应用级目录。
pub(crate) fn resolve_app_storage_owner_dir(
    consumer_module_id: &str,
    owner: &str,
) -> Result<PathBuf, String> {
    storage_registry_app_service::resolve_app_storage_owner_dir(consumer_module_id, owner)
}

/// 读取指定 owner 的应用级状态。
pub(crate) fn load_app_storage_state<T>(
    consumer_module_id: &str,
    owner: &str,
    state_key: &str,
) -> Result<Option<T>, String>
where
    T: DeserializeOwned,
{
    storage_registry_app_service::load_app_storage_state(
        consumer_module_id,
        owner,
        state_key,
    )
}

/// 保存指定 owner 的应用级状态。
pub(crate) fn save_app_storage_state<T>(
    consumer_module_id: &str,
    owner: &str,
    state_key: &str,
    state: &T,
) -> Result<(), String>
where
    T: Serialize,
{
    storage_registry_app_service::save_app_storage_state(
        consumer_module_id,
        owner,
        state_key,
        state,
    )
}

#[cfg(test)]
pub(crate) fn set_app_storage_test_root(root: Option<PathBuf>) -> Result<(), String> {
    storage_registry_app_service::set_app_storage_test_root(root)
}