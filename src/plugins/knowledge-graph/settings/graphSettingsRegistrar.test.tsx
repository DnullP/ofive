/**
 * @module plugins/knowledge-graph/settings/graphSettingsRegistrar.test
 * @description knowledge graph settings registrar 测试：验证图谱设置通过 custom item 接入中心 registry。
 */

import { afterEach, describe, expect, test } from "bun:test";

import {
    __resetSettingsRegistryForTests,
    getSettingsSectionsSnapshot,
} from "../../../host/settings/settingsRegistry";
import { registerGraphSettingsSection } from "./graphSettingsRegistrar";

afterEach(() => {
    __resetSettingsRegistryForTests();
});

describe("registerGraphSettingsSection", () => {
    test("应注册图谱 section 和 custom settings item", () => {
        const unregister = registerGraphSettingsSection();

        const section = getSettingsSectionsSnapshot().find(
            (item) => item.id === "graph-component",
        );

        expect(section).toBeDefined();
        expect(section?.items.map((item) => item.id)).toEqual([
            "knowledge-graph-settings-panel",
        ]);

        unregister();
    });
});