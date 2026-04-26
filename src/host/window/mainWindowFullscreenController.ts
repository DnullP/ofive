/**
 * @module host/window/mainWindowFullscreenController
 * @description 主窗口全屏控制器：统一 Tauri 全屏切换与 macOS Escape 保护。
 * @dependencies
 *   - ./windowRuntimeInfo
 */

import {
    detectWindowRuntimeInfo,
    type WindowRuntimeInfo,
} from "./windowRuntimeInfo";

export const MACOS_ESCAPE_FULLSCREEN_GUARD_MS = 600;
const MACOS_ESCAPE_FULLSCREEN_RESTORE_DELAY_MS = 120;

export type MainWindowFullscreenIntent = "none" | "native" | "simple";

export interface MainWindowHandle {
    isFullscreen: () => Promise<boolean>;
    setFullscreen: (fullscreen: boolean) => Promise<void>;
    setSimpleFullscreen?: (fullscreen: boolean) => Promise<void>;
}

interface MainWindowFullscreenOptions {
    runtimeInfo?: WindowRuntimeInfo;
    getCurrentWindow?: () => MainWindowHandle;
}

interface FullscreenEscapeGuardOptions extends MainWindowFullscreenOptions {
    now?: () => number;
    setTimeout?: (callback: () => void, delayMs: number) => unknown;
    restoreDelayMs?: number;
}

type FullscreenEscapeKeyboardEvent = Pick<
    KeyboardEvent,
    "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey" | "repeat" | "preventDefault"
>;

let mainWindowFullscreenIntent: MainWindowFullscreenIntent = "none";
let lastProtectedEscapeAt = 0;

/**
 * @function getMainWindowFullscreenIntent
 * @description 获取当前由 ofive 主动维护的主窗口全屏意图。
 */
export function getMainWindowFullscreenIntent(): MainWindowFullscreenIntent {
    return mainWindowFullscreenIntent;
}

/**
 * @function resetMainWindowFullscreenControllerForTest
 * @description 重置模块级全屏意图与 ESC 时间窗口，仅供测试使用。
 */
export function resetMainWindowFullscreenControllerForTest(): void {
    mainWindowFullscreenIntent = "none";
    lastProtectedEscapeAt = 0;
}

/**
 * @function isPlainEscapeKey
 * @description 判断键盘事件是否为无修饰键 Escape。
 */
export function isPlainEscapeKey(event: FullscreenEscapeKeyboardEvent): boolean {
    return event.key === "Escape" &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.shiftKey &&
        !event.repeat;
}

function shouldUseSimpleFullscreen(
    runtimeInfo: WindowRuntimeInfo,
    windowHandle: MainWindowHandle,
): boolean {
    return runtimeInfo.isTauriRuntime &&
        runtimeInfo.isMacOS &&
        typeof windowHandle.setSimpleFullscreen === "function";
}

async function resolveMainWindowHandle(
    options?: MainWindowFullscreenOptions,
): Promise<MainWindowHandle | null> {
    const runtimeInfo = options?.runtimeInfo ?? detectWindowRuntimeInfo();
    if (!runtimeInfo.isTauriRuntime) {
        return null;
    }

    if (options?.getCurrentWindow) {
        return options.getCurrentWindow();
    }

    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    return getCurrentWindow();
}

async function applyFullscreenIntent(
    intent: Exclude<MainWindowFullscreenIntent, "none">,
    fullscreen: boolean,
    windowHandle: MainWindowHandle,
): Promise<void> {
    if (intent === "simple" && windowHandle.setSimpleFullscreen) {
        await windowHandle.setSimpleFullscreen(fullscreen);
        return;
    }

    await windowHandle.setFullscreen(fullscreen);
}

/**
 * @function setMainWindowFullscreen
 * @description 设置主窗口全屏状态；macOS 优先使用不切换 Space 的 simple fullscreen。
 */
export async function setMainWindowFullscreen(
    fullscreen: boolean,
    options?: MainWindowFullscreenOptions,
): Promise<MainWindowFullscreenIntent> {
    const runtimeInfo = options?.runtimeInfo ?? detectWindowRuntimeInfo();
    const windowHandle = await resolveMainWindowHandle({ ...options, runtimeInfo });
    if (!windowHandle) {
        mainWindowFullscreenIntent = "none";
        return mainWindowFullscreenIntent;
    }

    if (!fullscreen) {
        const intentToExit = mainWindowFullscreenIntent === "simple" ? "simple" : "native";
        await applyFullscreenIntent(intentToExit, false, windowHandle);
        mainWindowFullscreenIntent = "none";
        return mainWindowFullscreenIntent;
    }

    if (shouldUseSimpleFullscreen(runtimeInfo, windowHandle)) {
        try {
            await applyFullscreenIntent("simple", true, windowHandle);
            mainWindowFullscreenIntent = "simple";
            return mainWindowFullscreenIntent;
        } catch (error) {
            console.warn("[window-fullscreen] simple fullscreen failed, fallback to native fullscreen", {
                message: error instanceof Error ? error.message : String(error),
            });
        }
    }

    await applyFullscreenIntent("native", true, windowHandle);
    mainWindowFullscreenIntent = "native";
    return mainWindowFullscreenIntent;
}

/**
 * @function toggleMainWindowFullscreen
 * @description 切换主窗口全屏状态。
 */
export async function toggleMainWindowFullscreen(
    options?: MainWindowFullscreenOptions,
): Promise<MainWindowFullscreenIntent> {
    const windowHandle = await resolveMainWindowHandle(options);
    if (!windowHandle) {
        mainWindowFullscreenIntent = "none";
        return mainWindowFullscreenIntent;
    }

    const isNativeFullscreen = await windowHandle.isFullscreen();
    const shouldExitFullscreen =
        mainWindowFullscreenIntent === "simple" || isNativeFullscreen;

    return setMainWindowFullscreen(!shouldExitFullscreen, {
        ...options,
        getCurrentWindow: () => windowHandle,
    });
}

async function restoreFullscreenIntent(
    options?: MainWindowFullscreenOptions,
): Promise<void> {
    const intent = mainWindowFullscreenIntent;
    if (intent === "none") {
        return;
    }

    const windowHandle = await resolveMainWindowHandle(options);
    if (!windowHandle) {
        return;
    }

    if (intent === "native" && await windowHandle.isFullscreen()) {
        return;
    }

    await applyFullscreenIntent(intent, true, windowHandle);
}

/**
 * @function handleMacFullscreenEscapeKeydown
 * @description macOS 全屏时保护连续 Escape，避免第二次 Escape 触发系统退出全屏。
 *
 * 只调用 preventDefault，不 stopPropagation，保留应用内 overlay、编辑器和 Vim 对 Escape 的处理。
 */
export function handleMacFullscreenEscapeKeydown(
    event: FullscreenEscapeKeyboardEvent,
    options?: FullscreenEscapeGuardOptions,
): boolean {
    const runtimeInfo = options?.runtimeInfo ?? detectWindowRuntimeInfo();
    if (!runtimeInfo.isTauriRuntime || !runtimeInfo.isMacOS || !isPlainEscapeKey(event)) {
        return false;
    }

    if (mainWindowFullscreenIntent === "none") {
        return false;
    }

    const now = options?.now?.() ?? Date.now();
    const isRapidSecondEscape =
        lastProtectedEscapeAt > 0 &&
        now - lastProtectedEscapeAt <= MACOS_ESCAPE_FULLSCREEN_GUARD_MS;
    lastProtectedEscapeAt = now;
    if (!isRapidSecondEscape) {
        return false;
    }

    event.preventDefault();

    const schedule = options?.setTimeout ??
        ((callback: () => void, delayMs: number) => globalThis.setTimeout(callback, delayMs));
    const restoreDelayMs = options?.restoreDelayMs ?? MACOS_ESCAPE_FULLSCREEN_RESTORE_DELAY_MS;
    schedule(() => {
        void restoreFullscreenIntent(options).catch((error) => {
            console.warn("[window-fullscreen] failed to restore fullscreen after Escape guard", {
                message: error instanceof Error ? error.message : String(error),
            });
        });
    }, restoreDelayMs);

    return true;
}
