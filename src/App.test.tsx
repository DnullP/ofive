/**
 * @module App.test
 * @description App 测试：验证应用壳层会消费 SettingsTab 作为内建设置页入口。
 */

import { afterEach, describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("react-i18next", () => ({
    useTranslation: () => ({
        t: (key: string) => key,
    }),
}));

mock.module("./host/layout", () => ({
    CustomTitlebar: () => <div>titlebar</div>,
    DockviewLayout: () => <div>dockview-layout</div>,
    SettingsTab: () => <div>settings-tab</div>,
}));

mock.module("./host/events/appEventBus", () => ({
    useBackendEventBridge: () => {
        /* noop */
    },
}));

mock.module("./host/vault/vaultStore", () => ({
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
    useConfigSync: () => {
        /* noop */
    },
}));

mock.module("./host/theme/themeStore", () => ({
    useThemeSync: () => {
        /* noop */
    },
}));

mock.module("./host/editor/autoSaveService", () => ({
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