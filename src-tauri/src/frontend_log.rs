//! # 前端日志桥接模块
//!
//! 暴露前端日志转发命令，统一输出到后端日志。
//! 当 `log` 框架已初始化时，前端日志也将被持久化到日志文件。

pub(crate) const FRONTEND_LOG_COMMAND_IDS: &[&str] = &["forward_frontend_log"];

/// 前端日志桥接命令：将前端日志输出到后端日志流。
///
/// # 参数
/// - `level`：日志级别（debug/info/warn/error）
/// - `message`：日志消息正文
/// - `context`：可选的上下文信息
///
/// # 副作用
/// - 通过 `log` 框架输出日志，同时写入控制台和日志文件。
#[tauri::command]
pub fn forward_frontend_log(level: String, message: String, context: Option<String>) {
    let context_part = context
        .as_deref()
        .filter(|item| !item.is_empty())
        .map(|item| format!(" | context={item}"))
        .unwrap_or_default();

    match level.as_str() {
        "error" => {
            log::error!(target: "frontend", "{message}{context_part}");
        }
        "warn" => {
            log::warn!(target: "frontend", "{message}{context_part}");
        }
        "debug" => {
            log::debug!(target: "frontend", "{message}{context_part}");
        }
        _ => {
            log::info!(target: "frontend", "{message}{context_part}");
        }
    }
}
