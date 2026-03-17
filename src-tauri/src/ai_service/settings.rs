//! # AI 设置与 vendor 模块
//!
//! 负责 AI vendor 目录、配置读写、配置清洗与模型列表拉取。

use std::collections::HashMap;
use std::time::Duration;

use reqwest::header::{AUTHORIZATION, CONTENT_TYPE};
use serde::Deserialize;
use serde_json::Value;
use tauri::State;

use crate::state::{get_vault_root, AppState};
use crate::vault_config::{load_vault_config, save_vault_config, VaultConfig};

use super::{
    AiChatSettings, AiVendorDefinition, AiVendorFieldDefinition, AiVendorModelDefinition,
    AI_CHAT_SETTINGS_CONFIG_KEY, DEFAULT_AI_VENDOR_ID,
};

#[derive(Debug, Deserialize)]
struct BaiduModelListResponse {
    data: Vec<BaiduModelListItem>,
}

#[derive(Debug, Deserialize)]
struct BaiduModelListItem {
    id: String,
    object: Option<String>,
    owned_by: Option<String>,
    created: Option<i64>,
}

pub(crate) fn ai_vendor_catalog() -> Vec<AiVendorDefinition> {
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
                default_value: Some("https://qianfan.baidubce.com/v2/chat/completions".to_string()),
            },
        ],
    }]
}

pub(crate) fn load_ai_chat_settings(state: &State<'_, AppState>) -> Result<AiChatSettings, String> {
    let root = get_vault_root(state)?;
    let config = load_vault_config(&root)?;
    Ok(read_ai_chat_settings_from_config(&config))
}

pub(crate) fn save_ai_chat_settings_in_state(
    settings: AiChatSettings,
    state: &State<'_, AppState>,
) -> Result<AiChatSettings, String> {
    let root = get_vault_root(state)?;
    let mut config = load_vault_config(&root)?;
    let sanitized = sanitize_ai_chat_settings(settings);

    let serialized =
        serde_json::to_value(&sanitized).map_err(|error| format!("序列化 AI 设置失败: {error}"))?;

    if let Value::Object(value) = serialized {
        config.entries.insert(
            AI_CHAT_SETTINGS_CONFIG_KEY.to_string(),
            Value::Object(value),
        );
        save_vault_config(&root, &config)?;
        return Ok(sanitized);
    }

    Err("AI 设置序列化结果非法".to_string())
}

pub(crate) fn load_validated_ai_chat_settings(
    state: &State<'_, AppState>,
) -> Result<AiChatSettings, String> {
    validate_ai_chat_settings_for_chat(load_ai_chat_settings(state)?)
}

pub(crate) async fn fetch_ai_vendor_models(
    settings: AiChatSettings,
) -> Result<Vec<AiVendorModelDefinition>, String> {
    let sanitized = sanitize_ai_chat_settings(settings);

    match sanitized.vendor_id.as_str() {
        "baidu-qianfan" => fetch_baidu_vendor_models(sanitized).await,
        other => Err(format!("当前 vendor 暂不支持获取模型列表: {other}")),
    }
}

fn default_ai_chat_settings() -> AiChatSettings {
    let default_vendor = ai_vendor_catalog()
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

fn find_ai_vendor(vendor_id: &str) -> Option<AiVendorDefinition> {
    ai_vendor_catalog()
        .into_iter()
        .find(|vendor| vendor.id == vendor_id)
}

fn read_ai_chat_settings_from_config(config: &VaultConfig) -> AiChatSettings {
    let Some(raw_value) = config.entries.get(AI_CHAT_SETTINGS_CONFIG_KEY) else {
        return default_ai_chat_settings();
    };

    match serde_json::from_value::<AiChatSettings>(raw_value.clone()) {
        Ok(settings) => sanitize_ai_chat_settings(settings),
        Err(error) => {
            log::warn!("[ai-service] parse ai settings failed: {error}");
            default_ai_chat_settings()
        }
    }
}

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

fn validate_ai_chat_settings_for_chat(settings: AiChatSettings) -> Result<AiChatSettings, String> {
    let sanitized = sanitize_ai_chat_settings(settings);
    let Some(vendor) = find_ai_vendor(&sanitized.vendor_id) else {
        return Err("当前 AI vendor 不受支持".to_string());
    };

    if sanitized.model.trim().is_empty() {
        return Err("请先在设置中填写模型名称".to_string());
    }

    if let Some(missing_field) = vendor
        .fields
        .iter()
        .find(|field| field.required && sanitized.field_values.get(&field.key).is_none())
    {
        return Err(format!("请先在设置中填写 {}", missing_field.label));
    }

    Ok(sanitized)
}

async fn fetch_baidu_vendor_models(
    settings: AiChatSettings,
) -> Result<Vec<AiVendorModelDefinition>, String> {
    let auth_token = settings
        .field_values
        .get("authToken")
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "请先填写 Authorization / API Key 再获取模型列表".to_string())?;

    let endpoint = settings
        .field_values
        .get("endpoint")
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .map(derive_baidu_models_endpoint)
        .unwrap_or_else(|| "https://qianfan.baidubce.com/v2/models".to_string());

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|error| format!("创建模型列表客户端失败: {error}"))?;

    let response = client
        .get(endpoint.clone())
        .header(CONTENT_TYPE, "application/json")
        .header(
            AUTHORIZATION,
            normalize_baidu_authorization_header(auth_token),
        )
        .send()
        .await
        .map_err(|error| format!("请求 Baidu 模型列表失败: {error}"))?;

    let status = response.status();
    let response_text = response
        .text()
        .await
        .map_err(|error| format!("读取 Baidu 模型列表响应失败: {error}"))?;

    if !status.is_success() {
        return Err(format!(
            "请求 Baidu 模型列表失败: status={} body={}",
            status.as_u16(),
            response_text
        ));
    }

    let parsed: BaiduModelListResponse = serde_json::from_str(&response_text)
        .map_err(|error| format!("解析 Baidu 模型列表响应失败: {error}"))?;

    let mut models = parsed
        .data
        .into_iter()
        .map(|item| AiVendorModelDefinition {
            id: item.id,
            object: item.object,
            owned_by: item.owned_by,
            created: item.created,
        })
        .collect::<Vec<_>>();

    models.sort_by(|left, right| left.id.cmp(&right.id));
    Ok(models)
}

fn derive_baidu_models_endpoint(chat_endpoint: &str) -> String {
    let trimmed = chat_endpoint.trim().trim_end_matches('/');
    if let Some(prefix) = trimmed.strip_suffix("/chat/completions") {
        return format!("{prefix}/models");
    }

    if trimmed.ends_with("/models") {
        return trimmed.to_string();
    }

    "https://qianfan.baidubce.com/v2/models".to_string()
}

fn normalize_baidu_authorization_header(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    if trimmed.to_ascii_lowercase().starts_with("bearer ") {
        return trimmed.to_string();
    }

    format!("Bearer {trimmed}")
}
