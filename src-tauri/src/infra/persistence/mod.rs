//! # 持久化基础设施模块
//!
//! 提供基于 vault config 等底层存储的持久化适配层，
//! 供应用服务读取和保存产品状态。

pub(crate) mod ai_chat_store;
pub(crate) mod backend_plugin_store;
pub(crate) mod extension_private_store;
pub(crate) mod vault_config_store;
