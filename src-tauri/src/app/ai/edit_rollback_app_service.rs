//! AI edit rollback orchestration.

use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::Value;

use crate::domain::capability::{build_builtin_capability_registry, CapabilityKind};
use crate::infra::persistence::ai_chat_rollback_store::{
    append_ai_chat_edit_rollback_record, load_ai_chat_edit_rollback_records,
    AiChatEditRollbackRecord, AiChatEditRollbackSnapshot, AiChatEditRollbackSnapshotKind,
};
use crate::shared::ai_service::AiChatRollbackRestoreResponse;

static AI_CHAT_EDIT_ROLLBACK_RECORD_SEQ: AtomicU64 = AtomicU64::new(1);

/// Record pre-images for one AI capability call before the tool mutates the vault.
pub(crate) fn record_ai_chat_capability_rollback_checkpoint(
    vault_root: &Path,
    checkpoint_id: Option<&str>,
    capability_id: &str,
    input: &Value,
) -> Result<bool, String> {
    let Some(checkpoint_id) = checkpoint_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return Ok(false);
    };

    let Some(snapshots) = plan_capability_snapshots(vault_root, capability_id, input)? else {
        return Ok(false);
    };

    if snapshots.is_empty() {
        return Ok(false);
    }

    append_ai_chat_edit_rollback_record(
        vault_root,
        checkpoint_id,
        AiChatEditRollbackRecord {
            id: next_rollback_record_id(),
            created_at_unix_ms: now_unix_ms(),
            capability_id: capability_id.trim().to_string(),
            snapshots,
        },
    )?;
    Ok(true)
}

/// Restore the vault to the pre-image recorded for one AI chat turn.
pub(crate) fn restore_ai_chat_rollback_checkpoint_in_root(
    vault_root: &Path,
    checkpoint_id: String,
) -> Result<AiChatRollbackRestoreResponse, String> {
    let checkpoint_id = checkpoint_id.trim().to_string();
    if checkpoint_id.is_empty() {
        return Err("rollback checkpoint id 不能为空".to_string());
    }

    let records = load_ai_chat_edit_rollback_records(vault_root, &checkpoint_id)?;
    let mut response = AiChatRollbackRestoreResponse {
        checkpoint_id,
        restored_paths: Vec::new(),
        deleted_paths: Vec::new(),
        skipped_paths: Vec::new(),
    };

    for record in records.iter().rev() {
        restore_record(vault_root, record, &mut response)?;
    }

    response.restored_paths.sort();
    response.restored_paths.dedup();
    response.deleted_paths.sort();
    response.deleted_paths.dedup();
    response.skipped_paths.sort();
    response.skipped_paths.dedup();
    Ok(response)
}

fn plan_capability_snapshots(
    vault_root: &Path,
    capability_id: &str,
    input: &Value,
) -> Result<Option<Vec<AiChatEditRollbackSnapshot>>, String> {
    let capability_id = capability_id.trim();
    let mut snapshots = Vec::new();

    match capability_id {
        "vault.create_markdown_file" | "vault.save_markdown_file" => {
            let relative_path = input_string(input, "relativePath", capability_id)?;
            push_file_with_parent_snapshots(vault_root, &relative_path, &mut snapshots)?;
        }
        "vault.apply_markdown_patch" => {
            let relative_path = input_string(input, "relativePath", capability_id)?;
            push_snapshot(
                vault_root,
                &relative_path,
                AiChatEditRollbackSnapshotKind::File,
                &mut snapshots,
            )?;
        }
        "vault.update_task" => {
            let relative_path = input_string(input, "relativePath", capability_id)?;
            push_snapshot(
                vault_root,
                &relative_path,
                AiChatEditRollbackSnapshotKind::File,
                &mut snapshots,
            )?;
        }
        "vault.save_canvas_document" => {
            let relative_path = input_string(input, "relativePath", capability_id)?;
            push_file_with_parent_snapshots(vault_root, &relative_path, &mut snapshots)?;
        }
        "vault.rename_markdown_file" => {
            let from_relative_path = input_string(input, "fromRelativePath", capability_id)?;
            let to_relative_path = input_string(input, "toRelativePath", capability_id)?;
            push_parent_directory_snapshots(vault_root, &to_relative_path, &mut snapshots)?;
            push_snapshot(
                vault_root,
                &from_relative_path,
                AiChatEditRollbackSnapshotKind::File,
                &mut snapshots,
            )?;
            push_snapshot(
                vault_root,
                &to_relative_path,
                AiChatEditRollbackSnapshotKind::File,
                &mut snapshots,
            )?;
        }
        "vault.delete_markdown_file" => {
            let relative_path = input_string(input, "relativePath", capability_id)?;
            push_snapshot(
                vault_root,
                &relative_path,
                AiChatEditRollbackSnapshotKind::File,
                &mut snapshots,
            )?;
        }
        "vault.create_directory" => {
            let relative_path = input_string(input, "relativeDirectoryPath", capability_id)?;
            push_directory_with_parent_snapshots(vault_root, &relative_path, &mut snapshots)?;
        }
        "agent_skill.create" => {
            let skill_name =
                normalize_skill_name(&input_string(input, "skillName", capability_id)?)?;
            let skill_root = format!(".ofive/skills/{skill_name}");
            push_directory_with_parent_snapshots(vault_root, &skill_root, &mut snapshots)?;
            push_snapshot(
                vault_root,
                &format!("{skill_root}/references"),
                AiChatEditRollbackSnapshotKind::Directory,
                &mut snapshots,
            )?;
            push_snapshot(
                vault_root,
                &format!("{skill_root}/SKILL.md"),
                AiChatEditRollbackSnapshotKind::File,
                &mut snapshots,
            )?;
        }
        "agent_skill.write_file" => {
            let skill_name =
                normalize_skill_name(&input_string(input, "skillName", capability_id)?)?;
            let skill_file_relative_path = normalize_skill_file_relative_path(&input_string(
                input,
                "relativePath",
                capability_id,
            )?)?;
            push_file_with_parent_snapshots(
                vault_root,
                &format!(".ofive/skills/{skill_name}/{skill_file_relative_path}"),
                &mut snapshots,
            )?;
        }
        _ if is_registered_write_capability(capability_id) => {
            return Err(format!(
                "AI 写能力 {} 尚未接入 edit rollback，已阻止未记录的写入",
                capability_id
            ));
        }
        _ => return Ok(None),
    }

    Ok(Some(snapshots))
}

fn restore_record(
    vault_root: &Path,
    record: &AiChatEditRollbackRecord,
    response: &mut AiChatRollbackRestoreResponse,
) -> Result<(), String> {
    for snapshot in record.snapshots.iter().rev() {
        if snapshot.kind == AiChatEditRollbackSnapshotKind::File && !snapshot.existed {
            delete_file_if_present(vault_root, snapshot, response)?;
        }
    }

    for snapshot in record.snapshots.iter() {
        if snapshot.kind == AiChatEditRollbackSnapshotKind::File && snapshot.existed {
            restore_file(vault_root, snapshot, response)?;
        }
    }

    for snapshot in record.snapshots.iter() {
        if snapshot.kind == AiChatEditRollbackSnapshotKind::Directory && snapshot.existed {
            restore_directory(vault_root, snapshot, response)?;
        }
    }

    for snapshot in record.snapshots.iter().rev() {
        if snapshot.kind == AiChatEditRollbackSnapshotKind::Directory && !snapshot.existed {
            delete_empty_directory_if_present(vault_root, snapshot, response)?;
        }
    }

    Ok(())
}

fn delete_file_if_present(
    vault_root: &Path,
    snapshot: &AiChatEditRollbackSnapshot,
    response: &mut AiChatRollbackRestoreResponse,
) -> Result<(), String> {
    let path = resolve_vault_relative_path(vault_root, &snapshot.relative_path)?;
    if !path.exists() {
        return Ok(());
    }
    if !path.is_file() {
        response.skipped_paths.push(snapshot.relative_path.clone());
        return Ok(());
    }
    fs::remove_file(&path)
        .map_err(|error| format!("删除 AI 创建文件失败 {}: {error}", path.display()))?;
    response.deleted_paths.push(snapshot.relative_path.clone());
    Ok(())
}

fn restore_file(
    vault_root: &Path,
    snapshot: &AiChatEditRollbackSnapshot,
    response: &mut AiChatRollbackRestoreResponse,
) -> Result<(), String> {
    let path = resolve_vault_relative_path(vault_root, &snapshot.relative_path)?;
    if path.exists() && !path.is_file() {
        response.skipped_paths.push(snapshot.relative_path.clone());
        return Ok(());
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("创建回滚文件父目录失败 {}: {error}", parent.display()))?;
    }
    let content = snapshot.content.as_deref().unwrap_or_default();
    fs::write(&path, content.as_bytes())
        .map_err(|error| format!("恢复 AI 修改文件失败 {}: {error}", path.display()))?;
    response.restored_paths.push(snapshot.relative_path.clone());
    Ok(())
}

fn restore_directory(
    vault_root: &Path,
    snapshot: &AiChatEditRollbackSnapshot,
    response: &mut AiChatRollbackRestoreResponse,
) -> Result<(), String> {
    let path = resolve_vault_relative_path(vault_root, &snapshot.relative_path)?;
    if path.exists() && !path.is_dir() {
        response.skipped_paths.push(snapshot.relative_path.clone());
        return Ok(());
    }
    fs::create_dir_all(&path)
        .map_err(|error| format!("恢复 AI 回滚目录失败 {}: {error}", path.display()))?;
    response.restored_paths.push(snapshot.relative_path.clone());
    Ok(())
}

fn delete_empty_directory_if_present(
    vault_root: &Path,
    snapshot: &AiChatEditRollbackSnapshot,
    response: &mut AiChatRollbackRestoreResponse,
) -> Result<(), String> {
    let path = resolve_vault_relative_path(vault_root, &snapshot.relative_path)?;
    if !path.exists() {
        return Ok(());
    }
    if !path.is_dir() {
        response.skipped_paths.push(snapshot.relative_path.clone());
        return Ok(());
    }
    match fs::remove_dir(&path) {
        Ok(()) => response.deleted_paths.push(snapshot.relative_path.clone()),
        Err(error) if error.kind() == std::io::ErrorKind::DirectoryNotEmpty => {
            response.skipped_paths.push(snapshot.relative_path.clone());
        }
        Err(error) => {
            return Err(format!("删除 AI 创建目录失败 {}: {error}", path.display()));
        }
    }
    Ok(())
}

fn push_file_with_parent_snapshots(
    vault_root: &Path,
    relative_path: &str,
    snapshots: &mut Vec<AiChatEditRollbackSnapshot>,
) -> Result<(), String> {
    push_parent_directory_snapshots(vault_root, relative_path, snapshots)?;
    push_snapshot(
        vault_root,
        relative_path,
        AiChatEditRollbackSnapshotKind::File,
        snapshots,
    )
}

fn push_directory_with_parent_snapshots(
    vault_root: &Path,
    relative_path: &str,
    snapshots: &mut Vec<AiChatEditRollbackSnapshot>,
) -> Result<(), String> {
    push_parent_directory_snapshots(vault_root, relative_path, snapshots)?;
    push_snapshot(
        vault_root,
        relative_path,
        AiChatEditRollbackSnapshotKind::Directory,
        snapshots,
    )
}

fn push_parent_directory_snapshots(
    vault_root: &Path,
    relative_path: &str,
    snapshots: &mut Vec<AiChatEditRollbackSnapshot>,
) -> Result<(), String> {
    let normalized = normalize_vault_relative_path(relative_path)?;
    let mut parts = normalized.split('/').collect::<Vec<_>>();
    parts.pop();

    let mut current = String::new();
    for part in parts {
        if current.is_empty() {
            current.push_str(part);
        } else {
            current.push('/');
            current.push_str(part);
        }
        if current == ".ofive" {
            continue;
        }
        push_snapshot(
            vault_root,
            &current,
            AiChatEditRollbackSnapshotKind::Directory,
            snapshots,
        )?;
    }
    Ok(())
}

fn push_snapshot(
    vault_root: &Path,
    relative_path: &str,
    kind: AiChatEditRollbackSnapshotKind,
    snapshots: &mut Vec<AiChatEditRollbackSnapshot>,
) -> Result<(), String> {
    let relative_path = normalize_vault_relative_path(relative_path)?;
    if snapshots
        .iter()
        .any(|snapshot| snapshot.relative_path == relative_path && snapshot.kind == kind)
    {
        return Ok(());
    }

    let absolute_path = resolve_vault_relative_path(vault_root, &relative_path)?;
    let snapshot = match kind {
        AiChatEditRollbackSnapshotKind::File => {
            if absolute_path.exists() {
                if !absolute_path.is_file() {
                    return Err(format!(
                        "AI edit rollback 期望文件但发现非文件: {relative_path}"
                    ));
                }
                AiChatEditRollbackSnapshot {
                    relative_path,
                    kind,
                    existed: true,
                    content: Some(fs::read_to_string(&absolute_path).map_err(|error| {
                        format!(
                            "读取 AI edit rollback 文件 pre-image 失败 {}: {error}",
                            absolute_path.display()
                        )
                    })?),
                }
            } else {
                AiChatEditRollbackSnapshot {
                    relative_path,
                    kind,
                    existed: false,
                    content: None,
                }
            }
        }
        AiChatEditRollbackSnapshotKind::Directory => {
            if absolute_path.exists() {
                if !absolute_path.is_dir() {
                    return Err(format!(
                        "AI edit rollback 期望目录但发现非目录: {relative_path}"
                    ));
                }
                AiChatEditRollbackSnapshot {
                    relative_path,
                    kind,
                    existed: true,
                    content: None,
                }
            } else {
                AiChatEditRollbackSnapshot {
                    relative_path,
                    kind,
                    existed: false,
                    content: None,
                }
            }
        }
    };

    snapshots.push(snapshot);
    Ok(())
}

fn input_string(input: &Value, field: &str, capability_id: &str) -> Result<String, String> {
    input
        .get(field)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .ok_or_else(|| format!("{} 缺少必填字段 {}", capability_id, field))
}

fn is_registered_write_capability(capability_id: &str) -> bool {
    build_builtin_capability_registry()
        .get(capability_id)
        .is_some_and(|descriptor| matches!(&descriptor.kind, CapabilityKind::Write))
}

fn resolve_vault_relative_path(vault_root: &Path, relative_path: &str) -> Result<PathBuf, String> {
    Ok(vault_root.join(normalize_vault_relative_path(relative_path)?))
}

fn normalize_vault_relative_path(path: &str) -> Result<String, String> {
    let trimmed = path.trim().replace('\\', "/");
    if trimmed.is_empty() {
        return Err("relative path 不能为空".to_string());
    }
    if trimmed.starts_with('/') {
        return Err("relative path 必须是相对路径".to_string());
    }

    let mut parts = Vec::new();
    for component in Path::new(&trimmed).components() {
        match component {
            Component::Normal(value) => {
                let Some(part) = value.to_str() else {
                    return Err("relative path 必须是 UTF-8".to_string());
                };
                if !part.is_empty() {
                    parts.push(part.to_string());
                }
            }
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err("relative path 不允许跳出 vault".to_string());
            }
        }
    }

    if parts.is_empty() {
        return Err("relative path 不能为空".to_string());
    }

    Ok(parts.join("/"))
}

fn normalize_skill_name(name: &str) -> Result<String, String> {
    let normalized = name.trim().to_string();
    if normalized.is_empty()
        || normalized.len() > 64
        || normalized.starts_with('-')
        || normalized.ends_with('-')
        || normalized.contains("--")
        || !normalized
            .chars()
            .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '-')
    {
        return Err("skillName 不符合命名规则".to_string());
    }
    Ok(normalized)
}

fn normalize_skill_file_relative_path(path: &str) -> Result<String, String> {
    let normalized = normalize_vault_relative_path(path)?;
    let first_segment = normalized.split('/').next().unwrap_or("");
    let allowed = normalized == "SKILL.md"
        || first_segment == "references"
        || first_segment == "assets"
        || first_segment == "scripts";
    if !allowed {
        return Err("SKILL 参考文件路径不在允许目录内".to_string());
    }
    if !(normalized.ends_with(".md") || normalized.ends_with(".markdown")) {
        return Err("SKILL 参考文件必须是 Markdown".to_string());
    }
    Ok(normalized)
}

fn next_rollback_record_id() -> String {
    let sequence = AI_CHAT_EDIT_ROLLBACK_RECORD_SEQ.fetch_add(1, Ordering::Relaxed);
    format!("ai-edit-rollback-record-{}-{sequence}", now_unix_ms())
}

fn now_unix_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::sync::atomic::{AtomicU64, Ordering};

    use serde_json::json;

    use super::{
        record_ai_chat_capability_rollback_checkpoint, restore_ai_chat_rollback_checkpoint_in_root,
    };

    static TEST_ROOT_SEQ: AtomicU64 = AtomicU64::new(1);

    fn create_test_root() -> std::path::PathBuf {
        let root = std::env::temp_dir().join(format!(
            "ofive-ai-edit-rollback-test-{}-{}",
            super::now_unix_ms(),
            TEST_ROOT_SEQ.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&root).expect("should create test root");
        root
    }

    fn write_file(root: &std::path::Path, relative_path: &str, content: &str) {
        let path = root.join(relative_path);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("should create parent");
        }
        fs::write(path, content).expect("should write file");
    }

    #[test]
    fn rollback_should_restore_saved_markdown_file() {
        let root = create_test_root();
        write_file(&root, "notes/a.md", "before");

        record_ai_chat_capability_rollback_checkpoint(
            &root,
            Some("checkpoint-1"),
            "vault.save_markdown_file",
            &json!({"relativePath": "notes/a.md", "content": "after"}),
        )
        .expect("record should succeed");
        write_file(&root, "notes/a.md", "after");

        let result = restore_ai_chat_rollback_checkpoint_in_root(&root, "checkpoint-1".to_string())
            .expect("restore should succeed");

        assert_eq!(
            fs::read_to_string(root.join("notes/a.md")).unwrap(),
            "before"
        );
        assert!(result.restored_paths.contains(&"notes/a.md".to_string()));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn rollback_should_delete_ai_created_file_and_empty_parents() {
        let root = create_test_root();

        record_ai_chat_capability_rollback_checkpoint(
            &root,
            Some("checkpoint-1"),
            "vault.create_markdown_file",
            &json!({"relativePath": "nested/new.md", "content": "# New"}),
        )
        .expect("record should succeed");
        write_file(&root, "nested/new.md", "# New");

        let result = restore_ai_chat_rollback_checkpoint_in_root(&root, "checkpoint-1".to_string())
            .expect("restore should succeed");

        assert!(!root.join("nested/new.md").exists());
        assert!(!root.join("nested").exists());
        assert!(result.deleted_paths.contains(&"nested/new.md".to_string()));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn rollback_should_restore_rename_preimage() {
        let root = create_test_root();
        write_file(&root, "notes/a.md", "before");

        record_ai_chat_capability_rollback_checkpoint(
            &root,
            Some("checkpoint-1"),
            "vault.rename_markdown_file",
            &json!({"fromRelativePath": "notes/a.md", "toRelativePath": "archive/a.md"}),
        )
        .expect("record should succeed");
        fs::create_dir_all(root.join("archive")).unwrap();
        fs::rename(root.join("notes/a.md"), root.join("archive/a.md")).unwrap();

        restore_ai_chat_rollback_checkpoint_in_root(&root, "checkpoint-1".to_string())
            .expect("restore should succeed");

        assert_eq!(
            fs::read_to_string(root.join("notes/a.md")).unwrap(),
            "before"
        );
        assert!(!root.join("archive/a.md").exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn rollback_should_cover_agent_skill_write_files() {
        let root = create_test_root();
        fs::create_dir_all(root.join(".ofive/skills/research-helper")).unwrap();

        record_ai_chat_capability_rollback_checkpoint(
            &root,
            Some("checkpoint-1"),
            "agent_skill.write_file",
            &json!({
                "skillName": "research-helper",
                "relativePath": "references/context.md",
                "content": "# Context"
            }),
        )
        .expect("record should succeed");
        write_file(
            &root,
            ".ofive/skills/research-helper/references/context.md",
            "# Context",
        );

        restore_ai_chat_rollback_checkpoint_in_root(&root, "checkpoint-1".to_string())
            .expect("restore should succeed");

        assert!(!root
            .join(".ofive/skills/research-helper/references/context.md")
            .exists());
        assert!(!root
            .join(".ofive/skills/research-helper/references")
            .exists());
        assert!(root.join(".ofive/skills/research-helper").exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn rollback_should_block_uncovered_registered_write_capabilities() {
        let root = create_test_root();
        let error = record_ai_chat_capability_rollback_checkpoint(
            &root,
            Some("checkpoint-1"),
            "agent_skill.create",
            &json!({"skillName": "../bad", "description": "bad"}),
        )
        .expect_err("invalid write input should be rejected before execution");

        assert!(error.contains("skillName"));
        let _ = fs::remove_dir_all(root);
    }
}
