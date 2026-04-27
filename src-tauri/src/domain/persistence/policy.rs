//! # 宿主持久化策略模型
//!
//! 将持久化协议请求映射为宿主内部的权限需求与审计摘要，避免应用层散落
//! 规则判断。

use crate::shared::persistence_contracts::{
    PersistenceAction, PersistenceRequest, PersistenceScope,
};

/// 宿主持久化访问裁决结果。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PersistenceAccessDecision {
    /// 本次访问要求的权限列表。
    pub required_permissions: Vec<String>,
}

/// 宿主持久化审计摘要。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PersistenceAuditRecord {
    /// 模块标识。
    pub module_id: String,
    /// runtime 标识。
    pub runtime_id: String,
    /// 动作类型。
    pub action: PersistenceAction,
    /// 存储作用域。
    pub scope: PersistenceScope,
    /// owner 命名空间。
    pub owner: String,
    /// 状态键。
    pub state_key: Option<String>,
    /// 会话标识。
    pub session_id: Option<String>,
    /// 任务标识。
    pub task_id: Option<String>,
    /// trace 标识。
    pub trace_id: Option<String>,
}

/// 评估一次宿主持久化请求的权限需求。
pub(crate) fn evaluate_persistence_access(
    request: &PersistenceRequest,
) -> Result<PersistenceAccessDecision, String> {
    let required_permissions = match (&request.scope, &request.action) {
        (PersistenceScope::ModulePrivate, PersistenceAction::Load)
        | (PersistenceScope::ModulePrivate, PersistenceAction::List) => {
            vec!["storage.module_private.read".to_string()]
        }
        (PersistenceScope::ModulePrivate, PersistenceAction::Save) => {
            vec!["storage.module_private.write".to_string()]
        }
        (PersistenceScope::ModulePrivate, PersistenceAction::Delete) => {
            vec!["storage.module_private.delete".to_string()]
        }
        (PersistenceScope::Core, _) => {
            return Err("core scope persistence access is not implemented yet".to_string())
        }
        (PersistenceScope::Cache, _) => {
            return Err("cache scope persistence access is not implemented yet".to_string())
        }
    };

    Ok(PersistenceAccessDecision {
        required_permissions,
    })
}

/// 将请求转换为宿主审计摘要。
pub(crate) fn build_persistence_audit_record(
    request: &PersistenceRequest,
) -> PersistenceAuditRecord {
    PersistenceAuditRecord {
        module_id: request.module_id.clone(),
        runtime_id: request.runtime_id.clone(),
        action: request.action.clone(),
        scope: request.scope.clone(),
        owner: request.owner.clone(),
        state_key: request.state_key.clone(),
        session_id: request.session_id.clone(),
        task_id: request.task_id.clone(),
        trace_id: request.trace_id.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::{build_persistence_audit_record, evaluate_persistence_access};
    use crate::shared::persistence_contracts::{
        PersistenceAction, PersistenceRequest, PersistenceScope, PERSISTENCE_CONTRACT_API_VERSION,
    };

    fn build_request(action: PersistenceAction) -> PersistenceRequest {
        PersistenceRequest {
            api_version: PERSISTENCE_CONTRACT_API_VERSION,
            module_id: "ai-chat".to_string(),
            runtime_id: "go-sidecar".to_string(),
            session_id: Some("session-1".to_string()),
            task_id: Some("task-1".to_string()),
            trace_id: Some("trace-1".to_string()),
            scope: PersistenceScope::ModulePrivate,
            owner: "ai-chat".to_string(),
            state_key: Some("history".to_string()),
            schema_version: 1,
            expected_revision: None,
            action,
            payload: None,
        }
    }

    #[test]
    fn persistence_policy_should_assign_write_permission_to_save() {
        let decision = evaluate_persistence_access(&build_request(PersistenceAction::Save))
            .expect("save 请求应成功映射权限");

        assert_eq!(
            decision.required_permissions,
            vec!["storage.module_private.write".to_string()]
        );
    }

    #[test]
    fn persistence_policy_should_build_audit_record_from_request() {
        let request = build_request(PersistenceAction::Load);
        let audit = build_persistence_audit_record(&request);

        assert_eq!(audit.module_id, "ai-chat");
        assert_eq!(audit.runtime_id, "go-sidecar");
        assert_eq!(audit.trace_id.as_deref(), Some("trace-1"));
        assert_eq!(audit.state_key.as_deref(), Some("history"));
    }
}
