//! # AI Sidecar 协议模型
//!
//! 定义 Rust 与 Go sidecar 之间未来进行 tool / capability 调用时使用的稳定协议对象。

#![allow(dead_code)]

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// 当前 sidecar capability 协议版本。
pub(crate) const SIDECAR_CAPABILITY_SCHEMA_VERSION: &str = "2026-03-17";

/// Go sidecar 发起的一次平台能力调用请求。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SidecarCapabilityCallRequest {
    /// 协议版本。
    pub schema_version: String,
    /// 目标平台能力 ID。
    pub capability_id: String,
    /// 结构化输入参数。
    pub input: Value,
    /// 调用链路 trace ID。
    pub trace_id: Option<String>,
    /// 会话 ID。
    pub session_id: Option<String>,
}

/// Rust 返回给 sidecar 的平台能力调用结果。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SidecarCapabilityCallResult {
    /// 协议版本。
    pub schema_version: String,
    /// 目标平台能力 ID。
    pub capability_id: String,
    /// 是否执行成功。
    pub success: bool,
    /// 结构化输出结果。
    pub output: Value,
    /// 失败时的结构化错误文本。
    pub error: Option<String>,
}

impl SidecarCapabilityCallRequest {
    /// 创建一条新的 sidecar capability 调用请求。
    pub(crate) fn new(capability_id: String, input: Value) -> Self {
        Self {
            schema_version: SIDECAR_CAPABILITY_SCHEMA_VERSION.to_string(),
            capability_id,
            input,
            trace_id: None,
            session_id: None,
        }
    }
}

impl SidecarCapabilityCallResult {
    /// 创建成功的 capability 调用结果。
    pub(crate) fn success(capability_id: String, output: Value) -> Self {
        Self {
            schema_version: SIDECAR_CAPABILITY_SCHEMA_VERSION.to_string(),
            capability_id,
            success: true,
            output,
            error: None,
        }
    }

    /// 创建失败的 capability 调用结果。
    pub(crate) fn failure(capability_id: String, error: String) -> Self {
        Self {
            schema_version: SIDECAR_CAPABILITY_SCHEMA_VERSION.to_string(),
            capability_id,
            success: false,
            output: Value::Null,
            error: Some(error),
        }
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{
        SidecarCapabilityCallRequest, SidecarCapabilityCallResult,
        SIDECAR_CAPABILITY_SCHEMA_VERSION,
    };

    #[test]
    fn sidecar_capability_request_should_use_current_schema_version() {
        let request = SidecarCapabilityCallRequest::new(
            "vault.read_markdown_file".to_string(),
            json!({"relativePath": "Notes/A.md"}),
        );

        assert_eq!(request.schema_version, SIDECAR_CAPABILITY_SCHEMA_VERSION);
        assert_eq!(request.capability_id, "vault.read_markdown_file");
    }

    #[test]
    fn sidecar_capability_result_should_create_success_and_failure_shapes() {
        let success = SidecarCapabilityCallResult::success(
            "vault.read_markdown_file".to_string(),
            json!({"content": "# A"}),
        );
        let failure = SidecarCapabilityCallResult::failure(
            "vault.read_markdown_file".to_string(),
            "not found".to_string(),
        );

        assert!(success.success);
        assert!(success.error.is_none());
        assert!(!failure.success);
        assert_eq!(failure.error.as_deref(), Some("not found"));
    }
}
