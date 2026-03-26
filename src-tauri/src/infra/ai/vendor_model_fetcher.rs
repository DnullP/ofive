//! # AI vendor 模型抓取模块
//!
//! 负责通过外部 HTTP 接口获取 vendor 支持的模型列表，
//! 不承载仓库内设置持久化等产品状态逻辑。

use std::time::Duration;

use reqwest::header::{AUTHORIZATION, CONTENT_TYPE};
use serde::Deserialize;

use crate::ai_service::{AiChatSettings, AiVendorModelDefinition};
use crate::infra::persistence::ai_chat_store;

const MINIMAX_MODELS: &[&str] = &[
    "MiniMax-M2",
    "MiniMax-M2.1",
    "MiniMax-M2.1-highspeed",
    "MiniMax-M2.5",
    "MiniMax-M2.5-highspeed",
    "MiniMax-M2.7",
    "MiniMax-M2.7-highspeed",
];

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

/// 按当前 vendor 设置抓取可用模型列表。
pub(crate) async fn fetch_ai_vendor_models(
    settings: AiChatSettings,
) -> Result<Vec<AiVendorModelDefinition>, String> {
    let sanitized = ai_chat_store::validate_ai_chat_settings_for_chat(settings)?;

    match sanitized.vendor_id.as_str() {
        "minimax-anthropic" => Ok(fetch_minimax_vendor_models()),
        "baidu-qianfan" => fetch_baidu_vendor_models(sanitized).await,
        other => Err(format!("当前 vendor 暂不支持获取模型列表: {other}")),
    }
}

/// 返回静态维护的 MiniMax 模型目录。
fn fetch_minimax_vendor_models() -> Vec<AiVendorModelDefinition> {
    MINIMAX_MODELS
        .iter()
        .map(|model_id| AiVendorModelDefinition {
            id: (*model_id).to_string(),
            object: Some("model".to_string()),
            owned_by: Some("MiniMax".to_string()),
            created: None,
        })
        .collect()
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
    let list_endpoint = endpoint
        .replace("/chat/completions", "/models")
        .replace("/chat", "/models");

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|error| format!("创建模型列表 HTTP 客户端失败: {error}"))?;

    let response = client
        .get(list_endpoint.clone())
        .header(AUTHORIZATION, authorization_header)
        .header(CONTENT_TYPE, "application/json")
        .send()
        .await
        .map_err(|error| {
            format!("请求 Baidu Qianfan 模型列表失败 endpoint={list_endpoint}: {error}")
        })?;

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!(
            "请求 Baidu Qianfan 模型列表失败 status={status} body={body}"
        ));
    }

    let payload = response
        .json::<BaiduModelListResponse>()
        .await
        .map_err(|error| format!("解析 Baidu Qianfan 模型列表响应失败: {error}"))?;

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

#[cfg(test)]
mod tests {
    use super::{fetch_ai_vendor_models, fetch_minimax_vendor_models, MINIMAX_MODELS};
    use crate::ai_service::AiChatSettings;
    use std::collections::HashMap;

    #[test]
    fn fetch_minimax_vendor_models_should_return_static_catalog() {
        let models = fetch_minimax_vendor_models();

        assert_eq!(models.len(), MINIMAX_MODELS.len());
        assert_eq!(
            models.first().map(|model| model.id.as_str()),
            Some("MiniMax-M2")
        );
        assert_eq!(
            models.last().map(|model| model.id.as_str()),
            Some("MiniMax-M2.7-highspeed")
        );
        assert!(models
            .iter()
            .all(|model| model.owned_by.as_deref() == Some("MiniMax")));
    }

    #[tokio::test]
    async fn fetch_ai_vendor_models_should_use_static_minimax_catalog() {
        let models = fetch_ai_vendor_models(AiChatSettings {
            vendor_id: "minimax-anthropic".to_string(),
            model: "MiniMax-M2.7".to_string(),
            field_values: HashMap::from([("apiKey".to_string(), "test-key".to_string())]),
        })
        .await
        .expect("MiniMax 静态模型目录应成功返回");

        assert_eq!(models.len(), MINIMAX_MODELS.len());
        assert_eq!(models[0].id, "MiniMax-M2");
        assert_eq!(models[6].id, "MiniMax-M2.7-highspeed");
    }
}
