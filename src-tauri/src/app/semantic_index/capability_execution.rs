//! # Semantic Index Capability Execution
//!
//! 定义语义索引模块对平台注册能力的执行路由，
//! 保持输入解析、应用服务编排与输出序列化收敛在模块边界内。

use serde_json::Value;

use crate::app::semantic_index::index_app_service;
use crate::domain::capability::{CapabilityExecutionContext, CapabilityExecutionRequest};
use crate::shared::semantic_index_contracts::SemanticSearchRequest;

/// 尝试执行一条由语义索引模块负责的平台能力请求。
///
/// # 参数
/// - `request`：平台能力执行请求。
/// - `context`：能力执行上下文。
///
/// # 返回值
/// - `None`：能力 ID 不属于语义索引模块。
/// - `Some(Ok(Value))`：执行成功并返回结构化响应。
/// - `Some(Err(String))`：执行失败。
pub(crate) fn execute_semantic_index_capability(
    request: &CapabilityExecutionRequest,
    context: &CapabilityExecutionContext<'_>,
) -> Option<Result<Value, String>> {
    match request.capability_id.as_str() {
        "semantic.search_markdown_chunks" => {
            Some(execute_search_markdown_chunks(request.input.clone(), context))
        }
        _ => None,
    }
}

/// 执行“按语义搜索 Markdown chunk”能力。
fn execute_search_markdown_chunks(
    input: Value,
    context: &CapabilityExecutionContext<'_>,
) -> Result<Value, String> {
    let request: SemanticSearchRequest = serde_json::from_value(input).map_err(|error| {
        format!(
            "failed to parse capability input for semantic.search_markdown_chunks: {error}"
        )
    })?;

    let output = index_app_service::search_markdown_chunks_in_root(request, context.vault_root)?;
    serde_json::to_value(output).map_err(|error| {
        format!(
            "failed to serialize capability output for semantic.search_markdown_chunks: {error}"
        )
    })
}

#[cfg(test)]
mod tests {
    use super::execute_semantic_index_capability;
    use crate::domain::capability::{
        CapabilityConsumer, CapabilityExecutionContext, CapabilityExecutionRequest,
    };
    use serde_json::json;
    use std::path::Path;

    #[test]
    fn execute_should_return_none_for_non_semantic_capability() {
        let request = CapabilityExecutionRequest {
            capability_id: "vault.read_markdown_file".to_string(),
            consumer: CapabilityConsumer::AiTool,
            input: json!({"relativePath": "Notes/A.md"}),
        };
        let context = CapabilityExecutionContext {
            vault_root: Path::new("/tmp/ofive-test-vault"),
        };

        assert!(execute_semantic_index_capability(&request, &context).is_none());
    }

    #[test]
    fn execute_should_return_structured_disabled_state_for_semantic_search() {
        let request = CapabilityExecutionRequest {
            capability_id: "semantic.search_markdown_chunks".to_string(),
            consumer: CapabilityConsumer::AiTool,
            input: json!({
                "query": "semantic retrieval",
                "limit": 4
            }),
        };
        let context = CapabilityExecutionContext {
            vault_root: Path::new("/tmp/ofive-test-vault"),
        };

        let response = execute_semantic_index_capability(&request, &context)
            .expect("semantic capability should be routed")
            .expect("semantic capability should return structured cold state");

        assert_eq!(response.get("status"), Some(&json!("disabled")));
        assert_eq!(response.get("results"), Some(&json!([])));
    }
}