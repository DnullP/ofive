//! # Host Platform Module Contribution
//!
//! 定义宿主平台层自身向统一模块贡献模型提供的元数据。
//! 该模块用于承载不属于具体业务扩展、但仍需要纳入统一装配视图的
//! 平台级命令与宿主桥接能力。

use crate::backend_module_manifest::{BackendModuleManifest, BackendModulePublicSurface};
use crate::frontend_log::FRONTEND_LOG_COMMAND_IDS;
use crate::host::commands::capability_commands::CAPABILITY_COMMAND_IDS;
use crate::host::commands::persistence_commands::PERSISTENCE_COMMAND_IDS;
use crate::host::commands::window_commands::WINDOW_COMMAND_IDS;
use crate::module_contribution::BackendModuleContribution;

const HOST_PLATFORM_COMMAND_IDS: &[&str] = &[
    CAPABILITY_COMMAND_IDS[0],
    PERSISTENCE_COMMAND_IDS[0],
    WINDOW_COMMAND_IDS[0],
    FRONTEND_LOG_COMMAND_IDS[0],
];

const HOST_PLATFORM_PUBLIC_SURFACES: &[BackendModulePublicSurface] = &[
    BackendModulePublicSurface {
        namespace: "crate::shared::persistence_contracts",
        allowed_paths: &[
            "src/domain/persistence/",
            "src/app/persistence/",
            "src/app/ai/persistence_callback_app_service.rs",
            "src/host/commands/persistence_commands.rs",
        ],
        rationale: "宿主持久化协议是跨模块协作的稳定 contract",
    },
    BackendModulePublicSurface {
        namespace: "crate::domain::capability::",
        allowed_paths: &[
            "src/domain/ai/",
            "src/domain/capability/",
            "src/app/capability/",
            "src/app/ai/",
            "src/app/vault/",
            "src/host/commands/capability_commands.rs",
            "src/module_contribution.rs",
        ],
        rationale: "capability descriptor、registry 与 policy 属于平台能力治理边界",
    },
    BackendModulePublicSurface {
        namespace: "crate::app::capability::",
        allowed_paths: &[
            "src/app/capability/",
            "src/app/ai/",
            "src/host/commands/capability_commands.rs",
        ],
        rationale: "capability app facade 是跨模块能力执行与目录访问入口",
    },
    BackendModulePublicSurface {
        namespace: "crate::app::persistence::persistence_app_service",
        allowed_paths: &[
            "src/app/ai/persistence_callback_app_service.rs",
            "src/host/commands/persistence_commands.rs",
        ],
        rationale: "宿主持久化协议的执行入口应通过统一 persistence app facade 访问",
    },
    BackendModulePublicSurface {
        namespace: "crate::host::events::",
        allowed_paths: &["src/app/ai/", "src/host/"],
        rationale: "宿主事件桥接是应用层向前端发射事件的稳定边界",
    },
    BackendModulePublicSurface {
        namespace: "crate::backend_module_manifest",
        allowed_paths: &[
            "src/platform_public_surface.rs",
            "src/module_contribution.rs",
            "src/module_boundary_template.rs",
            "src/app/ai/module_contribution.rs",
            "src/app/vault/module_contribution.rs",
            "src/host/module_contribution.rs",
        ],
        rationale: "backend module manifest 是模块接入平台的统一入口",
    },
    BackendModulePublicSurface {
        namespace: "crate::module_contribution",
        allowed_paths: &[
            "src/lib.rs",
            "src/backend_module_manifest.rs",
            "src/host/",
            "src/module_boundary_template.rs",
            "src/app/ai/module_contribution.rs",
            "src/app/vault/module_contribution.rs",
            "src/app/persistence/persistence_app_service.rs",
            "src/domain/capability/contribution.rs",
            "src/app/capability/contribution.rs",
        ],
        rationale: "module contribution 是平台装配与治理的稳定入口",
    },
    BackendModulePublicSurface {
        namespace: "crate::state::",
        allowed_paths: &[
            "src/app/",
            "src/host/",
            "src/runtime/",
            "src/infra/ai/",
            "src/infra/fs/",
            "src/infra/persistence/ai_chat_store.rs",
        ],
        rationale: "AppState 与运行时句柄属于平台级共享 runtime 能力",
    },
];

/// 返回宿主平台层的统一模块贡献。
pub(crate) fn host_platform_backend_module_contribution() -> BackendModuleContribution {
    BackendModuleContribution {
        module_id: "host-platform",
        command_ids: HOST_PLATFORM_COMMAND_IDS,
        events: &[],
        persistence_owners: &[],
        capability_catalog: None,
        capability_execute: None,
    }
}

/// 返回宿主平台层 manifest。
pub(crate) fn host_platform_backend_module_manifest() -> BackendModuleManifest {
    let contribution = host_platform_backend_module_contribution();

    BackendModuleManifest {
        module_id: contribution.module_id,
        contribution,
        public_surfaces: HOST_PLATFORM_PUBLIC_SURFACES,
        #[cfg(test)]
        boundary_template: None,
    }
}
