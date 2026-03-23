/**
 * @module api/windowApi
 * @description 桌面窗口接口封装：负责把前端窗口材质配置下发到 Tauri 原生宿主。
 * @dependencies
 *  - @tauri-apps/api/core
 */

import { invoke } from "@tauri-apps/api/core";

export type WindowThemeMode = "dark" | "light" | "kraft";

/**
 * @interface WindowsAcrylicColorConfig
 * @description 单组 Windows Acrylic RGBA 参数。
 */
export interface WindowsAcrylicColorConfig {
    red: number;
    green: number;
    blue: number;
    alpha: number;
}

/**
 * @interface WindowsAcrylicEffectConfig
 * @description Windows Acrylic 原生效果参数快照。
 */
export interface WindowsAcrylicEffectConfig {
    enabled: boolean;
    appThemeMode: WindowThemeMode;
    disableSystemBackdrop: boolean;
    focusedColor: WindowsAcrylicColorConfig;
    focusedAccentFlags: number;
    focusedAnimationId: number;
    inactiveColor: WindowsAcrylicColorConfig;
    inactiveAccentFlags: number;
    inactiveAnimationId: number;
}

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

/**
 * @function updateMainWindowAcrylicEffect
 * @description 将当前窗口材质参数和应用主题模式下发给 Tauri 主窗口。
 * @param config 当前 Acrylic 参数快照。
 * @returns Promise<void>
 */
export async function updateMainWindowAcrylicEffect(
    config: WindowsAcrylicEffectConfig,
): Promise<void> {
    if (!isTauriRuntime()) {
        return;
    }

    await invoke("update_main_window_acrylic_effect", { config });
}