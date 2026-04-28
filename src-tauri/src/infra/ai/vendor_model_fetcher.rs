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

    match sanitized.vendor_id.as_str() {
        "minimax-anthropic" => fetch_minimax_vendor_models(sanitized).await,
        "baidu-qianfan" => fetch_baidu_vendor_models(sanitized).await,
        other => Err(format!("当前 vendor 暂不支持获取模型列表: {other}")),
    }
}

/// 从 Anthropic-compatible MiniMax base URL 拉取模型列表。
async fn fetch_minimax_vendor_models(
    settings: AiChatSettings,
) -> Result<Vec<AiVendorModelDefinition>, String> {
    let api_key = settings
        .field_values
        .get("apiKey")
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "MiniMax 需要 API Key 才能获取模型列表".to_string())?;

    let endpoint = settings
        .field_values
        .get("endpoint")
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .unwrap_or("https://api.minimaxi.com/anthropic");
    let list_endpoint = resolve_models_endpoint(endpoint);
    let mut headers = HeaderMap::new();
    let api_key_header = HeaderValue::from_str(api_key)
        .map_err(|error| format!("MiniMax API Key 不能作为 HTTP header 发送: {error}"))?;
    headers.insert("x-api-key", api_key_header);
    headers.insert("anthropic-version", HeaderValue::from_static("2023-06-01"));

    fetch_openai_style_models(list_endpoint, headers, "MiniMax").await
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
    let authorization_header = HeaderValue::from_str(&authorization_header)
        .map_err(|error| format!("Baidu Qianfan Authorization 不能作为 HTTP header 发送: {error}"))?;
    headers.insert(AUTHORIZATION, authorization_header);

    fetch_openai_style_models(list_endpoint, headers, "Baidu Qianfan").await
}

async fn fetch_openai_style_models(
    list_endpoint: String,
    headers: HeaderMap,
    vendor_label: &str,
) -> Result<Vec<AiVendorModelDefinition>, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
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
        && last_segment[1..].chars().all(|character| character.is_ascii_digit())
    {
        return format!("{trimmed}/models");
    }

    format!("{trimmed}/v1/models")
}

#[cfg(test)]
mod tests {
    use super::{fetch_ai_vendor_models, resolve_models_endpoint};
    use axum::http::{HeaderMap, StatusCode};
    use axum::routing::get;
    use axum::{Json, Router};
    use crate::shared::ai_service::AiChatSettings;
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
        let address = listener.local_addr().expect("test server address should exist");
        let router = Router::new().route(
            "/anthropic/v1/models",
            get(|headers: HeaderMap| async move {
                let api_key = headers.get("x-api-key").and_then(|value| value.to_str().ok());
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
        })
        .await
        .expect("MiniMax 模型列表应从配置 base URL 拉取");

        assert_eq!(models.len(), 1);
        assert_eq!(models[0].id, "MiniMax-M2.7");
        assert_eq!(models[0].owned_by.as_deref(), Some("MiniMax"));
        assert_eq!(models[0].created, Some(1777300000));
    }
}
