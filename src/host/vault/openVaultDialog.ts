/**
 * @module host/vault/openVaultDialog
 * @description 共享的系统目录选择入口，用于从不同 UI 表面打开 vault。
 */

import { open } from "@tauri-apps/plugin-dialog";
import i18n from "../../i18n";
import { setCurrentVaultPath } from "./vaultStore";

/**
 * @function normalizeSelectedVaultPath
 * @description 规范化系统目录选择结果，兼容 string / string[] / 对象结构。
 * @param selected 系统对话框返回值。
 * @returns 规范化路径，无法识别返回 null。
 */
export function normalizeSelectedVaultPath(selected: unknown): string | null {
    if (typeof selected === "string") {
        return selected;
    }

    if (Array.isArray(selected)) {
        const first = selected[0];
        return typeof first === "string" ? first : null;
    }

    if (selected && typeof selected === "object") {
        const selectedObject = selected as { path?: unknown };
        if (typeof selectedObject.path === "string") {
            return selectedObject.path;
        }
    }

    return null;
}

/**
 * @function openVaultWithSystemPicker
 * @description 通过系统目录选择器打开 vault，并同步到全局 vault store。
 * @returns 被选中的 vault 路径；取消或失败时返回 null。
 */
export async function openVaultWithSystemPicker(): Promise<string | null> {
    try {
        console.info("[vault-ui] openVault:dialog:open");
        const selected = await open({
            directory: true,
            multiple: false,
            title: i18n.t("vault.selectDirectory"),
        });
        const selectedPath = normalizeSelectedVaultPath(selected);

        if (!selectedPath) {
            console.warn("[vault-ui] openVault:dialog:cancelled-or-invalid", { selected });
            return null;
        }

        console.info("[vault-ui] openVault:dialog:selected", { selectedPath });
        await setCurrentVaultPath(selectedPath);
        return selectedPath;
    } catch (openError) {
        const message = openError instanceof Error ? openError.message : i18n.t("vault.openDirectoryFailed");
        console.error("[vault-ui] openVault:dialog:failed", { message });
        return null;
    }
}
