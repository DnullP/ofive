//! # Backend Module Contributions
//!
//! 定义宿主内建后端模块向平台装配层贡献元数据与稳定能力入口的统一结构。
//! 当前阶段先覆盖：
//!
//! - 模块标识
//! - command IDs
//! - event IDs
//! - persistence owners
//! - capability catalog contribution
//! - capability execution contribution
//!
//! 该模型的目标不是一次性取代所有中央注册，而是逐步让中央层从
//! “手工堆模块细节”演进为“收集模块贡献并统一装配”。

use serde_json::Value;
use std::collections::HashSet;
use std::path::Path;

use crate::backend_module_manifest::builtin_backend_module_manifests;
use crate::domain::capability::{
    CapabilityConsumer, CapabilityDescriptor, CapabilityExecutionContext,
    CapabilityExecutionRequest,
};

/// 后端事件分类。
#[cfg_attr(not(test), allow(dead_code))]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum BackendEventKind {
    /// 仅在后端内部传播的领域事件。
    Domain,
    /// 从宿主桥接到前端订阅方的界面事件。
    UiBridge,
    /// 面向运行时基础设施的事件。
    Runtime,
}

/// 后端事件描述结构。
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct BackendEventDescriptor {
    /// 事件唯一标识。
    pub id: &'static str,
    /// 事件分类。
    pub kind: BackendEventKind,
}

impl BackendEventDescriptor {
    /// 创建一个后端事件描述。
    pub(crate) const fn new(id: &'static str, kind: BackendEventKind) -> Self {
        Self { id, kind }
    }
}

/// 后端模块贡献结构。
pub(crate) struct BackendModuleContribution {
    /// 模块唯一标识。
    pub module_id: &'static str,
    /// 该模块贡献的命令 ID 元数据。
    pub command_ids: &'static [&'static str],
    /// 该模块贡献的事件元数据。
    pub events: &'static [BackendEventDescriptor],
    /// 该模块管理的持久化 owner 列表。
    pub persistence_owners: &'static [&'static str],
    /// 该模块贡献的 capability catalog 入口。
    pub capability_catalog: Option<fn() -> Vec<CapabilityDescriptor>>,
    /// 该模块贡献的 capability execution 入口。
    pub capability_execute: Option<
        for<'a> fn(
            &CapabilityExecutionRequest,
            &CapabilityExecutionContext<'a>,
        ) -> Option<Result<Value, String>>,
    >,
}

impl BackendModuleContribution {
    /// 返回该模块声明的 UI bridge 事件 ID。
    pub(crate) fn ui_bridge_event_ids(&self) -> impl Iterator<Item = &'static str> + '_ {
        self.events
            .iter()
            .filter(|event| event.kind == BackendEventKind::UiBridge)
            .map(|event| event.id)
    }
}

/// 返回当前宿主内建模块 contribution 列表。
pub(crate) fn builtin_backend_module_contributions() -> Vec<BackendModuleContribution> {
    builtin_backend_module_manifests()
        .into_iter()
        .map(|manifest| manifest.contribution)
        .collect()
}

/// 按模块 ID 查找内建后端模块贡献。
pub(crate) fn find_builtin_backend_module_contribution(
    module_id: &str,
) -> Option<BackendModuleContribution> {
    builtin_backend_module_contributions()
        .into_iter()
        .find(|contribution| contribution.module_id == module_id)
}

/// 判断指定模块是否声明了给定的 persistence owner。
pub(crate) fn module_declares_persistence_owner(module_id: &str, owner: &str) -> bool {
    find_builtin_backend_module_contribution(module_id)
        .map(|contribution| contribution.persistence_owners.contains(&owner))
        .unwrap_or(false)
}

/// 校验模块贡献元数据的基础一致性。
pub(crate) fn validate_backend_module_contributions(
    contributions: &[BackendModuleContribution],
) -> Result<(), String> {
    let mut module_ids = HashSet::new();
    let mut command_ids = HashSet::new();
    let mut event_ids = HashSet::new();
    let mut persistence_owners = HashSet::new();

    for contribution in contributions {
        ensure_identifier(contribution.module_id, "module_id", contribution.module_id)?;

        if !module_ids.insert(contribution.module_id.to_string()) {
            return Err(format!(
                "duplicate backend module_id declared: {}",
                contribution.module_id
            ));
        }

        ensure_unique_identifiers(
            contribution.module_id,
            "command_id",
            contribution.command_ids,
            &mut command_ids,
        )?;
        ensure_unique_event_descriptors(contribution, &mut event_ids)?;
        ensure_unique_identifiers(
            contribution.module_id,
            "persistence_owner",
            contribution.persistence_owners,
            &mut persistence_owners,
        )?;
    }

    validate_backend_module_capability_contributions(contributions)?;

    Ok(())
}

/// 校验 capability catalog 与 execution route 的闭环关系。
pub(crate) fn validate_backend_module_capability_contributions(
    contributions: &[BackendModuleContribution],
) -> Result<(), String> {
    let mut capability_ids = HashSet::new();
    let execution_contributions = contributions
        .iter()
        .filter_map(|contribution| {
            contribution
                .capability_execute
                .map(|execute| (contribution.module_id, execute))
        })
        .collect::<Vec<_>>();
    let probe_context = CapabilityExecutionContext {
        vault_root: Path::new("/__ofive_capability_probe__"),
    };

    for contribution in contributions {
        match (
            contribution.capability_catalog,
            contribution.capability_execute,
        ) {
            (Some(_), None) => {
                return Err(format!(
                    "backend module contribution declares capability catalog without execution route: module={}",
                    contribution.module_id
                ));
            }
            (None, Some(_)) => {
                return Err(format!(
                    "backend module contribution declares capability execution without catalog: module={}",
                    contribution.module_id
                ));
            }
            _ => {}
        }

        let Some(catalog) = contribution.capability_catalog else {
            continue;
        };

        for descriptor in catalog() {
            validate_capability_descriptor(&descriptor, contribution.module_id)?;

            if !capability_ids.insert(descriptor.id.clone()) {
                return Err(format!(
                    "duplicate capability_id declared across backend modules: {}",
                    descriptor.id
                ));
            }

            let probe_request = CapabilityExecutionRequest {
                capability_id: descriptor.id.clone(),
                consumer: CapabilityConsumer::Frontend,
                input: Value::Null,
            };
            let matched_modules = execution_contributions
                .iter()
                .filter_map(|(module_id, execute)| {
                    execute(&probe_request, &probe_context).map(|_| *module_id)
                })
                .collect::<Vec<_>>();

            if matched_modules.is_empty() {
                return Err(format!(
                    "capability descriptor has no execution route: module={} capability_id={}",
                    contribution.module_id, descriptor.id
                ));
            }

            if matched_modules.len() > 1 {
                return Err(format!(
                    "capability descriptor matched multiple execution routes: capability_id={} modules={:?}",
                    descriptor.id, matched_modules
                ));
            }

            if matched_modules[0] != contribution.module_id {
                return Err(format!(
                    "capability descriptor routed to a different module execution: declared_module={} routed_module={} capability_id={}",
                    contribution.module_id, matched_modules[0], descriptor.id
                ));
            }
        }
    }

    Ok(())
}

fn ensure_unique_identifiers(
    module_id: &str,
    identifier_kind: &str,
    identifiers: &[&str],
    global_seen: &mut HashSet<String>,
) -> Result<(), String> {
    let mut local_seen = HashSet::new();

    for identifier in identifiers {
        ensure_identifier(identifier, identifier_kind, module_id)?;

        if !local_seen.insert(*identifier) {
            return Err(format!(
                "duplicate {} declared inside module {}: {}",
                identifier_kind, module_id, identifier
            ));
        }

        if !global_seen.insert((*identifier).to_string()) {
            return Err(format!(
                "duplicate {} declared across backend modules: {}",
                identifier_kind, identifier
            ));
        }
    }

    Ok(())
}

fn ensure_unique_event_descriptors(
    contribution: &BackendModuleContribution,
    global_seen: &mut HashSet<String>,
) -> Result<(), String> {
    let mut local_seen = HashSet::new();

    for event in contribution.events {
        ensure_identifier(event.id, "event_id", contribution.module_id)?;

        if !local_seen.insert(event.id) {
            return Err(format!(
                "duplicate event_id declared inside module {}: {}",
                contribution.module_id, event.id
            ));
        }

        if !global_seen.insert(event.id.to_string()) {
            return Err(format!(
                "duplicate event_id declared across backend modules: {}",
                event.id
            ));
        }
    }

    Ok(())
}

fn ensure_identifier(
    identifier: &str,
    identifier_kind: &str,
    module_id: &str,
) -> Result<(), String> {
    if identifier.trim().is_empty() {
        return Err(format!(
            "{} declared by module {} must not be empty",
            identifier_kind, module_id
        ));
    }

    Ok(())
}

fn validate_capability_descriptor(
    descriptor: &CapabilityDescriptor,
    module_id: &str,
) -> Result<(), String> {
    ensure_identifier(&descriptor.id, "capability_id", module_id)?;
    ensure_identifier(&descriptor.api_version, "capability_api_version", module_id)?;
    ensure_identifier(
        &descriptor.display_name,
        "capability_display_name",
        module_id,
    )?;
    ensure_identifier(&descriptor.description, "capability_description", module_id)?;

    if descriptor.required_permissions.is_empty() {
        return Err(format!(
            "capability descriptor must declare at least one permission: module={} capability_id={}",
            module_id, descriptor.id
        ));
    }

    if descriptor.supported_consumers.is_empty() {
        return Err(format!(
            "capability descriptor must declare at least one supported consumer: module={} capability_id={}",
            module_id, descriptor.id
        ));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use serde_json::json;
    use serde_json::Value;

    use super::{
        builtin_backend_module_contributions, validate_backend_module_capability_contributions,
        validate_backend_module_contributions, BackendEventDescriptor, BackendEventKind,
        BackendModuleContribution,
    };
    use crate::domain::capability::{
        CapabilityConsumer, CapabilityDescriptor, CapabilityExecutionContext,
        CapabilityExecutionRequest, CapabilityKind, CapabilityRiskLevel,
    };

    #[test]
    fn builtin_backend_module_contributions_should_be_consistent() {
        let contributions = builtin_backend_module_contributions();

        validate_backend_module_contributions(&contributions)
            .expect("内建 backend module contribution 应保持一致");
    }

    #[test]
    fn backend_module_contributions_should_reject_duplicate_command_ids() {
        let contributions = vec![
            BackendModuleContribution {
                module_id: "module-a",
                command_ids: &["shared-command"],
                events: &[],
                persistence_owners: &[],
                capability_catalog: None,
                capability_execute: None,
            },
            BackendModuleContribution {
                module_id: "module-b",
                command_ids: &["shared-command"],
                events: &[],
                persistence_owners: &[],
                capability_catalog: None,
                capability_execute: None,
            },
        ];

        let error = validate_backend_module_contributions(&contributions)
            .expect_err("重复 command_id 应被拒绝");

        assert!(error.contains("duplicate command_id declared across backend modules"));
    }

    #[test]
    fn backend_module_contributions_should_reject_empty_event_ids() {
        const INVALID_EVENTS: &[BackendEventDescriptor] =
            &[BackendEventDescriptor::new("", BackendEventKind::UiBridge)];

        let contributions = vec![BackendModuleContribution {
            module_id: "module-a",
            command_ids: &[],
            events: INVALID_EVENTS,
            persistence_owners: &[],
            capability_catalog: None,
            capability_execute: None,
        }];

        let error = validate_backend_module_contributions(&contributions)
            .expect_err("空 event_id 应被拒绝");

        assert!(error.contains("event_id declared by module module-a must not be empty"));
    }

    #[test]
    fn backend_module_contributions_should_reject_duplicate_event_ids() {
        const MODULE_A_EVENTS: &[BackendEventDescriptor] = &[BackendEventDescriptor::new(
            "event://shared",
            BackendEventKind::UiBridge,
        )];
        const MODULE_B_EVENTS: &[BackendEventDescriptor] = &[BackendEventDescriptor::new(
            "event://shared",
            BackendEventKind::Domain,
        )];

        let contributions = vec![
            BackendModuleContribution {
                module_id: "module-a",
                command_ids: &[],
                events: MODULE_A_EVENTS,
                persistence_owners: &[],
                capability_catalog: None,
                capability_execute: None,
            },
            BackendModuleContribution {
                module_id: "module-b",
                command_ids: &[],
                events: MODULE_B_EVENTS,
                persistence_owners: &[],
                capability_catalog: None,
                capability_execute: None,
            },
        ];

        let error = validate_backend_module_contributions(&contributions)
            .expect_err("重复 event_id 应被拒绝");

        assert!(error.contains("duplicate event_id declared across backend modules"));
    }

    #[test]
    fn builtin_backend_module_capability_contributions_should_be_consistent() {
        let contributions = builtin_backend_module_contributions();

        validate_backend_module_capability_contributions(&contributions)
            .expect("内建 capability contributions 应保持一致");
    }

    #[test]
    fn backend_module_capability_contributions_should_reject_duplicate_capability_ids() {
        fn catalog_a() -> Vec<CapabilityDescriptor> {
            vec![test_capability_descriptor("shared.capability")]
        }

        fn catalog_b() -> Vec<CapabilityDescriptor> {
            vec![test_capability_descriptor("shared.capability")]
        }

        fn execute_module_a(
            request: &CapabilityExecutionRequest,
            _: &CapabilityExecutionContext<'_>,
        ) -> Option<Result<Value, String>> {
            (request.capability_id == "shared.capability").then(|| Ok(json!({"ok": true})))
        }

        fn execute_module_b(
            _: &CapabilityExecutionRequest,
            _: &CapabilityExecutionContext<'_>,
        ) -> Option<Result<Value, String>> {
            None
        }

        let contributions = vec![
            BackendModuleContribution {
                module_id: "module-a",
                command_ids: &[],
                events: &[],
                persistence_owners: &[],
                capability_catalog: Some(catalog_a),
                capability_execute: Some(execute_module_a),
            },
            BackendModuleContribution {
                module_id: "module-b",
                command_ids: &[],
                events: &[],
                persistence_owners: &[],
                capability_catalog: Some(catalog_b),
                capability_execute: Some(execute_module_b),
            },
        ];

        let error = validate_backend_module_capability_contributions(&contributions)
            .expect_err("重复 capability_id 应被拒绝");

        assert!(error.contains("duplicate capability_id declared across backend modules"));
    }

    #[test]
    fn backend_module_capability_contributions_should_reject_missing_execution_route() {
        fn catalog_only() -> Vec<CapabilityDescriptor> {
            vec![test_capability_descriptor("module.only")]
        }

        let contributions = vec![BackendModuleContribution {
            module_id: "module-a",
            command_ids: &[],
            events: &[],
            persistence_owners: &[],
            capability_catalog: Some(catalog_only),
            capability_execute: None,
        }];

        let error = validate_backend_module_capability_contributions(&contributions)
            .expect_err("catalog 缺少 execution route 应被拒绝");

        assert!(error.contains("declares capability catalog without execution route"));
    }

    #[test]
    fn backend_module_capability_contributions_should_reject_empty_supported_consumers() {
        fn catalog_invalid() -> Vec<CapabilityDescriptor> {
            vec![CapabilityDescriptor {
                supported_consumers: vec![],
                ..test_capability_descriptor("module.invalid")
            }]
        }

        fn execute_invalid(
            request: &CapabilityExecutionRequest,
            _: &CapabilityExecutionContext<'_>,
        ) -> Option<Result<Value, String>> {
            (request.capability_id == "module.invalid").then(|| Err("invalid".to_string()))
        }

        let contributions = vec![BackendModuleContribution {
            module_id: "module-a",
            command_ids: &[],
            events: &[],
            persistence_owners: &[],
            capability_catalog: Some(catalog_invalid),
            capability_execute: Some(execute_invalid),
        }];

        let error = validate_backend_module_capability_contributions(&contributions)
            .expect_err("空 supported_consumers 应被拒绝");

        assert!(error.contains("must declare at least one supported consumer"));
    }

    fn test_capability_descriptor(capability_id: &str) -> CapabilityDescriptor {
        CapabilityDescriptor {
            id: capability_id.to_string(),
            api_version: "2026-03-17".to_string(),
            display_name: "Test Capability".to_string(),
            description: "test description".to_string(),
            kind: CapabilityKind::Read,
            input_schema: json!({"type": "object"}),
            output_schema: json!({"type": "object"}),
            risk_level: CapabilityRiskLevel::Low,
            requires_confirmation: false,
            required_permissions: vec!["test.read".to_string()],
            supported_consumers: vec![CapabilityConsumer::Frontend],
        }
    }
}
