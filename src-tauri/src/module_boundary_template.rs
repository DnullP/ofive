//! # Module Boundary Templates
//!
//! 为具备私有实现边界的后端模块提供统一的边界模板定义。
//! 新模块接入时，应优先在这里声明自己的私有命名空间与允许访问路径，
//! 而不是直接把专项规则散落到架构守卫实现中。

use crate::backend_module_manifest::builtin_backend_module_manifests;

/// 单条模块私有命名空间模板。
pub(crate) struct ModulePrivateNamespaceTemplate {
    /// 私有命名空间。
    pub namespace: &'static str,
    /// 允许访问该私有命名空间的源码路径。
    pub allowed_paths: &'static [&'static str],
    /// 规则说明。
    pub rationale: &'static str,
}

/// 单个模块的边界模板。
pub(crate) struct ModuleBoundaryTemplate {
    /// 模块唯一标识。
    pub module_id: &'static str,
    /// 该模块声明的私有命名空间规则。
    pub private_namespaces: &'static [ModulePrivateNamespaceTemplate],
}

/// 返回当前内建模块边界模板。
pub(crate) fn builtin_module_boundary_templates() -> Vec<ModuleBoundaryTemplate> {
    builtin_backend_module_manifests()
        .into_iter()
        .filter_map(|manifest| manifest.boundary_template)
        .collect()
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use super::builtin_module_boundary_templates;
    use crate::backend_module_manifest::builtin_backend_module_manifests;

    #[test]
    fn builtin_business_modules_should_have_boundary_templates() {
        let templated_module_ids = builtin_module_boundary_templates()
            .iter()
            .map(|template| template.module_id)
            .collect::<HashSet<_>>();

        for manifest in builtin_backend_module_manifests() {
            if manifest.module_id == "host-platform" {
                continue;
            }

            assert!(
                templated_module_ids.contains(manifest.module_id),
                "业务模块应声明边界模板: {}",
                manifest.module_id
            );
        }
    }
}
