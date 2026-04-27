//! # 文件系统基础设施模块
//!
//! 提供 vault 生命周期、watcher 安装、配置读写与只读文件访问等
//! 文件系统层面的技术实现。

pub(crate) mod fs_helpers;
pub(crate) mod vault_runtime;
pub(crate) mod watcher;
pub(crate) mod write_runtime;
