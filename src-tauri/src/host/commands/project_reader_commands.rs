//! # Project Reader 宿主命令模块
//!
//! 暴露外部项目只读阅读器所需的 Tauri command。

use std::time::Instant;

use tauri::async_runtime;
use tauri::State;

use crate::app::project_reader::project_reader_app_service;
use crate::shared::project_reader_contracts::{
    ProjectReaderCodeReferenceResponse, ProjectReaderFileResponse, ProjectReaderProject,
    ProjectReaderProjectListResponse, ProjectReaderSymbolResolveContext,
    ProjectReaderSymbolResolveResponse, ProjectReaderTreeResponse,
};
use crate::state::{get_vault_root, AppState};

pub(crate) const PROJECT_READER_COMMAND_IDS: &[&str] = &[
    "list_project_reader_projects",
    "add_project_reader_project",
    "get_project_reader_tree",
    "read_project_reader_file",
    "get_project_reader_code_references",
    "resolve_project_reader_symbol",
];

macro_rules! timed_command {
    ($name:expr, $body:expr) => {{
        log::info!("[command] {} invoked", $name);
        let start = Instant::now();
        let result = $body;
        let elapsed = start.elapsed();
        match &result {
            Ok(_) => log::info!("[command] {} completed in {:?}", $name, elapsed),
            Err(ref err) => log::warn!("[command] {} failed in {:?}: {}", $name, elapsed, err),
        }
        result
    }};
}

/// 列出已导入的外部项目。
#[tauri::command]
pub fn list_project_reader_projects() -> Result<ProjectReaderProjectListResponse, String> {
    timed_command!(
        "list_project_reader_projects",
        project_reader_app_service::list_projects()
    )
}

/// 添加外部项目并建立基础 SQL 文件索引。
#[tauri::command]
pub async fn add_project_reader_project(root_path: String) -> Result<ProjectReaderProject, String> {
    timed_command!(
        "add_project_reader_project",
        async_runtime::spawn_blocking(move || project_reader_app_service::add_project(root_path))
            .await
            .map_err(|error| format!("project-reader add project join failed: {error}"))?
    )
}

/// 获取指定外部项目文件树。
#[tauri::command]
pub async fn get_project_reader_tree(
    project_id: String,
) -> Result<ProjectReaderTreeResponse, String> {
    timed_command!(
        "get_project_reader_tree",
        async_runtime::spawn_blocking(move || {
            project_reader_app_service::get_project_tree(project_id)
        })
        .await
        .map_err(|error| format!("project-reader tree join failed: {error}"))?
    )
}

/// 读取指定外部项目文件。
#[tauri::command]
pub async fn read_project_reader_file(
    project_id: String,
    relative_path: String,
) -> Result<ProjectReaderFileResponse, String> {
    timed_command!(
        "read_project_reader_file",
        async_runtime::spawn_blocking(move || {
            project_reader_app_service::read_project_file(project_id, relative_path)
        })
        .await
        .map_err(|error| format!("project-reader file read join failed: {error}"))?
    )
}

/// 查询外部项目源码在当前 vault 中的引用位置。
#[tauri::command]
pub async fn get_project_reader_code_references(
    project_id: String,
    state: State<'_, AppState>,
) -> Result<ProjectReaderCodeReferenceResponse, String> {
    let vault_root = get_vault_root(&state)?;
    timed_command!(
        "get_project_reader_code_references",
        async_runtime::spawn_blocking(move || {
            project_reader_app_service::get_code_references(project_id, vault_root)
        })
        .await
        .map_err(|error| format!("project-reader code references join failed: {error}"))?
    )
}

/// 解析指定符号在外部项目中的候选定义位置。
#[tauri::command]
pub async fn resolve_project_reader_symbol(
    project_id: String,
    symbol: String,
    context: Option<ProjectReaderSymbolResolveContext>,
) -> Result<ProjectReaderSymbolResolveResponse, String> {
    timed_command!(
        "resolve_project_reader_symbol",
        async_runtime::spawn_blocking(move || {
            project_reader_app_service::resolve_symbol(project_id, symbol, context)
        })
        .await
        .map_err(|error| format!("project-reader symbol resolve join failed: {error}"))?
    )
}
