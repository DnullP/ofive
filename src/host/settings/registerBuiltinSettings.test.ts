/**
 * @module host/settings/registerBuiltinSettings.test
 * @description 内建 settings 启动入口测试：验证 host 内建 section 与 managed store settings contribution 会统一接入 settings registry。
 */

import { afterEach, describe, expect, test } from "bun:test";

import { getSettingsSectionsSnapshot, __resetSettingsRegistryForTests } from "./settingsRegistry";
import {
    __resetBuiltinSettingsRegistrationForTests,
    ensureBuiltinSettingsRegistered,
} from "./registerBuiltinSettings";
import { __resetManagedStoreRegistryForTests } from "../store/storeRegistry";
import { __resetBuiltinManagedStoresRegistrationForTests } from "../store/registerBuiltinManagedStores";

afterEach(() => {
    __resetSettingsRegistryForTests();
    __resetManagedStoreRegistryForTests();
    __resetBuiltinSettingsRegistrationForTests();
    __resetBuiltinManagedStoresRegistrationForTests();
});

describe("ensureBuiltinSettingsRegistered", () => {
    test("应统一注册 host builtin sections 与 managed store 的 settings 贡献", () => {
        ensureBuiltinSettingsRegistered();

        const sectionIds = getSettingsSectionsSnapshot().map((section) => section.id);

        expect(sectionIds).toContain("general-global");
        expect(sectionIds).toContain("language-i18n");
        expect(sectionIds).toContain("editor-auto-save");
        expect(sectionIds).toContain("theme-style");
        expect(sectionIds).toContain("shortcut-system");
    });
});