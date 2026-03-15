/**
 * @module host/registry/convertibleViewRegistry.test
 * @description 可转化视图注册中心单元测试：验证注册、查找、参数读写与注销行为。
 * @dependencies
 *  - bun:test
 *  - ./convertibleViewRegistry
 */

import { afterEach, describe, expect, it } from "bun:test";
import {
    buildConvertibleViewTabParams,
    getConvertibleViewByPanelId,
    getConvertibleViewByTabComponentId,
    readConvertibleViewTabState,
    registerConvertibleView,
    unregisterConvertibleView,
} from "./convertibleViewRegistry";

const TEST_DESCRIPTOR_ID = "calendar-test";

afterEach(() => {
    unregisterConvertibleView(TEST_DESCRIPTOR_ID);
});

describe("convertibleViewRegistry", () => {
    it("应支持按 panelId 与 tabComponentId 查找描述符", () => {
        registerConvertibleView({
            id: TEST_DESCRIPTOR_ID,
            tabComponentId: "calendar-tab-test",
            panelId: "calendar-panel-test",
            defaultMode: "tab",
            buildTabInstance: ({ stateKey }) => ({
                id: "calendar-test-tab",
                title: "Calendar",
                component: "calendar-tab-test",
                params: buildConvertibleViewTabParams({
                    descriptorId: TEST_DESCRIPTOR_ID,
                    stateKey,
                }),
            }),
        });

        expect(getConvertibleViewByPanelId("calendar-panel-test")?.id).toBe(TEST_DESCRIPTOR_ID);
        expect(getConvertibleViewByTabComponentId("calendar-tab-test")?.id).toBe(TEST_DESCRIPTOR_ID);
    });

    it("应在 tab params 中读写可转化元数据", () => {
        const params = buildConvertibleViewTabParams({
            descriptorId: TEST_DESCRIPTOR_ID,
            stateKey: "shared-state",
        }, {
            path: "Daily/2026-03-15.md",
        });

        expect(readConvertibleViewTabState(params)).toEqual({
            descriptorId: TEST_DESCRIPTOR_ID,
            stateKey: "shared-state",
        });
        expect((params.path as string)).toBe("Daily/2026-03-15.md");
    });
});
