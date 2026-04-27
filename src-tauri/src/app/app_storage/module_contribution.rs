//! # App Storage Module Contribution
//!
//! 定义应用级存储模块向宿主平台注册的模块元数据。

use crate::backend_module_manifest::{BackendModuleManifest, BackendModulePublicSurface};
use crate::module_contribution::BackendModuleContribution;

#[cfg(test)]
use crate::module_boundary_template::{ModuleBoundaryTemplate, ModulePrivateNamespaceTemplate};

const APP_STORAGE_PUBLIC_SURFACES: &[BackendModulePublicSurface] = &[BackendModulePublicSurface {
    namespace: "crate::app::app_storage::storage_registry_facade",
    allowed_paths: &[
        "src/app/app_storage/",
        "src/app/semantic_index/",
        "src/infra/vector/",
        "src/test_support/",
    ],
    rationale: "应用级存储资源应通过统一 facade 分配给具体业务模块消费",
}];

#[cfg(test)]
const APP_STORAGE_PRIVATE_NAMESPACES: &[ModulePrivateNamespaceTemplate] = &[
    ModulePrivateNamespaceTemplate {
        namespace: "crate::app::app_storage::storage_registry_app_service",
        allowed_paths: &["src/app/app_storage/", "src/test_support/"],
        rationale: "app-storage registry app service 属于应用级存储模块私有实现",
    },
    ModulePrivateNamespaceTemplate {
        namespace: "crate::infra::persistence::app_private_store",
        allowed_paths: &[
            "src/app/app_storage/",
            "src/infra/persistence/",
            "src/test_support/",
        ],
        rationale: "应用级私有存储基础设施仅供 app-storage 模块编排使用",
    },
];

/// 返回应用级存储模块 contribution。
pub(crate) fn app_storage_backend_module_contribution() -> BackendModuleContribution {
    BackendModuleContribution {
        module_id: "app-storage",
        command_ids: &[],
        events: &[],
        persistence_owners: &[],
        capability_catalog: None,
        capability_execute: None,
    }
}

/// 返回应用级存储模块 manifest。
pub(crate) fn app_storage_backend_module_manifest() -> BackendModuleManifest {
    let contribution = app_storage_backend_module_contribution();

    BackendModuleManifest {
        module_id: contribution.module_id,
        contribution,
        public_surfaces: APP_STORAGE_PUBLIC_SURFACES,
        #[cfg(test)]
        boundary_template: Some(ModuleBoundaryTemplate {
            module_id: "app-storage",
            private_namespaces: APP_STORAGE_PRIVATE_NAMESPACES,
        }),
    }
}
