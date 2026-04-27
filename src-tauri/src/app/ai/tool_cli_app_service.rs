//! # AI 内置 CLI 工具运行时
//!
//! 负责从 Tauri 宿主中启动 `ofive-toolbox` sidecar，并用稳定 JSON 协议执行
//! 内置能力。这里是 AI 内置工具的主执行链路；MCP 仅保留给外部工具接入。

use std::io::Write;
use std::path::PathBuf;
use std::process::{Command as StdCommand, Stdio};

use tauri::AppHandle;
use tauri_plugin_shell::ShellExt;

use crate::domain::ai::sidecar_contract::{
    SidecarCapabilityCallRequest, SidecarCapabilityCallResult,
};

const OFIVE_TOOLBOX_SIDECAR: &str = "ofive-toolbox";
const CAPABILITY_CALL_COMMAND: &str = "capability-call";

/// 通过受控 CLI sidecar 执行一次内置 capability 调用。
pub(crate) async fn execute_sidecar_capability_call_via_cli(
    app_handle: &AppHandle,
    vault_root: PathBuf,
    request: SidecarCapabilityCallRequest,
) -> SidecarCapabilityCallResult {
    let capability_id = request.capability_id.clone();
    let payload = match serde_json::to_vec(&request) {
        Ok(payload) => payload,
        Err(error) => {
            return SidecarCapabilityCallResult::failure(
                capability_id,
                format!("序列化 CLI tool 请求失败: {error}"),
            );
        }
    };

    let mut command = match build_toolbox_command(app_handle, vault_root, &payload) {
        Ok(command) => command,
        Err(error) => return SidecarCapabilityCallResult::failure(capability_id, error),
    };

    match tauri::async_runtime::spawn_blocking(move || run_toolbox_command(&mut command, &payload))
        .await
    {
        Ok(Ok(result)) => result,
        Ok(Err(error)) => SidecarCapabilityCallResult::failure(capability_id, error),
        Err(error) => SidecarCapabilityCallResult::failure(
            capability_id,
            format!("等待 CLI tool 执行任务失败: {error}"),
        ),
    }
}

fn build_toolbox_command(
    app_handle: &AppHandle,
    vault_root: PathBuf,
    _payload: &[u8],
) -> Result<StdCommand, String> {
    let mut command: StdCommand = app_handle
        .shell()
        .sidecar(OFIVE_TOOLBOX_SIDECAR)
        .map_err(|error| format!("创建 ofive-toolbox sidecar 命令失败: {error}"))?
        .args([
            CAPABILITY_CALL_COMMAND,
            "--vault-root",
            vault_root
                .to_str()
                .ok_or_else(|| "当前仓库路径不是有效 UTF-8，无法传给 CLI tool".to_string())?,
        ])
        .current_dir(&vault_root)
        .into();

    command.stdin(Stdio::piped());
    command.stdout(Stdio::piped());
    command.stderr(Stdio::piped());
    Ok(command)
}

fn run_toolbox_command(
    command: &mut StdCommand,
    payload: &[u8],
) -> Result<SidecarCapabilityCallResult, String> {
    let mut child = command
        .spawn()
        .map_err(|error| format!("启动 ofive-toolbox 失败: {error}"))?;

    {
        let Some(mut stdin) = child.stdin.take() else {
            return Err("ofive-toolbox stdin 不可用".to_string());
        };
        stdin
            .write_all(payload)
            .map_err(|error| format!("写入 ofive-toolbox stdin 失败: {error}"))?;
    }

    let output = child
        .wait_with_output()
        .map_err(|error| format!("等待 ofive-toolbox 退出失败: {error}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();

    if !output.status.success() {
        let detail = if stderr.is_empty() { stdout } else { stderr };
        return Err(format!(
            "ofive-toolbox 执行失败: exit={:?} detail={detail}",
            output.status.code()
        ));
    }

    serde_json::from_str::<SidecarCapabilityCallResult>(&stdout)
        .map_err(|error| format!("解析 ofive-toolbox 输出失败: {error}; stdout={stdout}"))
}

#[cfg(test)]
mod tests {
    use std::process::{Command as StdCommand, Stdio};

    #[test]
    fn std_command_should_support_piped_stdio_for_toolbox_runtime() {
        let mut command = StdCommand::new("echo");
        command.stdin(Stdio::piped());
        command.stdout(Stdio::piped());
        command.stderr(Stdio::piped());

        let debug = format!("{command:?}");
        assert!(debug.contains("echo"));
    }
}
