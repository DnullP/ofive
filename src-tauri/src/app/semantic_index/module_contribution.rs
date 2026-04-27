//! # Semantic Index Module Contribution
//!
//! 定义语义索引后端模块向宿主平台贡献的模块元数据。

use crate::backend_module_manifest::{BackendModuleManifest, BackendModulePublicSurface};
use crate::host::commands::semantic_index_commands::SEMANTIC_INDEX_COMMAND_IDS;
use crate::module_contribution::BackendModuleContribution;

#[cfg(test)]
use crate::module_boundary_template::{ModuleBoundaryTemplate, ModulePrivateNamespaceTemplate};

const SEMANTIC_INDEX_PERSISTENCE_OWNERS: &[&str] = &["semantic-index"];

const SEMANTIC_INDEX_PUBLIC_SURFACES: &[BackendModulePublicSurface] = &[
    BackendModulePublicSurface {
        namespace: "crate::shared::semantic_index_contracts",
        allowed_paths: &[
            "src/app/semantic_index/",
            "src/domain/capability/semantic_index_catalog.rs",
            "src/host/commands/semantic_index_commands.rs",
            "src/infra/vector/",
            "src/shared/semantic_index_contracts.rs",
            "src/test_support/",
        ],
        rationale: "semantic-index 对外稳定输入输出契约应通过 shared contract 受控复用",
    },
    BackendModulePublicSurface {
        namespace: "crate::app::semantic_index::index_facade",
        allowed_paths: &[
            "src/app/semantic_index/",
            "src/app/vault/",
            "src/host/",
            "src/test_support/",
        ],
        rationale: "semantic-index facade 是 Vault 与 Host 消费语义索引生命周期的受管控入口",
    },
];

#[cfg(test)]
const SEMANTIC_INDEX_PRIVATE_NAMESPACES: &[ModulePrivateNamespaceTemplate] = &[
    ModulePrivateNamespaceTemplate {
        namespace: "crate::app::semantic_index::index_app_service",
        allowed_paths: &[
            "src/app/semantic_index/",
            "src/domain/capability/semantic_index_catalog.rs",
            "src/test_support/",
        ],
        rationale: "semantic-index index_app_service 属于语义索引模块私有实现边界",
    },
    ModulePrivateNamespaceTemplate {
        namespace: "crate::app::semantic_index::capability_execution",
        allowed_paths: &["src/app/semantic_index/", "src/test_support/"],
        rationale: "semantic-index capability execution 属于语义索引模块私有实现边界",
    },
    ModulePrivateNamespaceTemplate {
        namespace: "crate::infra::vector::",
        allowed_paths: &[
            "src/app/semantic_index/",
            "src/infra/vector/",
            "src/test_support/",
        ],
        rationale: "向量 infra 仅供语义索引模块内部编排使用",
    },
];

/// 返回语义索引模块 contribution。
pub(crate) fn semantic_index_backend_module_contribution() -> BackendModuleContribution {
    BackendModuleContribution {
        module_id: "semantic-index",
        command_ids: SEMANTIC_INDEX_COMMAND_IDS,
        events: &[],
        persistence_owners: SEMANTIC_INDEX_PERSISTENCE_OWNERS,
        capability_catalog: Some(crate::domain::capability::semantic_index_capability_descriptors),
        capability_execute: Some(
            crate::app::semantic_index::capability_execution::execute_semantic_index_capability,
        ),
    }
}

/// 返回语义索引模块 manifest。
pub(crate) fn semantic_index_backend_module_manifest() -> BackendModuleManifest {
    let contribution = semantic_index_backend_module_contribution();

    BackendModuleManifest {
        module_id: contribution.module_id,
        contribution,
        public_surfaces: SEMANTIC_INDEX_PUBLIC_SURFACES,
        #[cfg(test)]
        boundary_template: Some(ModuleBoundaryTemplate {
            module_id: "semantic-index",
            private_namespaces: SEMANTIC_INDEX_PRIVATE_NAMESPACES,
        }),
    }
}
