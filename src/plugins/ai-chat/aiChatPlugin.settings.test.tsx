/**
 * @module plugins/ai-chat/aiChatPlugin.settings.test
 * @description AI chat plugin settings 测试：验证插件激活后会通过中心 settings registry 注册 AI 设置项。
 */

import { afterEach, describe, expect, test } from "bun:test";

import {
    __resetSettingsRegistryForTests,
    getSettingsSectionsSnapshot,
} from "../../host/settings/settingsRegistry";
import {
    __resetManagedStoreRegistryForTests,
    enableManagedStoreSettings,
} from "../../host/store/storeRegistry";
import { activatePlugin } from "./aiChatPlugin";

afterEach(() => {
    __resetSettingsRegistryForTests();
    __resetManagedStoreRegistryForTests();
});

describe("aiChatPlugin settings registration", () => {
    test("激活插件时应向中心 settings registry 注册 AI 设置 section 和 item", () => {
        enableManagedStoreSettings();

        const dispose = activatePlugin();
        const section = getSettingsSectionsSnapshot().find((item) => item.id === "ai-chat");

        expect(section).toBeDefined();
        expect(section?.items.map((item) => item.id)).toEqual(["ai-chat-settings-panel"]);

        dispose();
        expect(getSettingsSectionsSnapshot().find((item) => item.id === "ai-chat")).toBeUndefined();
    });
});
