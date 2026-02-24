//! # 前端日志桥接模块
//!
//! 暴露前端日志转发命令，统一输出到后端日志。

/// 前端日志桥接命令：将前端日志输出到后端日志流。
#[tauri::command]
pub fn forward_frontend_log(level: String, message: String, context: Option<String>) {
    let context_part = context
        .as_deref()
        .filter(|item| !item.is_empty())
        .map(|item| format!(" | context={item}"))
        .unwrap_or_default();

    match level.as_str() {
        "error" => {
            eprintln!("[frontend:error] {message}{context_part}");
        }
        "warn" => {
            eprintln!("[frontend:warn] {message}{context_part}");
        }
        "debug" => {
            println!("[frontend:debug] {message}{context_part}");
        }
        _ => {
            println!("[frontend:info] {message}{context_part}");
        }
    }
}
