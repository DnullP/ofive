//! # 日志模块
//!
//! 提供全局日志记录器，支持标准输出和文件持久化。
//!
//! ## 功能
//! - 控制台输出（stdout/stderr）
//! - 文件持久化到 `<vault>/.ofive/ofive.log`
//! - 日志文件大小限制 5MB，超限后自动轮转
//!
//! ## 依赖模块
//! - `log`：日志门面，提供 `info!`、`warn!` 等宏
//!
//! ## 状态
//! - `LOG_FILE_PATH`：当前日志文件路径，受 `set_vault_log_path` 更新
//! - 生命周期：应用启动时初始化为 `None`，`set_current_vault` 成功后设置为仓库日志路径
//!
//! ## 使用示例
//! ```ignore
//! use crate::logging;
//!
//! logging::init();
//! logging::set_vault_log_path(Some(vault_root.join(".ofive")));
//! log::info!("hello from ofive");
//! ```
//!
//! ## 导出
//! - `init`：初始化全局日志记录器
//! - `set_vault_log_path`：设置/清除日志文件持久化目录

use log::{Level, LevelFilter, Log, Metadata, Record};
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::RwLock;

/// 日志文件最大大小（5 MB）。
const MAX_LOG_FILE_SIZE: u64 = 5 * 1024 * 1024;

/// 轮转后保留的旧日志文件名（仅保留一个备份）。
const ROTATED_LOG_FILE_NAME: &str = "ofive.log.old";

/// 当前日志文件名。
const LOG_FILE_NAME: &str = "ofive.log";

/// 全局日志文件目录路径。
///
/// - `None` 表示未设置仓库目录，仅输出到控制台。
/// - `Some(path)` 表示日志将同时写入 `<path>/ofive.log`。
static LOG_FILE_PATH: RwLock<Option<PathBuf>> = RwLock::new(None);

/// 自定义日志记录器。
///
/// 同时输出到控制台和可选的日志文件。
struct OfiveLogger;

impl Log for OfiveLogger {
    /// 是否启用该日志级别。
    ///
    /// 当前全部启用，过滤由 `LevelFilter` 控制。
    fn enabled(&self, _metadata: &Metadata) -> bool {
        true
    }

    /// 记录一条日志。
    ///
    /// # 副作用
    /// - 向 stdout（info/debug/trace）或 stderr（warn/error）写入格式化日志。
    /// - 若 `LOG_FILE_PATH` 已设置，同时追加写入日志文件。
    /// - 写入前检查文件大小，超过 5MB 则轮转。
    fn log(&self, record: &Record) {
        if !self.enabled(record.metadata()) {
            return;
        }

        let timestamp = current_timestamp();
        let level = record.level();
        let target = record.target();
        let message = record.args();

        let formatted = format!("{timestamp} [{level}] [{target}] {message}");

        // 控制台输出
        match level {
            Level::Error | Level::Warn => {
                eprintln!("{formatted}");
            }
            _ => {
                println!("{formatted}");
            }
        }

        // 文件持久化
        if let Ok(guard) = LOG_FILE_PATH.read() {
            if let Some(ref dir) = *guard {
                let _ = write_to_log_file(dir, &formatted);
            }
        }
    }

    /// 刷新日志缓冲区（当前为即时写入，无需操作）。
    fn flush(&self) {}
}

/// 初始化全局日志记录器。
///
/// 注册 `OfiveLogger` 为全局日志实现，设置最大日志级别为 `Debug`。
///
/// # 副作用
/// - 设置 `log::set_logger` 全局状态。
/// - 若重复调用会静默失败（`log` 框架限制）。
pub fn init() {
    let _ = log::set_logger(&LOGGER).map(|()| log::set_max_level(LevelFilter::Debug));
}

/// 全局日志记录器单例。
static LOGGER: OfiveLogger = OfiveLogger;

/// 设置日志文件持久化路径。
///
/// # 参数
/// - `dir`：仓库的 `.ofive` 目录路径。传入 `None` 将停止文件持久化。
///
/// # 副作用
/// - 修改 `LOG_FILE_PATH` 全局状态。
/// - 传入 `Some` 时会尝试创建目录。
pub fn set_vault_log_path(dir: Option<PathBuf>) {
    if let Some(ref path) = dir {
        if let Err(error) = fs::create_dir_all(path) {
            eprintln!(
                "[logging] 创建日志目录失败 {}: {error}",
                path.to_string_lossy()
            );
        }
    }

    if let Ok(mut guard) = LOG_FILE_PATH.write() {
        *guard = dir;
    }
}

/// 将一行日志追加写入文件，写入前检查轮转。
///
/// # 参数
/// - `dir`：日志目录路径。
/// - `line`：格式化后的日志行。
///
/// # 返回
/// - 写入成功返回 `Ok(())`。
/// - IO 错误返回 `Err`。
fn write_to_log_file(dir: &PathBuf, line: &str) -> std::io::Result<()> {
    let log_file_path = dir.join(LOG_FILE_NAME);

    // 轮转检查
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

/// 轮转日志文件。
///
/// 将当前 `ofive.log` 重命名为 `ofive.log.old`（覆盖旧备份），
/// 然后创建新的空日志文件。
///
/// # 参数
/// - `dir`：日志目录路径。
fn rotate_log_file(dir: &PathBuf) {
    let current = dir.join(LOG_FILE_NAME);
    let rotated = dir.join(ROTATED_LOG_FILE_NAME);

    // 移除旧备份（若存在）
    let _ = fs::remove_file(&rotated);

    // 重命名当前文件为备份
    if let Err(error) = fs::rename(&current, &rotated) {
        eprintln!(
            "[logging] 日志轮转失败 {}: {error}",
            current.to_string_lossy()
        );
    }
}

/// 获取当前时间戳字符串（简易实现，格式：`YYYY-MM-DD HH:MM:SS`）。
///
/// 使用 `SystemTime` 计算，不依赖 `chrono` 等外部库。
///
/// # 返回
/// - 格式化的时间戳字符串。
fn current_timestamp() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let secs = now.as_secs();

    // 简化的 UTC 时间计算
    let days = secs / 86400;
    let time_of_day = secs % 86400;
    let hours = time_of_day / 3600;
    let minutes = (time_of_day % 3600) / 60;
    let seconds = time_of_day % 60;

    // 简化的日期计算（从 1970-01-01 起算）
    let (year, month, day) = days_to_date(days);

    format!("{year:04}-{month:02}-{day:02} {hours:02}:{minutes:02}:{seconds:02}")
}

/// 将自 1970-01-01 起的天数转换为 (年, 月, 日)。
///
/// # 参数
/// - `days`：距 Unix 纪元的天数。
///
/// # 返回
/// - `(year, month, day)` 元组。
fn days_to_date(days: u64) -> (u64, u64, u64) {
    // 算法来源：https://howardhinnant.github.io/date_algorithms.html
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

    /// 验证日期计算正确性。
    #[test]
    fn days_to_date_should_return_correct_epoch() {
        // 1970-01-01 = day 0
        assert_eq!(days_to_date(0), (1970, 1, 1));
    }

    /// 验证日期计算——已知日期。
    #[test]
    fn days_to_date_should_return_known_date() {
        // 2024-01-01 = day 19723
        assert_eq!(days_to_date(19723), (2024, 1, 1));
    }

    /// 验证时间戳格式。
    #[test]
    fn current_timestamp_should_have_expected_format() {
        let ts = current_timestamp();
        // 格式：YYYY-MM-DD HH:MM:SS
        assert_eq!(ts.len(), 19);
        assert_eq!(&ts[4..5], "-");
        assert_eq!(&ts[7..8], "-");
        assert_eq!(&ts[10..11], " ");
        assert_eq!(&ts[13..14], ":");
        assert_eq!(&ts[16..17], ":");
    }

    /// 验证日志轮转机制。
    #[test]
    fn rotate_should_rename_current_to_old() {
        let dir = std::env::temp_dir().join("ofive-log-rotate-test");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let current = dir.join(LOG_FILE_NAME);
        fs::write(&current, "test log content\n").unwrap();

        rotate_log_file(&dir);

        assert!(!current.exists(), "当前日志文件应被重命名");
        let rotated = dir.join(ROTATED_LOG_FILE_NAME);
        assert!(rotated.exists(), "旧备份应存在");

        let content = fs::read_to_string(&rotated).unwrap();
        assert_eq!(content, "test log content\n");

        let _ = fs::remove_dir_all(&dir);
    }

    /// 验证写入日志文件。
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

    /// 验证超过 5MB 时自动轮转。
    #[test]
    fn write_should_rotate_when_exceeding_max_size() {
        let dir = std::env::temp_dir().join("ofive-log-autorotate-test");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        // 创建一个刚好超过 MAX_LOG_FILE_SIZE 的文件
        let log_file = dir.join(LOG_FILE_NAME);
        let large_content = "x".repeat(MAX_LOG_FILE_SIZE as usize + 1);
        fs::write(&log_file, &large_content).unwrap();

        // 写入一行应触发轮转
        write_to_log_file(&dir, "new line after rotate").unwrap();

        let rotated = dir.join(ROTATED_LOG_FILE_NAME);
        assert!(rotated.exists(), "超限后应创建轮转备份");

        let new_content = fs::read_to_string(&log_file).unwrap();
        assert!(
            new_content.contains("new line after rotate"),
            "新日志文件应包含轮转后写入的内容"
        );
        assert!(
            !new_content.contains(&large_content),
            "新日志文件不应包含轮转前的旧内容"
        );

        let _ = fs::remove_dir_all(&dir);
    }

    /// 验证 set_vault_log_path 设置路径。
    #[test]
    fn set_vault_log_path_should_update_global() {
        let test_path = Path::new("/tmp/ofive-log-path-test");
        set_vault_log_path(Some(test_path.to_path_buf()));

        let guard = LOG_FILE_PATH.read().unwrap();
        assert_eq!(guard.as_deref(), Some(test_path));
        drop(guard);

        // 清除
        set_vault_log_path(None);
        let guard = LOG_FILE_PATH.read().unwrap();
        assert!(guard.is_none());
    }
}
