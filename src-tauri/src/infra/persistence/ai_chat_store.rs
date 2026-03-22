//! # AI 设置与历史存储模块
//!
//! 该模块负责将 AI vendor 配置与 AI 对话历史持久化到宿主托管的
//! AI 扩展私有存储，并在读写边界执行默认值补齐、字段过滤、数据清洗
//! 与聊天前校验。
//!
//! ## 依赖关系
//! - `crate::state`：解析当前已打开 vault 的根目录。
//! - `crate::infra::persistence::extension_private_store`：扩展私有命名空间持久化。
//! - `crate::infra::persistence::vault_config_store`：兼容旧版 `vault config` 字段并执行迁移。
//! - `crate::ai_service`：复用 AI 设置、vendor 元数据与历史记录的数据结构。
//!
//! ## 使用示例
//! ```rust,ignore
//! let settings = load_ai_chat_settings(&state)?;
//! let validated = validate_ai_chat_settings_for_chat(settings)?;
//! save_ai_chat_settings(validated, &state)?;
//! ```
//!
//! ## 主要导出能力
//! - `get_ai_vendor_catalog`：返回前端表单可消费的 vendor 元数据。
//! - `load_ai_chat_settings` / `save_ai_chat_settings`：读写 AI 设置。
//! - `load_ai_chat_history` / `save_ai_chat_history`：读写会话历史。
//! - `validate_ai_chat_settings_for_chat`：校验聊天前必填配置是否齐全。
//!
//! ## 模块状态
//! 模块本身不维护常驻内存状态；当前权威状态存放在：
//! - `.ofive/extensions/ai-chat/settings.json`
//! - `.ofive/extensions/ai-chat/history.json`
//! 旧版 `vault config` 中的 `aiChatSettings` 与 `aiChatHistory` 字段仅用于兼容迁移。
//!
//! ## 状态生命周期
//! - 初始化：首次读取且配置缺失时，返回内置默认设置或空历史。
//! - 更新：调用保存接口时，先清洗输入，再整体覆盖对应配置项。
//! - 恢复：配置反序列化失败时记录警告日志，并回退到默认值。
//! - 清理：本模块不主动删除配置项，调用方需通过写入空结构完成重置。

use std::collections::HashMap;
use std::path::Path;

use tauri::State;

use crate::ai_service::{
    AiChatConversationRecord, AiChatHistoryMessage, AiChatHistoryState, AiChatSettings,
    AiVendorDefinition, AiVendorFieldDefinition,
};
use crate::infra::persistence::extension_private_store;
use crate::infra::persistence::vault_config_store::{
    load_vault_config, save_vault_config, VaultConfig,
};
use crate::state::{get_vault_root, AppState};

const AI_EXTENSION_PRIVATE_STORE_OWNER: &str = "ai-chat";
const AI_CHAT_SETTINGS_STATE_KEY: &str = "settings";
const AI_CHAT_HISTORY_STATE_KEY: &str = "history";
const AI_CHAT_SETTINGS_CONFIG_KEY: &str = "aiChatSettings";
const AI_CHAT_HISTORY_CONFIG_KEY: &str = "aiChatHistory";
const DEFAULT_AI_VENDOR_ID: &str = "baidu-qianfan";

/// 返回当前宿主支持的 AI vendor 目录。
///
/// 该函数为前端设置页提供 vendor 元数据，包括字段定义、默认值与展示文案。
/// 当前目录为静态内置数据，不依赖磁盘配置，也不会修改模块外部状态。
///
/// # 返回值
/// - `Vec<AiVendorDefinition>`：当前版本支持的全部 vendor 定义。
pub(crate) fn get_ai_vendor_catalog() -> Vec<AiVendorDefinition> {
    vec![AiVendorDefinition {
        id: DEFAULT_AI_VENDOR_ID.to_string(),
        title: "Baidu Qianfan".to_string(),
        description: "Use Baidu Qianfan chat completions through the Go ADK sidecar.".to_string(),
        default_model: String::new(),
        fields: vec![
            AiVendorFieldDefinition {
                key: "authToken".to_string(),
                label: "IAM Token / Authorization".to_string(),
                description: "Paste the raw IAM token or the full Authorization header value. If you paste only the token, the sidecar will send it as Bearer <token>.".to_string(),
                field_type: "password".to_string(),
                required: true,
                placeholder: Some("Bearer ... or raw IAM token".to_string()),
                default_value: None,
            },
            AiVendorFieldDefinition {
                key: "appId".to_string(),
                label: "App ID".to_string(),
                description: "Optional Baidu application id header.".to_string(),
                field_type: "text".to_string(),
                required: false,
                placeholder: Some("Baidu app id".to_string()),
                default_value: None,
            },
            AiVendorFieldDefinition {
                key: "endpoint".to_string(),
                label: "Endpoint".to_string(),
                description: "Optional custom Qianfan endpoint override.".to_string(),
                field_type: "text".to_string(),
                required: false,
                placeholder: Some("https://qianfan.baidubce.com/v2/chat/completions".to_string()),
                default_value: Some(
                    "https://qianfan.baidubce.com/v2/chat/completions".to_string(),
                ),
            },
        ],
    }]
}

/// 读取当前仓库的 AI 设置。
///
/// # 参数
/// - `state`：Tauri 应用状态，用于定位当前 vault 根目录。
///
/// # 返回值
/// - `Ok(AiChatSettings)`：已完成默认值补齐与字段清洗的 AI 设置。
/// - `Err(String)`：获取 vault 根目录或读取配置文件失败。
///
/// # 异常与副作用
/// - 当配置缺失或反序列化失败时会回退到默认设置。
/// - 反序列化失败会记录告警日志，但不会中断调用方读取流程。
/// - 该函数只读取磁盘配置，不修改任何状态。
pub(crate) fn load_ai_chat_settings(state: &State<'_, AppState>) -> Result<AiChatSettings, String> {
    let root = get_vault_root(state)?;
    load_ai_chat_settings_in_root(&root)
}

/// 读取当前仓库的 AI 对话历史。
///
/// # 参数
/// - `state`：Tauri 应用状态，用于定位当前 vault 根目录。
///
/// # 返回值
/// - `Ok(AiChatHistoryState)`：已过滤非法会话并按更新时间排序的历史数据。
/// - `Err(String)`：获取 vault 根目录或读取配置文件失败。
///
/// # 异常与副作用
/// - 当配置缺失或反序列化失败时会返回空历史状态。
/// - 反序列化失败会记录告警日志，但不会阻断读取。
/// - 该函数只读取磁盘配置，不修改任何状态。
pub(crate) fn load_ai_chat_history(
    state: &State<'_, AppState>,
) -> Result<AiChatHistoryState, String> {
    let root = get_vault_root(state)?;
    load_ai_chat_history_in_root(&root)
}

/// 保存当前仓库的 AI 设置。
///
/// 在写入前会对 vendor、模型名与字段值进行清洗，移除空值与未声明字段，
/// 再整体覆盖 vault config 中的 `aiChatSettings` 条目。
///
/// # 参数
/// - `settings`：待保存的原始 AI 设置。
/// - `state`：Tauri 应用状态，用于定位当前 vault 根目录。
///
/// # 返回值
/// - `Ok(AiChatSettings)`：实际写入磁盘的清洗后设置。
/// - `Err(String)`：配置读取、序列化或保存失败。
///
/// # 副作用
/// - 会读取并修改 vault config 文件。
/// - 会覆盖 `aiChatSettings` 配置项的现有内容。
pub(crate) fn save_ai_chat_settings(
    settings: AiChatSettings,
    state: &State<'_, AppState>,
) -> Result<AiChatSettings, String> {
    let root = get_vault_root(state)?;
    save_ai_chat_settings_in_root(settings, &root)
}

/// 保存当前仓库的 AI 对话历史。
///
/// 在写入前会过滤非法会话与消息、修正时间戳并重新排序，
/// 再整体覆盖 vault config 中的 `aiChatHistory` 条目。
///
/// # 参数
/// - `history`：待保存的原始对话历史状态。
/// - `state`：Tauri 应用状态，用于定位当前 vault 根目录。
///
/// # 返回值
/// - `Ok(AiChatHistoryState)`：实际写入磁盘的清洗后历史状态。
/// - `Err(String)`：配置读取、序列化或保存失败。
///
/// # 副作用
/// - 会读取并修改 vault config 文件。
/// - 会覆盖 `aiChatHistory` 配置项的现有内容。
pub(crate) fn save_ai_chat_history(
    history: AiChatHistoryState,
    state: &State<'_, AppState>,
) -> Result<AiChatHistoryState, String> {
    let root = get_vault_root(state)?;
    save_ai_chat_history_in_root(history, &root)
}

/// 校验 AI 设置，确保能被聊天流程安全使用。
///
/// 该函数会先执行一次与持久化边界一致的清洗逻辑，再检查所选 vendor 的必填项
/// 是否齐全，供聊天入口在真正发起请求前执行快速失败。
///
/// # 参数
/// - `settings`：调用方提供的 AI 设置。
///
/// # 返回值
/// - `Ok(AiChatSettings)`：通过校验且已清洗的设置。
/// - `Err(String)`：vendor 不受支持，或存在缺失的必填字段。
///
/// # 副作用
/// - 无磁盘写入与全局状态修改。
pub(crate) fn validate_ai_chat_settings_for_chat(
    settings: AiChatSettings,
) -> Result<AiChatSettings, String> {
    let sanitized = sanitize_ai_chat_settings(settings);
    let Some(vendor) = find_ai_vendor(&sanitized.vendor_id) else {
        return Err("当前 AI vendor 不受支持".to_string());
    };

    let missing_required_fields = vendor
        .fields
        .iter()
        .filter(|field| field.required)
        .filter(|field| {
            sanitized
                .field_values
                .get(&field.key)
                .map(|value| value.trim().is_empty())
                .unwrap_or(true)
        })
        .map(|field| field.label.clone())
        .collect::<Vec<_>>();

    if !missing_required_fields.is_empty() {
        return Err(format!(
            "AI vendor 配置不完整，缺少字段: {}",
            missing_required_fields.join(", ")
        ));
    }

    Ok(sanitized)
}

/// 在指定 vault 根目录下读取 AI 设置。
fn load_ai_chat_settings_in_root(vault_root: &Path) -> Result<AiChatSettings, String> {
    if let Some(settings) = extension_private_store::load_extension_private_state::<AiChatSettings>(
        vault_root,
        AI_EXTENSION_PRIVATE_STORE_OWNER,
        AI_CHAT_SETTINGS_STATE_KEY,
    )? {
        return Ok(sanitize_ai_chat_settings(settings));
    }

    migrate_ai_chat_settings_from_legacy_config(vault_root)
}

/// 在指定 vault 根目录下读取 AI 对话历史。
fn load_ai_chat_history_in_root(vault_root: &Path) -> Result<AiChatHistoryState, String> {
    if let Some(history) =
        extension_private_store::load_extension_private_state::<AiChatHistoryState>(
            vault_root,
            AI_EXTENSION_PRIVATE_STORE_OWNER,
            AI_CHAT_HISTORY_STATE_KEY,
        )?
    {
        return Ok(sanitize_ai_chat_history(history));
    }

    migrate_ai_chat_history_from_legacy_config(vault_root)
}

/// 在指定 vault 根目录下保存 AI 设置。
fn save_ai_chat_settings_in_root(
    settings: AiChatSettings,
    vault_root: &Path,
) -> Result<AiChatSettings, String> {
    let sanitized = sanitize_ai_chat_settings(settings);
    extension_private_store::save_extension_private_state(
        vault_root,
        AI_EXTENSION_PRIVATE_STORE_OWNER,
        AI_CHAT_SETTINGS_STATE_KEY,
        &sanitized,
    )?;
    cleanup_legacy_ai_state_key(vault_root, AI_CHAT_SETTINGS_CONFIG_KEY);
    Ok(sanitized)
}

/// 在指定 vault 根目录下保存 AI 对话历史。
fn save_ai_chat_history_in_root(
    history: AiChatHistoryState,
    vault_root: &Path,
) -> Result<AiChatHistoryState, String> {
    let sanitized = sanitize_ai_chat_history(history);
    extension_private_store::save_extension_private_state(
        vault_root,
        AI_EXTENSION_PRIVATE_STORE_OWNER,
        AI_CHAT_HISTORY_STATE_KEY,
        &sanitized,
    )?;
    cleanup_legacy_ai_state_key(vault_root, AI_CHAT_HISTORY_CONFIG_KEY);
    Ok(sanitized)
}

/// 当扩展私有存储尚未建立时，从旧 `vault config` 读取并迁移 AI 设置。
fn migrate_ai_chat_settings_from_legacy_config(
    vault_root: &Path,
) -> Result<AiChatSettings, String> {
    let config = load_vault_config(vault_root)?;
    let Some(settings) = try_read_ai_chat_settings_from_legacy_config(&config) else {
        return Ok(default_ai_chat_settings());
    };

    let sanitized = sanitize_ai_chat_settings(settings);
    log::info!(
        "[ai-service] migrate ai settings from legacy vault config to extension private store"
    );
    extension_private_store::save_extension_private_state(
        vault_root,
        AI_EXTENSION_PRIVATE_STORE_OWNER,
        AI_CHAT_SETTINGS_STATE_KEY,
        &sanitized,
    )?;
    cleanup_legacy_ai_state_key(vault_root, AI_CHAT_SETTINGS_CONFIG_KEY);
    Ok(sanitized)
}

/// 当扩展私有存储尚未建立时，从旧 `vault config` 读取并迁移 AI 对话历史。
fn migrate_ai_chat_history_from_legacy_config(
    vault_root: &Path,
) -> Result<AiChatHistoryState, String> {
    let config = load_vault_config(vault_root)?;
    let Some(history) = try_read_ai_chat_history_from_legacy_config(&config) else {
        return Ok(default_ai_chat_history());
    };

    let sanitized = sanitize_ai_chat_history(history);
    log::info!(
        "[ai-service] migrate ai chat history from legacy vault config to extension private store"
    );
    extension_private_store::save_extension_private_state(
        vault_root,
        AI_EXTENSION_PRIVATE_STORE_OWNER,
        AI_CHAT_HISTORY_STATE_KEY,
        &sanitized,
    )?;
    cleanup_legacy_ai_state_key(vault_root, AI_CHAT_HISTORY_CONFIG_KEY);
    Ok(sanitized)
}

/// 从旧版 `vault config` 条目读取 AI 设置。
fn try_read_ai_chat_settings_from_legacy_config(config: &VaultConfig) -> Option<AiChatSettings> {
    let raw_value = config.entries.get(AI_CHAT_SETTINGS_CONFIG_KEY)?;

    match serde_json::from_value::<AiChatSettings>(raw_value.clone()) {
        Ok(settings) => Some(sanitize_ai_chat_settings(settings)),
        Err(error) => {
            log::warn!("[ai-service] parse legacy ai settings failed: {error}");
            None
        }
    }
}

/// 从旧版 `vault config` 条目读取 AI 对话历史。
fn try_read_ai_chat_history_from_legacy_config(config: &VaultConfig) -> Option<AiChatHistoryState> {
    let raw_value = config.entries.get(AI_CHAT_HISTORY_CONFIG_KEY)?;

    match serde_json::from_value::<AiChatHistoryState>(raw_value.clone()) {
        Ok(history) => Some(sanitize_ai_chat_history(history)),
        Err(error) => {
            log::warn!("[ai-service] parse legacy ai chat history failed: {error}");
            None
        }
    }
}

/// 清理旧版 `vault config` 中的 AI 存储字段，确保扩展私有存储成为唯一权威来源。
fn cleanup_legacy_ai_state_key(vault_root: &Path, config_key: &str) {
    if let Err(error) = remove_legacy_ai_state_key(vault_root, config_key) {
        log::warn!(
            "[ai-service] cleanup legacy ai state key failed: key={} error={}",
            config_key,
            error
        );
    }
}

/// 删除旧版 `vault config` 中指定 AI 字段。
fn remove_legacy_ai_state_key(vault_root: &Path, config_key: &str) -> Result<(), String> {
    let mut config = load_vault_config(vault_root)?;
    if config.entries.remove(config_key).is_none() {
        return Ok(());
    }

    save_vault_config(vault_root, &config)
}

/// 构造缺省 AI 设置。
///
/// 优先从默认 vendor 定义中提取默认模型与字段默认值，
/// 作为配置缺失、配置损坏或 vendor 回退时的统一基线。
fn default_ai_chat_settings() -> AiChatSettings {
    let default_vendor = get_ai_vendor_catalog()
        .into_iter()
        .find(|vendor| vendor.id == DEFAULT_AI_VENDOR_ID)
        .unwrap_or_else(|| AiVendorDefinition {
            id: DEFAULT_AI_VENDOR_ID.to_string(),
            title: "Baidu Qianfan".to_string(),
            description: "Baidu Qianfan Chat Completions via ADK-compatible sidecar.".to_string(),
            default_model: String::new(),
            fields: Vec::new(),
        });

    let mut field_values = HashMap::new();
    default_vendor.fields.iter().for_each(|field| {
        if let Some(default_value) = field.default_value.clone() {
            field_values.insert(field.key.clone(), default_value);
        }
    });

    AiChatSettings {
        vendor_id: default_vendor.id,
        model: default_vendor.default_model,
        field_values,
    }
}

/// 构造缺省 AI 对话历史。
///
/// 返回一个没有激活会话、会话列表为空的初始状态，
/// 供配置缺失或解析失败时回退使用。
fn default_ai_chat_history() -> AiChatHistoryState {
    AiChatHistoryState {
        active_conversation_id: None,
        conversations: Vec::new(),
    }
}

/// 根据 vendor 标识在内置目录中查找 vendor 定义。
///
/// 若找不到匹配项则返回 `None`，调用方通常会据此回退到默认 vendor。
fn find_ai_vendor(vendor_id: &str) -> Option<AiVendorDefinition> {
    get_ai_vendor_catalog()
        .into_iter()
        .find(|vendor| vendor.id == vendor_id)
}

/// 从 vault config 条目中读取并清洗 AI 设置。
///
/// 配置不存在时返回默认设置；反序列化失败时记录告警日志并回退到默认设置。
/// 清洗 AI 设置，确保后续保存与聊天校验使用统一格式。
///
/// 处理内容包括：回退未知 vendor、裁剪空白、移除未声明字段、补齐字段默认值，
/// 以及在模型名为空时回退到 vendor 默认模型。
fn sanitize_ai_chat_settings(settings: AiChatSettings) -> AiChatSettings {
    let fallback = default_ai_chat_settings();
    let vendor = find_ai_vendor(settings.vendor_id.trim()).unwrap_or_else(|| {
        find_ai_vendor(&fallback.vendor_id).unwrap_or_else(|| AiVendorDefinition {
            id: fallback.vendor_id.clone(),
            title: "Baidu Qianfan".to_string(),
            description: "Use Baidu Qianfan chat completions through the Go ADK sidecar."
                .to_string(),
            default_model: fallback.model.clone(),
            fields: Vec::new(),
        })
    });

    let allowed_field_keys = vendor
        .fields
        .iter()
        .map(|field| field.key.as_str())
        .collect::<Vec<_>>();

    let mut next_field_values = HashMap::new();
    vendor.fields.iter().for_each(|field| {
        let value = settings
            .field_values
            .get(&field.key)
            .map(|raw| raw.trim().to_string())
            .filter(|raw| !raw.is_empty())
            .or_else(|| field.default_value.clone());

        if let Some(value) = value {
            next_field_values.insert(field.key.clone(), value);
        }
    });

    settings.field_values.iter().for_each(|(key, value)| {
        if allowed_field_keys.contains(&key.as_str()) {
            let trimmed = value.trim();
            if !trimmed.is_empty() {
                next_field_values.insert(key.clone(), trimmed.to_string());
            }
        }
    });

    AiChatSettings {
        vendor_id: vendor.id,
        model: {
            let trimmed = settings.model.trim();
            if trimmed.is_empty() {
                vendor.default_model
            } else {
                trimmed.to_string()
            }
        },
        field_values: next_field_values,
    }
}

/// 清洗 AI 对话历史状态。
///
/// 处理内容包括：过滤非法会话、按更新时间倒序排列会话，
/// 并确保激活会话标识仍然指向有效会话。
fn sanitize_ai_chat_history(history: AiChatHistoryState) -> AiChatHistoryState {
    let mut conversations = history
        .conversations
        .into_iter()
        .filter_map(sanitize_ai_chat_conversation)
        .collect::<Vec<_>>();

    conversations.sort_by(|left, right| {
        right
            .updated_at_unix_ms
            .cmp(&left.updated_at_unix_ms)
            .then_with(|| left.id.cmp(&right.id))
    });

    let active_conversation_id = history.active_conversation_id.and_then(|active_id| {
        conversations
            .iter()
            .find(|conversation| conversation.id == active_id)
            .map(|conversation| conversation.id.clone())
    });

    AiChatHistoryState {
        active_conversation_id,
        conversations,
    }
}

/// 清洗单条会话记录。
///
/// 若会话标识或 session 标识为空则直接丢弃；
/// 其余情况下会裁剪标题、修正时间戳并过滤非法消息。
fn sanitize_ai_chat_conversation(
    conversation: AiChatConversationRecord,
) -> Option<AiChatConversationRecord> {
    let id = conversation.id.trim().to_string();
    let session_id = conversation.session_id.trim().to_string();
    if id.is_empty() || session_id.is_empty() {
        return None;
    }

    let messages = conversation
        .messages
        .into_iter()
        .filter_map(sanitize_ai_chat_message)
        .collect::<Vec<_>>();

    let created_at_unix_ms = conversation.created_at_unix_ms.max(0);
    let updated_at_unix_ms = conversation.updated_at_unix_ms.max(created_at_unix_ms);
    let title = {
        let trimmed = conversation.title.trim();
        if trimmed.is_empty() {
            "新对话".to_string()
        } else {
            trimmed.to_string()
        }
    };

    Some(AiChatConversationRecord {
        id,
        session_id,
        title,
        created_at_unix_ms,
        updated_at_unix_ms,
        messages,
    })
}

/// 清洗单条历史消息。
///
/// 仅保留 `user` 与 `assistant` 两种角色，且要求消息标识与文本非空；
/// 非法消息会被整个丢弃。
fn sanitize_ai_chat_message(message: AiChatHistoryMessage) -> Option<AiChatHistoryMessage> {
    let id = message.id.trim().to_string();
    let text = message.text.trim().to_string();
    let role = match message.role.trim() {
        "assistant" => "assistant".to_string(),
        "user" => "user".to_string(),
        _ => return None,
    };

    if id.is_empty() || text.is_empty() {
        return None;
    }

    Some(AiChatHistoryMessage {
        id,
        role,
        text,
        created_at_unix_ms: message.created_at_unix_ms.max(0),
    })
}

#[cfg(test)]
mod tests {
    use super::{
        load_ai_chat_history_in_root, load_ai_chat_settings_in_root, save_ai_chat_history_in_root,
        AI_CHAT_HISTORY_CONFIG_KEY, AI_CHAT_SETTINGS_CONFIG_KEY,
    };
    use crate::ai_service::{
        AiChatConversationRecord, AiChatHistoryMessage, AiChatHistoryState, AiChatSettings,
    };
    use crate::infra::persistence::vault_config_store::{
        load_vault_config, save_vault_config, VaultConfig,
    };
    use serde_json::json;
    use std::collections::HashMap;
    use std::fs;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    static TEST_ROOT_SEQ: AtomicU64 = AtomicU64::new(1);

    fn create_test_root() -> PathBuf {
        let sequence = TEST_ROOT_SEQ.fetch_add(1, Ordering::Relaxed);
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0);
        let root =
            std::env::temp_dir().join(format!("ofive-ai-chat-store-test-{}-{}", unique, sequence));
        fs::create_dir_all(root.join(".ofive")).expect("应成功创建测试根目录");
        root
    }

    #[test]
    fn load_ai_chat_settings_should_migrate_legacy_config_to_extension_store() {
        let root = create_test_root();
        let mut config = VaultConfig::default();
        config.entries.insert(
            AI_CHAT_SETTINGS_CONFIG_KEY.to_string(),
            json!({
                "vendorId": "baidu-qianfan",
                "model": "ernie-4.5-turbo-vl-preview",
                "fieldValues": {
                    "authToken": "token"
                }
            }),
        );
        save_vault_config(&root, &config).expect("保存旧版配置应成功");

        let settings = load_ai_chat_settings_in_root(&root).expect("迁移旧版设置应成功");

        assert_eq!(settings.vendor_id, "baidu-qianfan");
        assert_eq!(
            settings.field_values.get("authToken").map(String::as_str),
            Some("token")
        );
        assert!(root
            .join(".ofive/extensions/ai-chat/settings.json")
            .exists());

        let migrated_config = load_vault_config(&root).expect("读取迁移后配置应成功");
        assert!(
            !migrated_config
                .entries
                .contains_key(AI_CHAT_SETTINGS_CONFIG_KEY),
            "迁移后不应再保留旧字段"
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn save_ai_chat_history_should_write_extension_private_store_and_cleanup_legacy_key() {
        let root = create_test_root();
        let mut legacy_config = VaultConfig::default();
        legacy_config.entries.insert(
            AI_CHAT_HISTORY_CONFIG_KEY.to_string(),
            json!({
                "activeConversationId": "legacy",
                "conversations": []
            }),
        );
        save_vault_config(&root, &legacy_config).expect("保存旧版历史配置应成功");

        let history = AiChatHistoryState {
            active_conversation_id: Some("conversation-1".to_string()),
            conversations: vec![AiChatConversationRecord {
                id: "conversation-1".to_string(),
                session_id: "session-1".to_string(),
                title: "Test".to_string(),
                created_at_unix_ms: 10,
                updated_at_unix_ms: 20,
                messages: vec![AiChatHistoryMessage {
                    id: "message-1".to_string(),
                    role: "user".to_string(),
                    text: "hello".to_string(),
                    created_at_unix_ms: 10,
                }],
            }],
        };

        let saved = save_ai_chat_history_in_root(history, &root).expect("保存历史应成功");
        let loaded = load_ai_chat_history_in_root(&root).expect("读取新历史应成功");

        assert_eq!(
            saved.active_conversation_id.as_deref(),
            Some("conversation-1")
        );
        assert_eq!(
            loaded.active_conversation_id.as_deref(),
            Some("conversation-1")
        );
        assert_eq!(loaded.conversations.len(), 1);
        assert!(root.join(".ofive/extensions/ai-chat/history.json").exists());

        let migrated_config = load_vault_config(&root).expect("读取清理后配置应成功");
        assert!(
            !migrated_config
                .entries
                .contains_key(AI_CHAT_HISTORY_CONFIG_KEY),
            "保存后不应再保留旧字段"
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn load_ai_chat_history_should_return_default_when_no_state_exists() {
        let root = create_test_root();

        let loaded = load_ai_chat_history_in_root(&root).expect("读取默认历史应成功");

        assert!(loaded.active_conversation_id.is_none());
        assert!(loaded.conversations.is_empty());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn load_ai_chat_settings_should_prefer_extension_private_store() {
        let root = create_test_root();
        let mut legacy_config = VaultConfig::default();
        legacy_config.entries.insert(
            AI_CHAT_SETTINGS_CONFIG_KEY.to_string(),
            json!({
                "vendorId": "baidu-qianfan",
                "model": "legacy-model",
                "fieldValues": {
                    "authToken": "legacy-token"
                }
            }),
        );
        save_vault_config(&root, &legacy_config).expect("保存旧版配置应成功");

        let settings = AiChatSettings {
            vendor_id: "baidu-qianfan".to_string(),
            model: "extension-model".to_string(),
            field_values: HashMap::from([("authToken".to_string(), "extension-token".to_string())]),
        };
        crate::infra::persistence::extension_private_store::save_extension_private_state(
            &root, "ai-chat", "settings", &settings,
        )
        .expect("保存扩展私有设置应成功");

        let loaded = load_ai_chat_settings_in_root(&root).expect("读取扩展私有设置应成功");
        assert_eq!(loaded.model, "extension-model");
        assert_eq!(
            loaded.field_values.get("authToken").map(String::as_str),
            Some("extension-token")
        );

        let _ = fs::remove_dir_all(root);
    }
}
