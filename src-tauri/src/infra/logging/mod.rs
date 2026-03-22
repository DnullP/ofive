//! # 日志基础设施模块
//!
//! 提供全局日志记录器，支持标准输出和文件持久化。
//!
//! ## 功能
//! - 控制台输出（stdout/stderr）
//! - 文件持久化到 `<vault>/.ofive/ofive.log`
//! - 日志文件大小限制 5MB，超限后自动轮转

use log::{Level, LevelFilter, Log, Metadata, Record};
use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::PathBuf;
use std::sync::RwLock;

/// 日志文件最大大小（5 MB）。
const MAX_LOG_FILE_SIZE: u64 = 5 * 1024 * 1024;

/// 轮转后保留的旧日志文件名（仅保留一个备份）。
const ROTATED_LOG_FILE_NAME: &str = "ofive.log.old";

/// 当前日志文件名。
const LOG_FILE_NAME: &str = "ofive.log";

/// 全局日志文件目录路径。
static LOG_FILE_PATH: RwLock<Option<PathBuf>> = RwLock::new(None);

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
        let message = record.args();

        let formatted = format!("{timestamp} [{level}] [{target}] {message}");

        write_console_line(level, &formatted);

        if let Ok(guard) = LOG_FILE_PATH.read() {
            if let Some(ref dir) = *guard {
                let _ = write_to_log_file(dir, &formatted);
            }
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
