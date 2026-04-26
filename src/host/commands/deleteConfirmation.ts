/**
 * @module host/commands/deleteConfirmation
 * @description 删除确认适配器：命令系统删除入口在执行破坏性操作前统一请求确认。
 * @dependencies
 *  - ../../i18n
 *  - ./commandTypes
 *
 * @example
 *   const confirmed = await requestVaultDeleteConfirmation({ relativePath: "notes/demo.md", isDir: false });
 *
 * @exports
 *  - requestVaultDeleteConfirmation 请求删除确认
 */

import i18n from "../../i18n";
import type { DeleteConfirmationRequest } from "./commandTypes";

function isTauriRuntime(): boolean {
    if (typeof window === "undefined") {
        return false;
    }

    const runtimeWindow = window as Window & {
        __TAURI_INTERNALS__?: unknown;
        __TAURI__?: unknown;
    };
    return Boolean(runtimeWindow.__TAURI_INTERNALS__ || runtimeWindow.__TAURI__);
}

function buildDeleteConfirmationMessage(request: DeleteConfirmationRequest): string {
    if (request.isDir) {
        return i18n.t("vault.confirmDeleteDir", { name: request.relativePath });
    }

    return i18n.t("vault.confirmDeleteFile", { name: request.relativePath });
}

/**
 * @function requestVaultDeleteConfirmation
 * @description 根据运行时弹出删除确认；Tauri 使用原生确认框，web-mock 使用浏览器确认框。
 * @param request 删除目标信息。
 * @returns 用户确认时返回 true。
 */
export async function requestVaultDeleteConfirmation(
    request: DeleteConfirmationRequest,
): Promise<boolean> {
    const message = buildDeleteConfirmationMessage(request);

    if (!isTauriRuntime()) {
        if (typeof window === "undefined") {
            return false;
        }

        return window.confirm(message);
    }

    const { confirm } = await import("@tauri-apps/plugin-dialog");
    return confirm(message, {
        title: i18n.t("common.confirm"),
        kind: "warning",
    });
}
