//! # 宿主持久化契约模块
//!
//! 定义 sidecar / runtime 向 Rust 宿主请求持久化能力时使用的稳定协议。
//! 该模块只描述协议面，不绑定具体落盘实现。

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// 当前宿主持久化协议版本。
pub const PERSISTENCE_CONTRACT_API_VERSION: u32 = 1;

/// 持久化存储作用域。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PersistenceScope {
    /// 宿主核心共享存储。
    Core,
    /// 模块私有存储。
    ModulePrivate,
    /// 可重建缓存存储。
    Cache,
}

/// 持久化协议动作类型。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PersistenceAction {
    /// 读取单个状态。
    Load,
    /// 保存单个状态。
    Save,
    /// 删除单个状态。
    Delete,
    /// 列出某 owner 下的状态键。
    List,
}

/// 持久化响应状态。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PersistenceResponseStatus {
    /// 请求执行成功。
    Ok,
    /// 状态不存在。
    NotFound,
    /// revision/etag 冲突。
    Conflict,
    /// 请求语义或平台支持范围错误。
    Error,
}

/// 持久化协议错误码。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PersistenceErrorCode {
    /// 请求结构或字段取值无效。
    InvalidRequest,
    /// 请求的 apiVersion 不受支持。
    UnsupportedApiVersion,
    /// 请求的 scope 当前未实现。
    UnsupportedScope,
    /// 请求的 module_id 未注册为宿主后端模块。
    UnknownModuleId,
    /// module_id 与 owner 不匹配。
    OwnerModuleMismatch,
    /// 请求的 owner 未在模块贡献中声明。
    UndeclaredPersistenceOwner,
    /// 缺少必须的 state_key。
    StateKeyRequired,
    /// 缺少必须的 payload。
    PayloadRequired,
    /// revision 校验失败。
    RevisionConflict,
    /// 目标状态不存在。
    StateNotFound,
}

/// 单个状态项描述。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PersistenceStateDescriptor {
    /// 状态所属 owner。
    pub owner: String,
    /// 状态键。
    pub state_key: String,
    /// 状态 schema 版本。
    pub schema_version: u32,
    /// 当前 revision。
    pub revision: String,
}

/// sidecar / runtime 发往宿主的持久化请求。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PersistenceRequest {
    /// 协议版本。
    pub api_version: u32,
    /// 请求模块标识。
    pub module_id: String,
    /// 请求运行时标识。
    pub runtime_id: String,
    /// 可选会话标识。
    pub session_id: Option<String>,
    /// 可选任务标识。
    pub task_id: Option<String>,
    /// 可选调用链路 trace 标识。
    pub trace_id: Option<String>,
    /// 存储作用域。
    pub scope: PersistenceScope,
    /// owner 命名空间。
    pub owner: String,
    /// 状态键；`list` 动作可为空。
    pub state_key: Option<String>,
    /// 请求期望的 schema 版本。
    pub schema_version: u32,
    /// 乐观并发控制 revision。
    pub expected_revision: Option<String>,
    /// 请求动作。
    pub action: PersistenceAction,
    /// `save` 动作的状态载荷。
    pub payload: Option<Value>,
}

/// 宿主返回的持久化响应。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PersistenceResponse {
    /// 执行状态。
    pub status: PersistenceResponseStatus,
    /// 响应归属 owner。
    pub owner: String,
    /// 响应状态键；`list` 场景可为空。
    pub state_key: Option<String>,
    /// 实际 schema 版本。
    pub schema_version: Option<u32>,
    /// 当前 revision。
    pub revision: Option<String>,
    /// 单状态载荷。
    pub payload: Option<Value>,
    /// `list` 动作返回的状态描述列表。
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub items: Vec<PersistenceStateDescriptor>,
    /// 协议错误码。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<PersistenceErrorCode>,
    /// 人类可读错误信息。
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_message: Option<String>,
}
