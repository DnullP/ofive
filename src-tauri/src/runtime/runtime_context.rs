//! # 运行时上下文访问模块
//!
//! 提供从全局状态读取当前请求上下文所需信息的辅助函数。

use std::path::PathBuf;

use tauri::State;

use crate::state::AppState;

/// 从全局状态获取当前 vault 目录。
pub fn get_vault_root(state: &State<'_, AppState>) -> Result<PathBuf, String> {
    let guard = state
        .current_vault
        .lock()
        .map_err(|error| format!("读取 vault 状态失败: {error}"))?;

    guard
        .clone()
        .ok_or_else(|| "当前未设置 vault，请先调用 set_current_vault".to_string())
}

/// 将当前 vault 根目录写入全局状态。
pub fn set_vault_root(state: &State<'_, AppState>, vault_root: PathBuf) -> Result<(), String> {
    let mut guard = state
        .current_vault
        .lock()
        .map_err(|error| format!("写入 vault 状态失败: {error}"))?;
    *guard = Some(vault_root);
    Ok(())
}
