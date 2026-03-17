//! # 平台能力模块
//!
//! 定义平台能力的描述模型、内存注册中心与内建能力目录，
//! 为 AI、frontend 与其他 sidecar 提供统一治理边界。

mod builtin;
mod descriptor;
mod executor;
mod policy;
mod registry;

pub(crate) use builtin::build_builtin_capability_registry;
pub(crate) use descriptor::{
    CapabilityConsumer, CapabilityDescriptor, CapabilityKind, CapabilityRiskLevel,
};
pub(crate) use executor::{
    CapabilityExecutionContext, CapabilityExecutionRequest, CapabilityExecutor,
};
pub(crate) use policy::evaluate_capability_access;
pub(crate) use registry::CapabilityRegistry;
