//! # Sync 应用模块
//!
//! 定义未来多端同步能力在 Rust 宿主内的模块身份与边界入口。
//! 当前阶段先接入统一模块装配体系，固定：
//! - `module_id = sync`
//! - 模块私有持久化 owner
//! - 模块私有边界模板
//!
//! 依赖模块：
//! - `crate::backend_module_manifest`
//! - `crate::module_contribution`
//!
//! 使用示例：
//! ```ignore
//! let manifest = crate::app::sync::module_contribution::sync_backend_module_manifest();
//! assert_eq!(manifest.module_id, "sync");
//! ```
//!
//! 导出内容：
//! - `module_contribution`：Sync 模块向平台声明的 manifest 与 contribution

pub(crate) mod module_contribution;