//! # 宿主持久化命令入口模块
//!
//! 暴露稳定的持久化协议入口，供前端或未来其他 runtime 通过宿主统一请求
//! 持久化能力。

use tauri::State;

use crate::app::persistence::persistence_app_service;
use crate::shared::persistence_contracts::{PersistenceRequest, PersistenceResponse};
use crate::state::AppState;

pub(crate) const PERSISTENCE_COMMAND_IDS: &[&str] = &["execute_persistence_request"];

/// 执行一条宿主持久化协议请求。
#[tauri::command]
pub fn execute_persistence_request(
    request: PersistenceRequest,
    state: State<'_, AppState>,
) -> Result<PersistenceResponse, String> {
    persistence_app_service::execute_persistence_request(&state, request)
}
