//! # 宿主事件模块
//!
//! 统一维护从 Rust 发往前端的事件桥接逻辑，避免应用服务层直接拼接
//! 事件名称和发射细节。

use std::collections::HashSet;

use crate::infra::logging::BACKEND_LOG_NOTIFICATION_EVENT_NAME;
use crate::module_contribution::{
	BackendEventDescriptor, BackendEventKind, BackendModuleContribution,
};

pub(crate) mod ai_events;

/// 返回宿主当前显式维护的内建 UI bridge 事件清单。
pub(crate) fn builtin_host_events() -> Vec<BackendEventDescriptor> {
	let mut events = Vec::new();
	events.extend(ai_events::AI_EVENTS.iter().copied());
	events.push(BackendEventDescriptor::new(
		BACKEND_LOG_NOTIFICATION_EVENT_NAME,
		BackendEventKind::UiBridge,
	));
	events
}

/// 校验宿主 UI bridge 事件边界与模块贡献元数据保持一致。
pub(crate) fn validate_registered_host_events(
	contributions: &[BackendModuleContribution],
	registered_events: &[BackendEventDescriptor],
) -> Result<(), String> {
	let declared_event_ids = contributions
		.iter()
		.flat_map(|contribution| contribution.ui_bridge_event_ids())
		.collect::<HashSet<_>>();

	let mut registered_seen = HashSet::new();
	for event in registered_events {
		if event.kind != BackendEventKind::UiBridge {
			return Err(format!(
				"registered host event must use ui_bridge kind: {}",
				event.id
			));
		}

		if event.id.trim().is_empty() {
			return Err("registered event_id must not be empty".to_string());
		}

		if !registered_seen.insert(event.id.to_string()) {
			return Err(format!("duplicate registered event_id detected: {}", event.id));
		}

		if !declared_event_ids.contains(event.id) {
			return Err(format!(
				"registered event_id is missing from backend module contributions: {}",
				event.id
			));
		}
	}

	for contribution in contributions {
		for event_id in contribution.ui_bridge_event_ids() {
			if !registered_seen.contains(event_id) {
				return Err(format!(
					"backend module contribution declares event_id that is missing from registered list: module={} event_id={}",
					contribution.module_id, event_id
				));
			}
		}
	}

	Ok(())
}

#[cfg(test)]
mod tests {
	use super::{builtin_host_events, validate_registered_host_events};
	use crate::module_contribution::{
		builtin_backend_module_contributions, BackendEventDescriptor, BackendEventKind,
		BackendModuleContribution,
	};

	#[test]
	fn registered_host_events_should_match_builtin_backend_module_contributions() {
		let contributions = builtin_backend_module_contributions();
		let events = builtin_host_events();

		validate_registered_host_events(&contributions, &events)
			.expect("宿主显式事件边界应与内建 backend module contributions 保持一致");
	}

	#[test]
	fn registered_host_events_should_reject_missing_contribution_event() {
		const DECLARED_EVENTS: &[BackendEventDescriptor] = &[BackendEventDescriptor::new(
			"event://declared",
			BackendEventKind::UiBridge,
		)];

		let contributions = vec![BackendModuleContribution {
			module_id: "module-a",
			command_ids: &[],
			events: DECLARED_EVENTS,
			persistence_owners: &[],
			capability_catalog: None,
			capability_execute: None,
		}];

		let error = validate_registered_host_events(&contributions, &[])
			.expect_err("未注册的贡献事件应被拒绝");

		assert!(error.contains("backend module contribution declares event_id that is missing from registered list"));
	}

	#[test]
	fn registered_host_events_should_reject_orphan_registered_event() {
		let contributions = vec![BackendModuleContribution {
			module_id: "module-a",
			command_ids: &[],
			events: &[],
			persistence_owners: &[],
			capability_catalog: None,
			capability_execute: None,
		}];

		let error = validate_registered_host_events(
			&contributions,
			&[BackendEventDescriptor::new(
				"event://orphan",
				BackendEventKind::UiBridge,
			)],
		)
			.expect_err("游离的注册事件应被拒绝");

		assert!(error.contains("registered event_id is missing from backend module contributions"));
	}

	#[test]
	fn registered_host_events_should_reject_duplicate_registered_event() {
		const SHARED_EVENTS: &[BackendEventDescriptor] = &[BackendEventDescriptor::new(
			"event://shared",
			BackendEventKind::UiBridge,
		)];

		let contributions = vec![BackendModuleContribution {
			module_id: "module-a",
			command_ids: &[],
			events: SHARED_EVENTS,
			persistence_owners: &[],
			capability_catalog: None,
			capability_execute: None,
		}];

		let error = validate_registered_host_events(
			&contributions,
			&[
				BackendEventDescriptor::new("event://shared", BackendEventKind::UiBridge),
				BackendEventDescriptor::new("event://shared", BackendEventKind::UiBridge),
			],
		)
		.expect_err("重复注册事件应被拒绝");

		assert!(error.contains("duplicate registered event_id detected"));
	}

	#[test]
	fn registered_host_events_should_reject_empty_registered_event() {
		let contributions = vec![BackendModuleContribution {
			module_id: "module-a",
			command_ids: &[],
			events: &[],
			persistence_owners: &[],
			capability_catalog: None,
			capability_execute: None,
		}];

		let error = validate_registered_host_events(
			&contributions,
			&[BackendEventDescriptor::new("", BackendEventKind::UiBridge)],
		)
			.expect_err("空注册事件应被拒绝");

		assert!(error.contains("registered event_id must not be empty"));
	}

	#[test]
	fn registered_host_events_should_reject_non_ui_bridge_registered_event() {
		let contributions = vec![BackendModuleContribution {
			module_id: "module-a",
			command_ids: &[],
			events: &[],
			persistence_owners: &[],
			capability_catalog: None,
			capability_execute: None,
		}];

		let error = validate_registered_host_events(
			&contributions,
			&[BackendEventDescriptor::new(
				"runtime://heartbeat",
				BackendEventKind::Runtime,
			)],
		)
		.expect_err("宿主显式事件边界不应注册非 ui bridge 事件");

		assert!(error.contains("registered host event must use ui_bridge kind"));
	}

	#[test]
	fn registered_host_events_should_ignore_non_ui_bridge_module_events() {
		const RUNTIME_EVENTS: &[BackendEventDescriptor] = &[BackendEventDescriptor::new(
			"runtime://heartbeat",
			BackendEventKind::Runtime,
		)];

		let contributions = vec![BackendModuleContribution {
			module_id: "module-a",
			command_ids: &[],
			events: RUNTIME_EVENTS,
			persistence_owners: &[],
			capability_catalog: None,
			capability_execute: None,
		}];

		validate_registered_host_events(&contributions, &[])
			.expect("非 ui bridge 事件不应强制出现在宿主前端事件边界中");
	}
}