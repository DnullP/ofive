//! # 平台能力命令入口模块
//!
//! 提供宿主层平台注册目录查询命令。

use crate::app::capability::capability_app_service;
use crate::domain::capability::CapabilityDescriptor;

/// 获取平台能力目录。
#[tauri::command]
pub fn get_capability_catalog() -> Result<Vec<CapabilityDescriptor>, String> {
    Ok(capability_app_service::get_capability_catalog())
}
