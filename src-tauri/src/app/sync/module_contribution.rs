//! # Sync Module Contribution
//!
//! 定义 Sync 后端模块向宿主平台贡献的模块元数据。
//! 当前阶段 Sync 还未暴露命令、事件或 capability，先固定模块身份、
//! 私有持久化 owner 与边界模板，确保后续实现从一开始就进入受管控的
//! 模块装配体系。

use crate::backend_module_manifest::{BackendModuleManifest, BackendModulePublicSurface};
use crate::module_contribution::BackendModuleContribution;

#[cfg(test)]
use crate::module_boundary_template::{ModuleBoundaryTemplate, ModulePrivateNamespaceTemplate};

const SYNC_PERSISTENCE_OWNERS: &[&str] = &["sync"];

const SYNC_PUBLIC_SURFACES: &[BackendModulePublicSurface] = &[];

#[cfg(test)]
const SYNC_PRIVATE_NAMESPACES: &[ModulePrivateNamespaceTemplate] = &[ModulePrivateNamespaceTemplate {
    namespace: "crate::app::sync::",
    allowed_paths: &["src/app/sync/"],
    rationale: "sync app service 属于 Sync 模块私有实现边界",
}];

/// 返回 Sync 模块 contribution。
pub(crate) fn sync_backend_module_contribution() -> BackendModuleContribution {
    BackendModuleContribution {
        module_id: "sync",
        command_ids: &[],
        events: &[],
        persistence_owners: SYNC_PERSISTENCE_OWNERS,
        capability_catalog: None,
        capability_execute: None,
    }
}

/// 返回 Sync 模块 manifest。
pub(crate) fn sync_backend_module_manifest() -> BackendModuleManifest {
    let contribution = sync_backend_module_contribution();

    BackendModuleManifest {
        module_id: contribution.module_id,
        contribution,
        public_surfaces: SYNC_PUBLIC_SURFACES,
        #[cfg(test)]
        boundary_template: Some(ModuleBoundaryTemplate {
            module_id: "sync",
            private_namespaces: SYNC_PRIVATE_NAMESPACES,
        }),
    }
}