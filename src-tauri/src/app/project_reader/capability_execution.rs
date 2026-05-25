//! # Project Reader Capability Execution
//!
//! 将外部项目只读阅读器模块的 capability 请求路由到现有应用服务实现。

use serde::Deserialize;
use serde_json::Value;

use crate::app::project_reader::project_reader_app_service;
use crate::domain::capability::{CapabilityExecutionContext, CapabilityExecutionRequest};
use crate::shared::project_reader_contracts::{
    ProjectReaderSearchMode, ProjectReaderSearchRequest, ProjectReaderSymbolResolveContext,
};

/// 尝试执行一条由 Project Reader 模块负责的平台能力请求。
///
/// 如果能力 ID 不属于 Project Reader 模块，返回 `None`；
/// 如果属于 Project Reader 模块，则返回对应执行结果。
pub(crate) fn execute_project_reader_capability(
    request: &CapabilityExecutionRequest,
    context: &CapabilityExecutionContext<'_>,
) -> Option<Result<Value, String>> {
    match request.capability_id.as_str() {
        "project_reader.list_projects" => Some(execute_list_projects()),
        "project_reader.get_project_tree" => Some(execute_get_project_tree(request.input.clone())),
        "project_reader.read_project_file" => {
            Some(execute_read_project_file(request.input.clone()))
        }
        "project_reader.get_code_references" => {
            Some(execute_get_code_references(request.input.clone(), context))
        }
        "project_reader.resolve_symbol" => Some(execute_resolve_symbol(request.input.clone())),
        "project_reader.search_project" => Some(execute_search_project(request.input.clone())),
        _ => None,
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectIdInput {
    project_id: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectFileInput {
    project_id: String,
    relative_path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectSymbolInput {
    project_id: String,
    symbol: String,
    context: Option<ProjectSymbolResolveContextInput>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectSymbolResolveContextInput {
    current_file_path: Option<String>,
    current_line_number: Option<usize>,
    current_column_number: Option<usize>,
    current_line_text: Option<String>,
    current_file_content: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProjectSearchInput {
    project_id: String,
    query: String,
    mode: ProjectReaderSearchMode,
    limit: Option<usize>,
}

fn execute_list_projects() -> Result<Value, String> {
    serialize_output(
        project_reader_app_service::list_projects()?,
        "project_reader.list_projects",
    )
}

fn execute_get_project_tree(input: Value) -> Result<Value, String> {
    let input: ProjectIdInput = parse_input(input, "project_reader.get_project_tree")?;
    serialize_output(
        project_reader_app_service::get_project_tree(input.project_id)?,
        "project_reader.get_project_tree",
    )
}

fn execute_read_project_file(input: Value) -> Result<Value, String> {
    let input: ProjectFileInput = parse_input(input, "project_reader.read_project_file")?;
    serialize_output(
        project_reader_app_service::read_project_file(input.project_id, input.relative_path)?,
        "project_reader.read_project_file",
    )
}

fn execute_get_code_references(
    input: Value,
    context: &CapabilityExecutionContext<'_>,
) -> Result<Value, String> {
    let input: ProjectIdInput = parse_input(input, "project_reader.get_code_references")?;
    serialize_output(
        project_reader_app_service::get_code_references(
            input.project_id,
            context.vault_root.to_path_buf(),
        )?,
        "project_reader.get_code_references",
    )
}

fn execute_resolve_symbol(input: Value) -> Result<Value, String> {
    let input: ProjectSymbolInput = parse_input(input, "project_reader.resolve_symbol")?;
    let context = input
        .context
        .map(|context| ProjectReaderSymbolResolveContext {
            current_file_path: context.current_file_path,
            current_line_number: context.current_line_number,
            current_column_number: context.current_column_number,
            current_line_text: context.current_line_text,
            current_file_content: context.current_file_content,
        });
    serialize_output(
        project_reader_app_service::resolve_symbol(input.project_id, input.symbol, context)?,
        "project_reader.resolve_symbol",
    )
}

fn execute_search_project(input: Value) -> Result<Value, String> {
    let input: ProjectSearchInput = parse_input(input, "project_reader.search_project")?;
    serialize_output(
        project_reader_app_service::search_project(ProjectReaderSearchRequest {
            project_id: input.project_id,
            query: input.query,
            mode: input.mode,
            limit: input.limit,
        })?,
        "project_reader.search_project",
    )
}

fn parse_input<T: for<'de> Deserialize<'de>>(
    input: Value,
    capability_id: &str,
) -> Result<T, String> {
    serde_json::from_value(input).map_err(|error| format!("解析 {capability_id} 输入失败: {error}"))
}

fn serialize_output<T: serde::Serialize>(output: T, capability_id: &str) -> Result<Value, String> {
    serde_json::to_value(output)
        .map_err(|error| format!("序列化 {capability_id} 输出失败: {error}"))
}
