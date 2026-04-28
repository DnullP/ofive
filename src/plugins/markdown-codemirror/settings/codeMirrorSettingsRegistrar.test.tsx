/**
 * @module plugins/markdown-codemirror/settings/codeMirrorSettingsRegistrar.test
 * @description CodeMirror settings registrar 测试：验证编辑器设置通过中心 registry 注册。
 */

import { afterEach, describe, expect, test } from "bun:test";

import {
    __resetSettingsRegistryForTests,
    getSettingsSectionsSnapshot,
} from "../../../host/settings/settingsRegistry";
import { registerCodeMirrorSettingsSection } from "./codeMirrorSettingsRegistrar";

afterEach(() => {
    __resetSettingsRegistryForTests();
});

describe("registerCodeMirrorSettingsSection", () => {
    test("应注册 editor section 和标准设置项", () => {
        const unregister = registerCodeMirrorSettingsSection();

        const section = getSettingsSectionsSnapshot().find(
            (item) => item.id === "codemirror-editor",
        );

        expect(section).toBeDefined();
        expect(section?.items.map((item) => item.id)).toEqual([
            "vim-mode",
            "line-wrapping",
            "tab-restore-mode",
            "tab-out",
            "line-numbers",
            "font-family",
            "font-size",
            "tab-size",
            "config-error",
        ]);

        unregister();
    });
});
