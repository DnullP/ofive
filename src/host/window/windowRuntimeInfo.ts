/**
 * @module host/window/windowRuntimeInfo
 * @description 窗口运行时平台探测：集中识别 Tauri、Windows 与 macOS 宿主环境。
 */

/**
 * @interface WindowRuntimeInfo
 * @description 当前前端运行时的窗口平台信息。
 * @field isTauriRuntime 是否运行在 Tauri 宿主中。
 * @field isWindows 是否为 Windows 平台。
 * @field isMacOS 是否为 macOS 平台。
 */
export interface WindowRuntimeInfo {
    isTauriRuntime: boolean;
    isWindows: boolean;
    isMacOS: boolean;
}

export interface DetectWindowRuntimeOptions {
    runtimeWindow?: {
        __TAURI_INTERNALS__?: unknown;
        __TAURI__?: unknown;
    } | null;
    userAgent?: string;
    platform?: string;
}

interface WindowRuntimeInfoWindow {
    __TAURI_INTERNALS__?: unknown;
    __TAURI__?: unknown;
}

/**
 * @function detectWindowRuntimeInfo
 * @description 探测当前窗口运行时平台信息。
 * @param options 可选探测输入，测试时可注入伪造 runtime。
 * @returns 平台探测结果。
 */
export function detectWindowRuntimeInfo(
    options?: DetectWindowRuntimeOptions,
): WindowRuntimeInfo {
    const runtimeWindow = options?.runtimeWindow ??
        (typeof window === "undefined" ? null : (window as WindowRuntimeInfoWindow));
    const userAgent = options?.userAgent ??
        (typeof navigator === "undefined" ? "" : navigator.userAgent);
    const platform = options?.platform ??
        (typeof navigator === "undefined" ? "" : navigator.platform);
    const platformFingerprint = `${userAgent} ${platform}`.toLowerCase();

    return {
        isTauriRuntime: Boolean(
            runtimeWindow?.__TAURI_INTERNALS__ || runtimeWindow?.__TAURI__,
        ),
        isWindows: platformFingerprint.includes("win"),
        isMacOS: platformFingerprint.includes("mac"),
    };
}
