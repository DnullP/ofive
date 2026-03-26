/**
 * @module host/commands/systemShortcutSubsystem
 * @description 系统快捷键子系统：统一托管应用内“类系统”快捷键，并提供受控退出能力。
 * @dependencies
 *  - ./commandSystem
 *  - ../store/shortcutStore
 */

import { getCommandBindingPolicy, type CommandId } from "./commandSystem";
import { SYSTEM_RESERVED_BINDINGS, allowsSystemReservedBinding } from "./shortcutPolicies";
import { matchShortcut } from "../store/shortcutStore";

/**
 * @interface SystemShortcutPolicy
 * @description 单条系统快捷键策略。
 */
interface SystemShortcutPolicy {
    /** 系统层托管的物理按键。 */
    reservedBinding: string;
    /** 默认回退命令（未找到用户绑定时使用）。 */
    fallbackCommandId: CommandId;
}

/**
 * @interface SystemShortcutResolution
 * @description 系统快捷键解析结果。
 */
export interface SystemShortcutResolution {
    /** 匹配到的命令 id。 */
    commandId: CommandId;
    /** 命中来源。 */
    source: "binding" | "reserved";
}

const SYSTEM_SHORTCUT_POLICIES: SystemShortcutPolicy[] = [
    {
        reservedBinding: SYSTEM_RESERVED_BINDINGS[0],
        fallbackCommandId: "tab.closeFocused",
    },
    {
        reservedBinding: SYSTEM_RESERVED_BINDINGS[1],
        fallbackCommandId: "tab.closeFocused",
    },
    {
        reservedBinding: SYSTEM_RESERVED_BINDINGS[2],
        fallbackCommandId: "app.quit",
    },
    {
        reservedBinding: SYSTEM_RESERVED_BINDINGS[3],
        fallbackCommandId: "app.quit",
    },
];

/**
 * @function resolveSystemShortcutCommand
 * @description 根据按键事件解析系统快捷键命令，优先使用用户绑定，再回退保留映射。
 * @param event 键盘事件。
 * @param bindings 当前快捷键绑定。
 * @returns 命中结果；不命中返回 null。
 */
export function resolveSystemShortcutCommand(
    event: KeyboardEvent,
    bindings: Record<string, string>,
): SystemShortcutResolution | null {
    const matchedPolicy = SYSTEM_SHORTCUT_POLICIES.find((policy) =>
        matchShortcut(event, policy.reservedBinding),
    );
    if (!matchedPolicy) {
        return null;
    }

    const matchedCommandId = (Object.entries(bindings).find(([, shortcut]) => {
        const normalized = shortcut.trim();
        if (normalized.length === 0) {
            return false;
        }
        return matchShortcut(event, normalized);
    })?.[0] ?? null) as CommandId | null;

    if (matchedCommandId) {
        if (!allowsSystemReservedBinding(getCommandBindingPolicy(matchedCommandId))) {
            return {
                commandId: matchedPolicy.fallbackCommandId,
                source: "reserved",
            };
        }

        return {
            commandId: matchedCommandId,
            source: "binding",
        };
    }

    return {
        commandId: matchedPolicy.fallbackCommandId,
        source: "reserved",
    };
}

/**
 * @function requestApplicationQuit
 * @description 执行受控退出流程：Tauri 环境销毁当前窗口，Web 环境调用 window.close。
 */
export async function requestApplicationQuit(): Promise<void> {
    const runtimeWindow = window as Window & {
        __TAURI_INTERNALS__?: unknown;
        __TAURI__?: unknown;
    };
    const isTauriRuntime = Boolean(
        runtimeWindow.__TAURI_INTERNALS__ || runtimeWindow.__TAURI__,
    );

    if (!isTauriRuntime) {
        window.close();
        return;
    }

    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().destroy();
}
