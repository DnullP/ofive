//! # Vault Capability Execution
//!
//! 定义 Vault 模块对平台注册能力的执行路由。
//! 该模块让 Vault capability 的输入解析、执行分发与输出序列化
//! 保持在 Vault 自己的边界内，而不是集中堆在公共执行器中。

use serde::Deserialize;
use serde::Serialize;
use serde_json::Value;

use crate::app::vault::{
    canvas_app_service, markdown_patch_app_service, query_app_service, vault_app_service,
};
use crate::domain::capability::{CapabilityExecutionContext, CapabilityExecutionRequest};
use crate::shared::vault_contracts::VaultCanvasDocument;

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
        "vault.search_canvas_files" => Some(execute_search_canvas_files(
            request.input.clone(),
            context,
        )),
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
        "vault.create_markdown_file" => {
            Some(execute_create_markdown_file(request.input.clone(), context))
        }
        "vault.save_markdown_file" => {
            Some(execute_save_markdown_file(request.input.clone(), context))
        }
        "vault.apply_markdown_patch" => {
            Some(execute_apply_markdown_patch(request.input.clone(), context))
        }
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
    query: String,
    limit: Option<usize>,
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
struct ApplyMarkdownPatchInput {
    relative_path: String,
    unified_diff: String,
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
    let unified_diff = ensure_patch_targets_relative_path(
        &input.relative_path,
        &input.unified_diff,
    )?;
    let output = markdown_patch_app_service::apply_unified_markdown_diff_in_root(
        context.vault_root,
        unified_diff,
    )?;
    serialize_output(output, "vault.apply_markdown_patch")
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
        let root = std::env::temp_dir().join(format!("ofive-vault-capability-test-{unique}-{sequence}"));
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

        assert_eq!(result.get("relativePath").and_then(|value| value.as_str()), Some("notes/topic/readme.md"));
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
        assert_eq!(items[0].get("relativePath").and_then(|value| value.as_str()), Some("notes/topic.md"));
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
            items[0].get("relativePath").and_then(|value| value.as_str()),
            Some("boards/product-roadmap.canvas")
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

        assert_eq!(result.get("relativePath").and_then(|value| value.as_str()), Some("notes/guide.md"));
        assert_eq!(result.get("appliedBlockCount").and_then(|value| value.as_u64()), Some(1));
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
