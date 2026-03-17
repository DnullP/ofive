//! # 平台能力描述模型
//!
//! 定义平台注册中心中的核心结构体，确保不同消费者面对稳定的能力契约。

use serde::Serialize;
use serde_json::Value;

/// 平台能力类型。
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum CapabilityKind {
    /// 只读能力。
    Read,
    /// 写入能力。
    Write,
    /// UI 桥接能力。
    Ui,
    /// 后台任务能力。
    Task,
}

/// 平台能力风险级别。
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum CapabilityRiskLevel {
    /// 低风险。
    Low,
    /// 中风险。
    Medium,
    /// 高风险。
    High,
}

/// 平台能力消费者类型。
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum CapabilityConsumer {
    /// 前端或前端插件。
    Frontend,
    /// AI runtime 的 tool 投影。
    AiTool,
    /// 非 AI sidecar 或其他外部运行时。
    Sidecar,
}

/// 平台能力描述。
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityDescriptor {
    /// 平台能力 ID。
    pub id: String,
    /// 平台 API 版本。
    pub api_version: String,
    /// 面向产品和开发者的显示名称。
    pub display_name: String,
    /// 平台能力说明。
    pub description: String,
    /// 能力种类。
    pub kind: CapabilityKind,
    /// 输入 schema。
    pub input_schema: Value,
    /// 输出 schema。
    pub output_schema: Value,
    /// 风险级别。
    pub risk_level: CapabilityRiskLevel,
    /// 是否默认要求用户确认。
    pub requires_confirmation: bool,
    /// 需要的权限列表。
    pub required_permissions: Vec<String>,
    /// 允许访问此能力的消费者集合。
    pub supported_consumers: Vec<CapabilityConsumer>,
}

impl CapabilityDescriptor {
    /// 判断能力是否允许指定消费者访问。
    pub(crate) fn supports_consumer(&self, consumer: &CapabilityConsumer) -> bool {
        self.supported_consumers.iter().any(|item| item == consumer)
    }
}
