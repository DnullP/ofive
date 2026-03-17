//! # 应用运行时状态模块
//!
//! 定义后端共享运行时句柄与全局状态对象。

use notify::RecommendedWatcher;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use tauri_plugin_shell::process::CommandChild;

/// 单次写入链路的 trace 信息。
pub struct PendingVaultWriteTrace {
    /// 来源 traceId。
    pub trace_id: String,
    /// 过期时间戳（Unix 毫秒）。
    pub expire_at_unix_ms: u128,
}

/// AI sidecar 运行时句柄。
pub struct AiSidecarRuntime {
    /// sidecar 监听的本地端口。
    pub port: u16,
    /// gRPC 访问端点。
    pub endpoint: String,
    /// 子进程句柄，用于持有 sidecar 生命周期。
    pub child: CommandChild,
}

/// 后端共享状态。
///
/// - `current_vault`：当前生效仓库路径
/// - `vault_watcher`：当前仓库文件监听器实例
/// - `pending_vault_write_trace_by_path`：待回填到 watcher 事件的写入 traceId（按相对路径索引，含过期时间）
/// - `ai_sidecar_runtime`：AI sidecar 运行时状态
pub struct AppState {
    /// 当前生效仓库路径。
    pub current_vault: Mutex<Option<PathBuf>>,
    /// 当前仓库监听器。
    pub vault_watcher: Mutex<Option<RecommendedWatcher>>,
    /// 待回填到 watcher 事件的写入 traceId（按相对路径索引，含过期时间）。
    pub pending_vault_write_trace_by_path: Mutex<HashMap<String, PendingVaultWriteTrace>>,
    /// AI sidecar 运行时状态。
    pub ai_sidecar_runtime: Mutex<Option<AiSidecarRuntime>>,
}
