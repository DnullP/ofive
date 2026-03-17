//! # 平台能力应用服务
//!
//! 负责构建和返回当前 Rust 宿主维护的平台能力目录。

use crate::domain::capability::{build_builtin_capability_registry, CapabilityDescriptor};

/// 获取当前内建平台能力目录。
pub(crate) fn get_capability_catalog() -> Vec<CapabilityDescriptor> {
    let registry = build_builtin_capability_registry();
    registry.list()
}
