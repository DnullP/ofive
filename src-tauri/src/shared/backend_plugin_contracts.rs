//! # 后端插件契约模块
//!
//! 定义宿主层用于管理后端插件启停配置的稳定数据契约。

use serde::{Deserialize, Serialize};

/// 后端插件启停配置。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BackendPluginConfig {
    /// 插件唯一标识。
    pub plugin_id: String,
    /// 是否启用该后端插件。
    pub enabled: bool,
}
