/**
 * @module host/config/configStore.test
 * @description 配置 store 单元测试，覆盖空仓库回落默认配置与首次仓库配置归一化场景。
 * @dependencies
 *  - bun:test
 *  - ./configStore
 *
 * @example
 *   bun test src/host/config/configStore.test.ts
 */

import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

interface MockVaultConfig {
    schemaVersion: number;
    entries: Record<string, unknown>;
}

let currentVaultConfig: MockVaultConfig = {
    schemaVersion: 1,
    entries: {},
};

const savedVaultConfigs: MockVaultConfig[] = [];

mock.module("../../api/vaultApi", () => ({
    getCurrentVaultConfig: async () => structuredClone(currentVaultConfig),
    saveCurrentVaultConfig: async (nextConfig: MockVaultConfig) => {
        savedVaultConfigs.push(structuredClone(nextConfig));
        currentVaultConfig = structuredClone(nextConfig);
        return structuredClone(nextConfig);
    },
    subscribeVaultFsEvents: async () => {
        return () => {
            /* noop */
        };
    },
    subscribeVaultConfigEvents: async () => {
        return () => {
            /* noop */
        };
    },
    isSelfTriggeredVaultConfigEvent: () => false,
}));

const {
    getConfigSnapshot,
    syncConfigStateForVault,
    DEFAULT_FEATURE_SETTINGS,
} = await import("./configStore");

afterEach(async () => {
    await syncConfigStateForVault("", true);
    mock.restore();
});

describe("configStore defaults", () => {
    beforeEach(async () => {
        currentVaultConfig = {
            schemaVersion: 1,
            entries: {},
        };
        savedVaultConfigs.length = 0;
        await syncConfigStateForVault("", true);
    });

    it("应在首次加载缺省 features 的仓库时默认开启毛玻璃并写回配置", async () => {
        currentVaultConfig = {
            schemaVersion: 1,
            entries: {},
        };

        await syncConfigStateForVault("/tmp/first-vault", true);

        const snapshot = getConfigSnapshot();
        expect(snapshot.loadedVaultPath).toBe("/tmp/first-vault");
        expect(snapshot.featureSettings.glassEffectEnabled).toBe(true);
        expect(savedVaultConfigs).toHaveLength(1);
        expect(savedVaultConfigs[0]?.entries).toEqual({
            features: {
                searchEnabled: DEFAULT_FEATURE_SETTINGS.searchEnabled,
                knowledgeGraphEnabled: DEFAULT_FEATURE_SETTINGS.knowledgeGraphEnabled,
                glassEffectEnabled: true,
                glassTintOpacity: DEFAULT_FEATURE_SETTINGS.glassTintOpacity,
                glassSurfaceOpacity: DEFAULT_FEATURE_SETTINGS.glassSurfaceOpacity,
                glassInactiveSurfaceOpacity:
                    DEFAULT_FEATURE_SETTINGS.glassInactiveSurfaceOpacity,
                glassBlurRadius: DEFAULT_FEATURE_SETTINGS.glassBlurRadius,
                windowsAcrylicFocusedRed:
                    DEFAULT_FEATURE_SETTINGS.windowsAcrylicFocusedRed,
                windowsAcrylicFocusedGreen:
                    DEFAULT_FEATURE_SETTINGS.windowsAcrylicFocusedGreen,
                windowsAcrylicFocusedBlue:
                    DEFAULT_FEATURE_SETTINGS.windowsAcrylicFocusedBlue,
                windowsAcrylicFocusedAlpha:
                    DEFAULT_FEATURE_SETTINGS.windowsAcrylicFocusedAlpha,
                windowsAcrylicInactiveRed:
                    DEFAULT_FEATURE_SETTINGS.windowsAcrylicInactiveRed,
                windowsAcrylicInactiveGreen:
                    DEFAULT_FEATURE_SETTINGS.windowsAcrylicInactiveGreen,
                windowsAcrylicInactiveBlue:
                    DEFAULT_FEATURE_SETTINGS.windowsAcrylicInactiveBlue,
                windowsAcrylicInactiveAlpha:
                    DEFAULT_FEATURE_SETTINGS.windowsAcrylicInactiveAlpha,
                windowsAcrylicDisableSystemBackdrop:
                    DEFAULT_FEATURE_SETTINGS.windowsAcrylicDisableSystemBackdrop,
                windowsAcrylicFocusedAccentFlags:
                    DEFAULT_FEATURE_SETTINGS.windowsAcrylicFocusedAccentFlags,
                windowsAcrylicFocusedAnimationId:
                    DEFAULT_FEATURE_SETTINGS.windowsAcrylicFocusedAnimationId,
                windowsAcrylicInactiveAccentFlags:
                    DEFAULT_FEATURE_SETTINGS.windowsAcrylicInactiveAccentFlags,
                windowsAcrylicInactiveAnimationId:
                    DEFAULT_FEATURE_SETTINGS.windowsAcrylicInactiveAnimationId,
                vimModeEnabled: DEFAULT_FEATURE_SETTINGS.vimModeEnabled,
                editorFontSize: DEFAULT_FEATURE_SETTINGS.editorFontSize,
                editorTabSize: DEFAULT_FEATURE_SETTINGS.editorTabSize,
                editorLineWrapping: DEFAULT_FEATURE_SETTINGS.editorLineWrapping,
                editorLineNumbers: DEFAULT_FEATURE_SETTINGS.editorLineNumbers,
                autoSaveEnabled: DEFAULT_FEATURE_SETTINGS.autoSaveEnabled,
                autoSaveDelayMs: DEFAULT_FEATURE_SETTINGS.autoSaveDelayMs,
                editorFontFamily: DEFAULT_FEATURE_SETTINGS.editorFontFamily,
                notificationsEnabled: DEFAULT_FEATURE_SETTINGS.notificationsEnabled,
                notificationsMaxVisible: DEFAULT_FEATURE_SETTINGS.notificationsMaxVisible,
                frontmatterTemplate: DEFAULT_FEATURE_SETTINGS.frontmatterTemplate,
                restoreWorkspaceLayout: DEFAULT_FEATURE_SETTINGS.restoreWorkspaceLayout,
            },
        });
    });

    it("应在无仓库时回落到默认毛玻璃配置而不是沿用上一个仓库状态", async () => {
        currentVaultConfig = {
            schemaVersion: 1,
            entries: {
                features: {
                    glassEffectEnabled: false,
                },
            },
        };

        await syncConfigStateForVault("/tmp/glass-disabled-vault", true);
        expect(getConfigSnapshot().featureSettings.glassEffectEnabled).toBe(false);

        await syncConfigStateForVault("", true);

        const snapshot = getConfigSnapshot();
        expect(snapshot.loadedVaultPath).toBeNull();
        expect(snapshot.backendConfig).toBeNull();
        expect(snapshot.featureSettings.glassEffectEnabled).toBe(true);
        expect(savedVaultConfigs).toHaveLength(1);
    });
});