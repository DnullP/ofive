//! # Vault 写入基础设施模块
//!
//! 提供 vault 配置保存、Markdown/二进制文件写入、目录创建以及
//! 写入 trace 与索引副作用管理。

use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;

use crate::infra::fs::fs_helpers::{
    resolve_binary_target_path, resolve_canvas_path, resolve_canvas_target_path,
    resolve_markdown_path, resolve_markdown_target_path, resolve_vault_directory_path,
};
use crate::infra::persistence::vault_config_store::save_vault_config;
use crate::infra::query::query_index;
use crate::shared::vault_contracts::{
    CopyEntryResponse, VaultConfig, WriteBinaryFileResponse, WriteMarkdownResponse,
};
use crate::state::{get_vault_root, AppState, PendingVaultWriteTrace};

const PENDING_WRITE_TRACE_TTL_MS: u128 = 5_000;
const VAULT_CONFIG_RELATIVE_PATH: &str = ".ofive/config.json";

/// 在后台线程中执行索引重建操作，不阻塞当前命令返回。
fn spawn_background_reindex<F>(operation_name: &str, task: F)
where
    F: FnOnce() -> Result<(), String> + Send + 'static,
{
    let name = operation_name.to_string();
    std::thread::spawn(move || {
        if let Err(error) = task() {
            log::warn!(
                "[query-index] background reindex failed for {}: {}",
                name,
                error
            );
        }
    });
}

fn now_unix_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

fn normalize_relative_path(path: &str) -> String {
    path.replace('\\', "/")
}

fn register_pending_write_trace_in_app_state(
    state: &AppState,
    source_trace_id: Option<String>,
    relative_paths: &[String],
    operation_name: &str,
) -> Result<(), String> {
    let trace_id = match source_trace_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
    {
        Some(value) => value,
        None => return Ok(()),
    };

    if relative_paths.is_empty() {
        return Ok(());
    }

    let now_ms = now_unix_ms();
    let mut pending_trace_map = state
        .pending_vault_write_trace_by_path
        .lock()
        .map_err(|error| format!("写入 trace 映射失败: {error}"))?;
    pending_trace_map.retain(|_, pending| pending.expire_at_unix_ms > now_ms);

    relative_paths.iter().for_each(|path| {
        let normalized_path = normalize_relative_path(path);
        pending_trace_map.insert(
            normalized_path.clone(),
            PendingVaultWriteTrace {
                trace_id: trace_id.clone(),
                expire_at_unix_ms: now_ms + PENDING_WRITE_TRACE_TTL_MS,
            },
        );
        log::info!(
            "[vault] {} trace mapped: path={} trace_id={}",
            operation_name,
            normalized_path,
            trace_id
        );
    });

    Ok(())
}

fn register_pending_write_trace(
    state: &State<'_, AppState>,
    source_trace_id: Option<String>,
    relative_paths: &[String],
    operation_name: &str,
) -> Result<(), String> {
    register_pending_write_trace_in_app_state(
        state.inner(),
        source_trace_id,
        relative_paths,
        operation_name,
    )
}

fn to_vault_relative_path(path: &Path, vault_root: &Path) -> Result<String, String> {
    path.strip_prefix(vault_root)
        .map_err(|error| format!("计算目标相对路径失败 {}: {error}", path.display()))
        .map(|value| value.to_string_lossy().replace('\\', "/"))
}

/// 在指定 vault 根目录下保存配置。
pub(crate) fn save_current_vault_config_in_root(
    config: VaultConfig,
    vault_root: &Path,
) -> Result<VaultConfig, String> {
    log::info!("[vault-config] save_current_vault_config start");
    save_vault_config(vault_root, &config)?;
    log::info!(
        "[vault-config] save_current_vault_config success: schema_version={}",
        config.schema_version
    );
    Ok(config)
}

/// 保存当前仓库配置并注册写入 trace。
pub(crate) fn save_current_vault_config(
    config: VaultConfig,
    source_trace_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<VaultConfig, String> {
    let root = get_vault_root(&state)?;
    let saved = save_current_vault_config_in_root(config, &root)?;
    register_pending_write_trace(
        &state,
        source_trace_id,
        &[VAULT_CONFIG_RELATIVE_PATH.to_string()],
        "save_current_vault_config",
    )?;
    Ok(saved)
}

/// 在指定 vault 根目录下创建 Markdown 文件。
pub(crate) fn create_vault_markdown_file_in_root(
    relative_path: String,
    content: Option<String>,
    vault_root: &Path,
) -> Result<WriteMarkdownResponse, String> {
    log::info!(
        "[vault] create_vault_markdown_file start: relative_path={}",
        relative_path
    );

    let target_path = resolve_markdown_target_path(vault_root, &relative_path)?;

    if target_path.exists() {
        return Err("目标文件已存在".to_string());
    }

    if let Some(parent) = target_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("创建父目录失败 {}: {error}", parent.display()))?;
    }

    let mut file = fs::File::create(&target_path)
        .map_err(|error| format!("创建文件失败 {}: {error}", target_path.display()))?;

    if let Some(initial_content) = content {
        file.write_all(initial_content.as_bytes())
            .map_err(|error| format!("写入初始内容失败 {}: {error}", target_path.display()))?;
    }

    Ok(WriteMarkdownResponse {
        relative_path,
        created: true,
    })
}

/// 在当前仓库中创建 Markdown 文件并触发索引重建。
pub(crate) fn create_vault_markdown_file(
    relative_path: String,
    content: Option<String>,
    source_trace_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<WriteMarkdownResponse, String> {
    let root = get_vault_root(&state)?;
    let created = create_vault_markdown_file_in_root(relative_path, content, &root)?;
    register_pending_write_trace(
        &state,
        source_trace_id,
        &[created.relative_path.clone()],
        "create_vault_markdown_file",
    )?;
    let reindex_root = root.clone();
    let reindex_path = created.relative_path.clone();
    spawn_background_reindex("create_vault_markdown_file", move || {
        query_index::reindex_markdown_file(&reindex_root, &reindex_path)
    });
    Ok(created)
}

/// 在指定 vault 根目录下创建 Canvas 文件。
pub(crate) fn create_vault_canvas_file_in_root(
    relative_path: String,
    content: Option<String>,
    vault_root: &Path,
) -> Result<WriteMarkdownResponse, String> {
    log::info!(
        "[vault] create_vault_canvas_file start: relative_path={}",
        relative_path
    );

    let target_path = resolve_canvas_target_path(vault_root, &relative_path)?;

    if target_path.exists() {
        return Err("目标文件已存在".to_string());
    }

    if let Some(parent) = target_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("创建父目录失败 {}: {error}", parent.display()))?;
    }

    let initial_content = content.unwrap_or_else(|| "{\n  \"nodes\": [],\n  \"edges\": []\n}\n".to_string());

    fs::write(&target_path, initial_content.as_bytes())
        .map_err(|error| format!("创建 Canvas 文件失败 {}: {error}", target_path.display()))?;

    Ok(WriteMarkdownResponse {
        relative_path,
        created: true,
    })
}

/// 在当前仓库中创建 Canvas 文件并注册写入 trace。
pub(crate) fn create_vault_canvas_file(
    relative_path: String,
    content: Option<String>,
    source_trace_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<WriteMarkdownResponse, String> {
    let root = get_vault_root(&state)?;
    let created = create_vault_canvas_file_in_root(relative_path, content, &root)?;
    register_pending_write_trace(
        &state,
        source_trace_id,
        &[created.relative_path.clone()],
        "create_vault_canvas_file",
    )?;
    Ok(created)
}

/// 在指定 vault 根目录下创建二进制文件。
pub(crate) fn create_vault_binary_file_in_root(
    relative_path: String,
    base64_content: String,
    vault_root: &Path,
) -> Result<WriteBinaryFileResponse, String> {
    let target_path = resolve_binary_target_path(vault_root, &relative_path)?;

    if target_path.exists() {
        return Err("目标文件已存在".to_string());
    }

    if let Some(parent) = target_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("创建父目录失败 {}: {error}", parent.display()))?;
    }

    let decoded_bytes = BASE64_STANDARD
        .decode(&base64_content)
        .map_err(|error| format!("Base64 解码失败: {error}"))?;

    fs::write(&target_path, &decoded_bytes)
        .map_err(|error| format!("写入二进制文件失败 {}: {error}", target_path.display()))?;

    Ok(WriteBinaryFileResponse {
        relative_path,
        created: true,
    })
}

/// 在当前仓库中创建二进制文件并注册写入 trace。
pub(crate) fn create_vault_binary_file(
    relative_path: String,
    base64_content: String,
    source_trace_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<WriteBinaryFileResponse, String> {
    let root = get_vault_root(&state)?;
    let created = create_vault_binary_file_in_root(relative_path, base64_content, &root)?;
    register_pending_write_trace(
        &state,
        source_trace_id,
        &[created.relative_path.clone()],
        "create_vault_binary_file",
    )?;
    Ok(created)
}

/// 在指定 vault 根目录下创建目录。
pub(crate) fn create_vault_directory_in_root(
    relative_directory_path: String,
    vault_root: &Path,
) -> Result<(), String> {
    let target_directory_path = resolve_vault_directory_path(vault_root, &relative_directory_path)?;

    if target_directory_path.exists() && !target_directory_path.is_dir() {
        return Err("目标路径已存在且不是目录".to_string());
    }

    fs::create_dir_all(&target_directory_path)
        .map_err(|error| format!("创建目录失败 {}: {error}", target_directory_path.display()))?;

    Ok(())
}

/// 在当前仓库中创建目录并注册写入 trace。
pub(crate) fn create_vault_directory(
    relative_directory_path: String,
    source_trace_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let root = get_vault_root(&state)?;
    create_vault_directory_in_root(relative_directory_path.clone(), &root)?;
    register_pending_write_trace(
        &state,
        source_trace_id,
        &[relative_directory_path],
        "create_vault_directory",
    )?;
    Ok(())
}

/// 在指定 vault 根目录下保存 Markdown 文件。
pub(crate) fn save_vault_markdown_file_in_root(
    relative_path: String,
    content: String,
    vault_root: &Path,
) -> Result<WriteMarkdownResponse, String> {
    let target_path = resolve_markdown_target_path(vault_root, &relative_path)?;
    let existed = target_path.exists();

    if let Some(parent) = target_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("创建父目录失败 {}: {error}", parent.display()))?;
    }

    fs::write(&target_path, content.as_bytes())
        .map_err(|error| format!("保存文件失败 {}: {error}", target_path.display()))?;

    Ok(WriteMarkdownResponse {
        relative_path,
        created: !existed,
    })
}

/// 保存当前仓库中的 Markdown 文件并触发索引重建。
pub(crate) fn save_vault_markdown_file(
    relative_path: String,
    content: String,
    source_trace_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<WriteMarkdownResponse, String> {
    let root = get_vault_root(&state)?;
    let saved = save_vault_markdown_file_in_root(relative_path, content, &root)?;
    register_pending_write_trace(
        &state,
        source_trace_id,
        &[saved.relative_path.clone()],
        "save_vault_markdown_file",
    )?;
    let reindex_root = root.clone();
    let reindex_path = saved.relative_path.clone();
    spawn_background_reindex("save_vault_markdown_file", move || {
        query_index::reindex_markdown_file(&reindex_root, &reindex_path)
    });
    Ok(saved)
}

/// 在指定 vault 根目录下保存 Canvas 文件。
pub(crate) fn save_vault_canvas_file_in_root(
    relative_path: String,
    content: String,
    vault_root: &Path,
) -> Result<WriteMarkdownResponse, String> {
    let target_path = resolve_canvas_target_path(vault_root, &relative_path)?;
    let existed = target_path.exists();

    if let Some(parent) = target_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("创建父目录失败 {}: {error}", parent.display()))?;
    }

    fs::write(&target_path, content.as_bytes())
        .map_err(|error| format!("保存 Canvas 文件失败 {}: {error}", target_path.display()))?;

    Ok(WriteMarkdownResponse {
        relative_path,
        created: !existed,
    })
}

/// 保存当前仓库中的 Canvas 文件并注册写入 trace。
pub(crate) fn save_vault_canvas_file(
    relative_path: String,
    content: String,
    source_trace_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<WriteMarkdownResponse, String> {
    let root = get_vault_root(&state)?;
    let saved = save_vault_canvas_file_in_root(relative_path, content, &root)?;
    register_pending_write_trace(
        &state,
        source_trace_id,
        &[saved.relative_path.clone()],
        "save_vault_canvas_file",
    )?;
    Ok(saved)
}

pub(crate) fn rename_vault_markdown_file_in_root(
    from_relative_path: String,
    to_relative_path: String,
    vault_root: &Path,
) -> Result<WriteMarkdownResponse, String> {
    let source_path = resolve_markdown_path(vault_root, &from_relative_path)?;
    let target_path = resolve_markdown_target_path(vault_root, &to_relative_path)?;

    if source_path == target_path {
        return Ok(WriteMarkdownResponse {
            relative_path: to_relative_path,
            created: false,
        });
    }

    if target_path.exists() {
        return Err("目标文件已存在".to_string());
    }

    if let Some(parent) = target_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("创建父目录失败 {}: {error}", parent.display()))?;
    }

    fs::rename(&source_path, &target_path).map_err(|error| {
        format!(
            "重命名文件失败 {} -> {}: {error}",
            source_path.display(),
            target_path.display()
        )
    })?;

    Ok(WriteMarkdownResponse {
        relative_path: to_relative_path,
        created: false,
    })
}

pub(crate) fn rename_vault_markdown_file(
    from_relative_path: String,
    to_relative_path: String,
    source_trace_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<WriteMarkdownResponse, String> {
    let root = get_vault_root(&state)?;
    let from_path_for_trace = from_relative_path.clone();
    let renamed = rename_vault_markdown_file_in_root(from_relative_path, to_relative_path, &root)?;
    register_pending_write_trace(
        &state,
        source_trace_id,
        &[from_path_for_trace.clone(), renamed.relative_path.clone()],
        "rename_vault_markdown_file",
    )?;
    let reindex_root = root.clone();
    let reindex_path = renamed.relative_path.clone();
    spawn_background_reindex("rename_vault_markdown_file", move || {
        query_index::remove_markdown_file(&reindex_root, &from_path_for_trace)?;
        query_index::reindex_markdown_file(&reindex_root, &reindex_path)
    });
    Ok(renamed)
}

/// 在指定 vault 根目录下重命名 Canvas 文件。
pub(crate) fn rename_vault_canvas_file_in_root(
    from_relative_path: String,
    to_relative_path: String,
    vault_root: &Path,
) -> Result<WriteMarkdownResponse, String> {
    let source_path = resolve_canvas_path(vault_root, &from_relative_path)?;
    let target_path = resolve_canvas_target_path(vault_root, &to_relative_path)?;

    if source_path == target_path {
        return Ok(WriteMarkdownResponse {
            relative_path: to_relative_path,
            created: false,
        });
    }

    if target_path.exists() {
        return Err("目标文件已存在".to_string());
    }

    if let Some(parent) = target_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("创建父目录失败 {}: {error}", parent.display()))?;
    }

    fs::rename(&source_path, &target_path).map_err(|error| {
        format!(
            "重命名 Canvas 文件失败 {} -> {}: {error}",
            source_path.display(),
            target_path.display()
        )
    })?;

    Ok(WriteMarkdownResponse {
        relative_path: to_relative_path,
        created: false,
    })
}

/// 重命名当前仓库中的 Canvas 文件并注册写入 trace。
pub(crate) fn rename_vault_canvas_file(
    from_relative_path: String,
    to_relative_path: String,
    source_trace_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<WriteMarkdownResponse, String> {
    let root = get_vault_root(&state)?;
    let from_path_for_trace = from_relative_path.clone();
    let renamed = rename_vault_canvas_file_in_root(from_relative_path, to_relative_path, &root)?;
    register_pending_write_trace(
        &state,
        source_trace_id,
        &[from_path_for_trace, renamed.relative_path.clone()],
        "rename_vault_canvas_file",
    )?;
    Ok(renamed)
}

pub(crate) fn move_vault_markdown_file_to_directory_in_root(
    from_relative_path: String,
    target_directory_relative_path: String,
    vault_root: &Path,
) -> Result<WriteMarkdownResponse, String> {
    let source_path = resolve_markdown_path(vault_root, &from_relative_path)?;
    let source_file_name = source_path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "源文件名无效".to_string())?;

    let target_directory_path =
        resolve_vault_directory_path(vault_root, &target_directory_relative_path)?;

    if target_directory_path.exists() && !target_directory_path.is_dir() {
        return Err("目标目录路径不是目录".to_string());
    }

    fs::create_dir_all(&target_directory_path).map_err(|error| {
        format!(
            "创建目标目录失败 {}: {error}",
            target_directory_path.display()
        )
    })?;

    let target_path = target_directory_path.join(source_file_name);
    let target_relative_path = to_vault_relative_path(&target_path, vault_root)?;

    if source_path == target_path {
        return Ok(WriteMarkdownResponse {
            relative_path: target_relative_path,
            created: false,
        });
    }

    if target_path.exists() {
        return Err("目标文件已存在".to_string());
    }

    fs::rename(&source_path, &target_path).map_err(|error| {
        format!(
            "移动文件失败 {} -> {}: {error}",
            source_path.display(),
            target_path.display()
        )
    })?;

    Ok(WriteMarkdownResponse {
        relative_path: target_relative_path,
        created: false,
    })
}

pub(crate) fn move_vault_markdown_file_to_directory(
    from_relative_path: String,
    target_directory_relative_path: String,
    source_trace_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<WriteMarkdownResponse, String> {
    let root = get_vault_root(&state)?;
    let from_path_for_trace = from_relative_path.clone();
    let moved = move_vault_markdown_file_to_directory_in_root(
        from_relative_path,
        target_directory_relative_path,
        &root,
    )?;
    register_pending_write_trace(
        &state,
        source_trace_id,
        &[from_path_for_trace.clone(), moved.relative_path.clone()],
        "move_vault_markdown_file_to_directory",
    )?;
    let reindex_root = root.clone();
    let reindex_path = moved.relative_path.clone();
    spawn_background_reindex("move_vault_markdown_file_to_directory", move || {
        query_index::remove_markdown_file(&reindex_root, &from_path_for_trace)?;
        query_index::reindex_markdown_file(&reindex_root, &reindex_path)
    });
    Ok(moved)
}

/// 在指定 vault 根目录下移动 Canvas 文件到目录。
pub(crate) fn move_vault_canvas_file_to_directory_in_root(
    from_relative_path: String,
    target_directory_relative_path: String,
    vault_root: &Path,
) -> Result<WriteMarkdownResponse, String> {
    let source_path = resolve_canvas_path(vault_root, &from_relative_path)?;
    let source_file_name = source_path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "源文件名无效".to_string())?;

    let target_directory_path =
        resolve_vault_directory_path(vault_root, &target_directory_relative_path)?;

    if target_directory_path.exists() && !target_directory_path.is_dir() {
        return Err("目标目录路径不是目录".to_string());
    }

    fs::create_dir_all(&target_directory_path).map_err(|error| {
        format!(
            "创建目标目录失败 {}: {error}",
            target_directory_path.display()
        )
    })?;

    let target_path = target_directory_path.join(source_file_name);
    let target_relative_path = to_vault_relative_path(&target_path, vault_root)?;

    if source_path == target_path {
        return Ok(WriteMarkdownResponse {
            relative_path: target_relative_path,
            created: false,
        });
    }

    if target_path.exists() {
        return Err("目标文件已存在".to_string());
    }

    fs::rename(&source_path, &target_path).map_err(|error| {
        format!(
            "移动 Canvas 文件失败 {} -> {}: {error}",
            source_path.display(),
            target_path.display()
        )
    })?;

    Ok(WriteMarkdownResponse {
        relative_path: target_relative_path,
        created: false,
    })
}

/// 将当前仓库中的 Canvas 文件移动到目录并注册写入 trace。
pub(crate) fn move_vault_canvas_file_to_directory(
    from_relative_path: String,
    target_directory_relative_path: String,
    source_trace_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<WriteMarkdownResponse, String> {
    let root = get_vault_root(&state)?;
    let from_path_for_trace = from_relative_path.clone();
    let moved = move_vault_canvas_file_to_directory_in_root(
        from_relative_path,
        target_directory_relative_path,
        &root,
    )?;
    register_pending_write_trace(
        &state,
        source_trace_id,
        &[from_path_for_trace, moved.relative_path.clone()],
        "move_vault_canvas_file_to_directory",
    )?;
    Ok(moved)
}

pub(crate) fn rename_vault_directory_in_root(
    from_relative_path: String,
    to_relative_path: String,
    vault_root: &Path,
) -> Result<WriteMarkdownResponse, String> {
    if from_relative_path.trim().is_empty() {
        return Err("源目录路径不能为空".to_string());
    }

    if to_relative_path.trim().is_empty() {
        return Err("目标目录路径不能为空".to_string());
    }

    let source_path = resolve_vault_directory_path(vault_root, &from_relative_path)?;
    let target_path = resolve_vault_directory_path(vault_root, &to_relative_path)?;

    if source_path == vault_root {
        return Err("不支持重命名仓库根目录".to_string());
    }

    if source_path == target_path {
        return Ok(WriteMarkdownResponse {
            relative_path: to_relative_path,
            created: false,
        });
    }

    if target_path.starts_with(&source_path) {
        return Err("禁止将目录重命名到其子目录中".to_string());
    }

    if !source_path.exists() {
        return Err("源目录不存在".to_string());
    }

    if !source_path.is_dir() {
        return Err("源路径不是目录".to_string());
    }

    if target_path.exists() {
        return Err("目标目录已存在".to_string());
    }

    if let Some(parent) = target_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("创建父目录失败 {}: {error}", parent.display()))?;
    }

    fs::rename(&source_path, &target_path).map_err(|error| {
        format!(
            "重命名目录失败 {} -> {}: {error}",
            source_path.display(),
            target_path.display()
        )
    })?;

    Ok(WriteMarkdownResponse {
        relative_path: to_relative_path,
        created: false,
    })
}

pub(crate) fn rename_vault_directory(
    from_relative_path: String,
    to_relative_path: String,
    source_trace_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<WriteMarkdownResponse, String> {
    let root = get_vault_root(&state)?;
    let from_path_for_trace = from_relative_path.clone();
    let renamed = rename_vault_directory_in_root(from_relative_path, to_relative_path, &root)?;
    let old_prefix_for_reindex = from_path_for_trace.clone();
    register_pending_write_trace(
        &state,
        source_trace_id,
        &[from_path_for_trace, renamed.relative_path.clone()],
        "rename_vault_directory",
    )?;
    let reindex_root = root.clone();
    let new_prefix = renamed.relative_path.clone();
    spawn_background_reindex("rename_vault_directory", move || {
        query_index::relocate_directory_in_index(
            &reindex_root,
            &old_prefix_for_reindex,
            &new_prefix,
        )
    });
    Ok(renamed)
}

pub(crate) fn move_vault_directory_to_directory_in_root(
    from_relative_path: String,
    target_directory_relative_path: String,
    vault_root: &Path,
) -> Result<WriteMarkdownResponse, String> {
    if from_relative_path.trim().is_empty() {
        return Err("源目录路径不能为空".to_string());
    }

    let source_path = resolve_vault_directory_path(vault_root, &from_relative_path)?;
    if source_path == vault_root {
        return Err("不支持移动仓库根目录".to_string());
    }

    if !source_path.exists() {
        return Err("源目录不存在".to_string());
    }

    if !source_path.is_dir() {
        return Err("源路径不是目录".to_string());
    }

    let source_directory_name = source_path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "源目录名无效".to_string())?;

    let target_directory_path =
        resolve_vault_directory_path(vault_root, &target_directory_relative_path)?;

    if target_directory_path.exists() && !target_directory_path.is_dir() {
        return Err("目标目录路径不是目录".to_string());
    }

    if target_directory_path.starts_with(&source_path) {
        return Err("禁止将目录移动到其子目录中".to_string());
    }

    fs::create_dir_all(&target_directory_path).map_err(|error| {
        format!(
            "创建目标目录失败 {}: {error}",
            target_directory_path.display()
        )
    })?;

    let target_path = target_directory_path.join(source_directory_name);
    let target_relative_path = to_vault_relative_path(&target_path, vault_root)?;

    if source_path == target_path {
        return Ok(WriteMarkdownResponse {
            relative_path: target_relative_path,
            created: false,
        });
    }

    if target_path.exists() {
        return Err("目标目录已存在".to_string());
    }

    fs::rename(&source_path, &target_path).map_err(|error| {
        format!(
            "移动目录失败 {} -> {}: {error}",
            source_path.display(),
            target_path.display()
        )
    })?;

    Ok(WriteMarkdownResponse {
        relative_path: target_relative_path,
        created: false,
    })
}

pub(crate) fn move_vault_directory_to_directory(
    from_relative_path: String,
    target_directory_relative_path: String,
    source_trace_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<WriteMarkdownResponse, String> {
    let root = get_vault_root(&state)?;
    let from_path_for_trace = from_relative_path.clone();
    let moved = move_vault_directory_to_directory_in_root(
        from_relative_path,
        target_directory_relative_path,
        &root,
    )?;
    register_pending_write_trace(
        &state,
        source_trace_id,
        &[from_path_for_trace.clone(), moved.relative_path.clone()],
        "move_vault_directory_to_directory",
    )?;
    let reindex_root = root.clone();
    let new_prefix = moved.relative_path.clone();
    spawn_background_reindex("move_vault_directory_to_directory", move || {
        query_index::relocate_directory_in_index(&reindex_root, &from_path_for_trace, &new_prefix)
    });
    Ok(moved)
}

pub(crate) fn delete_vault_directory_in_root(
    relative_path: String,
    vault_root: &Path,
) -> Result<(), String> {
    if relative_path.trim().is_empty() {
        return Err("目录路径不能为空".to_string());
    }

    let target_path = resolve_vault_directory_path(vault_root, &relative_path)?;

    if target_path == vault_root {
        return Err("不支持删除仓库根目录".to_string());
    }

    if !target_path.exists() {
        return Err("目标目录不存在".to_string());
    }

    if !target_path.is_dir() {
        return Err("目标路径不是目录".to_string());
    }

    fs::remove_dir_all(&target_path)
        .map_err(|error| format!("删除目录失败 {}: {error}", target_path.display()))?;

    Ok(())
}

pub(crate) fn delete_vault_directory(
    relative_path: String,
    source_trace_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let root = get_vault_root(&state)?;
    let relative_path_for_trace = relative_path.clone();
    delete_vault_directory_in_root(relative_path, &root)?;
    register_pending_write_trace(
        &state,
        source_trace_id,
        &[relative_path_for_trace.clone()],
        "delete_vault_directory",
    )?;
    let reindex_root = root.clone();
    spawn_background_reindex("delete_vault_directory", move || {
        query_index::remove_directory_from_index(&reindex_root, &relative_path_for_trace)
    });
    Ok(())
}

pub(crate) fn delete_vault_markdown_file_in_root(
    relative_path: String,
    vault_root: &Path,
) -> Result<(), String> {
    let target_path = resolve_markdown_target_path(vault_root, &relative_path)?;

    if !target_path.exists() {
        return Err("目标文件不存在".to_string());
    }

    if !target_path.is_file() {
        return Err("目标路径不是文件".to_string());
    }

    fs::remove_file(&target_path)
        .map_err(|error| format!("删除文件失败 {}: {error}", target_path.display()))?;

    Ok(())
}

pub(crate) fn delete_vault_markdown_file(
    relative_path: String,
    source_trace_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let root = get_vault_root(&state)?;
    let relative_path_for_trace = relative_path.clone();
    delete_vault_markdown_file_in_root(relative_path, &root)?;
    register_pending_write_trace(
        &state,
        source_trace_id,
        &[relative_path_for_trace.clone()],
        "delete_vault_markdown_file",
    )?;
    let reindex_root = root.clone();
    spawn_background_reindex("delete_vault_markdown_file", move || {
        query_index::remove_markdown_file(&reindex_root, &relative_path_for_trace)
    });
    Ok(())
}

/// 在指定 vault 根目录下删除 Canvas 文件。
pub(crate) fn delete_vault_canvas_file_in_root(
    relative_path: String,
    vault_root: &Path,
) -> Result<(), String> {
    let target_path = resolve_canvas_target_path(vault_root, &relative_path)?;

    if !target_path.exists() {
        return Err("目标文件不存在".to_string());
    }

    if !target_path.is_file() {
        return Err("目标路径不是文件".to_string());
    }

    fs::remove_file(&target_path)
        .map_err(|error| format!("删除 Canvas 文件失败 {}: {error}", target_path.display()))?;

    Ok(())
}

/// 删除当前仓库中的 Canvas 文件并注册写入 trace。
pub(crate) fn delete_vault_canvas_file(
    relative_path: String,
    source_trace_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let root = get_vault_root(&state)?;
    let relative_path_for_trace = relative_path.clone();
    delete_vault_canvas_file_in_root(relative_path, &root)?;
    register_pending_write_trace(
        &state,
        source_trace_id,
        &[relative_path_for_trace],
        "delete_vault_canvas_file",
    )?;
    Ok(())
}

pub(crate) fn delete_vault_binary_file_in_root(
    relative_path: String,
    vault_root: &Path,
) -> Result<(), String> {
    let target_path = resolve_binary_target_path(vault_root, &relative_path)?;

    if !target_path.exists() {
        return Err("目标文件不存在".to_string());
    }

    if !target_path.is_file() {
        return Err("目标路径不是文件".to_string());
    }

    fs::remove_file(&target_path)
        .map_err(|error| format!("删除文件失败 {}: {error}", target_path.display()))?;

    Ok(())
}

pub(crate) fn delete_vault_binary_file(
    relative_path: String,
    source_trace_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let root = get_vault_root(&state)?;
    let relative_path_for_trace = relative_path.clone();
    delete_vault_binary_file_in_root(relative_path, &root)?;
    register_pending_write_trace(
        &state,
        source_trace_id,
        &[relative_path_for_trace],
        "delete_vault_binary_file",
    )?;
    Ok(())
}

fn split_name_extension(name: &str) -> (&str, &str) {
    if let Some(dot_pos) = name.rfind('.') {
        if dot_pos > 0 {
            return (&name[..dot_pos], &name[dot_pos + 1..]);
        }
    }
    (name, "")
}

fn resolve_copy_target_path(target_dir: &Path, source_name: &str) -> PathBuf {
    let target = target_dir.join(source_name);
    if !target.exists() {
        return target;
    }

    let (stem, ext) = split_name_extension(source_name);

    for index in 1..=10000 {
        let candidate_name = if ext.is_empty() {
            format!("{stem} (copy {index})")
        } else {
            format!("{stem} (copy {index}).{ext}")
        };
        let candidate = target_dir.join(&candidate_name);
        if !candidate.exists() {
            return candidate;
        }
    }

    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0);
    let fallback_name = if ext.is_empty() {
        format!("{stem} (copy {ts})")
    } else {
        format!("{stem} (copy {ts}).{ext}")
    };
    target_dir.join(fallback_name)
}

fn copy_dir_recursive(source: &Path, target: &Path) -> Result<(), String> {
    fs::create_dir_all(target)
        .map_err(|error| format!("创建目录失败 {}: {error}", target.display()))?;

    let entries = fs::read_dir(source)
        .map_err(|error| format!("读取目录失败 {}: {error}", source.display()))?;

    for entry in entries {
        let entry = entry.map_err(|error| format!("读取目录项失败: {error}"))?;
        let source_entry = entry.path();
        let target_entry = target.join(entry.file_name());

        if source_entry.is_dir() {
            copy_dir_recursive(&source_entry, &target_entry)?;
        } else {
            fs::copy(&source_entry, &target_entry).map_err(|error| {
                format!(
                    "复制文件失败 {} -> {}: {error}",
                    source_entry.display(),
                    target_entry.display()
                )
            })?;
        }
    }

    Ok(())
}

pub(crate) fn copy_vault_entry_in_root(
    source_relative_path: &str,
    target_directory_relative_path: &str,
    vault_root: &Path,
) -> Result<CopyEntryResponse, String> {
    if source_relative_path.trim().is_empty() {
        return Err("源路径不能为空".to_string());
    }

    let source_path = vault_root.join(source_relative_path);
    if !source_path.exists() {
        return Err(format!("源不存在: {source_relative_path}"));
    }

    let target_dir = resolve_vault_directory_path(vault_root, target_directory_relative_path)?;

    if !target_dir.exists() {
        fs::create_dir_all(&target_dir)
            .map_err(|error| format!("创建目标目录失败 {}: {error}", target_dir.display()))?;
    }

    let source_name = Path::new(source_relative_path)
        .file_name()
        .ok_or_else(|| "无法提取源文件名".to_string())?
        .to_string_lossy()
        .to_string();

    let target_path = resolve_copy_target_path(&target_dir, &source_name);

    if source_path.is_dir() {
        copy_dir_recursive(&source_path, &target_path)?;
    } else {
        fs::copy(&source_path, &target_path).map_err(|error| {
            format!(
                "复制文件失败 {} -> {}: {error}",
                source_path.display(),
                target_path.display()
            )
        })?;
    }

    Ok(CopyEntryResponse {
        relative_path: to_vault_relative_path(&target_path, vault_root)?,
        source_relative_path: source_relative_path.to_string(),
    })
}

pub(crate) fn copy_vault_entry(
    source_relative_path: String,
    target_directory_relative_path: String,
    source_trace_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<CopyEntryResponse, String> {
    let root = get_vault_root(&state)?;
    let result = copy_vault_entry_in_root(
        &source_relative_path,
        &target_directory_relative_path,
        &root,
    )?;
    register_pending_write_trace(
        &state,
        source_trace_id,
        &[result.relative_path.clone()],
        "copy_vault_entry",
    )?;
    Ok(result)
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::Mutex;
    use std::time::{SystemTime, UNIX_EPOCH};

    use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
    use base64::Engine;
    use serde_json::Map;

    use super::{
        copy_vault_entry_in_root, create_vault_binary_file_in_root, create_vault_directory_in_root,
        create_vault_markdown_file_in_root, delete_vault_binary_file_in_root,
        delete_vault_directory_in_root, delete_vault_markdown_file_in_root,
        move_vault_directory_to_directory_in_root, move_vault_markdown_file_to_directory_in_root,
        register_pending_write_trace_in_app_state, rename_vault_directory_in_root,
        rename_vault_markdown_file_in_root, save_current_vault_config_in_root,
        save_vault_markdown_file_in_root,
    };
    use crate::host::window_effects::WindowsAcrylicEffectConfig;
    use crate::shared::vault_contracts::VaultConfig;
    use crate::state::AppState;

    static TEST_ROOT_SEQ: AtomicU64 = AtomicU64::new(1);

    fn create_test_root() -> PathBuf {
        let sequence = TEST_ROOT_SEQ.fetch_add(1, Ordering::Relaxed);
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0);
        let root =
            std::env::temp_dir().join(format!("ofive-write-runtime-test-{unique}-{sequence}"));
        fs::create_dir_all(root.join(".ofive")).expect("应成功创建测试根目录");
        root
    }

    fn new_test_app_state() -> AppState {
        AppState {
            current_vault: Mutex::new(None),
            vault_watcher: Mutex::new(None),
            pending_vault_write_trace_by_path: Mutex::new(HashMap::new()),
            ai_sidecar_runtime: Mutex::new(None),
            windows_acrylic_effect_config: Mutex::new(WindowsAcrylicEffectConfig::default()),
        }
    }

    #[test]
    fn create_vault_markdown_file_in_root_writes_initial_content() {
        let root = create_test_root();

        let response = create_vault_markdown_file_in_root(
            "notes/test.md".to_string(),
            Some("hello".to_string()),
            &root,
        )
        .expect("创建 markdown 文件应成功");

        assert_eq!(response.relative_path, "notes/test.md");
        assert!(response.created);
        assert_eq!(
            fs::read_to_string(root.join("notes/test.md")).expect("应成功读取文件"),
            "hello"
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn create_vault_binary_file_in_root_decodes_base64() {
        let root = create_test_root();

        let response = create_vault_binary_file_in_root(
            "assets/a.bin".to_string(),
            BASE64_STANDARD.encode([1u8, 2u8, 3u8]),
            &root,
        )
        .expect("创建二进制文件应成功");

        assert_eq!(response.relative_path, "assets/a.bin");
        assert_eq!(
            fs::read(root.join("assets/a.bin")).expect("应成功读取二进制文件"),
            vec![1u8, 2u8, 3u8]
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn create_vault_directory_in_root_creates_nested_directories() {
        let root = create_test_root();

        create_vault_directory_in_root("nested/a/b".to_string(), &root).expect("创建目录应成功");

        assert!(root.join("nested/a/b").is_dir());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn save_vault_markdown_file_in_root_reports_creation_then_update() {
        let root = create_test_root();

        let created = save_vault_markdown_file_in_root(
            "notes/save.md".to_string(),
            "first".to_string(),
            &root,
        )
        .expect("首次保存应成功");
        let updated = save_vault_markdown_file_in_root(
            "notes/save.md".to_string(),
            "second".to_string(),
            &root,
        )
        .expect("再次保存应成功");

        assert!(created.created);
        assert!(!updated.created);
        assert_eq!(
            fs::read_to_string(root.join("notes/save.md")).expect("应成功读取 markdown 文件"),
            "second"
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn save_current_vault_config_in_root_persists_config_file() {
        let root = create_test_root();
        let config = VaultConfig {
            schema_version: 1,
            entries: Map::new(),
        };

        let saved =
            save_current_vault_config_in_root(config.clone(), &root).expect("保存配置应成功");

        assert_eq!(saved.schema_version, 1);
        assert!(Path::new(&root.join(".ofive/config.json")).exists());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn rename_vault_markdown_file_in_root_moves_file() {
        let root = create_test_root();
        fs::create_dir_all(root.join("notes")).expect("应成功创建目录");
        fs::write(root.join("notes/old.md"), "hello").expect("应成功写入源文件");

        let response = rename_vault_markdown_file_in_root(
            "notes/old.md".to_string(),
            "notes/new.md".to_string(),
            &root,
        )
        .expect("重命名 markdown 文件应成功");

        assert_eq!(response.relative_path, "notes/new.md");
        assert!(!root.join("notes/old.md").exists());
        assert_eq!(
            fs::read_to_string(root.join("notes/new.md")).unwrap(),
            "hello"
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn move_vault_markdown_file_to_directory_in_root_keeps_name() {
        let root = create_test_root();
        fs::create_dir_all(root.join("notes")).expect("应成功创建目录");
        fs::write(root.join("notes/todo.md"), "hello").expect("应成功写入源文件");

        let response = move_vault_markdown_file_to_directory_in_root(
            "notes/todo.md".to_string(),
            "archive/2026".to_string(),
            &root,
        )
        .expect("移动 markdown 文件应成功");

        assert_eq!(response.relative_path, "archive/2026/todo.md");
        assert!(!root.join("notes/todo.md").exists());
        assert_eq!(
            fs::read_to_string(root.join("archive/2026/todo.md")).unwrap(),
            "hello"
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn rename_vault_directory_in_root_moves_nested_children() {
        let root = create_test_root();
        fs::create_dir_all(root.join("a/b")).expect("应成功创建目录");
        fs::write(root.join("a/b/file.md"), "hello").expect("应成功写入文件");

        let response = rename_vault_directory_in_root("a".to_string(), "c".to_string(), &root)
            .expect("重命名目录应成功");

        assert_eq!(response.relative_path, "c");
        assert!(!root.join("a").exists());
        assert_eq!(
            fs::read_to_string(root.join("c/b/file.md")).unwrap(),
            "hello"
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn move_vault_directory_to_directory_in_root_keeps_directory_name() {
        let root = create_test_root();
        fs::create_dir_all(root.join("source/inner")).expect("应成功创建目录");
        fs::write(root.join("source/inner/file.md"), "hello").expect("应成功写入文件");

        let response = move_vault_directory_to_directory_in_root(
            "source".to_string(),
            "target/nested".to_string(),
            &root,
        )
        .expect("移动目录应成功");

        assert_eq!(response.relative_path, "target/nested/source");
        assert!(!root.join("source").exists());
        assert_eq!(
            fs::read_to_string(root.join("target/nested/source/inner/file.md")).unwrap(),
            "hello"
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn delete_in_root_operations_remove_targets() {
        let root = create_test_root();
        fs::create_dir_all(root.join("notes")).expect("应成功创建目录");
        fs::create_dir_all(root.join("assets")).expect("应成功创建目录");
        fs::create_dir_all(root.join("folders/x")).expect("应成功创建目录");
        fs::write(root.join("notes/delete.md"), "hello").expect("应成功写入 markdown 文件");
        fs::write(root.join("assets/delete.bin"), [1u8, 2u8]).expect("应成功写入二进制文件");

        delete_vault_markdown_file_in_root("notes/delete.md".to_string(), &root)
            .expect("删除 markdown 文件应成功");
        delete_vault_binary_file_in_root("assets/delete.bin".to_string(), &root)
            .expect("删除二进制文件应成功");
        delete_vault_directory_in_root("folders".to_string(), &root).expect("删除目录应成功");

        assert!(!root.join("notes/delete.md").exists());
        assert!(!root.join("assets/delete.bin").exists());
        assert!(!root.join("folders").exists());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn copy_vault_entry_in_root_copies_file_with_conflict_suffix() {
        let root = create_test_root();
        fs::create_dir_all(root.join("source")).expect("应成功创建目录");
        fs::create_dir_all(root.join("target")).expect("应成功创建目录");
        fs::write(root.join("source/note.md"), "alpha").expect("应成功写入源文件");
        fs::write(root.join("target/note.md"), "existing").expect("应成功写入目标冲突文件");

        let response =
            copy_vault_entry_in_root("source/note.md", "target", &root).expect("复制文件应成功");

        assert_eq!(response.relative_path, "target/note (copy 1).md");
        assert_eq!(
            fs::read_to_string(root.join("target/note (copy 1).md")).unwrap(),
            "alpha"
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn copy_vault_entry_in_root_copies_directory_recursively() {
        let root = create_test_root();
        fs::create_dir_all(root.join("dir/sub")).expect("应成功创建目录");
        fs::create_dir_all(root.join("archive")).expect("应成功创建目录");
        fs::write(root.join("dir/sub/file.md"), "deep").expect("应成功写入文件");

        let response = copy_vault_entry_in_root("dir", "archive", &root).expect("复制目录应成功");

        assert_eq!(response.relative_path, "archive/dir");
        assert_eq!(
            fs::read_to_string(root.join("archive/dir/sub/file.md")).unwrap(),
            "deep"
        );
        assert_eq!(
            fs::read_to_string(root.join("dir/sub/file.md")).unwrap(),
            "deep"
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn register_pending_write_trace_in_app_state_stores_normalized_paths() {
        let app_state = new_test_app_state();
        register_pending_write_trace_in_app_state(
            &app_state,
            Some("trace-1".to_string()),
            &["notes\\a.md".to_string(), "notes/b.md".to_string()],
            "test-op",
        )
        .expect("注册 trace 应成功");

        let guard = app_state
            .pending_vault_write_trace_by_path
            .lock()
            .expect("应成功读取 trace map");
        assert_eq!(
            guard.get("notes/a.md").map(|entry| entry.trace_id.as_str()),
            Some("trace-1")
        );
        assert_eq!(
            guard.get("notes/b.md").map(|entry| entry.trace_id.as_str()),
            Some("trace-1")
        );
    }
}
