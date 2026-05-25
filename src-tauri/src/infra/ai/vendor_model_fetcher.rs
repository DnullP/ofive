//! # AI vendor 模型抓取模块
//!
//! 负责通过外部 HTTP 接口获取 vendor 支持的模型列表，
//! 不承载仓库内设置持久化等产品状态逻辑。

use std::time::Duration;

use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, CONTENT_TYPE};
use serde::Deserialize;

use crate::infra::persistence::ai_chat_store;
use crate::shared::ai_service::{AiChatSettings, AiVendorModelDefinition};

#[derive(Debug, Deserialize)]
struct VendorModelListResponse {
    data: Vec<VendorModelListItem>,
}

#[derive(Debug, Deserialize)]
struct VendorModelListItem {
    id: String,
    object: Option<String>,
    owned_by: Option<String>,
    created: Option<i64>,
}

/// 按当前 vendor 设置抓取可用模型列表。
pub(crate) async fn fetch_ai_vendor_models(
    settings: AiChatSettings,
) -> Result<Vec<AiVendorModelDefinition>, String> {
    let sanitized = ai_chat_store::validate_ai_chat_settings_for_chat(settings)?;
    let active_provider = ai_chat_store::resolve_active_ai_provider(&sanitized);
    let active_settings = AiChatSettings {
        vendor_id: active_provider.vendor_id,
        model: active_provider.model,
        field_values: active_provider.field_values,
        active_provider_id: None,
        providers: Vec::new(),
        tool_approval_policy: sanitized.tool_approval_policy,
    };

    match active_settings.vendor_id.as_str() {
        "anthropic-compatible" | "minimax-anthropic" => {
            fetch_anthropic_vendor_models(active_settings).await
        }
        "openai-compatible" => {
            fetch_openai_vendor_models(
                active_settings,
                "OpenAI-compatible provider",
                "https://api.openai.com/v1",
            )
            .await
        }
        "codex-compatible" => {
            fetch_openai_vendor_models(
                active_settings,
                "Codex-compatible provider",
                "https://www.api-for-ai.com/v1",
            )
            .await
        }
        "baidu-qianfan" => fetch_baidu_vendor_models(active_settings).await,
        other => Err(format!("当前 vendor 暂不支持获取模型列表: {other}")),
    }
}

/// 从 Anthropic-compatible base URL 拉取模型列表。
async fn fetch_anthropic_vendor_models(
    settings: AiChatSettings,
) -> Result<Vec<AiVendorModelDefinition>, String> {
    let api_key = settings
        .field_values
        .get("apiKey")
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Anthropic-compatible provider 需要 API Key 才能获取模型列表".to_string())?;

    let endpoint = settings
        .field_values
        .get("endpoint")
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .unwrap_or("https://api.anthropic.com");
    let list_endpoint = resolve_models_endpoint(endpoint);
    let mut headers = HeaderMap::new();
    let api_key_header = HeaderValue::from_str(api_key).map_err(|error| {
        format!("Anthropic-compatible API Key 不能作为 HTTP header 发送: {error}")
    })?;
    let anthropic_version = settings
        .field_values
        .get("anthropicVersion")
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .unwrap_or("2023-06-01");
    let anthropic_version_header = HeaderValue::from_str(anthropic_version)
        .map_err(|error| format!("anthropic-version 不能作为 HTTP header 发送: {error}"))?;
    headers.insert("x-api-key", api_key_header);
    headers.insert("anthropic-version", anthropic_version_header);

    fetch_openai_style_models(list_endpoint, headers, "Anthropic-compatible provider").await
}

/// 从 OpenAI-compatible base URL 拉取模型列表。
async fn fetch_openai_vendor_models(
    settings: AiChatSettings,
    vendor_label: &str,
    default_endpoint: &str,
) -> Result<Vec<AiVendorModelDefinition>, String> {
    let api_key = settings
        .field_values
        .get("apiKey")
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| format!("{vendor_label} 需要 API Key 才能获取模型列表"))?;

    let endpoint = settings
        .field_values
        .get("baseUrl")
        .or_else(|| settings.field_values.get("endpoint"))
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .unwrap_or(default_endpoint);
    let list_endpoint = resolve_models_endpoint(endpoint);
    let mut headers = HeaderMap::new();
    let authorization_header = HeaderValue::from_str(&format!("Bearer {api_key}"))
        .map_err(|error| format!("OpenAI-compatible API Key 不能作为 HTTP header 发送: {error}"))?;
    headers.insert(AUTHORIZATION, authorization_header);

    fetch_openai_style_models(list_endpoint, headers, vendor_label).await
}

/// 从百度千帆接口拉取模型列表。
async fn fetch_baidu_vendor_models(
    settings: AiChatSettings,
) -> Result<Vec<AiVendorModelDefinition>, String> {
    let auth_value = settings
        .field_values
        .get("authToken")
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Baidu Qianfan 需要 authToken 才能获取模型列表".to_string())?;

    let authorization_header = if auth_value.to_ascii_lowercase().starts_with("bearer ") {
        auth_value.to_string()
    } else {
        format!("Bearer {auth_value}")
    };

    let endpoint = settings
        .field_values
        .get("endpoint")
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .unwrap_or("https://qianfan.baidubce.com/v2/chat/completions");
    let list_endpoint = resolve_models_endpoint(endpoint);
    let mut headers = HeaderMap::new();
    let authorization_header = HeaderValue::from_str(&authorization_header).map_err(|error| {
        format!("Baidu Qianfan Authorization 不能作为 HTTP header 发送: {error}")
    })?;
    headers.insert(AUTHORIZATION, authorization_header);

    fetch_openai_style_models(list_endpoint, headers, "Baidu Qianfan").await
}

async fn fetch_openai_style_models(
    list_endpoint: String,
    headers: HeaderMap,
    vendor_label: &str,
) -> Result<Vec<AiVendorModelDefinition>, String> {
    let mut client_builder = reqwest::Client::builder().timeout(Duration::from_secs(20));
    if should_bypass_proxy_for_endpoint(&list_endpoint) {
        client_builder = client_builder.no_proxy();
    }
    let client = client_builder
        .build()
        .map_err(|error| format!("创建模型列表 HTTP 客户端失败: {error}"))?;

    let response = client
        .get(list_endpoint.clone())
        .headers(headers)
        .header(CONTENT_TYPE, "application/json")
        .send()
        .await
        .map_err(|error| {
            format!("请求 {vendor_label} 模型列表失败 endpoint={list_endpoint}: {error}")
        })?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!(
            "请求 {vendor_label} 模型列表失败 status={status} body={body}"
        ));
    }

    let payload = response
        .json::<VendorModelListResponse>()
        .await
        .map_err(|error| format!("解析 {vendor_label} 模型列表响应失败: {error}"))?;

    Ok(payload
        .data
        .into_iter()
        .map(|item| AiVendorModelDefinition {
            id: item.id,
            object: item.object,
            owned_by: item.owned_by,
            created: item.created,
        })
        .collect())
}

fn should_bypass_proxy_for_endpoint(endpoint: &str) -> bool {
    let Ok(url) = reqwest::Url::parse(endpoint) else {
        return false;
    };
    matches!(
        url.host_str(),
        Some("127.0.0.1") | Some("localhost") | Some("::1")
    )
}

fn resolve_models_endpoint(endpoint: &str) -> String {
    let trimmed = endpoint.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return "https://api.minimaxi.com/anthropic/v1/models".to_string();
    }

    if trimmed.ends_with("/models") {
        return trimmed.to_string();
    }

    let suffixes = [
        ("/v1/messages", "/v1/models"),
        ("/v1/chat/completions", "/v1/models"),
        ("/chat/completions", "/models"),
        ("/chat", "/models"),
    ];
    for (suffix, replacement) in suffixes {
        if let Some(base) = trimmed.strip_suffix(suffix) {
            return format!("{}{}", base.trim_end_matches('/'), replacement);
        }
    }

    let last_segment = trimmed.rsplit('/').next().unwrap_or_default();
    if last_segment.len() >= 2
        && last_segment.starts_with('v')
        && last_segment[1..]
            .chars()
            .all(|character| character.is_ascii_digit())
    {
        return format!("{trimmed}/models");
    }

    format!("{trimmed}/v1/models")
}

#[cfg(test)]
mod tests {
    use super::{fetch_ai_vendor_models, resolve_models_endpoint};
    use crate::shared::ai_service::AiChatSettings;
    use axum::http::{HeaderMap, StatusCode};
    use axum::routing::get;
    use axum::{Json, Router};
    use serde_json::json;
    use std::collections::HashMap;
    use tokio::net::TcpListener;

    #[test]
    fn resolve_models_endpoint_should_derive_models_from_provider_base_url() {
        assert_eq!(
            resolve_models_endpoint("https://api.minimaxi.com/anthropic"),
            "https://api.minimaxi.com/anthropic/v1/models"
        );
        assert_eq!(
            resolve_models_endpoint("https://api.minimaxi.com/anthropic/v1/messages"),
            "https://api.minimaxi.com/anthropic/v1/models"
        );
        assert_eq!(
            resolve_models_endpoint("https://qianfan.baidubce.com/v2/chat/completions"),
            "https://qianfan.baidubce.com/v2/models"
        );
        assert_eq!(
            resolve_models_endpoint("https://api.minimaxi.com/anthropic/v1"),
            "https://api.minimaxi.com/anthropic/v1/models"
        );
        assert_eq!(
            resolve_models_endpoint("https://qianfan.baidubce.com/v2"),
            "https://qianfan.baidubce.com/v2/models"
        );
        assert_eq!(
            resolve_models_endpoint("https://example.com/v1/models"),
            "https://example.com/v1/models"
        );
    }

    #[tokio::test]
    async fn fetch_ai_vendor_models_should_request_minimax_models_from_configured_base_url() {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("test server should bind");
        let address = listener
            .local_addr()
            .expect("test server address should exist");
        let router = Router::new().route(
            "/anthropic/v1/models",
            get(|headers: HeaderMap| async move {
                let api_key = headers
                    .get("x-api-key")
                    .and_then(|value| value.to_str().ok());
                let anthropic_version = headers
                    .get("anthropic-version")
                    .and_then(|value| value.to_str().ok());
                match (api_key, anthropic_version) {
                    (Some("test-key"), Some("2023-06-01")) => (
                        StatusCode::OK,
                        Json(json!({
                            "data": [{
                                "id": "MiniMax-M2.7",
                                "object": "model",
                                "owned_by": "MiniMax",
                                "created": 1777300000
                            }]
                        })),
                    ),
                    _ => (
                        StatusCode::UNAUTHORIZED,
                        Json(json!({ "error": "missing required headers" })),
                    ),
                }
            }),
        );
        tokio::spawn(async move {
            axum::serve(listener, router)
                .await
                .expect("test server should run");
        });

        let models = fetch_ai_vendor_models(AiChatSettings {
            vendor_id: "minimax-anthropic".to_string(),
            model: "MiniMax-M2.7".to_string(),
            field_values: HashMap::from([
                ("apiKey".to_string(), "test-key".to_string()),
                (
                    "endpoint".to_string(),
                    format!("http://{address}/anthropic"),
                ),
            ]),
            active_provider_id: None,
            providers: Vec::new(),
            tool_approval_policy: HashMap::new(),
        })
        .await
        .expect("MiniMax 模型列表应从配置 base URL 拉取");

        assert_eq!(models.len(), 1);
        assert_eq!(models[0].id, "MiniMax-M2.7");
        assert_eq!(models[0].owned_by.as_deref(), Some("MiniMax"));
        assert_eq!(models[0].created, Some(1777300000));
    }

    #[tokio::test]
    async fn fetch_ai_vendor_models_should_request_codex_models_from_configured_base_url() {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("test server should bind");
        let address = listener
            .local_addr()
            .expect("test server address should exist");
        let router = Router::new().route(
            "/v1/models",
            get(|headers: HeaderMap| async move {
                let authorization = headers
                    .get("authorization")
                    .and_then(|value| value.to_str().ok());
                match authorization {
                    Some("Bearer test-key") => (
                        StatusCode::OK,
                        Json(json!({
                            "data": [{
                                "id": "gpt-5.5",
                                "object": "model",
                                "owned_by": "api-for-ai",
                                "created": 1777300000
                            }]
                        })),
                    ),
                    _ => (
                        StatusCode::UNAUTHORIZED,
                        Json(json!({ "error": "missing authorization" })),
                    ),
                }
            }),
        );
        tokio::spawn(async move {
            axum::serve(listener, router)
                .await
                .expect("test server should run");
        });

        let models = fetch_ai_vendor_models(AiChatSettings {
            vendor_id: "codex-compatible".to_string(),
            model: "gpt-5.5".to_string(),
            field_values: HashMap::from([
                ("apiKey".to_string(), "test-key".to_string()),
                ("baseUrl".to_string(), format!("http://{address}/v1")),
            ]),
            active_provider_id: None,
            providers: Vec::new(),
            tool_approval_policy: HashMap::new(),
        })
        .await
        .expect("Codex-compatible 模型列表应从配置 base URL 拉取");

        assert_eq!(models.len(), 1);
        assert_eq!(models[0].id, "gpt-5.5");
        assert_eq!(models[0].owned_by.as_deref(), Some("api-for-ai"));
    }
}
