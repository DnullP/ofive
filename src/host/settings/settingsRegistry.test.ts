/**
 * @module host/settings/settingsRegistry.test
 * @description settings registry 单元测试：验证分类和设置项的分组排序、覆盖更新与注销行为。
 */

import { afterEach, describe, expect, test } from "bun:test";

import {
    __resetSettingsRegistryForTests,
    getSettingsSectionsSnapshot,
    registerSettingsItem,
    registerSettingsItems,
    registerSettingsSection,
} from "./settingsRegistry";

afterEach(() => {
    __resetSettingsRegistryForTests();
});

describe("settingsRegistry", () => {
    test("应按 section 和 item 的 order 分组排序", () => {
        registerSettingsSection({
            id: "theme",
            title: "settings.themeSection",
            order: 20,
        });
        registerSettingsSection({
            id: "general",
            title: "settings.generalSection",
            order: 10,
        });

        registerSettingsItems([
            {
                id: "theme-mode",
                sectionId: "theme",
                order: 20,
                kind: "custom",
                title: "settings.themeTitle",
                render: () => null,
            },
            {
                id: "remember-last-vault",
                sectionId: "general",
                order: 20,
                kind: "custom",
                title: "settings.rememberLastVault",
                render: () => null,
            },
            {
                id: "search-enabled",
                sectionId: "general",
                order: 10,
                kind: "custom",
                title: "settings.enableSearch",
                render: () => null,
            },
        ]);

        const snapshot = getSettingsSectionsSnapshot();

        expect(snapshot.map((section) => section.id)).toEqual(["general", "theme"]);
        expect(snapshot[0]?.items.map((item) => item.id)).toEqual([
            "search-enabled",
            "remember-last-vault",
        ]);
        expect(snapshot[1]?.items.map((item) => item.id)).toEqual(["theme-mode"]);
    });

    test("注销设置项后应从对应分类中移除", () => {
        registerSettingsSection({
            id: "general",
            title: "settings.generalSection",
            order: 10,
        });

        const unregisterItem = registerSettingsItem({
            id: "search-enabled",
            sectionId: "general",
            order: 10,
            kind: "custom",
            title: "settings.enableSearch",
            render: () => null,
        });

        expect(getSettingsSectionsSnapshot()[0]?.items).toHaveLength(1);

        unregisterItem();

        expect(getSettingsSectionsSnapshot()[0]?.items).toHaveLength(0);
    });
});