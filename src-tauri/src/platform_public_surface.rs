//! # Platform Public Surface
//!
//! 定义当前后端允许跨模块依赖的稳定平台公共入口。
//! 该模块的目标是把“哪些边界可以被共享依赖”从文档约定收敛为
//! 可审查、可测试的工程清单；当前规则由各模块 manifest 派生。

use crate::backend_module_manifest::builtin_backend_module_manifests;

pub(crate) use crate::backend_module_manifest::BackendModulePublicSurface as PublicSurfaceRule;

/// 返回当前后端已声明的平台公共依赖面清单。
#[cfg_attr(not(test), allow(dead_code))]
pub(crate) fn platform_public_surface_rules() -> Vec<PublicSurfaceRule> {
    builtin_backend_module_manifests()
        .into_iter()
        .flat_map(|manifest| manifest.public_surfaces.iter().copied())
        .collect()
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use super::platform_public_surface_rules;

    #[test]
    fn platform_public_surface_rules_should_have_unique_namespaces() {
        let rules = platform_public_surface_rules();
        let mut seen = HashSet::new();

        for rule in rules {
            assert!(
                seen.insert(rule.namespace),
                "platform public surface namespace should stay unique: {}",
                rule.namespace
            );
        }
    }
}
