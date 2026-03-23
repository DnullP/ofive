//! # Capability Catalog Contributions
//!
//! 定义模块向平台注册中心贡献 capability catalog 的稳定结构。
//! 中央层只负责收集 contribution，不再了解具体模块能力细节。

use crate::domain::capability::CapabilityDescriptor;
use crate::module_contribution::builtin_backend_module_contributions;

/// 聚合当前内建模块的 capability catalog contributions。
pub(crate) fn builtin_capability_catalog_contributions(
) -> Vec<(&'static str, fn() -> Vec<CapabilityDescriptor>)> {
    builtin_backend_module_contributions()
        .into_iter()
        .filter_map(|contribution| {
            log::debug!(
                "[module] catalog contribution scan: module={} commands={} events={} persistence_owners={}"
                , contribution.module_id
                , contribution.command_ids.len()
                , contribution.events.len()
                , contribution.persistence_owners.len()
            );
            contribution
                .capability_catalog
                .map(|catalog| (contribution.module_id, catalog))
        })
        .collect()
}
