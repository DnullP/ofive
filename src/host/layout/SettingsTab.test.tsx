/**
 * @module host/layout/SettingsTab.test
 * @description SettingsTab 测试：验证设置页会消费中心 registry 快照并渲染当前激活 section。
 */

import { afterEach, describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import {
    __resetSettingsRegistryForTests,
    registerSettingsItem,
    registerSettingsSection,
} from "../settings/settingsRegistry";

const SETTINGS_TAB_TEST_SEARCH_ICON = "search-icon";

mock.module("react-i18next", () => ({
    useTranslation: () => ({
        t: (key: string, values?: Record<string, unknown>) => {
            if (values?.visible !== undefined && values?.total !== undefined) {
                return `${key}:${String(values.visible)}/${String(values.total)}`;
            }
            return key;
        },
    }),
}));

mock.module("lucide-react", () => ({
    Search: () => <span>{SETTINGS_TAB_TEST_SEARCH_ICON}</span>,
    ArrowUp: () => null,
    Bot: () => null,
    Check: () => null,
    ChevronDown: () => null,
    Copy: () => null,
    Plus: () => null,
    Sparkles: () => null,
    Timer: () => null,
    X: () => null,
}));

mock.module("../settings/registerBuiltinSettings", () => ({
    ensureBuiltinSettingsRegistered: () => {
        /* noop */
    },
}));

afterEach(() => {
    __resetSettingsRegistryForTests();
    mock.restore();
});

describe("SettingsTab", () => {
    test("应渲染 settings registry 的 section 列表和当前内容", async () => {
        registerSettingsSection({
            id: "general-global",
            title: "settings.generalSection",
            description: "settings.generalSectionDesc",
            order: 10,
        });

        registerSettingsItem({
            id: "search-enabled",
            sectionId: "general-global",
            order: 10,
            kind: "toggle",
            title: "settings.enableSearch",
            description: "settings.enableSearchDesc",
            useValue: () => true,
            updateValue: () => undefined,
        });

        const { SettingsTab } = await import("./SettingsTab");

        const markup = renderToStaticMarkup(<SettingsTab />);

        expect(markup).toContain("settings.generalSection");
        expect(markup).toContain("settings.generalSectionDesc");
        expect(markup).toContain("settings.enableSearch");
        expect(markup).toContain("settings.enableSearchDesc");
        expect(markup).toContain("settings.searchResultsSummary:1/1");
    });
});
