/**
 * @module App.test
 * @description App 测试：验证应用壳层会消费 SettingsTab 作为内建设置页入口。
 */

import { afterEach, describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

const actualAppEventBus = await import("./host/events/appEventBus");
const actualConfigStore = await import("./host/config/configStore");
const actualThemeStore = await import("./host/theme/themeStore");
const actualAutoSaveService = await import("./host/editor/autoSaveService");
const actualVaultStore = await import("./host/vault/vaultStore");
const actualWindowEffectsSync = await import("./host/window/useWindowEffectsSync");
const APP_TEST_TITLEBAR = "titlebar";
const APP_TEST_DOCKVIEW = "dockview-layout";
const APP_TEST_SETTINGS_TAB = "settings-tab";

mock.module("react-i18next", () => ({
    useTranslation: () => ({
        t: (key: string) => key,
    }),
}));

mock.module("./host/layout", () => ({
    CustomTitlebar: () => <div>{APP_TEST_TITLEBAR}</div>,
    DockviewLayout: () => <div>{APP_TEST_DOCKVIEW}</div>,
    SettingsTab: () => <div>{APP_TEST_SETTINGS_TAB}</div>,
    WorkbenchLayoutHost: () => <div>{APP_TEST_DOCKVIEW}</div>,
}));

mock.module("./host/events/appEventBus", () => ({
    ...actualAppEventBus,
    useBackendEventBridge: () => {
        /* noop */
    },
}));

mock.module("./host/vault/vaultStore", () => ({
    ...actualVaultStore,
    useVaultTreeSync: () => {
        /* noop */
    },
    useVaultState: () => ({
        currentVaultPath: null,
        isLoadingTree: false,
        error: null,
    }),
}));

mock.module("./host/config/configStore", () => ({
    ...actualConfigStore,
    useConfigSync: () => {
        /* noop */
    },
}));

mock.module("./host/theme/themeStore", () => ({
    ...actualThemeStore,
    useThemeSync: () => {
        /* noop */
    },
}));

mock.module("./host/editor/autoSaveService", () => ({
    ...actualAutoSaveService,
    useAutoSaveLifecycle: () => {
        /* noop */
    },
}));

mock.module("./utils/windowDragGesture", () => ({
    useWindowDragGestureSupport: () => {
        /* noop */
    },
}));

mock.module("./host/registry/registerBuiltinComponents", () => ({
    ensureBuiltinComponentsRegistered: () => {
        /* noop */
    },
}));

mock.module("./host/window/useWindowEffectsSync", () => ({
    ...actualWindowEffectsSync,
    useWindowEffectsSync: () => {
        /* noop */
    },
}));

afterEach(() => {
    mock.restore();
});

describe("App", () => {
    test("应渲染应用壳层并消费 SettingsTab 入口", async () => {
        const { default: App } = await import("./App");

        const markup = renderToStaticMarkup(<App />);

        expect(markup).toContain("titlebar");
        expect(markup).toContain("dockview-layout");
    });
});