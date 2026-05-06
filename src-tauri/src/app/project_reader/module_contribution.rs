//! # Project Reader Module Contribution
//!
//! 定义外部项目只读阅读器向宿主平台注册的模块元数据。

use crate::backend_module_manifest::{BackendModuleManifest, BackendModulePublicSurface};
use crate::host::commands::project_reader_commands::PROJECT_READER_COMMAND_IDS;
use crate::module_contribution::BackendModuleContribution;

#[cfg(test)]
use crate::module_boundary_template::{ModuleBoundaryTemplate, ModulePrivateNamespaceTemplate};

const PROJECT_READER_PUBLIC_SURFACES: &[BackendModulePublicSurface] =
    &[BackendModulePublicSurface {
        namespace: "crate::shared::project_reader_contracts",
        allowed_paths: &[
            "src/domain/capability/project_reader_catalog.rs",
            "src/app/project_reader/",
            "src/host/commands/project_reader_commands.rs",
            "src/shared/project_reader_contracts.rs",
            "src/test_support/",
        ],
        rationale: "project-reader 的前后端输入输出应通过 shared contract 受控复用",
    }];

#[cfg(test)]
const PROJECT_READER_PRIVATE_NAMESPACES: &[ModulePrivateNamespaceTemplate] =
    &[ModulePrivateNamespaceTemplate {
        namespace: "crate::app::project_reader::project_reader_app_service",
        allowed_paths: &[
            "src/app/project_reader/",
            "src/host/commands/project_reader_commands.rs",
            "src/test_support/",
        ],
        rationale: "project-reader app service 属于外部项目阅读器模块私有实现边界",
    },
    ModulePrivateNamespaceTemplate {
        namespace: "crate::app::project_reader::capability_execution",
        allowed_paths: &[
            "src/app/project_reader/",
            "src/domain/capability/project_reader_catalog.rs",
            "src/test_support/",
        ],
        rationale: "project-reader capability execution 属于外部项目阅读器模块私有实现边界",
    }];

const PROJECT_READER_PERSISTENCE_OWNERS: &[&str] = &["project-reader"];

/// 返回 Project Reader 模块 contribution。
pub(crate) fn project_reader_backend_module_contribution() -> BackendModuleContribution {
    BackendModuleContribution {
        module_id: "project-reader",
        command_ids: PROJECT_READER_COMMAND_IDS,
        events: &[],
        persistence_owners: PROJECT_READER_PERSISTENCE_OWNERS,
        capability_catalog: Some(crate::domain::capability::project_reader_capability_descriptors),
        capability_execute: Some(
            crate::app::project_reader::capability_execution::execute_project_reader_capability,
        ),
    }
}

/// 返回 Project Reader 模块 manifest。
pub(crate) fn project_reader_backend_module_manifest() -> BackendModuleManifest {
    let contribution = project_reader_backend_module_contribution();

    BackendModuleManifest {
        module_id: contribution.module_id,
        contribution,
        public_surfaces: PROJECT_READER_PUBLIC_SURFACES,
        #[cfg(test)]
        boundary_template: Some(ModuleBoundaryTemplate {
            module_id: "project-reader",
            private_namespaces: PROJECT_READER_PRIVATE_NAMESPACES,
        }),
    }
}
