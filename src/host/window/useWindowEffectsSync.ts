/**
 * @module host/window/useWindowEffectsSync
 * @description 窗口效果同步宿主服务：集中负责运行时平台探测、窗口焦点监听、
 *   document 根节点视觉状态同步，以及原生窗口效果参数下发。
 *
 *   设计目标：
 *   - 将窗口层副作用从 App 壳层中移出，避免顶层组件继续累积宿主细节
 *   - 将平台探测与原生下发收敛为独立边界，便于后续单独演进和测试
 *   - 保留 React Hook 入口，使宿主装配仍然显式且可读
 *
 * @dependencies
 *   - react
 *   - ../../api/windowApi
 *   - ../layout/glassRuntimeStyle
 *   - ../store/configStore
 *   - ../store/themeStore
 *
 * @example
 *   useWindowEffectsSync();
 *
 * @exports
 *   - WindowRuntimeInfo
 *   - detectWindowRuntimeInfo
 *   - shouldSyncNativeWindowEffects
 *   - buildWindowEffectConfig
 *   - useWindowEffectsSync
 */

import { useEffect, useMemo, useState } from "react";
import {
    updateMainWindowAcrylicEffect,
    type WindowsAcrylicEffectConfig,
} from "../../api/windowApi";
import { buildGlassRuntimeStyle } from "../layout/glassRuntimeStyle";
import {
    useConfigState,
    type FeatureSettings,
} from "../store/configStore";
import {
    useThemeState,
    type ThemeMode,
} from "../store/themeStore";

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

interface DetectWindowRuntimeOptions {
    runtimeWindow?: {
        __TAURI_INTERNALS__?: unknown;
        __TAURI__?: unknown;
    } | null;
    userAgent?: string;
    platform?: string;
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

interface WindowRuntimeInfoWindow {
    __TAURI_INTERNALS__?: unknown;
    __TAURI__?: unknown;
}

/**
 * @function shouldSyncNativeWindowEffects
 * @description 判断当前运行时是否需要下发原生窗口效果。
 * @param runtimeInfo 当前运行时信息。
 * @returns 仅 Tauri 的 Windows/macOS 宿主返回 true。
 */
export function shouldSyncNativeWindowEffects(
    runtimeInfo: WindowRuntimeInfo,
): boolean {
    return runtimeInfo.isTauriRuntime && (runtimeInfo.isWindows || runtimeInfo.isMacOS);
}

/**
 * @function buildWindowEffectConfig
 * @description 基于前端配置与主题构造原生窗口效果参数。
 * @param featureSettings 当前功能配置。
 * @param themeMode 当前主题模式。
 * @param enabled 当前是否启用玻璃效果。
 * @returns 原生窗口效果参数对象。
 */
export function buildWindowEffectConfig(
    featureSettings: FeatureSettings,
    themeMode: ThemeMode,
    enabled: boolean,
): WindowsAcrylicEffectConfig {
    return {
        enabled,
        appThemeMode: themeMode,
        disableSystemBackdrop: featureSettings.windowsAcrylicDisableSystemBackdrop,
        focusedColor: {
            red: featureSettings.windowsAcrylicFocusedRed,
            green: featureSettings.windowsAcrylicFocusedGreen,
            blue: featureSettings.windowsAcrylicFocusedBlue,
            alpha: featureSettings.windowsAcrylicFocusedAlpha,
        },
        focusedAccentFlags: featureSettings.windowsAcrylicFocusedAccentFlags,
        focusedAnimationId: featureSettings.windowsAcrylicFocusedAnimationId,
        inactiveColor: {
            red: featureSettings.windowsAcrylicInactiveRed,
            green: featureSettings.windowsAcrylicInactiveGreen,
            blue: featureSettings.windowsAcrylicInactiveBlue,
            alpha: featureSettings.windowsAcrylicInactiveAlpha,
        },
        inactiveAccentFlags: featureSettings.windowsAcrylicInactiveAccentFlags,
        inactiveAnimationId: featureSettings.windowsAcrylicInactiveAnimationId,
    };
}

/**
 * @function useWindowEffectsSync
 * @description 宿主窗口效果同步 Hook。
 *
 * @sideEffects
 *   - 监听浏览器 focus/blur，维护窗口焦点状态
 *   - 更新 document 根节点 class 与 CSS 变量
 *   - 在原生宿主环境中向后端下发窗口效果配置
 */
export function useWindowEffectsSync(): void {
    const configState = useConfigState();
    const themeState = useThemeState();
    const runtimeInfo = useMemo(() => detectWindowRuntimeInfo(), []);
    const isGlassEffectEnabled =
        runtimeInfo.isTauriRuntime && configState.featureSettings.glassEffectEnabled;
    const [isWindowFocused, setIsWindowFocused] = useState<boolean>(() => {
        if (typeof document === "undefined") {
            return true;
        }

        return document.hasFocus();
    });

    useEffect(() => {
        const handleFocus = (): void => {
            setIsWindowFocused(true);
        };

        const handleBlur = (): void => {
            setIsWindowFocused(false);
        };

        window.addEventListener("focus", handleFocus);
        window.addEventListener("blur", handleBlur);

        return () => {
            window.removeEventListener("focus", handleFocus);
            window.removeEventListener("blur", handleBlur);
        };
    }, []);

    useEffect(() => {
        const runtimeGlassStyle = buildGlassRuntimeStyle({
            glassTintOpacity: configState.featureSettings.glassTintOpacity,
            glassSurfaceOpacity: configState.featureSettings.glassSurfaceOpacity,
            glassInactiveSurfaceOpacity:
                configState.featureSettings.glassInactiveSurfaceOpacity,
            glassBlurRadius: configState.featureSettings.glassBlurRadius,
        });

        document.documentElement.classList.toggle(
            "app-runtime--tauri",
            runtimeInfo.isTauriRuntime,
        );
        document.documentElement.classList.toggle(
            "app-platform--windows",
            runtimeInfo.isWindows,
        );
        document.documentElement.classList.toggle(
            "app-platform--macos",
            runtimeInfo.isMacOS,
        );
        document.documentElement.classList.toggle(
            "app-effect--glass",
            isGlassEffectEnabled,
        );
        document.documentElement.classList.toggle(
            "app-window--inactive",
            !isWindowFocused,
        );

        Object.entries(runtimeGlassStyle.cssVariables).forEach(([name, value]) => {
            document.documentElement.style.setProperty(name, value);
        });

        console.info("[window-effects] runtime effect classes updated", {
            ...runtimeInfo,
            glassEffectEnabled: isGlassEffectEnabled,
            isWindowFocused,
            glassTintOpacity: configState.featureSettings.glassTintOpacity,
            glassSurfaceOpacity: configState.featureSettings.glassSurfaceOpacity,
            glassInactiveSurfaceOpacity:
                configState.featureSettings.glassInactiveSurfaceOpacity,
            effectiveInactiveSurfaceOpacity:
                runtimeGlassStyle.effectiveInactiveSurfaceOpacity,
            glassBlurRadius: configState.featureSettings.glassBlurRadius,
        });

        return () => {
            document.documentElement.classList.remove("app-runtime--tauri");
            document.documentElement.classList.remove("app-platform--windows");
            document.documentElement.classList.remove("app-platform--macos");
            document.documentElement.classList.remove("app-effect--glass");
            document.documentElement.classList.remove("app-window--inactive");
        };
    }, [
        configState.featureSettings.glassBlurRadius,
        configState.featureSettings.glassInactiveSurfaceOpacity,
        configState.featureSettings.glassSurfaceOpacity,
        configState.featureSettings.glassTintOpacity,
        isGlassEffectEnabled,
        isWindowFocused,
        runtimeInfo,
    ]);

    useEffect(() => {
        if (!shouldSyncNativeWindowEffects(runtimeInfo)) {
            return;
        }

        const nextConfig = buildWindowEffectConfig(
            configState.featureSettings,
            themeState.themeMode,
            isGlassEffectEnabled,
        );

        void updateMainWindowAcrylicEffect(nextConfig)
            .then(() => {
                console.info("[window-effects] native window effect applied", nextConfig);
            })
            .catch((error) => {
                console.warn("[window-effects] failed to apply native window effect", {
                    message: error instanceof Error ? error.message : String(error),
                });
            });
    }, [
        configState.featureSettings,
        isGlassEffectEnabled,
        runtimeInfo,
        themeState.themeMode,
    ]);
}