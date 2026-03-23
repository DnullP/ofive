//! # Vault 运行时基础设施模块
//!
//! 提供当前 vault 生命周期管理、配置读写、目录树读取与只读文件访问，
//! 作为应用服务层与底层文件系统实现之间的基础设施边界。

use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, State};

use crate::infra::fs::fs_helpers::{
    canonicalize_vault_path, collect_tree_entries, detect_mime_type,
    resolve_existing_vault_file_path, resolve_markdown_path,
};
use crate::infra::fs::watcher;
use crate::infra::persistence::vault_config_store::{
    ensure_vault_config_file, load_vault_config,
};
use crate::infra::query::query_index;
use crate::shared::vault_contracts::{
    ReadBinaryFileResponse, ReadMarkdownResponse, SetVaultResponse, VaultConfig,
    VaultTreeResponse,
};
use crate::state::{get_vault_root, set_vault_root, AppState};

/// 预校验并规范化当前 vault 路径。
pub(crate) fn set_current_vault_precheck(vault_path: String) -> Result<SetVaultResponse, String> {
    log::info!("[vault] set_current_vault_precheck start: {}", vault_path);
    let canonical = canonicalize_vault_path(&vault_path)?;
    ensure_vault_config_file(&canonical)?;
    Ok(SetVaultResponse {
        vault_path: canonical.to_string_lossy().to_string(),
    })
}

/// 设置当前工作仓库并安装 watcher、刷新索引。
pub(crate) fn set_current_vault(
    vault_path: String,
    app_handle: AppHandle,
    state: State<'_, AppState>,
) -> Result<SetVaultResponse, String> {
    log::info!("[vault] set_current_vault start: {}", vault_path);
    let prechecked = set_current_vault_precheck(vault_path)?;
    let canonical = PathBuf::from(&prechecked.vault_path);

    let vault_changed = {
        let guard = state
            .current_vault
            .lock()
            .map_err(|error| format!("读取 vault 状态失败: {error}"))?;
        guard.as_ref() != Some(&canonical)
    };

    if vault_changed {
        set_vault_root(&state, canonical.clone())?;

        let effective_path = canonical.to_string_lossy().to_string();

        watcher::install_vault_watcher(&app_handle, &state, &canonical)?;
        query_index::ensure_query_index_current(&canonical)?;
        crate::infra::logging::set_vault_log_path(Some(canonical.join(".ofive")));

        log::info!(
            "[vault] set_current_vault success (changed): {}",
            effective_path
        );

        Ok(SetVaultResponse {
            vault_path: effective_path,
        })
    } else {
        let effective_path = canonical.to_string_lossy().to_string();
        log::info!(
            "[vault] set_current_vault success (unchanged, skip reindex): {}",
            effective_path
        );
        Ok(SetVaultResponse {
            vault_path: effective_path,
        })
    }
}

/// 在指定 vault 根目录下读取配置。
pub(crate) fn get_current_vault_config_in_root(vault_root: &Path) -> Result<VaultConfig, String> {
    log::info!("[vault-config] get_current_vault_config start");
    let config = load_vault_config(vault_root)?;
    log::info!(
        "[vault-config] get_current_vault_config success: schema_version={}",
        config.schema_version
    );
    Ok(config)
}

/// 读取当前仓库配置。
pub(crate) fn get_current_vault_config(state: State<'_, AppState>) -> Result<VaultConfig, String> {
    let root = get_vault_root(&state)?;
    get_current_vault_config_in_root(&root)
}

/// 在指定 vault 根目录下读取目录树。
pub(crate) fn get_current_vault_tree_in_root(
    vault_root: &Path,
) -> Result<VaultTreeResponse, String> {
    log::info!("[vault] get_current_vault_tree start");

    let mut entries = Vec::new();
    collect_tree_entries(vault_root, vault_root, &mut entries)?;
    entries.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));

    log::info!(
        "[vault] get_current_vault_tree success: {} entries",
        entries.len()
    );

    Ok(VaultTreeResponse {
        vault_path: vault_root.to_string_lossy().to_string(),
        entries,
    })
}

/// 读取当前仓库目录树。
pub(crate) fn get_current_vault_tree(
    state: State<'_, AppState>,
) -> Result<VaultTreeResponse, String> {
    let root = get_vault_root(&state)?;
    get_current_vault_tree_in_root(&root)
}

/// 在指定 vault 根目录下读取 Markdown 文件。
pub(crate) fn read_vault_markdown_file_in_root(
    relative_path: String,
    vault_root: &Path,
) -> Result<ReadMarkdownResponse, String> {
    log::info!(
        "[vault] read_vault_markdown_file start: relative_path={}",
        relative_path
    );
    let target_path = resolve_markdown_path(vault_root, &relative_path)?;

    let content = fs::read_to_string(&target_path)
        .map_err(|error| format!("读取 Markdown 文件失败 {}: {error}", target_path.display()))?;

    log::info!(
        "[vault] read_vault_markdown_file success: bytes={}",
        content.len()
    );

    Ok(ReadMarkdownResponse {
        relative_path,
        content,
    })
}

/// 读取当前仓库中的 Markdown 文件。
pub(crate) fn read_vault_markdown_file(
    relative_path: String,
    state: State<'_, AppState>,
) -> Result<ReadMarkdownResponse, String> {
    let root = get_vault_root(&state)?;
    read_vault_markdown_file_in_root(relative_path, &root)
}

/// 在指定 vault 根目录下读取二进制文件。
pub(crate) fn read_vault_binary_file_in_root(
    relative_path: String,
    vault_root: &Path,
) -> Result<ReadBinaryFileResponse, String> {
    log::info!(
        "[vault] read_vault_binary_file start: relative_path={}",
        relative_path
    );
    let target_path = resolve_existing_vault_file_path(vault_root, &relative_path)?;
    let mime_type = detect_mime_type(&target_path).to_string();

    let content = fs::read(&target_path)
        .map_err(|error| format!("读取二进制文件失败 {}: {error}", target_path.display()))?;
    let base64_content = BASE64_STANDARD.encode(content);

    log::info!(
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

/// 读取当前仓库中的二进制文件。
pub(crate) fn read_vault_binary_file(
    relative_path: String,
    state: State<'_, AppState>,
) -> Result<ReadBinaryFileResponse, String> {
    let root = get_vault_root(&state)?;
    read_vault_binary_file_in_root(relative_path, &root)
}
