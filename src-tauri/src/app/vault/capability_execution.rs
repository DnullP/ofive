//! # Vault Capability Execution
//!
//! 定义 Vault 模块对平台注册能力的执行路由。
//! 该模块让 Vault capability 的输入解析、执行分发与输出序列化
//! 保持在 Vault 自己的边界内，而不是集中堆在公共执行器中。

use serde::Deserialize;
use serde::Serialize;
use serde_json::Value;

use crate::app::vault::{query_app_service, vault_app_service};
use crate::domain::capability::{CapabilityExecutionContext, CapabilityExecutionRequest};

/// 尝试执行一条由 Vault 模块负责的平台能力请求。
///
/// 如果能力 ID 不属于 Vault 模块，返回 `None`；
/// 如果属于 Vault 模块，则返回对应执行结果。
pub(crate) fn execute_vault_capability(
    request: &CapabilityExecutionRequest,
    context: &CapabilityExecutionContext<'_>,
) -> Option<Result<Value, String>> {
    match request.capability_id.as_str() {
        "vault.read_markdown_file" => {
            Some(execute_read_markdown_file(request.input.clone(), context))
        }
        "vault.search_markdown_files" => Some(execute_search_markdown_files(
            request.input.clone(),
            context,
        )),
        "vault.get_markdown_outline" => {
            Some(execute_get_markdown_outline(request.input.clone(), context))
        }
        "vault.get_backlinks_for_file" => Some(execute_get_backlinks_for_file(
            request.input.clone(),
            context,
        )),
        "vault.get_markdown_graph" => Some(execute_get_markdown_graph(context)),
        "vault.create_markdown_file" => {
            Some(execute_create_markdown_file(request.input.clone(), context))
        }
        "vault.save_markdown_file" => {
            Some(execute_save_markdown_file(request.input.clone(), context))
        }
        "vault.rename_markdown_file" => {
            Some(execute_rename_markdown_file(request.input.clone(), context))
        }
        "vault.delete_markdown_file" => {
            Some(execute_delete_markdown_file(request.input.clone(), context))
        }
        "vault.create_directory" => Some(execute_create_directory(request.input.clone(), context)),
        _ => None,
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RelativePathInput {
    relative_path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SearchMarkdownFilesInput {
    query: String,
    limit: Option<usize>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RelativePathWithOptionalContentInput {
    relative_path: String,
    content: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RelativePathWithContentInput {
    relative_path: String,
    content: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RenameMarkdownFileInput {
    from_relative_path: String,
    to_relative_path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RelativeDirectoryPathInput {
    relative_directory_path: String,
}

/// 执行“读取 Markdown 文件”能力。
fn execute_read_markdown_file(
    input: Value,
    context: &CapabilityExecutionContext<'_>,
) -> Result<Value, String> {
    let input: RelativePathInput = parse_input(input, "vault.read_markdown_file")?;
    let output = vault_app_service::read_vault_markdown_file_in_root(
        input.relative_path,
        context.vault_root,
    )?;
    serialize_output(output, "vault.read_markdown_file")
}

/// 执行“搜索 Markdown 文件”能力。
fn execute_search_markdown_files(
    input: Value,
    context: &CapabilityExecutionContext<'_>,
) -> Result<Value, String> {
    let input: SearchMarkdownFilesInput = parse_input(input, "vault.search_markdown_files")?;
    let output = query_app_service::search_vault_markdown_files_in_root(
        context.vault_root,
        input.query,
        input.limit,
    )?;
    serialize_output(output, "vault.search_markdown_files")
}

/// 执行“获取 Markdown 大纲”能力。
fn execute_get_markdown_outline(
    input: Value,
    context: &CapabilityExecutionContext<'_>,
) -> Result<Value, String> {
    let input: RelativePathInput = parse_input(input, "vault.get_markdown_outline")?;
    let output = query_app_service::get_vault_markdown_outline_in_root(
        context.vault_root,
        input.relative_path,
    )?;
    serialize_output(output, "vault.get_markdown_outline")
}

/// 执行“获取反向链接”能力。
fn execute_get_backlinks_for_file(
    input: Value,
    context: &CapabilityExecutionContext<'_>,
) -> Result<Value, String> {
    let input: RelativePathInput = parse_input(input, "vault.get_backlinks_for_file")?;
    let output = query_app_service::get_backlinks_for_file_in_root(
        context.vault_root,
        &input.relative_path,
    )?;
    serialize_output(output, "vault.get_backlinks_for_file")
}

/// 执行“获取 Markdown 图谱”能力。
fn execute_get_markdown_graph(context: &CapabilityExecutionContext<'_>) -> Result<Value, String> {
    let output = query_app_service::get_current_vault_markdown_graph_in_root(context.vault_root)?;
    serialize_output(output, "vault.get_markdown_graph")
}

/// 执行“创建 Markdown 文件”能力。
fn execute_create_markdown_file(
    input: Value,
    context: &CapabilityExecutionContext<'_>,
) -> Result<Value, String> {
    let input: RelativePathWithOptionalContentInput =
        parse_input(input, "vault.create_markdown_file")?;
    let output = vault_app_service::create_vault_markdown_file_in_root(
        input.relative_path,
        input.content,
        context.vault_root,
    )?;
    serialize_output(output, "vault.create_markdown_file")
}

/// 执行“保存 Markdown 文件”能力。
fn execute_save_markdown_file(
    input: Value,
    context: &CapabilityExecutionContext<'_>,
) -> Result<Value, String> {
    let input: RelativePathWithContentInput = parse_input(input, "vault.save_markdown_file")?;
    let output = vault_app_service::save_vault_markdown_file_in_root(
        input.relative_path,
        input.content,
        context.vault_root,
    )?;
    serialize_output(output, "vault.save_markdown_file")
}

/// 执行“重命名 Markdown 文件”能力。
fn execute_rename_markdown_file(
    input: Value,
    context: &CapabilityExecutionContext<'_>,
) -> Result<Value, String> {
    let input: RenameMarkdownFileInput = parse_input(input, "vault.rename_markdown_file")?;
    let output = vault_app_service::rename_vault_markdown_file_in_root(
        input.from_relative_path,
        input.to_relative_path,
        context.vault_root,
    )?;
    serialize_output(output, "vault.rename_markdown_file")
}

/// 执行“删除 Markdown 文件”能力。
fn execute_delete_markdown_file(
    input: Value,
    context: &CapabilityExecutionContext<'_>,
) -> Result<Value, String> {
    let input: RelativePathInput = parse_input(input, "vault.delete_markdown_file")?;
    vault_app_service::delete_vault_markdown_file_in_root(input.relative_path, context.vault_root)?;
    Ok(serde_json::json!({"ok": true}))
}

/// 执行“创建目录”能力。
fn execute_create_directory(
    input: Value,
    context: &CapabilityExecutionContext<'_>,
) -> Result<Value, String> {
    let input: RelativeDirectoryPathInput = parse_input(input, "vault.create_directory")?;
    vault_app_service::create_vault_directory_in_root(
        input.relative_directory_path,
        context.vault_root,
    )?;
    Ok(serde_json::json!({"ok": true}))
}

/// 解析能力输入。
fn parse_input<T>(input: Value, capability_id: &str) -> Result<T, String>
where
    T: for<'de> Deserialize<'de>,
{
    serde_json::from_value(input)
        .map_err(|error| format!("解析能力输入失败 {}: {error}", capability_id))
}

/// 序列化能力输出。
fn serialize_output<T>(output: T, capability_id: &str) -> Result<Value, String>
where
    T: Serialize,
{
    serde_json::to_value(output)
        .map_err(|error| format!("序列化能力输出失败 {}: {error}", capability_id))
}
