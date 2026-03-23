//! # AI Module Contribution
//!
//! 定义 AI 后端模块向宿主平台贡献的模块元数据。
//! 当前阶段 AI 先贡献命令、事件与 persistence owner；
//! capability/tool 暴露仍主要通过平台 capability registry 投影其他模块能力。

use crate::backend_module_manifest::BackendModuleManifest;
use crate::host::commands::ai_commands::AI_COMMAND_IDS;
use crate::host::events::ai_events::AI_EVENTS;
use crate::infra::persistence::backend_plugin_store::AI_BACKEND_PLUGIN_ID;
use crate::module_contribution::BackendModuleContribution;

#[cfg(test)]
use crate::module_boundary_template::{ModuleBoundaryTemplate, ModulePrivateNamespaceTemplate};

const AI_PERSISTENCE_OWNERS: &[&str] = &[AI_BACKEND_PLUGIN_ID];

#[cfg(test)]
const AI_PRIVATE_NAMESPACES: &[ModulePrivateNamespaceTemplate] = &[
    ModulePrivateNamespaceTemplate {
        namespace: "crate::app::ai::",
        allowed_paths: &["src/app/ai/", "src/host/commands/ai_commands.rs"],
        rationale: "ai app service 是 AI 模块私有实现边界",
    },
    ModulePrivateNamespaceTemplate {
        namespace: "crate::infra::ai::",
        allowed_paths: &["src/app/ai/", "src/infra/ai/"],
        rationale: "AI infra adapter 不应被其他模块直接依赖",
    },
    ModulePrivateNamespaceTemplate {
        namespace: "crate::infra::persistence::ai_chat_store",
        allowed_paths: &[
            "src/app/ai/",
            "src/infra/ai/",
            "src/infra/persistence/ai_chat_store.rs",
        ],
        rationale: "AI chat store 属于 AI 模块私有持久化实现",
    },
];

/// 返回 AI 模块 contribution。
pub(crate) fn ai_backend_module_contribution() -> BackendModuleContribution {
    BackendModuleContribution {
        module_id: "ai-chat",
        command_ids: AI_COMMAND_IDS,
        events: AI_EVENTS,
        persistence_owners: AI_PERSISTENCE_OWNERS,
        capability_catalog: None,
        capability_execute: None,
    }
}

/// 返回 AI 模块 manifest。
pub(crate) fn ai_backend_module_manifest() -> BackendModuleManifest {
    let contribution = ai_backend_module_contribution();

    BackendModuleManifest {
        module_id: contribution.module_id,
        contribution,
        #[cfg(test)]
        boundary_template: Some(ModuleBoundaryTemplate {
            module_id: "ai-chat",
            private_namespaces: AI_PRIVATE_NAMESPACES,
        }),
    }
}
