//! # Vault Module Contribution
//!
//! 定义 Vault 后端模块向宿主平台贡献的模块元数据。

use crate::backend_module_manifest::{BackendModuleManifest, BackendModulePublicSurface};
use crate::host::commands::vault_commands::VAULT_COMMAND_IDS;
use crate::module_contribution::BackendModuleContribution;

#[cfg(test)]
use crate::module_boundary_template::{ModuleBoundaryTemplate, ModulePrivateNamespaceTemplate};

const VAULT_PUBLIC_SURFACES: &[BackendModulePublicSurface] = &[
    BackendModulePublicSurface {
        namespace: "crate::shared::vault_contracts",
        allowed_paths: &[
            "src/app/vault/",
            "src/host/commands/vault_commands.rs",
            "src/infra/fs/",
            "src/infra/query/",
            "src/infra/persistence/",
            "src/test_support/",
            "src/app/sync/",
        ],
        rationale: "vault 输入输出与配置结构属于 Vault 模块对外复用的稳定 shared contract",
    },
    BackendModulePublicSurface {
        namespace: "crate::app::vault::sync_facade",
        allowed_paths: &["src/app/sync/", "src/app/vault/"],
        rationale: "sync facade 是 Vault 向未来同步模块暴露的受管控消费入口",
    },
    BackendModulePublicSurface {
        namespace: "crate::app::vault::query_facade",
        allowed_paths: &["src/app/semantic_index/", "src/app/vault/"],
        rationale: "query facade 是 Vault 向语义索引暴露的只读查询入口",
    },
];

#[cfg(test)]
const VAULT_PRIVATE_NAMESPACES: &[ModulePrivateNamespaceTemplate] = &[
    ModulePrivateNamespaceTemplate {
        namespace: "crate::app::vault::vault_app_service",
        allowed_paths: &[
            "src/app/vault/",
            "src/host/bootstrap.rs",
            "src/host/commands/vault_commands.rs",
            "src/test_support/",
        ],
        rationale:
            "vault app service 是 Vault 模块私有实现边界；宿主启动桥接仅可访问显式声明的预热入口",
    },
    ModulePrivateNamespaceTemplate {
        namespace: "crate::app::vault::query_app_service",
        allowed_paths: &[
            "src/app/vault/",
            "src/host/bootstrap.rs",
            "src/host/commands/vault_commands.rs",
            "src/test_support/",
        ],
        rationale: "vault query app service 是 Vault 模块私有实现边界",
    },
    ModulePrivateNamespaceTemplate {
        namespace: "crate::app::vault::canvas_app_service",
        allowed_paths: &["src/app/vault/", "src/test_support/"],
        rationale: "vault canvas app service 是 Vault 模块私有实现边界",
    },
    ModulePrivateNamespaceTemplate {
        namespace: "crate::app::vault::markdown_patch_app_service",
        allowed_paths: &["src/app/vault/", "src/test_support/"],
        rationale: "vault markdown patch app service 是 Vault 模块私有实现边界",
    },
    ModulePrivateNamespaceTemplate {
        namespace: "crate::app::vault::capability_execution",
        allowed_paths: &["src/app/vault/", "src/test_support/"],
        rationale: "vault capability execution 是 Vault 模块私有实现边界",
    },
    ModulePrivateNamespaceTemplate {
        namespace: "crate::infra::fs::vault_runtime",
        allowed_paths: &["src/app/vault/", "src/infra/fs/"],
        rationale: "Vault runtime 仅供 Vault app 编排层使用",
    },
    ModulePrivateNamespaceTemplate {
        namespace: "crate::infra::fs::write_runtime",
        allowed_paths: &["src/app/vault/", "src/infra/fs/"],
        rationale: "Vault 写入 runtime 仅供 Vault app 编排层使用",
    },
    ModulePrivateNamespaceTemplate {
        namespace: "crate::infra::query::",
        allowed_paths: &[
            "src/app/vault/",
            "src/infra/fs/",
            "src/infra/query/",
            "src/test_support/",
        ],
        rationale: "Vault 查询 infra 属于 Vault 模块私有实现",
    },
];

/// 返回 Vault 模块 contribution。
pub(crate) fn vault_backend_module_contribution() -> BackendModuleContribution {
    BackendModuleContribution {
        module_id: "vault",
        command_ids: VAULT_COMMAND_IDS,
        events: &[],
        persistence_owners: &[],
        capability_catalog: Some(crate::domain::capability::vault_capability_descriptors),
        capability_execute: Some(crate::app::vault::capability_execution::execute_vault_capability),
    }
}

/// 返回 Vault 模块 manifest。
pub(crate) fn vault_backend_module_manifest() -> BackendModuleManifest {
    let contribution = vault_backend_module_contribution();

    BackendModuleManifest {
        module_id: contribution.module_id,
        contribution,
        public_surfaces: VAULT_PUBLIC_SURFACES,
        #[cfg(test)]
        boundary_template: Some(ModuleBoundaryTemplate {
            module_id: "vault",
            private_namespaces: VAULT_PRIVATE_NAMESPACES,
        }),
    }
}
