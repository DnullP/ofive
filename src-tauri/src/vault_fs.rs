//! # 仓库文件监听模块
//!
//! 提供仓库文件系统监听与事件派发能力。

use crate::state::AppState;
use notify::{
    event::{ModifyKind, RenameMode},
    Event, EventKind, RecursiveMode, Watcher,
};
use serde::Serialize;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, State};

/// 文件系统事件名称，供前端订阅。
pub const VAULT_FS_EVENT_NAME: &str = "vault://fs-event";
/// 配置文件事件名称，供前端配置模块订阅。
pub const VAULT_CONFIG_EVENT_NAME: &str = "vault://config-event";

/// 文件系统事件自增序列，用于生成全局唯一事件ID（单进程内）。
static VAULT_FS_EVENT_SEQ: AtomicU64 = AtomicU64::new(1);

/// 对外返回的文件系统变更事件负载。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct VaultFsEventPayload {
    /// 事件唯一ID（贯穿前后端处理链路）。
    event_id: String,
    /// 事件来源链路ID（前端保存命令的 trace_id 回填值）。
    source_trace_id: Option<String>,
    /// 事件类型（created/modified/deleted/moved）。
    event_type: String,
    /// 变更目标路径（相对 vault 根目录）。
    relative_path: Option<String>,
    /// 移动场景下的旧路径。
    old_relative_path: Option<String>,
}

/// 配置文件变更事件负载。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct VaultConfigEventPayload {
    /// 事件唯一ID。
    event_id: String,
    /// 来源链路ID（预留字段）。
    source_trace_id: Option<String>,
    /// 事件类型（created/modified/deleted/moved）。
    event_type: String,
    /// 变更目标路径。
    relative_path: Option<String>,
    /// 移动场景下的旧路径。
    old_relative_path: Option<String>,
}

fn is_config_file_path(path: &str) -> bool {
    path == ".ofive/config.json"
}

fn is_internal_system_path(path: &str) -> bool {
    path == ".ofive" || path.starts_with(".ofive/")
}

/// 将绝对路径转换为 vault 根目录下的相对路径。
fn to_relative_path(path: &Path, root: &Path) -> Option<String> {
    let normalized = if let Ok(relative) = path.strip_prefix(root) {
        relative.to_path_buf()
    } else if let Ok(canonical) = path.canonicalize() {
        if let Ok(relative) = canonical.strip_prefix(root) {
            relative.to_path_buf()
        } else {
            return None;
        }
    } else {
        return None;
    };

    Some(normalized.to_string_lossy().replace('\\', "/"))
}

/// 生成文件系统事件ID。
fn next_vault_fs_event_id() -> String {
    format!(
        "vault-fs-{}",
        VAULT_FS_EVENT_SEQ.fetch_add(1, Ordering::Relaxed)
    )
}

/// 派发后端文件系统事件到前端。
fn emit_vault_fs_event(app_handle: &AppHandle, payload: VaultFsEventPayload) {
    if let Err(error) = app_handle.emit(VAULT_FS_EVENT_NAME, payload.clone()) {
        log::warn!("[vault-watch] emit event failed: {error}");
        return;
    }

    log::info!(
        "[vault-watch] event emitted: id={} type={} path={:?} old_path={:?} source_trace_id={:?}",
        payload.event_id,
        payload.event_type,
        payload.relative_path,
        payload.old_relative_path,
        payload.source_trace_id
    );
}

fn emit_vault_config_event(app_handle: &AppHandle, payload: VaultConfigEventPayload) {
    if let Err(error) = app_handle.emit(VAULT_CONFIG_EVENT_NAME, payload.clone()) {
        log::warn!("[vault-config-watch] emit event failed: {error}");
        return;
    }

    log::info!(
        "[vault-config-watch] event emitted: id={} type={} path={:?} old_path={:?} source_trace_id={:?}",
        payload.event_id,
        payload.event_type,
        payload.relative_path,
        payload.old_relative_path,
        payload.source_trace_id
    );
}

fn maybe_emit_config_event(
    app_handle: &AppHandle,
    event_type: &str,
    source_trace_id: Option<String>,
    relative_path: Option<String>,
    old_relative_path: Option<String>,
) {
    let should_emit = relative_path.as_deref().is_some_and(is_config_file_path)
        || old_relative_path
            .as_deref()
            .is_some_and(is_config_file_path);

    if !should_emit {
        return;
    }

    emit_vault_config_event(
        app_handle,
        VaultConfigEventPayload {
            event_id: next_vault_fs_event_id(),
            source_trace_id,
            event_type: event_type.to_string(),
            relative_path,
            old_relative_path,
        },
    );
}

/// 归一化相对路径键，确保与保存侧路径索引一致。
fn normalize_relative_path_key(relative_path: &str) -> String {
    relative_path.replace('\\', "/")
}

fn now_unix_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

/// 根据相对路径消费待回填 traceId。
fn take_pending_trace_id(app_handle: &AppHandle, relative_path: Option<&str>) -> Option<String> {
    let path = relative_path?.trim();
    if path.is_empty() {
        return None;
    }

    let now_ms = now_unix_ms();
    let key = normalize_relative_path_key(path);
    let state = app_handle.state::<AppState>();
    let mut pending_trace_map = match state.pending_vault_write_trace_by_path.lock() {
        Ok(guard) => guard,
        Err(error) => {
            log::warn!("[vault-watch] read trace map failed: {error}");
            return None;
        }
    };

    pending_trace_map.retain(|_, pending| pending.expire_at_unix_ms > now_ms);

    pending_trace_map
        .get(&key)
        .map(|pending| pending.trace_id.clone())
}

fn resolve_pending_trace_id_for_move(
    app_handle: &AppHandle,
    to_relative_path: Option<&str>,
    from_relative_path: Option<&str>,
) -> Option<String> {
    take_pending_trace_id(app_handle, to_relative_path)
        .or_else(|| take_pending_trace_id(app_handle, from_relative_path))
}

/// 处理 notify 原始事件并归类为前端可消费的统一事件。
fn handle_notify_event(app_handle: &AppHandle, root: &Path, event: Event) {
    match event.kind {
        EventKind::Create(_) => {
            event.paths.iter().for_each(|path| {
                let relative_path = to_relative_path(path, root);
                if relative_path
                    .as_deref()
                    .is_some_and(is_internal_system_path)
                {
                    return;
                }
                let source_trace_id = take_pending_trace_id(app_handle, relative_path.as_deref());
                emit_vault_fs_event(
                    app_handle,
                    VaultFsEventPayload {
                        event_id: next_vault_fs_event_id(),
                        source_trace_id: source_trace_id.clone(),
                        event_type: "created".to_string(),
                        relative_path: relative_path.clone(),
                        old_relative_path: None,
                    },
                );
                maybe_emit_config_event(
                    app_handle,
                    "created",
                    source_trace_id,
                    relative_path,
                    None,
                );
            });
        }
        EventKind::Modify(ModifyKind::Name(rename_mode)) => {
            // 提取事件携带的路径（位置语义取决于 rename_mode）。
            let first_abs_path = event.paths.first();
            let second_abs_path = event.paths.get(1);
            let first_relative = first_abs_path.and_then(|p| to_relative_path(p, root));
            let second_relative = second_abs_path.and_then(|p| to_relative_path(p, root));

            // 跳过 .ofive/ 内部路径的重命名事件。
            let hits_internal = first_relative
                .as_deref()
                .is_some_and(is_internal_system_path)
                || second_relative
                    .as_deref()
                    .is_some_and(is_internal_system_path);
            if hits_internal {
                return;
            }

            match rename_mode {
                RenameMode::Both => {
                    // Both：first=旧路径，second=新路径 → "moved"
                    let source_trace_id = resolve_pending_trace_id_for_move(
                        app_handle,
                        second_relative.as_deref(),
                        first_relative.as_deref(),
                    );
                    emit_vault_fs_event(
                        app_handle,
                        VaultFsEventPayload {
                            event_id: next_vault_fs_event_id(),
                            source_trace_id: source_trace_id.clone(),
                            event_type: "moved".to_string(),
                            relative_path: second_relative.clone(),
                            old_relative_path: first_relative.clone(),
                        },
                    );
                    maybe_emit_config_event(
                        app_handle,
                        "moved",
                        source_trace_id,
                        second_relative,
                        first_relative,
                    );
                }
                RenameMode::From => {
                    // From：first=被移走的旧路径 → "deleted"
                    let source_trace_id =
                        take_pending_trace_id(app_handle, first_relative.as_deref());
                    emit_vault_fs_event(
                        app_handle,
                        VaultFsEventPayload {
                            event_id: next_vault_fs_event_id(),
                            source_trace_id: source_trace_id.clone(),
                            event_type: "deleted".to_string(),
                            relative_path: first_relative.clone(),
                            old_relative_path: None,
                        },
                    );
                    maybe_emit_config_event(
                        app_handle,
                        "deleted",
                        source_trace_id,
                        first_relative,
                        None,
                    );
                }
                RenameMode::To => {
                    // To：first=出现的新路径（目标位置）→ "created"
                    let source_trace_id =
                        take_pending_trace_id(app_handle, first_relative.as_deref());
                    emit_vault_fs_event(
                        app_handle,
                        VaultFsEventPayload {
                            event_id: next_vault_fs_event_id(),
                            source_trace_id: source_trace_id.clone(),
                            event_type: "created".to_string(),
                            relative_path: first_relative.clone(),
                            old_relative_path: None,
                        },
                    );
                    maybe_emit_config_event(
                        app_handle,
                        "created",
                        source_trace_id,
                        first_relative,
                        None,
                    );
                }
                RenameMode::Any => {
                    // Any：平台不区分 From/To/Both，需要自行推断语义。
                    if first_relative.is_some() && second_relative.is_some() {
                        // 双路径 → first=旧路径，second=新路径 → "moved"
                        let source_trace_id = resolve_pending_trace_id_for_move(
                            app_handle,
                            second_relative.as_deref(),
                            first_relative.as_deref(),
                        );
                        emit_vault_fs_event(
                            app_handle,
                            VaultFsEventPayload {
                                event_id: next_vault_fs_event_id(),
                                source_trace_id: source_trace_id.clone(),
                                event_type: "moved".to_string(),
                                relative_path: second_relative.clone(),
                                old_relative_path: first_relative.clone(),
                            },
                        );
                        maybe_emit_config_event(
                            app_handle,
                            "moved",
                            source_trace_id,
                            second_relative,
                            first_relative,
                        );
                    } else if let Some(abs_path) = first_abs_path {
                        // 单路径 → 根据路径是否仍存在于磁盘判定为目标（created）
                        // 还是来源（deleted）。macOS FSEvents 常产生此类事件。
                        let path_exists = abs_path.exists();
                        let event_type = if path_exists { "created" } else { "deleted" };
                        log::info!(
                            "[vault-watch] RenameMode::Any single-path: path={} exists={} → {}",
                            abs_path.display(),
                            path_exists,
                            event_type
                        );
                        let source_trace_id =
                            take_pending_trace_id(app_handle, first_relative.as_deref());
                        emit_vault_fs_event(
                            app_handle,
                            VaultFsEventPayload {
                                event_id: next_vault_fs_event_id(),
                                source_trace_id: source_trace_id.clone(),
                                event_type: event_type.to_string(),
                                relative_path: first_relative.clone(),
                                old_relative_path: None,
                            },
                        );
                        maybe_emit_config_event(
                            app_handle,
                            event_type,
                            source_trace_id,
                            first_relative,
                            None,
                        );
                    }
                }
                _ => {}
            }
        }
        EventKind::Modify(_) => {
            event.paths.iter().for_each(|path| {
                let relative_path = to_relative_path(path, root);
                if relative_path
                    .as_deref()
                    .is_some_and(is_internal_system_path)
                {
                    return;
                }
                let source_trace_id = take_pending_trace_id(app_handle, relative_path.as_deref());
                emit_vault_fs_event(
                    app_handle,
                    VaultFsEventPayload {
                        event_id: next_vault_fs_event_id(),
                        source_trace_id: source_trace_id.clone(),
                        event_type: "modified".to_string(),
                        relative_path: relative_path.clone(),
                        old_relative_path: None,
                    },
                );
                maybe_emit_config_event(
                    app_handle,
                    "modified",
                    source_trace_id,
                    relative_path,
                    None,
                );
            });
        }
        EventKind::Remove(_) => {
            event.paths.iter().for_each(|path| {
                let relative_path = to_relative_path(path, root).or_else(|| {
                    path.to_string_lossy()
                        .strip_prefix(&format!("{}{}", root.display(), std::path::MAIN_SEPARATOR))
                        .map(|item| item.replace('\\', "/"))
                });
                if relative_path
                    .as_deref()
                    .is_some_and(is_internal_system_path)
                {
                    return;
                }
                let source_trace_id = take_pending_trace_id(app_handle, relative_path.as_deref());
                emit_vault_fs_event(
                    app_handle,
                    VaultFsEventPayload {
                        event_id: next_vault_fs_event_id(),
                        source_trace_id: source_trace_id.clone(),
                        event_type: "deleted".to_string(),
                        relative_path: relative_path.clone(),
                        old_relative_path: None,
                    },
                );
                maybe_emit_config_event(
                    app_handle,
                    "deleted",
                    source_trace_id,
                    relative_path,
                    None,
                );
            });
        }
        _ => {}
    }
}

/// 安装并切换当前 vault 目录监听器。
pub fn install_vault_watcher(
    app_handle: &AppHandle,
    state: &State<'_, AppState>,
    vault_root: &Path,
) -> Result<(), String> {
    let root = vault_root.to_path_buf();
    let app_handle = app_handle.clone();

    let mut watcher =
        notify::recommended_watcher(move |result: Result<Event, notify::Error>| match result {
            Ok(event) => {
                handle_notify_event(&app_handle, &root, event);
            }
            Err(error) => {
                log::warn!("[vault-watch] watch callback error: {error}");
            }
        })
        .map_err(|error| format!("创建文件监听器失败: {error}"))?;

    watcher
        .watch(vault_root, RecursiveMode::Recursive)
        .map_err(|error| format!("监听目录失败 {}: {error}", vault_root.display()))?;

    let mut guard = state
        .vault_watcher
        .lock()
        .map_err(|error| format!("写入 watcher 状态失败: {error}"))?;
    *guard = Some(watcher);

    log::info!("[vault-watch] watcher installed: {}", vault_root.display());
    Ok(())
}
