//! # 日志基础设施模块
//!
//! 提供全局日志记录器，支持标准输出和文件持久化。
//!
//! ## 功能
//! - 控制台输出（stdout/stderr）
//! - 文件持久化到 `<vault>/.ofive/ofive.log`
//! - 日志文件大小限制 5MB，超限后自动轮转

use log::{Level, LevelFilter, Log, Metadata, Record};
use serde::Serialize;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use tauri::{AppHandle, Emitter};

/// 日志文件最大大小（5 MB）。
const MAX_LOG_FILE_SIZE: u64 = 5 * 1024 * 1024;

/// 轮转后保留的旧日志文件名（仅保留一个备份）。
const ROTATED_LOG_FILE_NAME: &str = "ofive.log.old";

/// 当前日志文件名。
const LOG_FILE_NAME: &str = "ofive.log";

/// 前端订阅后端日志通知所使用的事件名。
pub(crate) const BACKEND_LOG_NOTIFICATION_EVENT_NAME: &str = "host://log-notification";

/// WARN 日志默认自动关闭时间。
const WARN_NOTIFICATION_AUTO_CLOSE_MS: u64 = 6000;

/// ERROR 日志默认自动关闭时间。
const ERROR_NOTIFICATION_AUTO_CLOSE_MS: u64 = 9000;

/// 全局日志文件目录路径。
static LOG_FILE_PATH: RwLock<Option<PathBuf>> = RwLock::new(None);

type LogNotificationSink = dyn Fn(BackendLogNotificationEventPayload) + Send + Sync + 'static;

/// 后端日志通知序列号。
static LOG_NOTIFICATION_SEQUENCE: AtomicU64 = AtomicU64::new(1);

/// 日志通知下沉器；在生产环境中由 Tauri 事件桥接实现，在测试中可替换为捕获器。
static LOG_NOTIFICATION_SINK: RwLock<Option<Arc<LogNotificationSink>>> = RwLock::new(None);

/// 从后端转发到前端消息插件的日志通知负载。
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
pub struct BackendLogNotificationEventPayload {
    /// 消息唯一 ID。
    pub notification_id: String,
    /// 日志级别，仅限 warn / error。
    pub level: String,
    /// 可选标题。
    pub title: Option<String>,
    /// 消息正文。
    pub message: String,
    /// 原始日志 target。
    pub target: String,
    /// 日志来源，区分前端桥接日志与后端原生日志。
    pub source: String,
    /// 自动关闭时间。
    pub auto_close_ms: u64,
    /// 可选进度；普通日志通知为空。
    pub progress: Option<u8>,
    /// 创建时间戳。
    pub created_at: u64,
}

/// 自定义日志记录器。
struct OfiveLogger;

impl Log for OfiveLogger {
    fn enabled(&self, _metadata: &Metadata) -> bool {
        true
    }

    fn log(&self, record: &Record) {
        if !self.enabled(record.metadata()) {
            return;
        }

        let timestamp = current_timestamp();
        let level = record.level();
        let target = record.target();
        let raw_message = record.args().to_string();

        let formatted = format!("{timestamp} [{level}] [{target}] {raw_message}");

        write_console_line(level, &formatted);

        if let Ok(guard) = LOG_FILE_PATH.read() {
            if let Some(ref dir) = *guard {
                let _ = write_to_log_file(dir, &formatted);
            }
        }

        if let Some(payload) =
            build_log_notification_payload(level, target, &raw_message, current_unix_ms())
        {
            emit_log_notification(payload);
        }
    }

    fn flush(&self) {}
}

static LOGGER: OfiveLogger = OfiveLogger;

/// 初始化全局日志记录器。
pub fn init() {
    let _ = log::set_logger(&LOGGER).map(|()| log::set_max_level(LevelFilter::Debug));
}

/// 设置日志文件持久化路径。
pub fn set_vault_log_path(dir: Option<PathBuf>) {
    if let Some(ref path) = dir {
        if let Err(error) = fs::create_dir_all(path) {
            write_internal_stderr(&format!(
                "[logging] 创建日志目录失败 {}: {error}",
                path.to_string_lossy()
            ));
        }
    }

    if let Ok(mut guard) = LOG_FILE_PATH.write() {
        *guard = dir;
    }
}

/// 为生产环境安装基于 Tauri AppHandle 的日志通知下沉器。
pub fn install_tauri_log_notification_sink(app_handle: AppHandle) {
    set_log_notification_sink(Some(Arc::new(move |payload| {
        if let Err(error) = app_handle.emit(BACKEND_LOG_NOTIFICATION_EVENT_NAME, payload) {
            write_internal_stderr(&format!("[logging] 日志通知事件发送失败: {error}"));
        }
    })));
}

/// 设置日志通知下沉器。
pub fn set_log_notification_sink(sink: Option<Arc<LogNotificationSink>>) {
    if let Ok(mut guard) = LOG_NOTIFICATION_SINK.write() {
        *guard = sink;
    }
}

/// 测试辅助：将日志通知写入指定捕获容器。
pub fn set_log_notification_capture(
    capture: Option<Arc<Mutex<Vec<BackendLogNotificationEventPayload>>>>,
) {
    match capture {
        Some(capture) => {
            set_log_notification_sink(Some(Arc::new(move |payload| {
                if let Ok(mut guard) = capture.lock() {
                    guard.push(payload);
                }
            })));
        }
        None => {
            set_log_notification_sink(None);
        }
    }
}

/// 根据日志记录构造前端消息插件可消费的通知负载。
pub fn build_log_notification_payload(
    level: Level,
    target: &str,
    message: &str,
    created_at: u64,
) -> Option<BackendLogNotificationEventPayload> {
    let level_text = match level {
        Level::Warn => "warn",
        Level::Error => "error",
        _ => return None,
    };
    let auto_close_ms = if level == Level::Error {
        ERROR_NOTIFICATION_AUTO_CLOSE_MS
    } else {
        WARN_NOTIFICATION_AUTO_CLOSE_MS
    };
    let source = if target == "frontend" {
        "frontend-log"
    } else {
        "backend-log"
    };

    Some(BackendLogNotificationEventPayload {
        notification_id: format!(
            "backend-log-{}",
            LOG_NOTIFICATION_SEQUENCE.fetch_add(1, Ordering::Relaxed)
        ),
        level: level_text.to_string(),
        title: None,
        message: message.to_string(),
        target: target.to_string(),
        source: source.to_string(),
        auto_close_ms,
        progress: None,
        created_at,
    })
}

/// 将 AI sidecar 的 stdout/stderr 内容转发到标准日志流。
pub(crate) fn forward_sidecar_output(stream: &str, text: &str) {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return;
    }

    let (level, target) = sidecar_log_route(stream);
    for line in trimmed
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
    {
        log::log!(target: target, level, "{line}");
    }
}

fn sidecar_log_route(stream: &str) -> (Level, &'static str) {
    match stream {
        "stderr" => (Level::Warn, "ai-sidecar.stderr"),
        _ => (Level::Info, "ai-sidecar.stdout"),
    }
}

fn write_to_log_file(dir: &PathBuf, line: &str) -> std::io::Result<()> {
    let log_file_path = dir.join(LOG_FILE_NAME);

    if let Ok(metadata) = fs::metadata(&log_file_path) {
        if metadata.len() >= MAX_LOG_FILE_SIZE {
            rotate_log_file(dir);
        }
    }

    let mut file: File = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&log_file_path)?;

    writeln!(file, "{line}")
}

fn rotate_log_file(dir: &PathBuf) {
    let current = dir.join(LOG_FILE_NAME);
    let rotated = dir.join(ROTATED_LOG_FILE_NAME);

    let _ = fs::remove_file(&rotated);

    if let Err(error) = fs::rename(&current, &rotated) {
        write_internal_stderr(&format!(
            "[logging] 日志轮转失败 {}: {error}",
            current.to_string_lossy()
        ));
    }
}

fn write_console_line(level: Level, line: &str) {
    let write_result = match level {
        Level::Error | Level::Warn => {
            let mut stderr = io::stderr().lock();
            writeln!(stderr, "{line}")
        }
        _ => {
            let mut stdout = io::stdout().lock();
            writeln!(stdout, "{line}")
        }
    };

    if let Err(error) = write_result {
        write_internal_stderr(&format!("[logging] 控制台日志写入失败: {error}"));
    }
}

fn emit_log_notification(payload: BackendLogNotificationEventPayload) {
    let sink = LOG_NOTIFICATION_SINK
        .read()
        .ok()
        .and_then(|guard| guard.clone());

    if let Some(sink) = sink {
        sink(payload);
    }
}

fn write_internal_stderr(line: &str) {
    let mut stderr = io::stderr().lock();
    let _ = writeln!(stderr, "{line}");
}

fn current_timestamp() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let secs = now.as_secs();
    let days = secs / 86400;
    let time_of_day = secs % 86400;
    let hours = time_of_day / 3600;
    let minutes = (time_of_day % 3600) / 60;
    let seconds = time_of_day % 60;
    let (year, month, day) = days_to_date(days);

    format!("{year:04}-{month:02}-{day:02} {hours:02}:{minutes:02}:{seconds:02}")
}

fn current_unix_ms() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};

    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

fn days_to_date(days: u64) -> (u64, u64, u64) {
    let z = days + 719468;
    let era = z / 146097;
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y, m, d)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn days_to_date_should_return_correct_epoch() {
        assert_eq!(days_to_date(0), (1970, 1, 1));
    }

    #[test]
    fn days_to_date_should_return_known_date() {
        assert_eq!(days_to_date(19723), (2024, 1, 1));
    }

    #[test]
    fn current_timestamp_should_have_expected_format() {
        let ts = current_timestamp();
        assert_eq!(ts.len(), 19);
        assert_eq!(&ts[4..5], "-");
        assert_eq!(&ts[7..8], "-");
        assert_eq!(&ts[10..11], " ");
        assert_eq!(&ts[13..14], ":");
        assert_eq!(&ts[16..17], ":");
    }

    #[test]
    fn rotate_should_rename_current_to_old() {
        let dir = std::env::temp_dir().join("ofive-log-rotate-test");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let current = dir.join(LOG_FILE_NAME);
        fs::write(&current, "test log content\n").unwrap();

        rotate_log_file(&dir);

        assert!(!current.exists());
        let rotated = dir.join(ROTATED_LOG_FILE_NAME);
        assert!(rotated.exists());
        assert_eq!(fs::read_to_string(&rotated).unwrap(), "test log content\n");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn write_to_log_file_should_append_line() {
        let dir = std::env::temp_dir().join("ofive-log-write-test");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        write_to_log_file(&dir, "line one").unwrap();
        write_to_log_file(&dir, "line two").unwrap();

        let content = fs::read_to_string(dir.join(LOG_FILE_NAME)).unwrap();
        assert!(content.contains("line one"));
        assert!(content.contains("line two"));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn write_should_rotate_when_exceeding_max_size() {
        let dir = std::env::temp_dir().join("ofive-log-autorotate-test");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let log_file = dir.join(LOG_FILE_NAME);
        let large_content = "x".repeat(MAX_LOG_FILE_SIZE as usize + 1);
        fs::write(&log_file, &large_content).unwrap();

        write_to_log_file(&dir, "new line after rotate").unwrap();

        let rotated = dir.join(ROTATED_LOG_FILE_NAME);
        assert!(rotated.exists());

        let new_content = fs::read_to_string(&log_file).unwrap();
        assert!(new_content.contains("new line after rotate"));
        assert!(!new_content.contains(&large_content));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn build_log_notification_payload_should_skip_non_warn_levels() {
        assert!(build_log_notification_payload(Level::Info, "vault", "ok", 1).is_none());
        assert!(build_log_notification_payload(Level::Debug, "vault", "ok", 1).is_none());
    }

    #[test]
    fn build_log_notification_payload_should_map_frontend_target_to_frontend_source() {
        let payload = build_log_notification_payload(Level::Warn, "frontend", "warn text", 42)
            .expect("warn payload should exist");

        assert_eq!(payload.level, "warn");
        assert_eq!(payload.source, "frontend-log");
        assert_eq!(payload.auto_close_ms, WARN_NOTIFICATION_AUTO_CLOSE_MS);
        assert_eq!(payload.message, "warn text");
        assert_eq!(payload.created_at, 42);
    }

    #[test]
    fn set_vault_log_path_should_update_global() {
        let test_path = Path::new("/tmp/ofive-log-path-test");
        set_vault_log_path(Some(test_path.to_path_buf()));

        let guard = LOG_FILE_PATH.read().unwrap();
        assert_eq!(guard.as_deref(), Some(test_path));
        drop(guard);

        set_vault_log_path(None);
        let guard = LOG_FILE_PATH.read().unwrap();
        assert!(guard.is_none());
    }

    #[test]
    fn sidecar_log_route_should_map_stream_to_standard_target() {
        assert_eq!(
            sidecar_log_route("stdout"),
            (Level::Info, "ai-sidecar.stdout")
        );
        assert_eq!(
            sidecar_log_route("stderr"),
            (Level::Warn, "ai-sidecar.stderr")
        );
        assert_eq!(
            sidecar_log_route("other"),
            (Level::Info, "ai-sidecar.stdout")
        );
    }
}
