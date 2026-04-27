//! # ofive AI 工具箱 CLI
//!
//! 提供内置 AI 工具的进程边界。当前第一版把平台注册能力暴露为
//! `capability-call` 子命令，后续可在同一二进制里增加受控终端和外部 CLI 适配。

use std::ffi::OsString;
use std::io::{self, Read, Write};
use std::path::PathBuf;

use crate::app::capability::execution_app_service;
use crate::domain::ai::sidecar_contract::{
    SidecarCapabilityCallRequest, SidecarCapabilityCallResult,
};
use crate::domain::capability::{CapabilityConsumer, CapabilityExecutionRequest};

const CAPABILITY_CALL_COMMAND: &str = "capability-call";
const VAULT_ROOT_ARG: &str = "--vault-root";

/// 从真实进程环境运行工具箱 CLI。
pub(crate) fn run_from_env() -> Result<(), String> {
    let mut stdin = io::stdin();
    let mut stdout = io::stdout();
    run(
        std::env::args_os().skip(1).collect(),
        &mut stdin,
        &mut stdout,
    )
}

fn run(args: Vec<OsString>, stdin: &mut dyn Read, stdout: &mut dyn Write) -> Result<(), String> {
    let invocation = parse_invocation(args)?;
    match invocation.command.as_str() {
        CAPABILITY_CALL_COMMAND => run_capability_call(invocation.vault_root, stdin, stdout),
        unknown => Err(format!("未知 ofive-toolbox 子命令: {unknown}")),
    }
}

fn run_capability_call(
    vault_root: PathBuf,
    stdin: &mut dyn Read,
    stdout: &mut dyn Write,
) -> Result<(), String> {
    let mut input = String::new();
    stdin
        .read_to_string(&mut input)
        .map_err(|error| format!("读取 capability-call 输入失败: {error}"))?;

    let request = serde_json::from_str::<SidecarCapabilityCallRequest>(&input)
        .map_err(|error| format!("解析 capability-call 输入 JSON 失败: {error}"))?;
    let capability_id = request.capability_id.clone();

    let result = execution_app_service::execute_capability_in_root(
        &vault_root,
        CapabilityExecutionRequest {
            capability_id: request.capability_id,
            consumer: CapabilityConsumer::Sidecar,
            input: request.input,
        },
    )
    .map(|output| SidecarCapabilityCallResult::success(capability_id.clone(), output))
    .unwrap_or_else(|error| SidecarCapabilityCallResult::failure(capability_id, error));

    serde_json::to_writer(&mut *stdout, &result)
        .map_err(|error| format!("写入 capability-call 输出 JSON 失败: {error}"))?;
    stdout
        .write_all(b"\n")
        .map_err(|error| format!("写入 capability-call 输出换行失败: {error}"))?;
    Ok(())
}

#[derive(Debug, PartialEq)]
struct ToolboxInvocation {
    command: String,
    vault_root: PathBuf,
}

fn parse_invocation(args: Vec<OsString>) -> Result<ToolboxInvocation, String> {
    let mut iter = args.into_iter();
    let command = iter
        .next()
        .and_then(|value| value.into_string().ok())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "ofive-toolbox 缺少子命令".to_string())?;

    let mut vault_root: Option<PathBuf> = None;
    while let Some(raw_arg) = iter.next() {
        let arg = raw_arg
            .into_string()
            .map_err(|_| "ofive-toolbox 参数必须是有效 UTF-8".to_string())?;
        match arg.as_str() {
            VAULT_ROOT_ARG => {
                let value = iter
                    .next()
                    .ok_or_else(|| "--vault-root 缺少参数值".to_string())?;
                vault_root = Some(PathBuf::from(value));
            }
            unknown => {
                return Err(format!("未知 ofive-toolbox 参数: {unknown}"));
            }
        }
    }

    let vault_root = vault_root.ok_or_else(|| "ofive-toolbox 缺少 --vault-root".to_string())?;
    Ok(ToolboxInvocation {
        command,
        vault_root,
    })
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::io::Cursor;
    use std::path::{Path, PathBuf};
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};

    use serde_json::json;

    use super::{parse_invocation, run, CAPABILITY_CALL_COMMAND, VAULT_ROOT_ARG};

    static TEST_ROOT_SEQUENCE: AtomicU64 = AtomicU64::new(1);

    fn create_test_root() -> PathBuf {
        let sequence = TEST_ROOT_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0);
        let root = std::env::temp_dir().join(format!("ofive-toolbox-cli-test-{unique}-{sequence}"));
        fs::create_dir_all(root.join(".ofive")).expect("应成功创建测试仓库目录");
        root
    }

    fn write_markdown_file(root: &Path, relative_path: &str, content: &str) {
        let target = root.join(relative_path);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).expect("应成功创建父目录");
        }
        fs::write(target, content).expect("应成功写入测试 Markdown 文件");
    }

    #[test]
    fn parse_invocation_should_require_vault_root() {
        let invocation = parse_invocation(vec![
            CAPABILITY_CALL_COMMAND.into(),
            VAULT_ROOT_ARG.into(),
            "/tmp/ofive".into(),
        ])
        .expect("应成功解析工具箱参数");

        assert_eq!(invocation.command, CAPABILITY_CALL_COMMAND);
        assert_eq!(invocation.vault_root, PathBuf::from("/tmp/ofive"));
    }

    #[test]
    fn run_capability_call_should_read_markdown_file() {
        let root = create_test_root();
        write_markdown_file(&root, "Notes/A.md", "# A\n\nhello");

        let request = json!({
            "schemaVersion": "2026-03-17",
            "capabilityId": "vault.read_markdown_file",
            "input": {"relativePath": "Notes/A.md"},
            "traceId": null,
            "sessionId": null,
        })
        .to_string();
        let mut stdin = Cursor::new(request.into_bytes());
        let mut stdout = Vec::new();

        run(
            vec![
                CAPABILITY_CALL_COMMAND.into(),
                VAULT_ROOT_ARG.into(),
                root.as_os_str().to_owned(),
            ],
            &mut stdin,
            &mut stdout,
        )
        .expect("capability-call 应执行成功");

        let output = String::from_utf8(stdout).expect("输出应是有效 UTF-8");
        let payload: serde_json::Value = serde_json::from_str(&output).expect("输出应是有效 JSON");
        assert_eq!(payload["success"], true);
        assert_eq!(payload["capabilityId"], "vault.read_markdown_file");
        assert_eq!(payload["output"]["relativePath"], "Notes/A.md");
        assert_eq!(payload["output"]["content"], "# A\n\nhello");

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn run_capability_call_should_suggest_wikilink_targets_without_query() {
        let root = create_test_root();
        write_markdown_file(&root, "Notes/Topic.md", "# Topic\n");
        write_markdown_file(&root, "Notes/Guide.md", "# Guide\n\n[[Topic]]\n");

        let request = json!({
            "schemaVersion": "2026-03-17",
            "capabilityId": "vault.suggest_wikilink_targets",
            "input": {"limit": 5},
            "traceId": null,
            "sessionId": null,
        })
        .to_string();
        let mut stdin = Cursor::new(request.into_bytes());
        let mut stdout = Vec::new();

        run(
            vec![
                CAPABILITY_CALL_COMMAND.into(),
                VAULT_ROOT_ARG.into(),
                root.as_os_str().to_owned(),
            ],
            &mut stdin,
            &mut stdout,
        )
        .expect("capability-call 应执行成功");

        let output = String::from_utf8(stdout).expect("输出应是有效 UTF-8");
        let payload: serde_json::Value = serde_json::from_str(&output).expect("输出应是有效 JSON");
        assert_eq!(payload["success"], true);
        assert_eq!(payload["capabilityId"], "vault.suggest_wikilink_targets");
        assert_eq!(payload["output"][0]["relativePath"], "Notes/Topic.md");

        let _ = fs::remove_dir_all(root);
    }
}
