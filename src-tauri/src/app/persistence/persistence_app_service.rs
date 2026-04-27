//! # 宿主持久化应用服务
//!
//! 将 sidecar / runtime 发起的持久化协议请求路由到宿主持久化基础设施。
//! 当前阶段仅开放 `module_private` 作用域，用于扩展或模块的私有长期状态。

use std::path::Path;

use tauri::State;

use crate::domain::persistence::{evaluate_persistence_access, PersistenceAuditRecord};
use crate::infra::persistence::extension_private_store::{self, ExtensionPrivateStateRecord};
use crate::module_contribution::{
    find_builtin_backend_module_contribution, module_declares_persistence_owner,
};
use crate::shared::persistence_contracts::{
    PersistenceAction, PersistenceErrorCode, PersistenceRequest, PersistenceResponse,
    PersistenceResponseStatus, PersistenceScope, PersistenceStateDescriptor,
    PERSISTENCE_CONTRACT_API_VERSION,
};
use crate::state::{get_vault_root, AppState};

/// 执行一条宿主持久化协议请求。
pub(crate) fn execute_persistence_request(
    state: &State<'_, AppState>,
    request: PersistenceRequest,
) -> Result<PersistenceResponse, String> {
    let root = get_vault_root(state)?;
    execute_persistence_request_in_root(&root, request)
}

/// 在指定仓库根目录下执行一条宿主持久化协议请求。
pub(crate) fn execute_persistence_request_in_root(
    vault_root: &Path,
    request: PersistenceRequest,
) -> Result<PersistenceResponse, String> {
    let audit_record = crate::domain::persistence::build_persistence_audit_record(&request);

    if let Some(response) = validate_request_shape(&request) {
        log_persistence_request_finish(&audit_record, &response);
        return Ok(response);
    }

    if request.api_version != PERSISTENCE_CONTRACT_API_VERSION {
        let response = error_response(
            &request,
            PersistenceErrorCode::UnsupportedApiVersion,
            format!(
                "unsupported persistence api version: expected={} actual={}",
                PERSISTENCE_CONTRACT_API_VERSION, request.api_version
            ),
        );
        log_persistence_request_finish(&audit_record, &response);
        return Ok(response);
    }

    if request.scope != PersistenceScope::ModulePrivate {
        let response = error_response(
            &request,
            PersistenceErrorCode::UnsupportedScope,
            format!(
                "scope {:?} is not supported yet; only module_private is available",
                request.scope
            ),
        );
        log_persistence_request_finish(&audit_record, &response);
        return Ok(response);
    }

    let access_decision = evaluate_persistence_access(&request)?;
    log_persistence_request_start(&audit_record, &access_decision.required_permissions);

    if find_builtin_backend_module_contribution(&request.module_id).is_none() {
        let response = error_response(
            &request,
            PersistenceErrorCode::UnknownModuleId,
            format!(
                "module_private scope requires a registered backend module: module_id={}",
                request.module_id
            ),
        );
        log_persistence_request_finish(&audit_record, &response);
        return Ok(response);
    }

    if request.owner != request.module_id {
        let response = error_response(
            &request,
            PersistenceErrorCode::OwnerModuleMismatch,
            format!(
                "module_private scope requires owner to match module_id: owner={} module_id={}",
                request.owner, request.module_id
            ),
        );
        log_persistence_request_finish(&audit_record, &response);
        return Ok(response);
    }

    if !module_declares_persistence_owner(&request.module_id, &request.owner) {
        let response = error_response(
            &request,
            PersistenceErrorCode::UndeclaredPersistenceOwner,
            format!(
                "module_private scope requires owner to be declared by the module contribution: module_id={} owner={}",
                request.module_id, request.owner
            ),
        );
        log_persistence_request_finish(&audit_record, &response);
        return Ok(response);
    }

    let response = match request.action {
        PersistenceAction::Load => handle_load(vault_root, &request),
        PersistenceAction::Save => handle_save(vault_root, &request),
        PersistenceAction::Delete => handle_delete(vault_root, &request),
        PersistenceAction::List => handle_list(vault_root, &request),
    }?;

    log_persistence_request_finish(&audit_record, &response);
    Ok(response)
}

fn log_persistence_request_start(
    audit_record: &PersistenceAuditRecord,
    required_permissions: &[String],
) {
    log::info!(
        "[persistence] request start: module_id={} runtime_id={} action={:?} scope={:?} owner={} state_key={:?} session_id={:?} task_id={:?} trace_id={:?} permissions={:?}",
        audit_record.module_id,
        audit_record.runtime_id,
        audit_record.action,
        audit_record.scope,
        audit_record.owner,
        audit_record.state_key,
        audit_record.session_id,
        audit_record.task_id,
        audit_record.trace_id,
        required_permissions,
    );
}

fn log_persistence_request_finish(
    audit_record: &PersistenceAuditRecord,
    response: &PersistenceResponse,
) {
    log::info!(
        "[persistence] request finish: module_id={} runtime_id={} action={:?} owner={} state_key={:?} trace_id={:?} status={:?} revision={:?} error_code={:?}",
        audit_record.module_id,
        audit_record.runtime_id,
        audit_record.action,
        audit_record.owner,
        audit_record.state_key,
        audit_record.trace_id,
        response.status,
        response.revision,
        response.error_code,
    );
}

fn handle_load(
    vault_root: &Path,
    request: &PersistenceRequest,
) -> Result<PersistenceResponse, String> {
    let state_key = match require_state_key(request) {
        Ok(state_key) => state_key,
        Err(response) => return Ok(response),
    };
    let current = extension_private_store::load_extension_private_state_value(
        vault_root,
        &request.owner,
        state_key,
    )?;

    let Some(record) = current else {
        return Ok(not_found_response(request, state_key));
    };

    Ok(ok_state_response(
        request,
        Some(state_key.to_string()),
        record,
    ))
}

fn handle_save(
    vault_root: &Path,
    request: &PersistenceRequest,
) -> Result<PersistenceResponse, String> {
    let state_key = match require_state_key(request) {
        Ok(state_key) => state_key,
        Err(response) => return Ok(response),
    };
    let Some(payload) = request.payload.clone() else {
        return Ok(error_response(
            request,
            PersistenceErrorCode::PayloadRequired,
            "persistence save request requires payload to be present".to_string(),
        ));
    };

    let current = extension_private_store::load_extension_private_state_value(
        vault_root,
        &request.owner,
        state_key,
    )?;
    if let Some(conflict) = detect_revision_conflict(request, current.as_ref()) {
        return Ok(conflict);
    }

    let saved = extension_private_store::save_extension_private_state_value(
        vault_root,
        &request.owner,
        state_key,
        request.schema_version,
        &payload,
    )?;

    Ok(ok_state_response(
        request,
        Some(state_key.to_string()),
        saved,
    ))
}

fn handle_delete(
    vault_root: &Path,
    request: &PersistenceRequest,
) -> Result<PersistenceResponse, String> {
    let state_key = match require_state_key(request) {
        Ok(state_key) => state_key,
        Err(response) => return Ok(response),
    };
    let current = extension_private_store::load_extension_private_state_value(
        vault_root,
        &request.owner,
        state_key,
    )?;

    let Some(record) = current else {
        return Ok(not_found_response(request, state_key));
    };

    if let Some(conflict) = detect_revision_conflict(request, Some(&record)) {
        return Ok(conflict);
    }

    extension_private_store::delete_extension_private_state(vault_root, &request.owner, state_key)?;

    Ok(PersistenceResponse {
        status: PersistenceResponseStatus::Ok,
        owner: request.owner.clone(),
        state_key: Some(state_key.to_string()),
        schema_version: Some(record.schema_version),
        revision: None,
        payload: None,
        items: Vec::new(),
        error_code: None,
        error_message: None,
    })
}

fn handle_list(
    vault_root: &Path,
    request: &PersistenceRequest,
) -> Result<PersistenceResponse, String> {
    let items = extension_private_store::list_extension_private_states(vault_root, &request.owner)?
        .into_iter()
        .map(|record| PersistenceStateDescriptor {
            owner: record.owner,
            state_key: record.state_key,
            schema_version: record.schema_version,
            revision: record.revision,
        })
        .collect::<Vec<_>>();

    Ok(PersistenceResponse {
        status: PersistenceResponseStatus::Ok,
        owner: request.owner.clone(),
        state_key: None,
        schema_version: None,
        revision: None,
        payload: None,
        items,
        error_code: None,
        error_message: None,
    })
}

fn validate_request_shape(request: &PersistenceRequest) -> Option<PersistenceResponse> {
    if request.module_id.trim().is_empty() {
        return Some(error_response(
            request,
            PersistenceErrorCode::InvalidRequest,
            "persistence request module_id cannot be empty".to_string(),
        ));
    }
    if request.runtime_id.trim().is_empty() {
        return Some(error_response(
            request,
            PersistenceErrorCode::InvalidRequest,
            "persistence request runtime_id cannot be empty".to_string(),
        ));
    }
    if request.owner.trim().is_empty() {
        return Some(error_response(
            request,
            PersistenceErrorCode::InvalidRequest,
            "persistence request owner cannot be empty".to_string(),
        ));
    }
    if request.schema_version == 0 {
        return Some(error_response(
            request,
            PersistenceErrorCode::InvalidRequest,
            "persistence request schema_version cannot be 0".to_string(),
        ));
    }

    None
}

fn require_state_key<'a>(request: &'a PersistenceRequest) -> Result<&'a str, PersistenceResponse> {
    request
        .state_key
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            error_response(
                request,
                PersistenceErrorCode::StateKeyRequired,
                "persistence request state_key cannot be empty".to_string(),
            )
        })
}

fn detect_revision_conflict(
    request: &PersistenceRequest,
    current: Option<&ExtensionPrivateStateRecord>,
) -> Option<PersistenceResponse> {
    let expected_revision = request
        .expected_revision
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())?;
    let actual_revision = current.map(|record| record.revision.as_str()).unwrap_or("");
    if expected_revision == actual_revision {
        return None;
    }

    Some(PersistenceResponse {
        status: PersistenceResponseStatus::Conflict,
        owner: request.owner.clone(),
        state_key: request.state_key.clone(),
        schema_version: current.map(|record| record.schema_version),
        revision: current.map(|record| record.revision.clone()),
        payload: current.map(|record| record.data.clone()),
        items: Vec::new(),
        error_code: Some(PersistenceErrorCode::RevisionConflict),
        error_message: Some(format!(
            "revision conflict: expected={} actual={}",
            expected_revision, actual_revision
        )),
    })
}

fn ok_state_response(
    request: &PersistenceRequest,
    state_key: Option<String>,
    record: ExtensionPrivateStateRecord,
) -> PersistenceResponse {
    PersistenceResponse {
        status: PersistenceResponseStatus::Ok,
        owner: request.owner.clone(),
        state_key,
        schema_version: Some(record.schema_version),
        revision: Some(record.revision),
        payload: Some(record.data),
        items: Vec::new(),
        error_code: None,
        error_message: None,
    }
}

fn not_found_response(request: &PersistenceRequest, state_key: &str) -> PersistenceResponse {
    PersistenceResponse {
        status: PersistenceResponseStatus::NotFound,
        owner: request.owner.clone(),
        state_key: Some(state_key.to_string()),
        schema_version: None,
        revision: None,
        payload: None,
        items: Vec::new(),
        error_code: Some(PersistenceErrorCode::StateNotFound),
        error_message: Some(format!(
            "state not found: owner={} key={}",
            request.owner, state_key
        )),
    }
}

fn error_response(
    request: &PersistenceRequest,
    error_code: PersistenceErrorCode,
    error_message: String,
) -> PersistenceResponse {
    PersistenceResponse {
        status: PersistenceResponseStatus::Error,
        owner: request.owner.clone(),
        state_key: request.state_key.clone(),
        schema_version: None,
        revision: None,
        payload: None,
        items: Vec::new(),
        error_code: Some(error_code),
        error_message: Some(error_message),
    }
}

#[cfg(test)]
mod tests {
    use super::execute_persistence_request_in_root;
    use crate::shared::persistence_contracts::{
        PersistenceAction, PersistenceErrorCode, PersistenceRequest, PersistenceResponseStatus,
        PersistenceScope, PERSISTENCE_CONTRACT_API_VERSION,
    };
    use serde_json::json;
    use std::fs;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    static TEST_ROOT_SEQ: AtomicU64 = AtomicU64::new(1);

    fn create_test_root() -> PathBuf {
        let sequence = TEST_ROOT_SEQ.fetch_add(1, Ordering::Relaxed);
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0);
        let root = std::env::temp_dir().join(format!(
            "ofive-persistence-app-service-test-{}-{}",
            unique, sequence
        ));
        fs::create_dir_all(root.join(".ofive")).expect("应成功创建测试根目录");
        root
    }

    fn base_request(action: PersistenceAction) -> PersistenceRequest {
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
    fn persistence_contract_should_save_then_load_module_private_state() {
        let root = create_test_root();
        let mut save_request = base_request(PersistenceAction::Save);
        save_request.payload = Some(json!({"messages": ["hello"]}));

        let save_response =
            execute_persistence_request_in_root(&root, save_request).expect("保存请求应成功");
        assert_eq!(save_response.status, PersistenceResponseStatus::Ok);
        assert!(save_response.revision.is_some());

        let load_response =
            execute_persistence_request_in_root(&root, base_request(PersistenceAction::Load))
                .expect("读取请求应成功");
        assert_eq!(load_response.status, PersistenceResponseStatus::Ok);
        assert_eq!(load_response.payload, Some(json!({"messages": ["hello"]})));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn persistence_contract_should_return_conflict_when_revision_mismatches() {
        let root = create_test_root();
        let mut first_save = base_request(PersistenceAction::Save);
        first_save.payload = Some(json!({"version": 1}));
        let first_response =
            execute_persistence_request_in_root(&root, first_save).expect("首次保存应成功");

        let mut second_save = base_request(PersistenceAction::Save);
        second_save.expected_revision = Some("rev-stale".to_string());
        second_save.payload = Some(json!({"version": 2}));
        let conflict_response = execute_persistence_request_in_root(&root, second_save)
            .expect("冲突请求应返回协议响应");

        assert_eq!(
            conflict_response.status,
            PersistenceResponseStatus::Conflict
        );
        assert_eq!(
            conflict_response.error_code,
            Some(PersistenceErrorCode::RevisionConflict)
        );
        assert_eq!(conflict_response.revision, first_response.revision);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn persistence_contract_should_list_saved_state_keys() {
        let root = create_test_root();
        let mut save_history = base_request(PersistenceAction::Save);
        save_history.payload = Some(json!({"messages": []}));
        execute_persistence_request_in_root(&root, save_history).expect("保存 history 应成功");

        let mut save_settings = base_request(PersistenceAction::Save);
        save_settings.state_key = Some("settings".to_string());
        save_settings.payload = Some(json!({"vendorId": "baidu-qianfan"}));
        execute_persistence_request_in_root(&root, save_settings).expect("保存 settings 应成功");

        let mut list_request = base_request(PersistenceAction::List);
        list_request.state_key = None;
        list_request.payload = None;
        let list_response =
            execute_persistence_request_in_root(&root, list_request).expect("list 请求应成功");

        assert_eq!(list_response.status, PersistenceResponseStatus::Ok);
        assert_eq!(list_response.items.len(), 2);
        assert_eq!(list_response.items[0].state_key, "history");
        assert_eq!(list_response.items[1].state_key, "settings");

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn persistence_contract_should_reject_owner_module_mismatch() {
        let root = create_test_root();
        let mut request = base_request(PersistenceAction::Load);
        request.owner = "vault".to_string();

        let response = execute_persistence_request_in_root(&root, request)
            .expect("owner/module 不匹配应返回协议错误");

        assert_eq!(response.status, PersistenceResponseStatus::Error);
        assert_eq!(
            response.error_code,
            Some(PersistenceErrorCode::OwnerModuleMismatch)
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn persistence_contract_should_reject_unknown_module_id() {
        let root = create_test_root();
        let mut request = base_request(PersistenceAction::Load);
        request.module_id = "unknown-module".to_string();
        request.owner = "unknown-module".to_string();

        let response =
            execute_persistence_request_in_root(&root, request).expect("未知模块应返回协议错误");

        assert_eq!(response.status, PersistenceResponseStatus::Error);
        assert_eq!(
            response.error_code,
            Some(PersistenceErrorCode::UnknownModuleId)
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn persistence_contract_should_reject_undeclared_persistence_owner() {
        let root = create_test_root();
        let mut request = base_request(PersistenceAction::Load);
        request.module_id = "vault".to_string();
        request.owner = "vault".to_string();

        let response = execute_persistence_request_in_root(&root, request)
            .expect("未声明的 persistence owner 应返回协议错误");

        assert_eq!(response.status, PersistenceResponseStatus::Error);
        assert_eq!(
            response.error_code,
            Some(PersistenceErrorCode::UndeclaredPersistenceOwner)
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn persistence_contract_should_return_structured_error_for_unsupported_scope() {
        let root = create_test_root();
        let mut request = base_request(PersistenceAction::Load);
        request.scope = PersistenceScope::Core;

        let response = execute_persistence_request_in_root(&root, request)
            .expect("未支持 scope 应返回协议错误");

        assert_eq!(response.status, PersistenceResponseStatus::Error);
        assert_eq!(
            response.error_code,
            Some(PersistenceErrorCode::UnsupportedScope)
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn persistence_contract_should_return_structured_error_for_missing_state_key() {
        let root = create_test_root();
        let mut request = base_request(PersistenceAction::Load);
        request.state_key = None;

        let response = execute_persistence_request_in_root(&root, request)
            .expect("缺少 state_key 应返回协议错误");

        assert_eq!(response.status, PersistenceResponseStatus::Error);
        assert_eq!(
            response.error_code,
            Some(PersistenceErrorCode::StateKeyRequired)
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn persistence_contract_should_return_structured_error_for_missing_payload() {
        let root = create_test_root();
        let request = base_request(PersistenceAction::Save);

        let response = execute_persistence_request_in_root(&root, request)
            .expect("缺少 payload 应返回协议错误");

        assert_eq!(response.status, PersistenceResponseStatus::Error);
        assert_eq!(
            response.error_code,
            Some(PersistenceErrorCode::PayloadRequired)
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn persistence_contract_should_return_structured_error_for_invalid_request_shape() {
        let root = create_test_root();
        let mut request = base_request(PersistenceAction::Load);
        request.runtime_id = "   ".to_string();

        let response = execute_persistence_request_in_root(&root, request)
            .expect("非法请求结构应返回协议错误");

        assert_eq!(response.status, PersistenceResponseStatus::Error);
        assert_eq!(
            response.error_code,
            Some(PersistenceErrorCode::InvalidRequest)
        );

        let _ = fs::remove_dir_all(root);
    }
}
