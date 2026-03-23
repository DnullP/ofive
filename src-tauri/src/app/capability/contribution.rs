//! # Capability Execution Contributions
//!
//! 定义模块向公共 capability execution 入口贡献执行路由的稳定结构。
//! 中央执行层只负责收集 contribution 并顺序尝试路由。

use serde_json::Value;

use crate::domain::capability::{CapabilityExecutionContext, CapabilityExecutionRequest};
use crate::module_contribution::builtin_backend_module_contributions;

/// 聚合当前内建模块的 capability execution contributions。
pub(crate) fn builtin_capability_execution_contributions() -> Vec<(
    &'static str,
    for<'a> fn(
        &CapabilityExecutionRequest,
        &CapabilityExecutionContext<'a>,
    ) -> Option<Result<Value, String>>,
)> {
    builtin_backend_module_contributions()
        .into_iter()
        .filter_map(|contribution| {
            log::debug!(
                "[module] execution contribution scan: module={} commands={} events={} persistence_owners={}"
                , contribution.module_id
                , contribution.command_ids.len()
                , contribution.events.len()
                , contribution.persistence_owners.len()
            );
            contribution
                .capability_execute
                .map(|execute| (contribution.module_id, execute))
        })
        .collect()
}
