//! # 状态模块
//!
//! 提供后端共享运行时状态与常用状态访问函数。

use notify::RecommendedWatcher;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::State;

/// 后端共享状态。
///
/// - `current_vault`：当前生效仓库路径
/// - `vault_watcher`：当前仓库文件监听器实例
/// - `pending_vault_write_trace_by_path`：待回填到 watcher 事件的写入 traceId（按相对路径索引，含过期时间）

/// 单次写入链路的 trace 信息。
pub struct PendingVaultWriteTrace {
    /// 来源 traceId。
    pub trace_id: String,
    /// 过期时间戳（Unix 毫秒）。
    pub expire_at_unix_ms: u128,
}

pub struct AppState {
    /// 当前生效仓库路径。
    pub current_vault: Mutex<Option<PathBuf>>,
    /// 当前仓库监听器。
    pub vault_watcher: Mutex<Option<RecommendedWatcher>>,
    /// 待回填到 watcher 事件的写入 traceId（按相对路径索引，含过期时间）。
    pub pending_vault_write_trace_by_path: Mutex<HashMap<String, PendingVaultWriteTrace>>,
}

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
