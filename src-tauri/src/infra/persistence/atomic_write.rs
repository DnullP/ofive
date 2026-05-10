//! # 原子文件写入工具
//!
//! 用于 JSON 状态文件这类会被前后台任务同时读写的持久化文件。

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

static TEMP_FILE_SEQUENCE: AtomicU64 = AtomicU64::new(1);

pub(crate) fn write_string_atomically(file_path: &Path, contents: &str) -> Result<(), String> {
    let parent = file_path
        .parent()
        .ok_or_else(|| format!("原子写入目标目录缺失 path={}", file_path.to_string_lossy()))?;
    fs::create_dir_all(parent).map_err(|error| {
        format!(
            "创建原子写入目录失败 path={}: {error}",
            parent.to_string_lossy()
        )
    })?;

    let file_name = file_path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| format!("原子写入目标文件名非法 path={}", file_path.display()))?;
    let unique = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    let sequence = TEMP_FILE_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let temp_path = parent.join(format!(
        ".{file_name}.{}.{}.{}.tmp",
        std::process::id(),
        unique,
        sequence
    ));

    let write_result = (|| -> Result<(), String> {
        let mut temp_file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp_path)
            .map_err(|error| {
                format!(
                    "创建原子写入临时文件失败 path={}: {error}",
                    temp_path.display()
                )
            })?;
        temp_file.write_all(contents.as_bytes()).map_err(|error| {
            format!(
                "写入原子写入临时文件失败 path={}: {error}",
                temp_path.display()
            )
        })?;
        temp_file.sync_all().map_err(|error| {
            format!(
                "同步原子写入临时文件失败 path={}: {error}",
                temp_path.display()
            )
        })?;
        Ok(())
    })();

    if let Err(error) = write_result {
        let _ = fs::remove_file(&temp_path);
        return Err(error);
    }

    fs::rename(&temp_path, file_path).map_err(|error| {
        let _ = fs::remove_file(&temp_path);
        format!(
            "替换原子写入目标文件失败 source={} target={}: {error}",
            temp_path.display(),
            file_path.display()
        )
    })?;

    Ok(())
}
