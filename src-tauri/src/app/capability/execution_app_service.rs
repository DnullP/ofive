//! # 平台能力执行应用服务
//!
//! 负责将 sidecar / AI tool 发起的 capability 调用路由到 Rust 已有实现，
//! 并在执行前应用统一的风险与确认策略。

use std::path::Path;

use serde::Deserialize;
use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Manager};

use crate::app::vault::{query_app_service, vault_app_service};
use crate::domain::ai::sidecar_contract::{
    SidecarCapabilityCallRequest, SidecarCapabilityCallResult,
};
use crate::domain::capability::{
    build_builtin_capability_registry, evaluate_capability_access, CapabilityConsumer,
    CapabilityExecutionContext, CapabilityExecutionRequest, CapabilityExecutor,
};
use crate::state::{get_vault_root, AppState};

/// 在当前 app 上下文中执行一次 sidecar capability 调用。
pub(crate) fn execute_sidecar_capability_call(
    app_handle: &AppHandle,
    request: SidecarCapabilityCallRequest,
) -> SidecarCapabilityCallResult {
    let state = app_handle.state::<AppState>();
    let capability_id = request.capability_id.clone();

    let execution_result = get_vault_root(&state).and_then(|vault_root| {
        execute_capability_in_root(
            &vault_root,
            CapabilityExecutionRequest {
                capability_id: request.capability_id,
                consumer: CapabilityConsumer::Sidecar,
                input: request.input,
            },
        )
    });

    match execution_result {
        Ok(output) => SidecarCapabilityCallResult::success(capability_id, output),
        Err(error) => SidecarCapabilityCallResult::failure(capability_id, error),
    }
}

/// 在指定 vault 根目录下执行一条平台能力请求。
pub(crate) fn execute_capability_in_root(
    vault_root: &Path,
    request: CapabilityExecutionRequest,
) -> Result<Value, String> {
    let registry = build_builtin_capability_registry();
    let descriptor = registry
        .get(&request.capability_id)
        .ok_or_else(|| format!("未注册的平台能力: {}", request.capability_id))?;

    evaluate_capability_access(&descriptor, &request.consumer)?;

    let context = CapabilityExecutionContext { vault_root };
    match request.capability_id.as_str() {
        "vault.read_markdown_file" => ReadMarkdownFileExecutor.execute(request.input, &context),
        "vault.search_markdown_files" => {
            SearchMarkdownFilesExecutor.execute(request.input, &context)
        }
        "vault.get_markdown_outline" => GetMarkdownOutlineExecutor.execute(request.input, &context),
        "vault.get_backlinks_for_file" => {
            GetBacklinksForFileExecutor.execute(request.input, &context)
        }
        "vault.get_markdown_graph" => GetMarkdownGraphExecutor.execute(request.input, &context),
        "vault.create_markdown_file" => CreateMarkdownFileExecutor.execute(request.input, &context),
        "vault.save_markdown_file" => SaveMarkdownFileExecutor.execute(request.input, &context),
        "vault.rename_markdown_file" => RenameMarkdownFileExecutor.execute(request.input, &context),
        "vault.delete_markdown_file" => DeleteMarkdownFileExecutor.execute(request.input, &context),
        "vault.create_directory" => CreateDirectoryExecutor.execute(request.input, &context),
        _ => Err(format!(
            "平台能力 {} 已注册，但当前执行器尚未实现",
            request.capability_id
        )),
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

struct ReadMarkdownFileExecutor;
struct SearchMarkdownFilesExecutor;
struct GetMarkdownOutlineExecutor;
struct GetBacklinksForFileExecutor;
struct GetMarkdownGraphExecutor;
struct CreateMarkdownFileExecutor;
struct SaveMarkdownFileExecutor;
struct RenameMarkdownFileExecutor;
struct DeleteMarkdownFileExecutor;
struct CreateDirectoryExecutor;

impl CapabilityExecutor for ReadMarkdownFileExecutor {
    fn execute(
        &self,
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
}

impl CapabilityExecutor for SearchMarkdownFilesExecutor {
    fn execute(
        &self,
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
}

impl CapabilityExecutor for GetMarkdownOutlineExecutor {
    fn execute(
        &self,
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
}

impl CapabilityExecutor for GetBacklinksForFileExecutor {
    fn execute(
        &self,
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
}

impl CapabilityExecutor for GetMarkdownGraphExecutor {
    fn execute(
        &self,
        _input: Value,
        context: &CapabilityExecutionContext<'_>,
    ) -> Result<Value, String> {
        let output =
            query_app_service::get_current_vault_markdown_graph_in_root(context.vault_root)?;
        serialize_output(output, "vault.get_markdown_graph")
    }
}

impl CapabilityExecutor for CreateMarkdownFileExecutor {
    fn execute(
        &self,
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
}

impl CapabilityExecutor for SaveMarkdownFileExecutor {
    fn execute(
        &self,
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
}

impl CapabilityExecutor for RenameMarkdownFileExecutor {
    fn execute(
        &self,
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
}

impl CapabilityExecutor for DeleteMarkdownFileExecutor {
    fn execute(
        &self,
        input: Value,
        context: &CapabilityExecutionContext<'_>,
    ) -> Result<Value, String> {
        let input: RelativePathInput = parse_input(input, "vault.delete_markdown_file")?;
        vault_app_service::delete_vault_markdown_file_in_root(
            input.relative_path,
            context.vault_root,
        )?;
        Ok(serde_json::json!({"ok": true}))
    }
}

impl CapabilityExecutor for CreateDirectoryExecutor {
    fn execute(
        &self,
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
}

fn parse_input<T>(input: Value, capability_id: &str) -> Result<T, String>
where
    T: for<'de> Deserialize<'de>,
{
    serde_json::from_value(input)
        .map_err(|error| format!("解析能力输入失败 {}: {error}", capability_id))
}

fn serialize_output<T>(output: T, capability_id: &str) -> Result<Value, String>
where
    T: Serialize,
{
    serde_json::to_value(output)
        .map_err(|error| format!("序列化能力输出失败 {}: {error}", capability_id))
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    use serde_json::json;

    use crate::domain::capability::{CapabilityConsumer, CapabilityExecutionRequest};

    use super::execute_capability_in_root;

    static TEST_ROOT_SEQUENCE: AtomicU64 = AtomicU64::new(1);

    fn create_test_root() -> PathBuf {
        let sequence = TEST_ROOT_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0);
        let root =
            std::env::temp_dir().join(format!("ofive-capability-exec-test-{unique}-{sequence}"));
        fs::create_dir_all(root.join(".ofive")).expect("应成功创建测试仓库目录");
        root
    }

    fn write_markdown_file(root: &Path, relative_path: &str, content: &str) {
        let file_path = root.join(relative_path);
        if let Some(parent) = file_path.parent() {
            fs::create_dir_all(parent).expect("应成功创建父目录");
        }
        fs::write(file_path, content).expect("应成功写入 Markdown 文件");
    }

    #[test]
    fn execute_capability_in_root_should_read_markdown_file() {
        let root = create_test_root();
        write_markdown_file(&root, "Notes/A.md", "# A\n\nhello");

        let output = execute_capability_in_root(
            &root,
            CapabilityExecutionRequest {
                capability_id: "vault.read_markdown_file".to_string(),
                consumer: CapabilityConsumer::Sidecar,
                input: json!({"relativePath": "Notes/A.md"}),
            },
        )
        .expect("读取 markdown 能力应执行成功");

        assert_eq!(output["relativePath"], "Notes/A.md");
        assert_eq!(output["content"], "# A\n\nhello");

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn execute_capability_in_root_should_create_markdown_file() {
        let root = create_test_root();

        let output = execute_capability_in_root(
            &root,
            CapabilityExecutionRequest {
                capability_id: "vault.create_markdown_file".to_string(),
                consumer: CapabilityConsumer::Sidecar,
                input: json!({"relativePath": "Notes/New.md", "content": "# New"}),
            },
        )
        .expect("确认后的 sidecar 写能力应执行成功");

        assert_eq!(output["relativePath"], "Notes/New.md");
        assert_eq!(output["created"], true);
        assert!(root.join("Notes/New.md").exists());

        let _ = fs::remove_dir_all(root);
    }
}
