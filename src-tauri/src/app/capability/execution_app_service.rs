//! # 平台能力执行应用服务
//!
//! 负责将 sidecar / AI tool 发起的 capability 调用路由到 Rust 已有实现，
//! 并在执行前应用统一的风险与确认策略。

use std::path::Path;

use serde_json::Value;
use tauri::{AppHandle, Manager};

use crate::app::capability::contribution::builtin_capability_execution_contributions;
use crate::domain::ai::sidecar_contract::{
    SidecarCapabilityCallRequest, SidecarCapabilityCallResult,
};
use crate::domain::capability::{
    build_builtin_capability_registry, evaluate_capability_access, CapabilityConsumer,
    CapabilityExecutionContext, CapabilityExecutionRequest,
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
    execute_with_contributions(&request, &context).unwrap_or_else(|| {
        Err(format!(
            "平台能力 {} 已注册，但当前执行器尚未实现",
            request.capability_id
        ))
    })
}

fn execute_with_contributions(
    request: &CapabilityExecutionRequest,
    context: &CapabilityExecutionContext<'_>,
) -> Option<Result<Value, String>> {
    builtin_capability_execution_contributions()
        .into_iter()
        .find_map(|(module_id, execute)| {
            let execution = execute(request, context);
            if execution.is_some() {
                log::debug!(
                    "[capability] execution routed: capability_id={} module={}",
                    request.capability_id,
                    module_id
                );
            }
            execution
        })
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
    fn execute_capability_in_root_should_allow_sidecar_semantic_search() {
        let root = create_test_root();

        let output = execute_capability_in_root(
            &root,
            CapabilityExecutionRequest {
                capability_id: "semantic.search_markdown_chunks".to_string(),
                consumer: CapabilityConsumer::Sidecar,
                input: json!({
                    "query": "ofive",
                    "limit": 4,
                }),
            },
        )
        .expect("sidecar semantic search capability should execute successfully");

        assert_eq!(output["status"], "disabled");
        assert_eq!(output["results"], json!([]));

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
