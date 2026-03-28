/**
 * @module host/window/useWindowEffectsSync.test
 * @description 窗口效果同步宿主服务测试：覆盖平台探测、原生下发条件与配置映射。
 * @dependencies
 *   - bun:test
 *   - ./useWindowEffectsSync
 *
 * @example
 *   bun test src/host/window/useWindowEffectsSync.test.ts
 */

import { describe, expect, it, mock } from "bun:test";
import type { FeatureSettings } from "../store/configStore";

const actualConfigStore = await import("../store/configStore");

mock.module("../../api/windowApi", () => ({
    updateMainWindowAcrylicEffect: async () => undefined,
}));

mock.module("../store/configStore", () => ({
    ...actualConfigStore,
    getConfigSnapshot: () => ({
        featureSettings: {
            searchEnabled: true,
            knowledgeGraphEnabled: true,
            glassEffectEnabled: true,
            glassTintOpacity: 0.05,
            glassSurfaceOpacity: 0.12,
            glassInactiveSurfaceOpacity: 0.09,
            glassBlurRadius: 8,
            windowsAcrylicFocusedRed: 56,
            windowsAcrylicFocusedGreen: 64,
            windowsAcrylicFocusedBlue: 76,
            windowsAcrylicFocusedAlpha: 72,
            windowsAcrylicInactiveRed: 64,
            windowsAcrylicInactiveGreen: 72,
            windowsAcrylicInactiveBlue: 84,
            windowsAcrylicInactiveAlpha: 56,
            windowsAcrylicDisableSystemBackdrop: true,
            windowsAcrylicFocusedAccentFlags: 9,
            windowsAcrylicFocusedAnimationId: 7,
            windowsAcrylicInactiveAccentFlags: 5,
            windowsAcrylicInactiveAnimationId: 3,
            vimModeEnabled: false,
            editorFontSize: 16,
            editorTabSize: 4,
            editorLineWrapping: true,
            editorLineNumbers: "absolute",
            autoSaveEnabled: true,
            autoSaveDelayMs: 1500,
            editorFontFamily:
                '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
        },
    }),
    subscribeConfigChanges: () => {
        return () => {
            /* noop */
        };
    },
    useConfigState: () => ({
        featureSettings: {
            searchEnabled: true,
            knowledgeGraphEnabled: true,
            glassEffectEnabled: true,
            glassTintOpacity: 0.05,
            glassSurfaceOpacity: 0.12,
            glassInactiveSurfaceOpacity: 0.09,
            glassBlurRadius: 8,
            windowsAcrylicFocusedRed: 56,
            windowsAcrylicFocusedGreen: 64,
            windowsAcrylicFocusedBlue: 76,
            windowsAcrylicFocusedAlpha: 72,
            windowsAcrylicInactiveRed: 64,
            windowsAcrylicInactiveGreen: 72,
            windowsAcrylicInactiveBlue: 84,
            windowsAcrylicInactiveAlpha: 56,
            windowsAcrylicDisableSystemBackdrop: true,
            windowsAcrylicFocusedAccentFlags: 9,
            windowsAcrylicFocusedAnimationId: 7,
            windowsAcrylicInactiveAccentFlags: 5,
            windowsAcrylicInactiveAnimationId: 3,
            vimModeEnabled: false,
            editorFontSize: 16,
            editorTabSize: 4,
            editorLineWrapping: true,
            editorLineNumbers: "absolute",
            autoSaveEnabled: true,
            autoSaveDelayMs: 1500,
            editorFontFamily:
                '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
        },
    }),
}));

mock.module("../store/themeStore", () => ({
    useThemeState: () => ({
        themeMode: "kraft",
    }),
}));

const {
    buildWindowEffectConfig,
    detectWindowRuntimeInfo,
    shouldSyncNativeWindowEffects,
} = await import("./useWindowEffectsSync");

/**
 * @function createFeatureSettings
 * @description 构造窗口效果测试所需的最小功能配置。
 * @returns 完整 feature settings。
 */
function createFeatureSettings(): FeatureSettings {
    return {
        searchEnabled: true,
        knowledgeGraphEnabled: true,
        glassEffectEnabled: true,
        glassTintOpacity: 0.05,
        glassSurfaceOpacity: 0.12,
        glassInactiveSurfaceOpacity: 0.09,
        glassBlurRadius: 8,
        windowsAcrylicFocusedRed: 56,
        windowsAcrylicFocusedGreen: 64,
        windowsAcrylicFocusedBlue: 76,
        windowsAcrylicFocusedAlpha: 72,
        windowsAcrylicInactiveRed: 64,
        windowsAcrylicInactiveGreen: 72,
        windowsAcrylicInactiveBlue: 84,
        windowsAcrylicInactiveAlpha: 56,
        windowsAcrylicDisableSystemBackdrop: true,
        windowsAcrylicFocusedAccentFlags: 9,
        windowsAcrylicFocusedAnimationId: 7,
        windowsAcrylicInactiveAccentFlags: 5,
        windowsAcrylicInactiveAnimationId: 3,
        vimModeEnabled: false,
        editorFontSize: 16,
        editorTabSize: 4,
        editorLineWrapping: true,
        editorLineNumbers: "absolute",
        autoSaveEnabled: true,
        autoSaveDelayMs: 1500,
        editorFontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    };
}

describe("useWindowEffectsSync helpers", () => {
    it("应正确识别 tauri windows 运行时", () => {
        const runtimeInfo = detectWindowRuntimeInfo({
            runtimeWindow: { __TAURI__: {} },
            userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
            platform: "Win32",
        });

        expect(runtimeInfo).toEqual({
            isTauriRuntime: true,
            isWindows: true,
            isMacOS: false,
        });
    });

    it("应正确识别非 tauri web 运行时", () => {
        const runtimeInfo = detectWindowRuntimeInfo({
            runtimeWindow: {},
            userAgent: "Mozilla/5.0 (X11; Linux x86_64)",
            platform: "Linux x86_64",
        });

        expect(runtimeInfo).toEqual({
            isTauriRuntime: false,
            isWindows: false,
            isMacOS: false,
        });
    });

    it("仅 tauri windows 或 macos 需要同步原生窗口效果", () => {
        expect(
            shouldSyncNativeWindowEffects({
                isTauriRuntime: true,
                isWindows: true,
                isMacOS: false,
            }),
        ).toBe(true);
        expect(
            shouldSyncNativeWindowEffects({
                isTauriRuntime: true,
                isWindows: false,
                isMacOS: true,
            }),
        ).toBe(true);
        expect(
            shouldSyncNativeWindowEffects({
                isTauriRuntime: false,
                isWindows: true,
                isMacOS: false,
            }),
        ).toBe(false);
    });

    it("应将 feature settings 映射为原生窗口效果配置", () => {
        const config = buildWindowEffectConfig(createFeatureSettings(), "kraft", true);

        expect(config).toEqual({
            enabled: true,
            appThemeMode: "kraft",
            disableSystemBackdrop: true,
            focusedColor: {
                red: 56,
                green: 64,
                blue: 76,
                alpha: 72,
            },
            focusedAccentFlags: 9,
            focusedAnimationId: 7,
            inactiveColor: {
                red: 64,
                green: 72,
                blue: 84,
                alpha: 56,
            },
            inactiveAccentFlags: 5,
            inactiveAnimationId: 3,
        });
    });
});