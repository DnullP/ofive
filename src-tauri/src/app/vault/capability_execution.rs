//! # Vault Capability Execution
//!
//! 定义 Vault 模块对平台注册能力的执行路由。
//! 该模块让 Vault capability 的输入解析、执行分发与输出序列化
//! 保持在 Vault 自己的边界内，而不是集中堆在公共执行器中。

use serde::Serialize;
use serde::{Deserialize, Deserializer};
use serde_json::Value;

use crate::app::vault::{
    agent_skill_app_service, canvas_app_service, markdown_patch_app_service, query_app_service,
    vault_app_service,
};
use crate::domain::capability::{CapabilityExecutionContext, CapabilityExecutionRequest};
use crate::shared::vault_contracts::{VaultCanvasDocument, VaultTaskItem};

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
        "vault.list_tasks" => Some(execute_list_tasks(request.input.clone(), context)),
        "vault.search_markdown_files" => Some(execute_search_markdown_files(
            request.input.clone(),
            context,
        )),
        "vault.search_canvas_files" => {
            Some(execute_search_canvas_files(request.input.clone(), context))
        }
        "vault.resolve_wikilink_target" => Some(execute_resolve_wikilink_target(
            request.input.clone(),
            context,
        )),
        "vault.suggest_wikilink_targets" => Some(execute_suggest_wikilink_targets(
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
        "vault.get_canvas_document" => {
            Some(execute_get_canvas_document(request.input.clone(), context))
        }
        "agent_skill.list" => Some(execute_list_agent_skills(context)),
        "agent_skill.read_file" => Some(execute_read_agent_skill_file(
            request.input.clone(),
            context,
        )),
        "agent_skill.create" => Some(execute_create_agent_skill(request.input.clone(), context)),
        "agent_skill.write_file" => Some(execute_write_agent_skill_file(
            request.input.clone(),
            context,
        )),
        "vault.create_markdown_file" => {
            Some(execute_create_markdown_file(request.input.clone(), context))
        }
        "vault.save_markdown_file" => {
            Some(execute_save_markdown_file(request.input.clone(), context))
        }
        "vault.apply_markdown_patch" => {
            Some(execute_apply_markdown_patch(request.input.clone(), context))
        }
        "vault.update_task" => Some(execute_update_task(request.input.clone(), context)),
        "vault.save_canvas_document" => {
            Some(execute_save_canvas_document(request.input.clone(), context))
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
    #[serde(default)]
    query: String,
    limit: Option<usize>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ListTasksInput {
    relative_path: Option<String>,
    #[serde(default)]
    include_completed: bool,
    limit: Option<usize>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ListTasksOutput {
    tasks: Vec<VaultTaskItem>,
    total_count: usize,
    returned_count: usize,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ResolveWikiLinkTargetInput {
    current_dir: String,
    target: String,
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
struct RelativePathWithCanvasDocumentInput {
    relative_path: String,
    document: VaultCanvasDocument,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentSkillCreateInput {
    skill_name: String,
    description: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentSkillFileInput {
    skill_name: String,
    relative_path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct AgentSkillFileWithContentInput {
    skill_name: String,
    relative_path: String,
    content: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ApplyMarkdownPatchInput {
    relative_path: String,
    unified_diff: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UpdateTaskInput {
    relative_path: String,
    line: usize,
    raw_line: String,
    content: Option<String>,
    checked: Option<bool>,
    #[serde(default, deserialize_with = "deserialize_task_metadata_update_field")]
    start: TaskMetadataUpdateField,
    #[serde(default, deserialize_with = "deserialize_task_metadata_update_field")]
    end: TaskMetadataUpdateField,
    #[serde(default, deserialize_with = "deserialize_task_metadata_update_field")]
    recurrence: TaskMetadataUpdateField,
    #[serde(default, deserialize_with = "deserialize_task_metadata_update_field")]
    priority: TaskMetadataUpdateField,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateTaskOutput {
    relative_path: String,
    line: usize,
    updated_line: String,
    task: VaultTaskItem,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ParsedTaskLineForUpdate {
    indent: String,
    list_marker: String,
    checked: bool,
    content: String,
    due: Option<String>,
    start: Option<String>,
    end: Option<String>,
    recurrence: Option<String>,
    priority: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TaskMetadataKindForUpdate {
    Due,
    Start,
    End,
    Recurrence,
    Priority,
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
enum TaskMetadataUpdateField {
    #[default]
    Missing,
    Clear,
    Set(String),
}

#[derive(Debug, Default)]
struct TaskMetadataForUpdate {
    due: Option<String>,
    start: Option<String>,
    end: Option<String>,
    recurrence: Option<String>,
    priority: Option<String>,
}

#[derive(Debug)]
struct PopTaskMetadataResult<'a> {
    remaining: &'a str,
    value: Option<String>,
    consumed: bool,
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

/// 执行“列出任务规划”能力。
fn execute_list_tasks(
    input: Value,
    context: &CapabilityExecutionContext<'_>,
) -> Result<Value, String> {
    let input: ListTasksInput = parse_input(input, "vault.list_tasks")?;
    let normalized_relative_path = input
        .relative_path
        .map(|value| value.trim().replace('\\', "/"))
        .filter(|value| !value.is_empty());
    let limit = input.limit.unwrap_or(200).clamp(1, 500);
    let filtered_tasks = query_app_service::query_vault_tasks_in_root(context.vault_root)?
        .into_iter()
        .filter(|task| input.include_completed || !task.checked)
        .filter(|task| {
            normalized_relative_path
                .as_ref()
                .is_none_or(|relative_path| &task.relative_path == relative_path)
        })
        .collect::<Vec<_>>();
    let total_count = filtered_tasks.len();
    let tasks = filtered_tasks.into_iter().take(limit).collect::<Vec<_>>();
    let output = ListTasksOutput {
        returned_count: tasks.len(),
        total_count,
        tasks,
    };

    serialize_output(output, "vault.list_tasks")
}

/// 执行“搜索 Canvas 文件”能力。
fn execute_search_canvas_files(
    input: Value,
    context: &CapabilityExecutionContext<'_>,
) -> Result<Value, String> {
    let input: SearchMarkdownFilesInput = parse_input(input, "vault.search_canvas_files")?;
    let output = query_app_service::search_vault_canvas_files_in_root(
        context.vault_root,
        input.query,
        input.limit,
    )?;
    serialize_output(output, "vault.search_canvas_files")
}

/// 执行“解析 WikiLink 目标”能力。
fn execute_resolve_wikilink_target(
    input: Value,
    context: &CapabilityExecutionContext<'_>,
) -> Result<Value, String> {
    let input: ResolveWikiLinkTargetInput = parse_input(input, "vault.resolve_wikilink_target")?;
    let output = query_app_service::resolve_wikilink_target_in_root(
        context.vault_root,
        input.current_dir,
        input.target,
    )?;
    serialize_output(output, "vault.resolve_wikilink_target")
}

/// 执行“建议 WikiLink 目标”能力。
fn execute_suggest_wikilink_targets(
    input: Value,
    context: &CapabilityExecutionContext<'_>,
) -> Result<Value, String> {
    let input: SearchMarkdownFilesInput = parse_input(input, "vault.suggest_wikilink_targets")?;
    let output = query_app_service::suggest_wikilink_targets_in_root(
        context.vault_root,
        input.query,
        input.limit,
    )?;
    serialize_output(output, "vault.suggest_wikilink_targets")
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

/// 执行“读取结构化 Canvas 文档”能力。
fn execute_get_canvas_document(
    input: Value,
    context: &CapabilityExecutionContext<'_>,
) -> Result<Value, String> {
    let input: RelativePathInput = parse_input(input, "vault.get_canvas_document")?;
    let output = canvas_app_service::get_vault_canvas_document_in_root(
        context.vault_root,
        input.relative_path,
    )?;
    serialize_output(output, "vault.get_canvas_document")
}

/// 执行“列出 Agent SKILL”能力。
fn execute_list_agent_skills(context: &CapabilityExecutionContext<'_>) -> Result<Value, String> {
    let output = agent_skill_app_service::list_agent_skills_in_root(context.vault_root)?;
    serialize_output(output, "agent_skill.list")
}

/// 执行“读取 Agent SKILL 文件”能力。
fn execute_read_agent_skill_file(
    input: Value,
    context: &CapabilityExecutionContext<'_>,
) -> Result<Value, String> {
    let input: AgentSkillFileInput = parse_input(input, "agent_skill.read_file")?;
    let output = agent_skill_app_service::read_agent_skill_file_in_root(
        context.vault_root,
        input.skill_name,
        input.relative_path,
    )?;
    serialize_output(output, "agent_skill.read_file")
}

/// 执行“创建 Agent SKILL”能力。
fn execute_create_agent_skill(
    input: Value,
    context: &CapabilityExecutionContext<'_>,
) -> Result<Value, String> {
    let input: AgentSkillCreateInput = parse_input(input, "agent_skill.create")?;
    let output = agent_skill_app_service::create_agent_skill_in_root(
        context.vault_root,
        input.skill_name,
        input.description,
    )?;
    serialize_output(output, "agent_skill.create")
}

/// 执行“写入 Agent SKILL 文件”能力。
fn execute_write_agent_skill_file(
    input: Value,
    context: &CapabilityExecutionContext<'_>,
) -> Result<Value, String> {
    let input: AgentSkillFileWithContentInput = parse_input(input, "agent_skill.write_file")?;
    let output = agent_skill_app_service::write_agent_skill_file_in_root(
        context.vault_root,
        input.skill_name,
        input.relative_path,
        input.content,
    )?;
    serialize_output(output, "agent_skill.write_file")
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

/// 执行“应用 Markdown 增量 patch”能力。
fn execute_apply_markdown_patch(
    input: Value,
    context: &CapabilityExecutionContext<'_>,
) -> Result<Value, String> {
    let input: ApplyMarkdownPatchInput = parse_input(input, "vault.apply_markdown_patch")?;
    let unified_diff =
        ensure_patch_targets_relative_path(&input.relative_path, &input.unified_diff)?;
    let output = markdown_patch_app_service::apply_unified_markdown_diff_in_root(
        context.vault_root,
        unified_diff,
    )?;
    serialize_output(output, "vault.apply_markdown_patch")
}

/// 执行“更新任务规划”能力。
fn execute_update_task(
    input: Value,
    context: &CapabilityExecutionContext<'_>,
) -> Result<Value, String> {
    let input: UpdateTaskInput = parse_input(input, "vault.update_task")?;
    validate_update_task_input(&input)?;

    let read_response = vault_app_service::read_vault_markdown_file_in_root(
        input.relative_path.clone(),
        context.vault_root,
    )?;
    let newline = if read_response.content.contains("\r\n") {
        "\r\n"
    } else {
        "\n"
    };
    let mut lines = read_response
        .content
        .split(newline)
        .map(ToString::to_string)
        .collect::<Vec<_>>();
    let line_index = resolve_task_line_index(&lines, input.line, &input.raw_line)?;
    let current_line = lines
        .get(line_index)
        .ok_or_else(|| "无法定位要更新的任务行，请先重新读取任务列表".to_string())?
        .clone();
    let parsed = parse_task_line_for_update(&current_line)
        .ok_or_else(|| "目标任务行已不再符合任务看板语法".to_string())?;
    let updated_line = build_updated_task_line(&parsed, &input)?;
    lines[line_index] = updated_line.clone();

    vault_app_service::save_vault_markdown_file_in_root(
        input.relative_path.clone(),
        lines.join(newline),
        context.vault_root,
    )?;

    let updated_task = query_app_service::query_vault_tasks_in_root(context.vault_root)?
        .into_iter()
        .find(|task| task.relative_path == input.relative_path && task.line == line_index + 1)
        .ok_or_else(|| "任务已保存，但无法在任务索引中重新定位更新后的任务".to_string())?;
    let output = UpdateTaskOutput {
        relative_path: input.relative_path,
        line: line_index + 1,
        updated_line,
        task: updated_task,
    };

    serialize_output(output, "vault.update_task")
}

fn ensure_patch_targets_relative_path(
    relative_path: &str,
    unified_diff: &str,
) -> Result<String, String> {
    let trimmed_path = relative_path.trim();
    if trimmed_path.is_empty() {
        return Err("relativePath 不能为空".to_string());
    }

    let normalized_target = trimmed_path.replace('\\', "/");
    let mut header_paths = Vec::new();
    for line in unified_diff.lines() {
        if let Some(path) = line.strip_prefix("--- ") {
            header_paths.push(path.trim().trim_matches('"').to_string());
            continue;
        }
        if let Some(path) = line.strip_prefix("+++ ") {
            header_paths.push(path.trim().trim_matches('"').to_string());
        }
    }

    if header_paths.len() < 2 {
        return Err("unifiedDiff 必须包含 --- 和 +++ 文件头".to_string());
    }

    for raw_path in header_paths {
        let normalized = raw_path
            .strip_prefix("a/")
            .or_else(|| raw_path.strip_prefix("b/"))
            .unwrap_or(raw_path.as_str())
            .replace('\\', "/");
        if normalized != normalized_target {
            return Err(format!(
                "unifiedDiff 只能修改 relativePath 指定的文件。relativePath={:?}，diff 中出现了 {:?}",
                relative_path,
                raw_path,
            ));
        }
    }

    Ok(unified_diff.to_string())
}

fn validate_update_task_input(input: &UpdateTaskInput) -> Result<(), String> {
    if input.relative_path.trim().is_empty() {
        return Err("relativePath 不能为空".to_string());
    }
    if input.line == 0 {
        return Err("line 必须大于 0".to_string());
    }
    if input.raw_line.trim().is_empty() {
        return Err("rawLine 不能为空".to_string());
    }
    if let Some(content) = &input.content {
        if content.trim().is_empty() {
            return Err("content 不能为空".to_string());
        }
    }
    if let TaskMetadataUpdateField::Set(start) = &input.start {
        validate_task_date_time_value(start, "start")?;
    }
    if let TaskMetadataUpdateField::Set(end) = &input.end {
        validate_task_date_time_value(end, "end")?;
    }
    if let TaskMetadataUpdateField::Set(recurrence) = &input.recurrence {
        validate_task_recurrence_value(recurrence)?;
    }
    if let TaskMetadataUpdateField::Set(priority) = &input.priority {
        validate_task_priority_value(priority)?;
    }

    Ok(())
}

fn deserialize_task_metadata_update_field<'de, D>(
    deserializer: D,
) -> Result<TaskMetadataUpdateField, D::Error>
where
    D: Deserializer<'de>,
{
    Option::<String>::deserialize(deserializer).map(|value| match value {
        Some(value) => TaskMetadataUpdateField::Set(value),
        None => TaskMetadataUpdateField::Clear,
    })
}

fn resolve_task_line_index(
    lines: &[String],
    preferred_line: usize,
    raw_line: &str,
) -> Result<usize, String> {
    let preferred_index = preferred_line.saturating_sub(1);
    if lines
        .get(preferred_index)
        .is_some_and(|line| line == raw_line)
    {
        return Ok(preferred_index);
    }

    let matched_indexes = lines
        .iter()
        .enumerate()
        .filter_map(|(index, line)| (line == raw_line).then_some(index))
        .collect::<Vec<_>>();
    if matched_indexes.len() == 1 {
        return Ok(matched_indexes[0]);
    }

    Err("无法定位要更新的任务行，请先重新读取任务列表".to_string())
}

fn parse_task_line_for_update(line: &str) -> Option<ParsedTaskLineForUpdate> {
    let (indent, list_marker, checked, tail) = parse_task_prefix_for_update(line)?;
    let tail_without_edit = strip_trailing_edit_token_for_update(tail);
    let (content_tail, metadata) = pop_task_metadata_tokens_for_update(tail_without_edit);
    let content = content_tail.trim();
    if content.is_empty() {
        return None;
    }

    Some(ParsedTaskLineForUpdate {
        indent: indent.to_string(),
        list_marker: list_marker.to_string(),
        checked,
        content: content.to_string(),
        due: metadata.due,
        start: metadata.start,
        end: metadata.end,
        recurrence: metadata.recurrence,
        priority: metadata.priority,
    })
}

fn parse_task_prefix_for_update(line: &str) -> Option<(&str, &str, bool, &str)> {
    let trimmed_start = line.trim_start();
    let indent_len = line.len().saturating_sub(trimmed_start.len());
    let indent = &line[..indent_len];
    let rest = trimmed_start;
    let marker_end = rest.find(char::is_whitespace)?;
    let list_marker = &rest[..marker_end];
    let mut tail = rest[marker_end..].trim_start();
    if !matches!(list_marker, "-" | "+" | "*") && !is_ordered_list_marker(list_marker) {
        return None;
    }

    if !tail.starts_with('[') || tail.len() < 3 {
        return None;
    }
    let checked = match tail.as_bytes().get(1) {
        Some(b'x') | Some(b'X') => true,
        Some(b' ') => false,
        _ => return None,
    };
    if tail.as_bytes().get(2) != Some(&b']') {
        return None;
    }
    tail = tail[3..].trim_start();
    if tail.is_empty() {
        return None;
    }

    Some((indent, list_marker, checked, tail))
}

fn is_ordered_list_marker(value: &str) -> bool {
    value.strip_suffix('.').is_some_and(|prefix| {
        !prefix.is_empty() && prefix.bytes().all(|byte| byte.is_ascii_digit())
    })
}

fn strip_trailing_edit_token_for_update(input: &str) -> &str {
    let trimmed = input.trim_end();
    if trimmed == "edit" {
        return "";
    }

    trimmed
        .strip_suffix(" edit")
        .map(str::trim_end)
        .unwrap_or(trimmed)
}

fn pop_task_metadata_tokens_for_update(mut input: &str) -> (&str, TaskMetadataForUpdate) {
    let mut metadata = TaskMetadataForUpdate::default();
    let pop_order = [
        TaskMetadataKindForUpdate::Priority,
        TaskMetadataKindForUpdate::Recurrence,
        TaskMetadataKindForUpdate::End,
        TaskMetadataKindForUpdate::Start,
        TaskMetadataKindForUpdate::Due,
    ];

    loop {
        let mut consumed = false;
        for kind in pop_order {
            if task_metadata_has_value(&metadata, kind) {
                continue;
            }

            let result = pop_task_metadata_token_for_update(input, kind);
            if !result.consumed {
                continue;
            }

            input = result.remaining;
            set_task_metadata_value(&mut metadata, kind, result.value);
            consumed = true;
            break;
        }

        if !consumed {
            break;
        }
    }

    (input, metadata)
}

fn task_metadata_has_value(
    metadata: &TaskMetadataForUpdate,
    kind: TaskMetadataKindForUpdate,
) -> bool {
    match kind {
        TaskMetadataKindForUpdate::Due => metadata.due.is_some(),
        TaskMetadataKindForUpdate::Start => metadata.start.is_some(),
        TaskMetadataKindForUpdate::End => metadata.end.is_some(),
        TaskMetadataKindForUpdate::Recurrence => metadata.recurrence.is_some(),
        TaskMetadataKindForUpdate::Priority => metadata.priority.is_some(),
    }
}

fn set_task_metadata_value(
    metadata: &mut TaskMetadataForUpdate,
    kind: TaskMetadataKindForUpdate,
    value: Option<String>,
) {
    match kind {
        TaskMetadataKindForUpdate::Due => metadata.due = value,
        TaskMetadataKindForUpdate::Start => metadata.start = value,
        TaskMetadataKindForUpdate::End => metadata.end = value,
        TaskMetadataKindForUpdate::Recurrence => metadata.recurrence = value,
        TaskMetadataKindForUpdate::Priority => metadata.priority = value,
    }
}

fn pop_task_metadata_token_for_update<'a>(
    input: &'a str,
    kind: TaskMetadataKindForUpdate,
) -> PopTaskMetadataResult<'a> {
    let trimmed = input.trim_end();
    if let Some(result) = pop_short_task_metadata_token_for_update(trimmed, kind) {
        return result;
    }

    if !trimmed.ends_with("}`")
        || !matches!(
            kind,
            TaskMetadataKindForUpdate::Due | TaskMetadataKindForUpdate::Priority
        )
    {
        return PopTaskMetadataResult {
            remaining: trimmed,
            value: None,
            consumed: false,
        };
    }

    let Some(start_index) = trimmed.rfind("`{$") else {
        return PopTaskMetadataResult {
            remaining: trimmed,
            value: None,
            consumed: false,
        };
    };
    if start_index > 0
        && !trimmed[..start_index]
            .chars()
            .next_back()
            .is_some_and(char::is_whitespace)
    {
        return PopTaskMetadataResult {
            remaining: trimmed,
            value: None,
            consumed: false,
        };
    }

    let value = normalize_optional_task_metadata_value(
        &trimmed[start_index + 3..trimmed.len().saturating_sub(2)],
    );
    PopTaskMetadataResult {
        remaining: trimmed[..start_index].trim_end(),
        value,
        consumed: true,
    }
}

fn pop_short_task_metadata_token_for_update<'a>(
    input: &'a str,
    kind: TaskMetadataKindForUpdate,
) -> Option<PopTaskMetadataResult<'a>> {
    let trimmed = input.trim_end();
    match kind {
        TaskMetadataKindForUpdate::Priority => {
            let (remaining, token) = split_last_whitespace_token_for_update(trimmed)?;
            let value = token
                .strip_prefix('!')
                .map(str::trim)
                .map(str::to_lowercase)
                .filter(|value| matches!(value.as_str(), "high" | "medium" | "low"))?;
            Some(PopTaskMetadataResult {
                remaining,
                value: Some(value),
                consumed: true,
            })
        }
        TaskMetadataKindForUpdate::Recurrence => {
            let (remaining, token) = split_last_whitespace_token_for_update(trimmed)?;
            let normalized = token.to_lowercase();
            let value = normalized
                .strip_prefix("every:")
                .or_else(|| normalized.strip_prefix("repeat:"))
                .or_else(|| normalized.strip_prefix("recurrence:"))
                .map(str::trim)
                .filter(|value| is_task_recurrence_token(value))?;
            Some(PopTaskMetadataResult {
                remaining,
                value: Some(value.to_string()),
                consumed: true,
            })
        }
        TaskMetadataKindForUpdate::Due
        | TaskMetadataKindForUpdate::Start
        | TaskMetadataKindForUpdate::End => {
            pop_task_date_time_metadata_token_for_update(trimmed, kind)
        }
    }
}

fn pop_task_date_time_metadata_token_for_update(
    input: &str,
    kind: TaskMetadataKindForUpdate,
) -> Option<PopTaskMetadataResult<'_>> {
    let (remaining, last_token) = split_last_whitespace_token_for_update(input)?;
    let prefix = task_date_time_metadata_prefix(kind)?;
    if let Some(value) = last_token
        .strip_prefix(prefix)
        .map(|value| value.replace('T', " "))
        .filter(|value| is_task_date_time_value(value))
    {
        return Some(PopTaskMetadataResult {
            remaining,
            value: Some(value),
            consumed: true,
        });
    }

    if is_task_time_token(last_token) {
        let (remaining_without_date, date_token) =
            split_last_whitespace_token_for_update(remaining)?;
        let date_value = date_token.strip_prefix(prefix)?;
        let candidate = format!("{date_value} {last_token}");
        if is_task_date_time_value(&candidate) {
            return Some(PopTaskMetadataResult {
                remaining: remaining_without_date,
                value: Some(candidate),
                consumed: true,
            });
        }
    }

    None
}

fn task_date_time_metadata_prefix(kind: TaskMetadataKindForUpdate) -> Option<&'static str> {
    match kind {
        TaskMetadataKindForUpdate::Due => Some("@"),
        TaskMetadataKindForUpdate::Start => Some("start:"),
        TaskMetadataKindForUpdate::End => Some("end:"),
        TaskMetadataKindForUpdate::Recurrence | TaskMetadataKindForUpdate::Priority => None,
    }
}

fn split_last_whitespace_token_for_update(input: &str) -> Option<(&str, &str)> {
    let trimmed = input.trim_end();
    if trimmed.is_empty() {
        return None;
    }

    let token_end = trimmed.len();
    for (index, ch) in trimmed.char_indices().rev() {
        if ch.is_whitespace() {
            let token_start = index + ch.len_utf8();
            if token_start >= token_end {
                continue;
            }

            return Some((
                trimmed[..index].trim_end(),
                &trimmed[token_start..token_end],
            ));
        }
    }

    Some(("", trimmed))
}

fn build_updated_task_line(
    parsed: &ParsedTaskLineForUpdate,
    input: &UpdateTaskInput,
) -> Result<String, String> {
    let content = input
        .content
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(parsed.content.as_str());
    let checked = input.checked.unwrap_or(parsed.checked);
    let start = resolve_optional_task_metadata_update(
        &input.start,
        parsed.start.as_deref(),
        Some(validate_task_date_time_value),
        "start",
    )?;
    let end = resolve_optional_task_metadata_update(
        &input.end,
        parsed.end.as_deref(),
        Some(validate_task_date_time_value),
        "end",
    )?;
    let recurrence = resolve_optional_task_metadata_update(
        &input.recurrence,
        parsed.recurrence.as_deref(),
        Some(|value, _field| validate_task_recurrence_value(value)),
        "recurrence",
    )?;
    let priority = resolve_optional_task_metadata_update(
        &input.priority,
        parsed.priority.as_deref(),
        Some(|value, _field| validate_task_priority_value(value)),
        "priority",
    )?;

    let mut segments = vec![format!(
        "{}{} [{}] {}",
        parsed.indent,
        parsed.list_marker,
        if checked { "x" } else { " " },
        content,
    )];
    if let Some(start) = start {
        segments.push(format!("start:{start}"));
    }
    if let Some(end) = end {
        segments.push(format!("end:{end}"));
    }
    if let Some(recurrence) = recurrence {
        segments.push(format!("every:{recurrence}"));
    }
    if let Some(priority) = priority {
        segments.push(format!("!{priority}"));
    }

    Ok(segments.join(" "))
}

fn resolve_optional_task_metadata_update(
    update: &TaskMetadataUpdateField,
    current: Option<&str>,
    validator: Option<fn(&str, &str) -> Result<(), String>>,
    field: &str,
) -> Result<Option<String>, String> {
    match update {
        TaskMetadataUpdateField::Missing => {
            Ok(current.and_then(normalize_optional_task_metadata_value))
        }
        TaskMetadataUpdateField::Clear => Ok(None),
        TaskMetadataUpdateField::Set(value) => {
            let Some(normalized) = normalize_optional_task_metadata_value(value) else {
                return Ok(None);
            };
            if let Some(validator) = validator {
                validator(&normalized, field)?;
            }
            Ok(Some(normalized))
        }
    }
}

fn normalize_optional_task_metadata_value(value: &str) -> Option<String> {
    let normalized = value.trim().replace('T', " ");
    (!normalized.is_empty()).then_some(normalized)
}

fn validate_task_date_time_value(value: &str, field: &str) -> Result<(), String> {
    let normalized = value.trim().replace('T', " ");
    if is_task_date_time_value(&normalized) {
        return Ok(());
    }

    Err(format!(
        "{field} 必须是 YYYY-MM-DD 或 YYYY-MM-DD HH:MM 格式"
    ))
}

fn validate_task_recurrence_value(value: &str) -> Result<(), String> {
    let normalized = value.trim().to_lowercase();
    if is_task_recurrence_token(&normalized) {
        return Ok(());
    }

    Err("recurrence 只能包含字母、数字、- 或 _".to_string())
}

fn validate_task_priority_value(value: &str) -> Result<(), String> {
    if matches!(
        value.trim().to_lowercase().as_str(),
        "high" | "medium" | "low"
    ) {
        return Ok(());
    }

    Err("priority 必须是 high、medium 或 low".to_string())
}

fn is_task_date_time_value(value: &str) -> bool {
    let mut parts = value.split(' ');
    let Some(date_part) = parts.next() else {
        return false;
    };
    if !is_task_date_token(date_part) {
        return false;
    }

    match parts.next() {
        None => true,
        Some(time_part) => parts.next().is_none() && is_task_time_token(time_part),
    }
}

fn is_task_recurrence_token(value: &str) -> bool {
    !value.is_empty()
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

fn is_task_date_token(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 10
        && bytes[4] == b'-'
        && bytes[7] == b'-'
        && bytes
            .iter()
            .enumerate()
            .all(|(index, byte)| matches!(index, 4 | 7) || byte.is_ascii_digit())
}

fn is_task_time_token(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 5
        && bytes[2] == b':'
        && bytes
            .iter()
            .enumerate()
            .all(|(index, byte)| index == 2 || byte.is_ascii_digit())
}

/// 执行“保存结构化 Canvas 文档”能力。
fn execute_save_canvas_document(
    input: Value,
    context: &CapabilityExecutionContext<'_>,
) -> Result<Value, String> {
    let input: RelativePathWithCanvasDocumentInput =
        parse_canvas_document_input(input, "vault.save_canvas_document")?;
    let output = canvas_app_service::save_vault_canvas_document_in_root(
        context.vault_root,
        input.relative_path,
        input.document,
    )?;
    serialize_output(output, "vault.save_canvas_document")
}

fn parse_canvas_document_input(
    input: Value,
    capability_id: &str,
) -> Result<RelativePathWithCanvasDocumentInput, String> {
    serde_json::from_value(input).map_err(|error| {
        let base = format!("解析能力输入失败 {}: {error}", capability_id);
        let message = error.to_string();
        if message.contains("missing field `x`")
            || message.contains("missing field `y`")
            || message.contains("missing field `width`")
            || message.contains("missing field `height`")
            || message.contains("missing field `id`")
            || message.contains("missing field `type`")
        {
            format!(
                "{}。建议：先调用 vault.get_canvas_document 读取完整 document，再在返回结果上做最小修改后整份保存；不要只发送局部节点片段。每个 node 都必须保留 id、type、x、y、width、height，坐标可以是浮点数。",
                base
            )
        } else if message.contains("missing field `fromNode`")
            || message.contains("missing field `toNode`")
        {
            format!(
                "{}。建议：先调用 vault.get_canvas_document 读取完整 document，再在返回结果上做最小修改后整份保存；不要只发送局部连线片段。每个 edge 都必须保留 id、fromNode、toNode；如果原始 edge 带有 fromSide、toSide、label、color 或其他字段，也应一并保留，除非你明确要删除或修改它们。",
                base
            )
        } else {
            base
        }
    })
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

#[cfg(test)]
mod tests {
    use super::execute_vault_capability;
    use crate::domain::capability::{CapabilityExecutionContext, CapabilityExecutionRequest};
    use serde_json::json;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    static TEST_ROOT_SEQ: AtomicU64 = AtomicU64::new(1);

    fn create_test_root() -> PathBuf {
        let sequence = TEST_ROOT_SEQ.fetch_add(1, Ordering::Relaxed);
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0);
        let root =
            std::env::temp_dir().join(format!("ofive-vault-capability-test-{unique}-{sequence}"));
        fs::create_dir_all(root.join(".ofive")).expect("应成功创建测试根目录");
        root
    }

    fn write_markdown_file(root: &Path, relative_path: &str, content: &str) {
        let file_path = root.join(relative_path);
        if let Some(parent) = file_path.parent() {
            fs::create_dir_all(parent).expect("应成功创建测试目录");
        }
        fs::write(file_path, content).expect("应成功写入 Markdown 文件");
    }

    fn write_canvas_file(root: &Path, relative_path: &str, content: &str) {
        let file_path = root.join(relative_path);
        if let Some(parent) = file_path.parent() {
            fs::create_dir_all(parent).expect("应成功创建测试目录");
        }
        fs::write(file_path, content).expect("应成功写入 Canvas 文件");
    }

    fn write_agent_skill_file(root: &Path, skill_name: &str, relative_path: &str, content: &str) {
        let file_path = root
            .join(".ofive")
            .join("skills")
            .join(skill_name)
            .join(relative_path);
        if let Some(parent) = file_path.parent() {
            fs::create_dir_all(parent).expect("应成功创建测试 skill 目录");
        }
        fs::write(file_path, content).expect("应成功写入测试 skill 文件");
    }

    #[test]
    fn execute_vault_capability_should_resolve_wikilink_target() {
        let root = create_test_root();
        write_markdown_file(&root, "notes/topic/readme.md", "# Readme\n");

        let request = CapabilityExecutionRequest {
            capability_id: "vault.resolve_wikilink_target".to_string(),
            consumer: crate::domain::capability::CapabilityConsumer::AiTool,
            input: json!({"currentDir": "notes/topic", "target": "readme"}),
        };
        let context = CapabilityExecutionContext { vault_root: &root };

        let result = execute_vault_capability(&request, &context)
            .expect("应由 Vault 模块接管该能力")
            .expect("解析 WikiLink 应成功");

        assert_eq!(
            result.get("relativePath").and_then(|value| value.as_str()),
            Some("notes/topic/readme.md")
        );
    }

    #[test]
    fn execute_vault_capability_should_suggest_wikilink_targets() {
        let root = create_test_root();
        write_markdown_file(&root, "notes/topic.md", "# Topic\n");
        write_markdown_file(&root, "notes/guide.md", "# Guide\n\n[[topic]]\n");

        let request = CapabilityExecutionRequest {
            capability_id: "vault.suggest_wikilink_targets".to_string(),
            consumer: crate::domain::capability::CapabilityConsumer::AiTool,
            input: json!({"query": "topic", "limit": 5}),
        };
        let context = CapabilityExecutionContext { vault_root: &root };

        let result = execute_vault_capability(&request, &context)
            .expect("应由 Vault 模块接管该能力")
            .expect("建议 WikiLink 目标应成功");

        let items = result.as_array().expect("输出应为数组");
        assert!(!items.is_empty());
        assert_eq!(
            items[0]
                .get("relativePath")
                .and_then(|value| value.as_str()),
            Some("notes/topic.md")
        );
    }

    #[test]
    fn execute_vault_capability_should_list_tasks() {
        let root = create_test_root();
        write_markdown_file(
            &root,
            "Tasks/task.md",
            "# Tasks\n- [ ] Plan launch start:2026-03-24 09:00 end:2026-03-25 18:00 every:weekly-tue !high\n- [x] Done item start:2026-03-20 09:00 !low\n",
        );

        let request = CapabilityExecutionRequest {
            capability_id: "vault.list_tasks".to_string(),
            consumer: crate::domain::capability::CapabilityConsumer::AiTool,
            input: json!({"includeCompleted": false}),
        };
        let context = CapabilityExecutionContext { vault_root: &root };

        let result = execute_vault_capability(&request, &context)
            .expect("应由 Vault 模块接管任务列表能力")
            .expect("列出任务应成功");

        assert_eq!(result["totalCount"], 1);
        assert_eq!(result["returnedCount"], 1);
        assert_eq!(result["tasks"][0]["relativePath"], "Tasks/task.md");
        assert_eq!(result["tasks"][0]["line"], 2);
        assert_eq!(result["tasks"][0]["content"], "Plan launch");
        assert_eq!(result["tasks"][0]["recurrence"], "weekly-tue");
    }

    #[test]
    fn execute_vault_capability_should_update_task_schedule() {
        let root = create_test_root();
        let raw_line =
            "- [ ] Plan launch start:2026-03-24 09:00 end:2026-03-25 18:00 every:weekly-tue !high";
        write_markdown_file(&root, "Tasks/task.md", &format!("# Tasks\n{raw_line}\n"));

        let request = CapabilityExecutionRequest {
            capability_id: "vault.update_task".to_string(),
            consumer: crate::domain::capability::CapabilityConsumer::AiTool,
            input: json!({
                "relativePath": "Tasks/task.md",
                "line": 2,
                "rawLine": raw_line,
                "content": "Plan launch window",
                "checked": true,
                "start": "2026-03-26 10:00",
                "end": "2026-03-26 12:00",
                "recurrence": "monthly-26",
                "priority": "medium"
            }),
        };
        let context = CapabilityExecutionContext { vault_root: &root };

        let result = execute_vault_capability(&request, &context)
            .expect("应由 Vault 模块接管任务更新能力")
            .expect("更新任务应成功");

        let expected = "- [x] Plan launch window start:2026-03-26 10:00 end:2026-03-26 12:00 every:monthly-26 !medium";
        assert_eq!(result["updatedLine"], expected);
        assert_eq!(result["task"]["checked"], true);
        assert_eq!(result["task"]["priority"], "medium");
        assert_eq!(
            fs::read_to_string(root.join("Tasks/task.md")).expect("应能读取更新后的任务文件"),
            format!("# Tasks\n{expected}\n")
        );
    }

    #[test]
    fn execute_vault_capability_should_clear_task_schedule_fields_with_null() {
        let root = create_test_root();
        let raw_line =
            "- [ ] Plan launch start:2026-03-24 09:00 end:2026-03-25 18:00 every:weekly-tue !high";
        write_markdown_file(&root, "Tasks/task.md", &format!("# Tasks\n{raw_line}\n"));

        let request = CapabilityExecutionRequest {
            capability_id: "vault.update_task".to_string(),
            consumer: crate::domain::capability::CapabilityConsumer::AiTool,
            input: json!({
                "relativePath": "Tasks/task.md",
                "line": 2,
                "rawLine": raw_line,
                "start": null,
                "end": null,
                "recurrence": null,
                "priority": null
            }),
        };
        let context = CapabilityExecutionContext { vault_root: &root };

        let result = execute_vault_capability(&request, &context)
            .expect("应由 Vault 模块接管任务更新能力")
            .expect("清空任务元数据应成功");

        let expected = "- [ ] Plan launch";
        assert_eq!(result["updatedLine"], expected);
        assert!(result["task"]["start"].is_null());
        assert!(result["task"]["end"].is_null());
        assert!(result["task"]["recurrence"].is_null());
        assert!(result["task"]["priority"].is_null());
        assert_eq!(
            fs::read_to_string(root.join("Tasks/task.md")).expect("应能读取更新后的任务文件"),
            format!("# Tasks\n{expected}\n")
        );
    }

    #[test]
    fn execute_vault_capability_should_reject_stale_task_line() {
        let root = create_test_root();
        write_markdown_file(
            &root,
            "Tasks/task.md",
            "# Tasks\n- [ ] Current task !high\n",
        );

        let request = CapabilityExecutionRequest {
            capability_id: "vault.update_task".to_string(),
            consumer: crate::domain::capability::CapabilityConsumer::AiTool,
            input: json!({
                "relativePath": "Tasks/task.md",
                "line": 2,
                "rawLine": "- [ ] Old task !high",
                "priority": "low"
            }),
        };
        let context = CapabilityExecutionContext { vault_root: &root };

        let error = execute_vault_capability(&request, &context)
            .expect("应由 Vault 模块接管任务更新能力")
            .expect_err("过期 rawLine 应被拒绝");

        assert!(error.contains("重新读取任务列表"));
    }

    #[test]
    fn execute_vault_capability_should_list_agent_skills() {
        let root = create_test_root();
        write_agent_skill_file(
            &root,
            "research-helper",
            "SKILL.md",
            "---\nname: research-helper\ndescription: Research local notes.\n---\n# Research\n",
        );

        let request = CapabilityExecutionRequest {
            capability_id: "agent_skill.list".to_string(),
            consumer: crate::domain::capability::CapabilityConsumer::AiTool,
            input: json!({}),
        };
        let context = CapabilityExecutionContext { vault_root: &root };

        let result = execute_vault_capability(&request, &context)
            .expect("应由 Vault 模块接管该能力")
            .expect("列出 Agent SKILL 应成功");

        let items = result.as_array().expect("输出应为数组");
        assert!(items.iter().any(|item| {
            item.get("name").and_then(|value| value.as_str()) == Some("research-helper")
        }));
        assert!(items.iter().any(|item| {
            item.get("name").and_then(|value| value.as_str()) == Some("ofive-wikilink-syntax")
                && item.get("readOnly").and_then(|value| value.as_bool()) == Some(true)
        }));
    }

    #[test]
    fn execute_vault_capability_should_read_agent_skill_file() {
        let root = create_test_root();
        write_agent_skill_file(
            &root,
            "research-helper",
            "SKILL.md",
            "---\nname: research-helper\ndescription: Research local notes.\n---\n# Research\n",
        );

        let request = CapabilityExecutionRequest {
            capability_id: "agent_skill.read_file".to_string(),
            consumer: crate::domain::capability::CapabilityConsumer::AiTool,
            input: json!({"skillName": "research-helper", "relativePath": "SKILL.md"}),
        };
        let context = CapabilityExecutionContext { vault_root: &root };

        let result = execute_vault_capability(&request, &context)
            .expect("应由 Vault 模块接管该能力")
            .expect("读取 Agent SKILL 文件应成功");

        assert_eq!(
            result.get("skillName").and_then(|value| value.as_str()),
            Some("research-helper")
        );
        assert!(result
            .get("content")
            .and_then(|value| value.as_str())
            .is_some_and(|content| content.contains("# Research")));
    }

    #[test]
    fn execute_vault_capability_should_suggest_wikilink_targets_without_query() {
        let root = create_test_root();
        write_markdown_file(&root, "notes/topic.md", "# Topic\n");
        write_markdown_file(&root, "notes/guide.md", "# Guide\n\n[[topic]]\n");

        let request = CapabilityExecutionRequest {
            capability_id: "vault.suggest_wikilink_targets".to_string(),
            consumer: crate::domain::capability::CapabilityConsumer::AiTool,
            input: json!({"limit": 5}),
        };
        let context = CapabilityExecutionContext { vault_root: &root };

        let result = execute_vault_capability(&request, &context)
            .expect("应由 Vault 模块接管该能力")
            .expect("缺省 query 应按空查询返回 WikiLink 建议");

        let items = result.as_array().expect("输出应为数组");
        assert!(!items.is_empty());
        assert_eq!(
            items[0]
                .get("relativePath")
                .and_then(|value| value.as_str()),
            Some("notes/topic.md")
        );
    }

    #[test]
    fn execute_vault_capability_should_search_markdown_files_without_query() {
        let root = create_test_root();
        write_markdown_file(&root, "notes/alpha.md", "# Alpha\n");
        write_markdown_file(&root, "notes/beta.md", "# Beta\n");

        let request = CapabilityExecutionRequest {
            capability_id: "vault.search_markdown_files".to_string(),
            consumer: crate::domain::capability::CapabilityConsumer::AiTool,
            input: json!({"limit": 5}),
        };
        let context = CapabilityExecutionContext { vault_root: &root };

        let result = execute_vault_capability(&request, &context)
            .expect("应由 Vault 模块接管该能力")
            .expect("缺省 query 应按空查询返回 Markdown 文件列表");

        let items = result.as_array().expect("输出应为数组");
        assert_eq!(items.len(), 2);
        assert_eq!(
            items[0]
                .get("relativePath")
                .and_then(|value| value.as_str()),
            Some("notes/alpha.md")
        );
        assert_eq!(
            items[1]
                .get("relativePath")
                .and_then(|value| value.as_str()),
            Some("notes/beta.md")
        );
    }

    #[test]
    fn execute_vault_capability_should_search_canvas_files() {
        let root = create_test_root();
        write_canvas_file(
            &root,
            "boards/product-roadmap.canvas",
            "{\n  \"nodes\": [],\n  \"edges\": []\n}\n",
        );
        write_canvas_file(
            &root,
            "boards/archive/weekly.canvas",
            "{\n  \"nodes\": [],\n  \"edges\": []\n}\n",
        );

        let request = CapabilityExecutionRequest {
            capability_id: "vault.search_canvas_files".to_string(),
            consumer: crate::domain::capability::CapabilityConsumer::AiTool,
            input: json!({"query": "roadmap", "limit": 5}),
        };
        let context = CapabilityExecutionContext { vault_root: &root };

        let result = execute_vault_capability(&request, &context)
            .expect("应由 Vault 模块接管该能力")
            .expect("搜索 Canvas 文件应成功");

        let items = result.as_array().expect("输出应为数组");
        assert_eq!(items.len(), 1);
        assert_eq!(
            items[0]
                .get("relativePath")
                .and_then(|value| value.as_str()),
            Some("boards/product-roadmap.canvas")
        );
    }

    #[test]
    fn execute_vault_capability_should_search_canvas_files_without_query() {
        let root = create_test_root();
        write_canvas_file(
            &root,
            "boards/archive.canvas",
            "{\n  \"nodes\": [],\n  \"edges\": []\n}\n",
        );
        write_canvas_file(
            &root,
            "boards/roadmap.canvas",
            "{\n  \"nodes\": [],\n  \"edges\": []\n}\n",
        );

        let request = CapabilityExecutionRequest {
            capability_id: "vault.search_canvas_files".to_string(),
            consumer: crate::domain::capability::CapabilityConsumer::AiTool,
            input: json!({"limit": 5}),
        };
        let context = CapabilityExecutionContext { vault_root: &root };

        let result = execute_vault_capability(&request, &context)
            .expect("应由 Vault 模块接管该能力")
            .expect("缺省 query 应按空查询返回 Canvas 文件列表");

        let items = result.as_array().expect("输出应为数组");
        assert_eq!(items.len(), 2);
        assert_eq!(
            items[0]
                .get("relativePath")
                .and_then(|value| value.as_str()),
            Some("boards/archive.canvas")
        );
        assert_eq!(
            items[1]
                .get("relativePath")
                .and_then(|value| value.as_str()),
            Some("boards/roadmap.canvas")
        );
    }

    #[test]
    fn execute_vault_capability_should_read_and_save_canvas_document() {
        let root = create_test_root();
        write_canvas_file(
            &root,
            "boards/roadmap.canvas",
            "{\n  \"nodes\": [],\n  \"edges\": [],\n  \"metadata\": {\n    \"title\": \"Roadmap\"\n  }\n}\n",
        );
        let context = CapabilityExecutionContext { vault_root: &root };

        let read_request = CapabilityExecutionRequest {
            capability_id: "vault.get_canvas_document".to_string(),
            consumer: crate::domain::capability::CapabilityConsumer::AiTool,
            input: json!({"relativePath": "boards/roadmap.canvas"}),
        };
        let read_result = execute_vault_capability(&read_request, &context)
            .expect("应由 Vault 模块接管读取 Canvas 能力")
            .expect("读取结构化 Canvas 应成功");
        assert_eq!(
            read_result
                .get("document")
                .and_then(|value| value.get("metadata"))
                .and_then(|value| value.get("title"))
                .and_then(|value| value.as_str()),
            Some("Roadmap")
        );

        let save_request = CapabilityExecutionRequest {
            capability_id: "vault.save_canvas_document".to_string(),
            consumer: crate::domain::capability::CapabilityConsumer::AiTool,
            input: json!({
                "relativePath": "boards/roadmap.canvas",
                "document": {
                    "nodes": [
                        {
                            "id": "text-1",
                            "type": "text",
                            "x": 16,
                            "y": 24,
                            "width": 320,
                            "height": 180,
                            "text": "hello"
                        }
                    ],
                    "edges": [],
                    "metadata": {
                        "title": "Roadmap"
                    }
                }
            }),
        };
        execute_vault_capability(&save_request, &context)
            .expect("应由 Vault 模块接管保存 Canvas 能力")
            .expect("保存结构化 Canvas 应成功");

        let saved_content = fs::read_to_string(root.join("boards/roadmap.canvas"))
            .expect("应能读取保存后的 Canvas 文件");
        assert!(saved_content.contains("\"id\": \"text-1\""));
    }

    #[test]
    fn execute_vault_capability_should_explain_incomplete_canvas_edge_payloads() {
        let root = create_test_root();
        write_canvas_file(
            &root,
            "boards/roadmap.canvas",
            "{\n  \"nodes\": [],\n  \"edges\": []\n}\n",
        );
        let context = CapabilityExecutionContext { vault_root: &root };

        let save_request = CapabilityExecutionRequest {
            capability_id: "vault.save_canvas_document".to_string(),
            consumer: crate::domain::capability::CapabilityConsumer::AiTool,
            input: json!({
                "relativePath": "boards/roadmap.canvas",
                "document": {
                    "nodes": [],
                    "edges": [
                        {
                            "id": "edge-1",
                            "toNode": "node-b"
                        }
                    ]
                }
            }),
        };

        let error = execute_vault_capability(&save_request, &context)
            .expect("应由 Vault 模块接管保存 Canvas 能力")
            .expect_err("局部 edge 片段应触发更明确的诊断信息");

        assert!(error.contains("missing field `fromNode`"));
        assert!(error.contains("不要只发送局部连线片段"));
        assert!(error.contains("每个 edge 都必须保留 id、fromNode、toNode"));
    }

    #[test]
    fn execute_vault_capability_should_apply_markdown_patch() {
        let root = create_test_root();
        write_markdown_file(&root, "notes/guide.md", "# Guide\n\nalpha\nbeta\ngamma\n");
        let context = CapabilityExecutionContext { vault_root: &root };

        let request = CapabilityExecutionRequest {
            capability_id: "vault.apply_markdown_patch".to_string(),
            consumer: crate::domain::capability::CapabilityConsumer::AiTool,
            input: json!({
                "relativePath": "notes/guide.md",
                "unifiedDiff": "--- a/notes/guide.md\n+++ b/notes/guide.md\n@@ -3,3 +3,3 @@\n alpha\n-beta\n+beta patched\n gamma"
            }),
        };

        let result = execute_vault_capability(&request, &context)
            .expect("应由 Vault 模块接管 patch 能力")
            .expect("应用 Markdown patch 应成功");

        assert_eq!(
            result.get("relativePath").and_then(|value| value.as_str()),
            Some("notes/guide.md")
        );
        assert_eq!(
            result
                .get("appliedBlockCount")
                .and_then(|value| value.as_u64()),
            Some(1)
        );
        assert_eq!(
            fs::read_to_string(root.join("notes/guide.md")).expect("应能读取修改后的文件"),
            "# Guide\n\nalpha\nbeta patched\ngamma\n"
        );
    }

    #[test]
    fn execute_vault_capability_should_reject_mismatched_patch_relative_path() {
        let root = create_test_root();
        write_markdown_file(&root, "notes/guide.md", "# Guide\n\nalpha\nbeta\ngamma\n");
        let context = CapabilityExecutionContext { vault_root: &root };

        let request = CapabilityExecutionRequest {
            capability_id: "vault.apply_markdown_patch".to_string(),
            consumer: crate::domain::capability::CapabilityConsumer::AiTool,
            input: json!({
                "relativePath": "notes/other.md",
                "unifiedDiff": "--- a/notes/guide.md\n+++ b/notes/guide.md\n@@ -3,3 +3,3 @@\n alpha\n-beta\n+beta patched\n gamma"
            }),
        };

        let error = execute_vault_capability(&request, &context)
            .expect("应由 Vault 模块接管 patch 能力")
            .expect_err("路径不一致时应拒绝 patch");

        assert!(error.contains("relativePath"));
    }
}
