//! # Backend Module Manifests
//!
//! 定义内建后端模块向宿主平台注册时的统一 manifest 结构。
//! 当前 manifest 先收敛：
//!
//! - module_id
//! - module contribution
//! - 模块声明的公共依赖面
//! - 模块私有边界模板（测试态）
//!
//! 目标是让模块接入平台时，优先通过一个统一入口声明自身，
//! 而不是把 contribution、边界模板等信息分散在多处维护。

use crate::module_contribution::BackendModuleContribution;

#[cfg(test)]
use crate::module_boundary_template::ModuleBoundaryTemplate;

/// 模块对平台声明的一条稳定公共依赖面规则。
#[cfg_attr(not(test), allow(dead_code))]
#[derive(Clone, Copy)]
pub(crate) struct BackendModulePublicSurface {
    /// 允许被跨模块依赖的命名空间前缀。
    pub namespace: &'static str,
    /// 允许使用该公共依赖面的源码路径前缀。
    pub allowed_paths: &'static [&'static str],
    /// 保留该公共依赖面的原因说明。
    pub rationale: &'static str,
}

/// 后端模块统一 manifest。
pub(crate) struct BackendModuleManifest {
    /// 模块唯一标识。
    #[cfg_attr(not(test), allow(dead_code))]
    pub module_id: &'static str,
    /// 模块向平台贡献的运行时元数据与能力入口。
    pub contribution: BackendModuleContribution,
    /// 模块声明的稳定公共依赖面。
    pub public_surfaces: &'static [BackendModulePublicSurface],
    /// 模块私有边界模板。
    #[cfg(test)]
    pub boundary_template: Option<ModuleBoundaryTemplate>,
}

/// 返回当前宿主内建模块 manifest 列表。
pub(crate) fn builtin_backend_module_manifests() -> Vec<BackendModuleManifest> {
    vec![
        crate::host::module_contribution::host_platform_backend_module_manifest(),
        crate::app::app_storage::module_contribution::app_storage_backend_module_manifest(),
        crate::app::vault::module_contribution::vault_backend_module_manifest(),
        crate::app::ai::module_contribution::ai_backend_module_manifest(),
        crate::app::semantic_index::module_contribution::semantic_index_backend_module_manifest(),
        crate::app::sync::module_contribution::sync_backend_module_manifest(),
    ]
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use super::builtin_backend_module_manifests;

    #[test]
    fn builtin_backend_module_manifests_should_have_unique_module_ids() {
        let manifests = builtin_backend_module_manifests();
        let mut seen = HashSet::new();

        for manifest in manifests {
            assert!(
                seen.insert(manifest.module_id),
                "builtin backend module manifest should not duplicate module_id: {}",
                manifest.module_id
            );
            assert_eq!(
                manifest.module_id, manifest.contribution.module_id,
                "manifest module_id should stay aligned with module contribution"
            );

            if let Some(boundary_template) = manifest.boundary_template {
                assert_eq!(
                    manifest.module_id, boundary_template.module_id,
                    "boundary template should stay aligned with manifest module_id"
                );
            }

            let mut public_surface_namespaces = HashSet::new();
            for public_surface in manifest.public_surfaces {
                assert!(
                    public_surface_namespaces.insert(public_surface.namespace),
                    "module public surface namespace should not duplicate inside one manifest: module={} namespace={}",
                    manifest.module_id,
                    public_surface.namespace
                );
            }
        }
    }
}
