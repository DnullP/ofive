//! # AI 应用服务模块
//!
//! 组织 AI 设置、健康检查和流式聊天等用例，作为宿主命令层与底层实现之间的
//! 稳定编排边界。

pub(crate) mod chat_app_service;
pub(crate) mod mcp_server_app_service;
pub(crate) mod module_contribution;
pub(crate) mod persistence_callback_app_service;
pub(crate) mod plugin_app_service;
pub(crate) mod settings_app_service;
pub(crate) mod tool_app_service;
pub(crate) mod tool_callback_app_service;
