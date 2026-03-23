//! # Platform Public Surface
//!
//! 定义当前后端允许跨模块依赖的稳定平台公共入口。
//! 该模块的目标是把“哪些边界可以被共享依赖”从文档约定收敛为
//! 可审查、可测试的工程清单。

/// 平台公共依赖面规则。
#[cfg_attr(not(test), allow(dead_code))]
pub(crate) struct PublicSurfaceRule {
    /// 允许被跨模块依赖的命名空间前缀。
    pub namespace: &'static str,
    /// 允许使用该公共依赖面的源码路径前缀。
    pub allowed_paths: &'static [&'static str],
    /// 保留该公共依赖面的原因说明。
    pub rationale: &'static str,
}

/// 返回当前后端已声明的平台公共依赖面清单。
#[cfg_attr(not(test), allow(dead_code))]
pub(crate) fn platform_public_surface_rules() -> &'static [PublicSurfaceRule] {
    &[
        PublicSurfaceRule {
            namespace: "crate::shared::backend_plugin_contracts",
            allowed_paths: &[
                "src/app/ai/",
                "src/host/commands/ai_commands.rs",
                "src/infra/persistence/backend_plugin_store.rs",
            ],
            rationale: "backend plugin 配置契约属于稳定 shared contract",
        },
        PublicSurfaceRule {
            namespace: "crate::shared::persistence_contracts",
            allowed_paths: &[
                "src/domain/persistence/",
                "src/app/persistence/",
                "src/app/ai/persistence_callback_app_service.rs",
                "src/host/commands/persistence_commands.rs",
            ],
            rationale: "宿主持久化协议是跨模块协作的稳定 contract",
        },
        PublicSurfaceRule {
            namespace: "crate::shared::vault_contracts",
            allowed_paths: &[
                "src/app/vault/",
                "src/host/commands/vault_commands.rs",
                "src/infra/fs/",
                "src/infra/query/",
                "src/infra/persistence/",
                "src/test_support/",
            ],
            rationale: "vault 输入输出与配置结构属于稳定 shared contract",
        },
        PublicSurfaceRule {
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
        PublicSurfaceRule {
            namespace: "crate::app::capability::",
            allowed_paths: &[
                "src/app/capability/",
                "src/app/ai/",
                "src/host/commands/capability_commands.rs",
            ],
            rationale: "capability app facade 是跨模块能力执行与目录访问入口",
        },
        PublicSurfaceRule {
            namespace: "crate::app::persistence::persistence_app_service",
            allowed_paths: &[
                "src/app/ai/persistence_callback_app_service.rs",
                "src/host/commands/persistence_commands.rs",
            ],
            rationale: "宿主持久化协议的执行入口应通过统一 persistence app facade 访问",
        },
        PublicSurfaceRule {
            namespace: "crate::host::events::",
            allowed_paths: &[
                "src/app/ai/",
                "src/host/",
            ],
            rationale: "宿主事件桥接是应用层向前端发射事件的稳定边界",
        },
        PublicSurfaceRule {
            namespace: "crate::backend_module_manifest",
            allowed_paths: &[
                "src/module_contribution.rs",
                "src/module_boundary_template.rs",
                "src/app/ai/module_contribution.rs",
                "src/app/vault/module_contribution.rs",
                "src/host/module_contribution.rs",
            ],
            rationale: "backend module manifest 是模块接入平台的统一入口",
        },
        PublicSurfaceRule {
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
        PublicSurfaceRule {
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
        PublicSurfaceRule {
            namespace: "crate::ai_service::",
            allowed_paths: &[
                "src/app/ai/",
                "src/infra/ai/",
                "src/infra/persistence/ai_chat_store.rs",
                "src/host/commands/ai_commands.rs",
                "src/host/events/ai_events.rs",
            ],
            rationale: "AI protobuf 与流式事件 payload 属于 AI 共享契约边界",
        },
    ]
}