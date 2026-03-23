//! # 内建平台注册目录
//!
//! 提供当前后端已实现能力的稳定注册表，作为 AI、frontend 与 sidecar 的统一事实源。

use crate::domain::capability::{
    builtin_capability_catalog_contributions, CapabilityDescriptor, CapabilityRegistry,
};

/// 构建当前内建平台注册中心。
pub(crate) fn build_builtin_capability_registry() -> CapabilityRegistry {
    let mut registry = CapabilityRegistry::new();

    builtin_capabilities().into_iter().for_each(|descriptor| {
        registry.register(descriptor).expect("内建能力注册不应重复");
    });

    registry
}

fn builtin_capabilities() -> Vec<CapabilityDescriptor> {
    builtin_capability_catalog_contributions()
        .into_iter()
        .flat_map(|(module_id, descriptors)| {
            log::debug!(
                "[capability] loading catalog contribution from module={}",
                module_id
            );
            descriptors()
        })
        .collect()
}
