/**
 * @module host/settings/registrars/builtinSettingsRegistrars.test
 * @description 内建 settings registrar 测试：验证 host 内建分类与设置项已注册到中心 registry。
 */

import { afterEach, describe, expect, test } from "bun:test";

import {
    __resetSettingsRegistryForTests,
    getSettingsSectionsSnapshot,
} from "../settingsRegistry";
import { registerAutoSaveSettingsSection } from "./autoSaveSettingsRegistrar";
import { registerFrontmatterSettingsSection } from "./frontmatterSettingsRegistrar";
import { registerGeneralSettingsSection } from "./generalSettingsRegistrar";
import { registerLanguageSettingsSection } from "./languageSettingsRegistrar";
import { registerShortcutSettingsSection } from "./shortcutSettingsRegistrar";
import { registerThemeSettingsSection } from "./themeSettingsRegistrar";

afterEach(() => {
    __resetSettingsRegistryForTests();
});

describe("builtin settings registrars", () => {
    test("应把内建 host settings 注册为 section + item 结构", () => {
        const unregisters = [
            registerGeneralSettingsSection(),
            registerFrontmatterSettingsSection(),
            registerLanguageSettingsSection(),
            registerThemeSettingsSection(),
            registerAutoSaveSettingsSection(),
            registerShortcutSettingsSection(),
        ];

        const snapshot = getSettingsSectionsSnapshot();

        expect(snapshot.map((section) => section.id)).toEqual([
            "general-global",
            "language-i18n",
            "theme-style",
            "editor-auto-save",
            "frontmatter-template",
            "shortcut-system",
        ]);
        expect(snapshot.find((section) => section.id === "general-global")?.items.map((item) => item.id)).toEqual([
            "remember-last-vault",
            "search-enabled",
            "knowledge-graph-enabled",
            "notifications-enabled",
            "notifications-max-visible",
            "restore-workspace-layout",
            "config-error",
        ]);
        expect(snapshot.find((section) => section.id === "shortcut-system")?.items.map((item) => item.id)).toEqual([
            "shortcut-table",
        ]);

        unregisters.forEach((unregister) => unregister());
    });
});