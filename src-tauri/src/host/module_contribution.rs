//! # Host Platform Module Contribution
//!
//! 定义宿主平台层自身向统一模块贡献模型提供的元数据。
//! 该模块用于承载不属于具体业务扩展、但仍需要纳入统一装配视图的
//! 平台级命令与宿主桥接能力。

use crate::backend_module_manifest::BackendModuleManifest;
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
        #[cfg(test)]
        boundary_template: None,
    }
}