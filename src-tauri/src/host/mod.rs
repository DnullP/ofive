//! # 宿主层模块
//!
//! 提供 Tauri 应用装配所需的窗口初始化、状态构建与命令注册辅助，
//! 避免在 `lib.rs` 中直接堆叠宿主细节。

pub(crate) mod bootstrap;
pub(crate) mod command_registry;
pub(crate) mod commands;
