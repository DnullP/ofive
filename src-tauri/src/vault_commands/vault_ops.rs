//! # 仓库基础命令模块
//!
//! 提供仓库设置、配置读写、目录树读取与文件读写命令。

use crate::state::{get_vault_root, AppState, PendingVaultWriteTrace};
use crate::vault_commands::fs_helpers::{
    canonicalize_vault_path, collect_tree_entries, detect_mime_type, resolve_binary_target_path,
    resolve_existing_vault_file_path, resolve_markdown_path, resolve_markdown_target_path,
    resolve_vault_directory_path,
};
use crate::vault_commands::query_index;
use crate::vault_commands::types::{
    CopyEntryResponse, ReadBinaryFileResponse, ReadMarkdownResponse, SetVaultResponse,
    VaultTreeResponse, WriteBinaryFileResponse, WriteMarkdownResponse,
};
use crate::vault_config::{
    ensure_vault_config_file, load_vault_config, save_vault_config, VaultConfig,
};
use crate::vault_fs::install_vault_watcher;
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, State};

/// 在后台线程中执行索引重建操作，不阻塞当前命令返回。
///
/// 将给定的闭包提交到独立线程执行，索引操作失败仅记录日志，
/// 不影响主流程返回结果。
///
/// # 参数
/// - `operation_name`：操作名称，用于日志标识
/// - `task`：需要在后台执行的索引操作闭包
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

const PENDING_WRITE_TRACE_TTL_MS: u128 = 5_000;
const VAULT_CONFIG_RELATIVE_PATH: &str = ".ofive/config.json";

fn now_unix_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

fn normalize_relative_path(path: &str) -> String {
    path.replace('\\', "/")
}

fn register_pending_write_trace(
    state: &State<'_, AppState>,
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
        println!(
            "[vault] {} trace mapped: path={} trace_id={}",
            operation_name, normalized_path, trace_id
        );
    });

    Ok(())
}

/// 设置当前工作仓库目录。
pub fn set_current_vault_precheck(vault_path: String) -> Result<SetVaultResponse, String> {
    println!("[vault] set_current_vault_precheck start: {}", vault_path);
    let canonical = canonicalize_vault_path(&vault_path)?;
    ensure_vault_config_file(&canonical)?;
    Ok(SetVaultResponse {
        vault_path: canonical.to_string_lossy().to_string(),
    })
}

/// 设置当前工作仓库目录。
pub fn set_current_vault(
    vault_path: String,
    app_handle: AppHandle,
    state: State<'_, AppState>,
) -> Result<SetVaultResponse, String> {
    println!("[vault] set_current_vault start: {}", vault_path);
    let prechecked = set_current_vault_precheck(vault_path)?;
    let canonical = PathBuf::from(&prechecked.vault_path);

    let mut guard = state
        .current_vault
        .lock()
        .map_err(|error| format!("写入 vault 状态失败: {error}"))?;
    *guard = Some(canonical.clone());

    let effective_path = canonical.to_string_lossy().to_string();

    install_vault_watcher(&app_handle, &state, &canonical)?;
    query_index::ensure_query_index_current(&canonical)?;

    // 设置日志文件持久化路径到 <vault>/.ofive/
    crate::logging::set_vault_log_path(Some(canonical.join(".ofive")));

    println!("[vault] set_current_vault success: {}", effective_path);

    Ok(SetVaultResponse {
        vault_path: effective_path,
    })
}

/// 获取当前仓库配置。
///
/// 当前为配置模块骨架接口，返回预留结构体供后续功能扩展。
pub fn get_current_vault_config_in_root(vault_root: &Path) -> Result<VaultConfig, String> {
    println!("[vault-config] get_current_vault_config start");
    let config = load_vault_config(vault_root)?;
    println!(
        "[vault-config] get_current_vault_config success: schema_version={}",
        config.schema_version
    );
    Ok(config)
}

pub fn get_current_vault_config(state: State<'_, AppState>) -> Result<VaultConfig, String> {
    let root = get_vault_root(&state)?;
    get_current_vault_config_in_root(&root)
}

/// 保存当前仓库配置。
///
/// 当前为配置模块骨架接口，前端可透传并持久化预留配置对象。
pub fn save_current_vault_config_in_root(
    config: VaultConfig,
    vault_root: &Path,
) -> Result<VaultConfig, String> {
    println!("[vault-config] save_current_vault_config start");
    save_vault_config(vault_root, &config)?;
    println!(
        "[vault-config] save_current_vault_config success: schema_version={}",
        config.schema_version
    );
    Ok(config)
}

pub fn save_current_vault_config(
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

/// 获取当前仓库目录树。
pub fn get_current_vault_tree_in_root(vault_root: &Path) -> Result<VaultTreeResponse, String> {
    println!("[vault] get_current_vault_tree start");

    let mut entries = Vec::new();
    collect_tree_entries(vault_root, vault_root, &mut entries)?;
    entries.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));

    println!(
        "[vault] get_current_vault_tree success: {} entries",
        entries.len()
    );

    Ok(VaultTreeResponse {
        vault_path: vault_root.to_string_lossy().to_string(),
        entries,
    })
}

pub fn get_current_vault_tree(state: State<'_, AppState>) -> Result<VaultTreeResponse, String> {
    let root = get_vault_root(&state)?;
    get_current_vault_tree_in_root(&root)
}

/// 按相对路径读取当前仓库内 Markdown 文件。
pub fn read_vault_markdown_file_in_root(
    relative_path: String,
    vault_root: &Path,
) -> Result<ReadMarkdownResponse, String> {
    println!(
        "[vault] read_vault_markdown_file start: relative_path={}",
        relative_path
    );
    let target_path = resolve_markdown_path(vault_root, &relative_path)?;

    let content = fs::read_to_string(&target_path)
        .map_err(|error| format!("读取 Markdown 文件失败 {}: {error}", target_path.display()))?;

    println!(
        "[vault] read_vault_markdown_file success: bytes={}",
        content.len()
    );

    Ok(ReadMarkdownResponse {
        relative_path,
        content,
    })
}

pub fn read_vault_markdown_file(
    relative_path: String,
    state: State<'_, AppState>,
) -> Result<ReadMarkdownResponse, String> {
    let root = get_vault_root(&state)?;
    read_vault_markdown_file_in_root(relative_path, &root)
}

/// 按相对路径读取当前仓库内二进制文件（Base64 返回）。
pub fn read_vault_binary_file_in_root(
    relative_path: String,
    vault_root: &Path,
) -> Result<ReadBinaryFileResponse, String> {
    println!(
        "[vault] read_vault_binary_file start: relative_path={}",
        relative_path
    );
    let target_path = resolve_existing_vault_file_path(vault_root, &relative_path)?;
    let mime_type = detect_mime_type(&target_path).to_string();

    let content = fs::read(&target_path)
        .map_err(|error| format!("读取二进制文件失败 {}: {error}", target_path.display()))?;
    let base64_content = BASE64_STANDARD.encode(content);

    println!(
        "[vault] read_vault_binary_file success: mime={} bytes(base64)={}",
        mime_type,
        base64_content.len()
    );

    Ok(ReadBinaryFileResponse {
        relative_path,
        mime_type,
        base64_content,
    })
}

pub fn read_vault_binary_file(
    relative_path: String,
    state: State<'_, AppState>,
) -> Result<ReadBinaryFileResponse, String> {
    let root = get_vault_root(&state)?;
    read_vault_binary_file_in_root(relative_path, &root)
}

/// 创建当前仓库中的 Markdown 文件。
pub fn create_vault_markdown_file_in_root(
    relative_path: String,
    content: Option<String>,
    vault_root: &Path,
) -> Result<WriteMarkdownResponse, String> {
    println!(
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

    println!(
        "[vault] create_vault_markdown_file success: {}",
        target_path.display()
    );

    Ok(WriteMarkdownResponse {
        relative_path,
        created: true,
    })
}

pub fn create_vault_markdown_file(
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

/// 在指定 vault 根目录下创建二进制文件（通常为图片）。
///
/// # 参数
/// - `relative_path` - 文件的相对路径（如 `Images/pasted-20260224-120000.png`）。
/// - `base64_content` - Base64 编码后的文件内容。
/// - `vault_root` - vault 根目录绝对路径。
///
/// # 返回
/// - 创建成功时返回 `WriteBinaryFileResponse`。
///
/// # 异常
/// - 路径校验失败、目标文件已存在、Base64 解码失败、写入失败时返回错误。
pub fn create_vault_binary_file_in_root(
    relative_path: String,
    base64_content: String,
    vault_root: &Path,
) -> Result<WriteBinaryFileResponse, String> {
    println!(
        "[vault] create_vault_binary_file start: relative_path={}",
        relative_path
    );

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

    println!(
        "[vault] create_vault_binary_file success: {} ({} bytes)",
        target_path.display(),
        decoded_bytes.len()
    );

    Ok(WriteBinaryFileResponse {
        relative_path,
        created: true,
    })
}

/// 在当前仓库中创建二进制文件（通常为图片）。
///
/// # 副作用
/// - 在文件系统中创建文件。
/// - 注册写入 trace 以供 watcher 过滤自触发事件。
/// - 不操作 query_index（非 Markdown 文件不需要索引）。
pub fn create_vault_binary_file(
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

/// 创建当前仓库中的目录。
pub fn create_vault_directory_in_root(
    relative_directory_path: String,
    vault_root: &Path,
) -> Result<(), String> {
    println!(
        "[vault] create_vault_directory start: relative_directory_path={}",
        relative_directory_path
    );

    let target_directory_path = resolve_vault_directory_path(vault_root, &relative_directory_path)?;

    if target_directory_path.exists() && !target_directory_path.is_dir() {
        return Err("目标路径已存在且不是目录".to_string());
    }

    fs::create_dir_all(&target_directory_path)
        .map_err(|error| format!("创建目录失败 {}: {error}", target_directory_path.display()))?;

    println!(
        "[vault] create_vault_directory success: {}",
        target_directory_path.display()
    );

    Ok(())
}

pub fn create_vault_directory(
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

/// 保存当前仓库中的 Markdown 文件。
pub fn save_vault_markdown_file_in_root(
    relative_path: String,
    content: String,
    vault_root: &Path,
) -> Result<WriteMarkdownResponse, String> {
    println!(
        "[vault] save_vault_markdown_file start: relative_path={} bytes={}",
        relative_path,
        content.len()
    );

    let target_path = resolve_markdown_target_path(vault_root, &relative_path)?;
    let existed = target_path.exists();

    if let Some(parent) = target_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("创建父目录失败 {}: {error}", parent.display()))?;
    }

    fs::write(&target_path, content.as_bytes())
        .map_err(|error| format!("保存文件失败 {}: {error}", target_path.display()))?;

    println!(
        "[vault] save_vault_markdown_file success: {}",
        target_path.display()
    );

    Ok(WriteMarkdownResponse {
        relative_path,
        created: !existed,
    })
}

pub fn save_vault_markdown_file(
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

/// 重命名当前仓库中的 Markdown 文件。
pub fn rename_vault_markdown_file_in_root(
    from_relative_path: String,
    to_relative_path: String,
    vault_root: &Path,
) -> Result<WriteMarkdownResponse, String> {
    println!(
        "[vault] rename_vault_markdown_file start: from={} to={}",
        from_relative_path, to_relative_path
    );

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

    println!(
        "[vault] rename_vault_markdown_file success: {} -> {}",
        source_path.display(),
        target_path.display()
    );

    Ok(WriteMarkdownResponse {
        relative_path: to_relative_path,
        created: false,
    })
}

pub fn rename_vault_markdown_file(
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

/// 将当前仓库中的 Markdown 文件移动到目标目录（保留原文件名）。
pub fn move_vault_markdown_file_to_directory_in_root(
    from_relative_path: String,
    target_directory_relative_path: String,
    vault_root: &Path,
) -> Result<WriteMarkdownResponse, String> {
    println!(
        "[vault] move_vault_markdown_file_to_directory start: from={} target_dir={}",
        from_relative_path, target_directory_relative_path
    );

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
    let target_relative_path = target_path
        .strip_prefix(vault_root)
        .map_err(|error| format!("计算目标相对路径失败 {}: {error}", target_path.display()))?
        .to_string_lossy()
        .replace('\\', "/");

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

    println!(
        "[vault] move_vault_markdown_file_to_directory success: {} -> {}",
        source_path.display(),
        target_path.display()
    );

    Ok(WriteMarkdownResponse {
        relative_path: target_relative_path,
        created: false,
    })
}

pub fn move_vault_markdown_file_to_directory(
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

/// 重命名当前仓库中的目录。
pub fn rename_vault_directory_in_root(
    from_relative_path: String,
    to_relative_path: String,
    vault_root: &Path,
) -> Result<WriteMarkdownResponse, String> {
    println!(
        "[vault] rename_vault_directory start: from={} to={}",
        from_relative_path, to_relative_path
    );

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

    println!(
        "[vault] rename_vault_directory success: {} -> {}",
        source_path.display(),
        target_path.display()
    );

    Ok(WriteMarkdownResponse {
        relative_path: to_relative_path,
        created: false,
    })
}

pub fn rename_vault_directory(
    from_relative_path: String,
    to_relative_path: String,
    source_trace_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<WriteMarkdownResponse, String> {
    let root = get_vault_root(&state)?;
    let from_path_for_trace = from_relative_path.clone();
    let renamed = rename_vault_directory_in_root(from_relative_path, to_relative_path, &root)?;
    register_pending_write_trace(
        &state,
        source_trace_id,
        &[from_path_for_trace, renamed.relative_path.clone()],
        "rename_vault_directory",
    )?;
    let reindex_root = root.clone();
    spawn_background_reindex("rename_vault_directory", move || {
        query_index::ensure_query_index_current(&reindex_root)
    });
    Ok(renamed)
}

/// 将当前仓库中的目录移动到目标目录（保留原目录名）。
pub fn move_vault_directory_to_directory_in_root(
    from_relative_path: String,
    target_directory_relative_path: String,
    vault_root: &Path,
) -> Result<WriteMarkdownResponse, String> {
    println!(
        "[vault] move_vault_directory_to_directory start: from={} target_dir={}",
        from_relative_path, target_directory_relative_path
    );

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
    let target_relative_path = target_path
        .strip_prefix(vault_root)
        .map_err(|error| format!("计算目标相对路径失败 {}: {error}", target_path.display()))?
        .to_string_lossy()
        .replace('\\', "/");

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

    println!(
        "[vault] move_vault_directory_to_directory success: {} -> {}",
        source_path.display(),
        target_path.display()
    );

    Ok(WriteMarkdownResponse {
        relative_path: target_relative_path,
        created: false,
    })
}

pub fn move_vault_directory_to_directory(
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
        &[from_path_for_trace, moved.relative_path.clone()],
        "move_vault_directory_to_directory",
    )?;
    let reindex_root = root.clone();
    spawn_background_reindex("move_vault_directory_to_directory", move || {
        query_index::ensure_query_index_current(&reindex_root)
    });
    Ok(moved)
}

/// 删除当前仓库中的目录（递归删除）。
pub fn delete_vault_directory_in_root(
    relative_path: String,
    vault_root: &Path,
) -> Result<(), String> {
    println!(
        "[vault] delete_vault_directory start: relative_path={}",
        relative_path
    );

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

    println!(
        "[vault] delete_vault_directory success: {}",
        target_path.display()
    );

    Ok(())
}

pub fn delete_vault_directory(
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
        &[relative_path_for_trace],
        "delete_vault_directory",
    )?;
    let reindex_root = root.clone();
    spawn_background_reindex("delete_vault_directory", move || {
        query_index::ensure_query_index_current(&reindex_root)
    });
    Ok(())
}

/// 删除当前仓库中的 Markdown 文件。
pub fn delete_vault_markdown_file_in_root(
    relative_path: String,
    vault_root: &Path,
) -> Result<(), String> {
    println!(
        "[vault] delete_vault_markdown_file start: relative_path={}",
        relative_path
    );

    let target_path = resolve_markdown_target_path(vault_root, &relative_path)?;

    if !target_path.exists() {
        return Err("目标文件不存在".to_string());
    }

    if !target_path.is_file() {
        return Err("目标路径不是文件".to_string());
    }

    fs::remove_file(&target_path)
        .map_err(|error| format!("删除文件失败 {}: {error}", target_path.display()))?;

    println!(
        "[vault] delete_vault_markdown_file success: {}",
        target_path.display()
    );

    Ok(())
}

pub fn delete_vault_markdown_file(
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

/// 删除当前仓库中的二进制文件（图片等非 Markdown 文件）。
///
/// 使用 `resolve_binary_target_path` 校验路径后执行删除操作。
///
/// # 参数
/// - `relative_path` - 目标文件相对路径。
/// - `vault_root` - vault 根目录绝对路径。
///
/// # 返回
/// - 成功返回 `Ok(())`。
///
/// # 异常
/// - 路径为空/绝对路径/目录逃逸/系统目录时返回错误。
/// - 目标文件不存在或不是文件时返回错误。
/// - 删除文件失败时返回错误。
pub fn delete_vault_binary_file_in_root(
    relative_path: String,
    vault_root: &Path,
) -> Result<(), String> {
    println!(
        "[vault] delete_vault_binary_file start: relative_path={}",
        relative_path
    );

    let target_path = resolve_binary_target_path(vault_root, &relative_path)?;

    if !target_path.exists() {
        return Err("目标文件不存在".to_string());
    }

    if !target_path.is_file() {
        return Err("目标路径不是文件".to_string());
    }

    fs::remove_file(&target_path)
        .map_err(|error| format!("删除文件失败 {}: {error}", target_path.display()))?;

    println!(
        "[vault] delete_vault_binary_file success: {}",
        target_path.display()
    );

    Ok(())
}

/// 删除当前仓库中的二进制文件（图片等非 Markdown 文件），并注册写入追踪。
///
/// # 参数
/// - `relative_path` - 目标文件相对路径。
/// - `source_trace_id` - 前端写入追踪 ID（可选）。
/// - `state` - 应用共享状态。
///
/// # 返回
/// - 成功返回 `Ok(())`。
///
/// # 副作用
/// - 删除文件系统中的目标文件。
/// - 注册写入追踪以防止文件监听器重复通知前端。
pub fn delete_vault_binary_file(
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

/// 将文件名拆分为名称主体和扩展名部分。
///
/// # 参数
/// - `name` - 文件名。
///
/// # 返回
/// - `(stem, extension)` 元组；无扩展名时 extension 为空字符串。
fn split_name_extension(name: &str) -> (&str, &str) {
    if let Some(dot_pos) = name.rfind('.') {
        if dot_pos > 0 {
            return (&name[..dot_pos], &name[dot_pos + 1..]);
        }
    }
    (name, "")
}

/// 在目标目录下为复制操作生成不冲突的文件名路径。
///
/// 若 `target_dir/source_name` 不存在，直接返回。
/// 否则依次尝试 `stem (copy 1).ext`、`stem (copy 2).ext`，
/// 直到找到不冲突的路径。
///
/// # 参数
/// - `target_dir` - 目标目录绝对路径。
/// - `source_name` - 原始文件/目录名。
///
/// # 返回
/// - 不冲突的绝对路径。
fn resolve_copy_target_path(target_dir: &Path, source_name: &str) -> PathBuf {
    let target = target_dir.join(source_name);
    if !target.exists() {
        return target;
    }

    let (stem, ext) = split_name_extension(source_name);

    for i in 1..=10000 {
        let candidate_name = if ext.is_empty() {
            format!("{stem} (copy {i})")
        } else {
            format!("{stem} (copy {i}).{ext}")
        };
        let candidate = target_dir.join(&candidate_name);
        if !candidate.exists() {
            return candidate;
        }
    }

    // 极端情况回退：带时间戳
    let ts = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let fallback_name = if ext.is_empty() {
        format!("{stem} (copy {ts})")
    } else {
        format!("{stem} (copy {ts}).{ext}")
    };
    target_dir.join(fallback_name)
}

/// 递归复制目录及其全部子项。
///
/// # 参数
/// - `source` - 源目录绝对路径。
/// - `target` - 目标目录绝对路径（尚不存在时自动创建）。
///
/// # 异常
/// - 创建目录或复制文件失败时返回错误描述。
fn copy_dir_recursive(source: &Path, target: &Path) -> Result<(), String> {
    fs::create_dir_all(target).map_err(|e| format!("创建目录失败 {}: {e}", target.display()))?;

    let entries =
        fs::read_dir(source).map_err(|e| format!("读取目录失败 {}: {e}", source.display()))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("读取目录项失败: {e}"))?;
        let src = entry.path();
        let dest = target.join(entry.file_name());

        if src.is_dir() {
            copy_dir_recursive(&src, &dest)?;
        } else {
            fs::copy(&src, &dest).map_err(|e| {
                format!("复制文件失败 {} -> {}: {e}", src.display(), dest.display())
            })?;
        }
    }

    Ok(())
}

/// 在指定 vault 根目录下复制文件或目录到目标目录。
///
/// 当目标目录下已存在同名文件/目录时，自动添加 `(copy N)` 后缀。
///
/// # 参数
/// - `source_relative_path` - 源文件/目录的相对路径。
/// - `target_directory_relative_path` - 目标目录的相对路径（空字符串表示 vault 根）。
/// - `vault_root` - vault 根目录绝对路径。
///
/// # 返回
/// - 成功时返回 `CopyEntryResponse`，含新路径和原路径。
///
/// # 异常
/// - 源不存在、目标目录无效、复制操作失败时返回错误。
pub fn copy_vault_entry_in_root(
    source_relative_path: &str,
    target_directory_relative_path: &str,
    vault_root: &Path,
) -> Result<CopyEntryResponse, String> {
    println!(
        "[vault] copy_vault_entry start: source={} target_dir={}",
        source_relative_path, target_directory_relative_path
    );

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
            .map_err(|e| format!("创建目标目录失败 {}: {e}", target_dir.display()))?;
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
        fs::copy(&source_path, &target_path).map_err(|e| {
            format!(
                "复制文件失败 {} -> {}: {e}",
                source_path.display(),
                target_path.display()
            )
        })?;
    }

    let new_relative_path = target_path
        .strip_prefix(vault_root)
        .map_err(|e| format!("计算新相对路径失败 {}: {e}", target_path.display()))?
        .to_string_lossy()
        .replace('\\', "/");

    println!(
        "[vault] copy_vault_entry success: {} -> {}",
        source_relative_path, new_relative_path
    );

    Ok(CopyEntryResponse {
        relative_path: new_relative_path,
        source_relative_path: source_relative_path.to_string(),
    })
}

/// 在当前仓库中复制文件或目录到目标目录。
///
/// # 副作用
/// - 在文件系统中创建新文件/目录。
/// - 注册写入 trace 以供 watcher 过滤自触发事件。
pub fn copy_vault_entry(
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
