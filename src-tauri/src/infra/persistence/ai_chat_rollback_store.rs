//! Persistent rollback journal for AI chat edits.

use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use crate::infra::persistence::extension_private_store;

const AI_EXTENSION_PRIVATE_STORE_OWNER: &str = "ai-chat";
const AI_CHAT_ROLLBACK_STATE_KEY: &str = "rollback";
const AI_CHAT_ROLLBACK_SCHEMA_VERSION: u32 = 1;

static AI_CHAT_ROLLBACK_STORE_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AiChatEditRollbackJournal {
    #[serde(default = "default_schema_version")]
    pub schema_version: u32,
    #[serde(default)]
    pub checkpoints: Vec<AiChatEditRollbackCheckpoint>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AiChatEditRollbackCheckpoint {
    pub id: String,
    pub created_at_unix_ms: i64,
    #[serde(default)]
    pub records: Vec<AiChatEditRollbackRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AiChatEditRollbackRecord {
    pub id: String,
    pub created_at_unix_ms: i64,
    pub capability_id: String,
    #[serde(default)]
    pub snapshots: Vec<AiChatEditRollbackSnapshot>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AiChatEditRollbackSnapshot {
    pub relative_path: String,
    pub kind: AiChatEditRollbackSnapshotKind,
    pub existed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub(crate) enum AiChatEditRollbackSnapshotKind {
    File,
    Directory,
}

impl Default for AiChatEditRollbackJournal {
    fn default() -> Self {
        Self {
            schema_version: AI_CHAT_ROLLBACK_SCHEMA_VERSION,
            checkpoints: Vec::new(),
        }
    }
}

fn default_schema_version() -> u32 {
    AI_CHAT_ROLLBACK_SCHEMA_VERSION
}

pub(crate) fn append_ai_chat_edit_rollback_record(
    vault_root: &std::path::Path,
    checkpoint_id: &str,
    record: AiChatEditRollbackRecord,
) -> Result<(), String> {
    let _guard = AI_CHAT_ROLLBACK_STORE_LOCK
        .lock()
        .map_err(|error| format!("锁定 AI edit rollback store 失败: {error}"))?;
    let mut journal = load_ai_chat_edit_rollback_journal_unlocked(vault_root)?;
    let checkpoint_id = checkpoint_id.trim();
    if checkpoint_id.is_empty() {
        return Err("rollback checkpoint id 不能为空".to_string());
    }

    if let Some(checkpoint) = journal
        .checkpoints
        .iter_mut()
        .find(|checkpoint| checkpoint.id == checkpoint_id)
    {
        checkpoint.records.push(record);
    } else {
        journal.checkpoints.push(AiChatEditRollbackCheckpoint {
            id: checkpoint_id.to_string(),
            created_at_unix_ms: record.created_at_unix_ms,
            records: vec![record],
        });
    }

    save_ai_chat_edit_rollback_journal_unlocked(vault_root, &journal)
}

pub(crate) fn load_ai_chat_edit_rollback_records(
    vault_root: &std::path::Path,
    checkpoint_id: &str,
) -> Result<Vec<AiChatEditRollbackRecord>, String> {
    let _guard = AI_CHAT_ROLLBACK_STORE_LOCK
        .lock()
        .map_err(|error| format!("锁定 AI edit rollback store 失败: {error}"))?;
    let journal = load_ai_chat_edit_rollback_journal_unlocked(vault_root)?;
    let checkpoint_id = checkpoint_id.trim();
    Ok(journal
        .checkpoints
        .into_iter()
        .find(|checkpoint| checkpoint.id == checkpoint_id)
        .map(|checkpoint| checkpoint.records)
        .unwrap_or_default())
}

fn load_ai_chat_edit_rollback_journal_unlocked(
    vault_root: &std::path::Path,
) -> Result<AiChatEditRollbackJournal, String> {
    let journal =
        extension_private_store::load_extension_private_state::<AiChatEditRollbackJournal>(
            vault_root,
            AI_EXTENSION_PRIVATE_STORE_OWNER,
            AI_CHAT_ROLLBACK_STATE_KEY,
        )?
        .unwrap_or_default();

    Ok(sanitize_ai_chat_edit_rollback_journal(journal))
}

fn save_ai_chat_edit_rollback_journal_unlocked(
    vault_root: &std::path::Path,
    journal: &AiChatEditRollbackJournal,
) -> Result<(), String> {
    extension_private_store::save_extension_private_state(
        vault_root,
        AI_EXTENSION_PRIVATE_STORE_OWNER,
        AI_CHAT_ROLLBACK_STATE_KEY,
        &sanitize_ai_chat_edit_rollback_journal(journal.clone()),
    )
}

fn sanitize_ai_chat_edit_rollback_journal(
    journal: AiChatEditRollbackJournal,
) -> AiChatEditRollbackJournal {
    let mut checkpoints = journal
        .checkpoints
        .into_iter()
        .filter_map(|checkpoint| {
            let id = checkpoint.id.trim().to_string();
            if id.is_empty() {
                return None;
            }
            let mut records = checkpoint
                .records
                .into_iter()
                .filter_map(|record| {
                    let record_id = record.id.trim().to_string();
                    let capability_id = record.capability_id.trim().to_string();
                    if record_id.is_empty() || capability_id.is_empty() {
                        return None;
                    }
                    Some(AiChatEditRollbackRecord {
                        id: record_id,
                        created_at_unix_ms: record.created_at_unix_ms.max(0),
                        capability_id,
                        snapshots: record.snapshots,
                    })
                })
                .collect::<Vec<_>>();
            records.sort_by(|left, right| {
                left.created_at_unix_ms
                    .cmp(&right.created_at_unix_ms)
                    .then(left.id.cmp(&right.id))
            });
            Some(AiChatEditRollbackCheckpoint {
                id,
                created_at_unix_ms: checkpoint.created_at_unix_ms.max(0),
                records,
            })
        })
        .collect::<Vec<_>>();

    checkpoints.sort_by(|left, right| {
        left.created_at_unix_ms
            .cmp(&right.created_at_unix_ms)
            .then(left.id.cmp(&right.id))
    });

    AiChatEditRollbackJournal {
        schema_version: AI_CHAT_ROLLBACK_SCHEMA_VERSION,
        checkpoints,
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    use super::{
        append_ai_chat_edit_rollback_record, load_ai_chat_edit_rollback_records,
        AiChatEditRollbackRecord,
    };

    static TEST_ROOT_SEQ: AtomicU64 = AtomicU64::new(1);

    fn create_test_root() -> std::path::PathBuf {
        let sequence = TEST_ROOT_SEQ.fetch_add(1, Ordering::Relaxed);
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0);
        let root =
            std::env::temp_dir().join(format!("ofive-ai-rollback-store-test-{unique}-{sequence}"));
        fs::create_dir_all(&root).expect("should create test root");
        root
    }

    #[test]
    fn rollback_store_should_append_records_by_checkpoint() {
        let root = create_test_root();
        append_ai_chat_edit_rollback_record(
            &root,
            "checkpoint-1",
            AiChatEditRollbackRecord {
                id: "record-1".to_string(),
                created_at_unix_ms: 2,
                capability_id: "vault.save_markdown_file".to_string(),
                snapshots: Vec::new(),
            },
        )
        .expect("append should succeed");

        let records = load_ai_chat_edit_rollback_records(&root, "checkpoint-1")
            .expect("load should succeed");
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].id, "record-1");

        let _ = fs::remove_dir_all(root);
    }
}
