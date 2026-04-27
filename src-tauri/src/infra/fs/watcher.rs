//! # Vault Watcher 基础设施模块
//!
//! 提供 vault 文件系统监听、事件归一化与前端事件派发能力，
//! 作为应用层与底层 `notify` watcher 之间的基础设施边界。

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
pub(crate) const VAULT_FS_EVENT_NAME: &str = "vault://fs-event";
/// 配置文件事件名称，供前端配置模块订阅。
pub(crate) const VAULT_CONFIG_EVENT_NAME: &str = "vault://config-event";

/// 文件系统事件自增序列，用于生成全局唯一事件 ID。
static VAULT_FS_EVENT_SEQ: AtomicU64 = AtomicU64::new(1);

/// 对外返回的文件系统变更事件负载。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct VaultFsEventPayload {
    /// 事件唯一 ID。
    event_id: String,
    /// 事件来源链路 ID。
    source_trace_id: Option<String>,
    /// 事件类型（created/modified/deleted/moved）。
    event_type: String,
    /// 变更目标路径。
    relative_path: Option<String>,
    /// 移动场景下的旧路径。
    old_relative_path: Option<String>,
}

/// 配置文件变更事件负载。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct VaultConfigEventPayload {
    /// 事件唯一 ID。
    event_id: String,
    /// 来源链路 ID。
    source_trace_id: Option<String>,
    /// 事件类型。
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

fn next_vault_fs_event_id() -> String {
    format!(
        "vault-fs-{}",
        VAULT_FS_EVENT_SEQ.fetch_add(1, Ordering::Relaxed)
    )
}

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

fn normalize_relative_path_key(relative_path: &str) -> String {
    relative_path.replace('\\', "/")
}

fn now_unix_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or(0)
}

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
            let first_abs_path = event.paths.first();
            let second_abs_path = event.paths.get(1);
            let first_relative = first_abs_path.and_then(|path| to_relative_path(path, root));
            let second_relative = second_abs_path.and_then(|path| to_relative_path(path, root));

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
                    if first_relative.is_some() && second_relative.is_some() {
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
                        let path_exists = abs_path.exists();
                        let event_type = if path_exists { "created" } else { "deleted" };
                        log::info!(
                            "[vault-watch] RenameMode::Any single-path: path={} exists={} -> {}",
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
pub(crate) fn install_vault_watcher(
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

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::Path;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::{
        is_config_file_path, is_internal_system_path, normalize_relative_path_key, to_relative_path,
    };

    static TEST_ROOT_SEQ: AtomicU64 = AtomicU64::new(1);

    fn create_test_root() -> std::path::PathBuf {
        let sequence = TEST_ROOT_SEQ.fetch_add(1, Ordering::Relaxed);
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0);
        let root = std::env::temp_dir().join(format!("ofive-watcher-test-{unique}-{sequence}"));
        fs::create_dir_all(root.join("nested")).expect("应成功创建测试目录");
        root
    }

    #[test]
    fn helpers_detect_internal_and_config_paths() {
        assert!(is_config_file_path(".ofive/config.json"));
        assert!(!is_config_file_path("notes/a.md"));
        assert!(is_internal_system_path(".ofive"));
        assert!(is_internal_system_path(".ofive/config.json"));
        assert!(!is_internal_system_path("notes/.ofive.md"));
    }

    #[test]
    fn normalize_relative_path_key_rewrites_backslashes() {
        assert_eq!(normalize_relative_path_key("notes\\a.md"), "notes/a.md");
    }

    #[test]
    fn to_relative_path_returns_normalized_relative_value() {
        let root = create_test_root();
        let file_path = root.join(Path::new("nested/demo.md"));
        fs::write(&file_path, "hello").expect("应成功写入测试文件");

        let relative = to_relative_path(&file_path, &root).expect("应成功计算相对路径");
        assert_eq!(relative, "nested/demo.md");

        let _ = fs::remove_dir_all(root);
    }
}
