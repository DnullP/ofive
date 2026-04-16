/**
 * @module host/layout/sidebarLayoutPersistence.test
 * @description 侧边栏工作区持久化模型的单元测试。
 *
 * @dependencies
 *   - bun:test
 *   - ./sidebarLayoutPersistence
 *
 * @example
 *   bun test src/host/layout/sidebarLayoutPersistence.test.ts
 */

import { describe, expect, it } from "bun:test";
import {
    buildSidebarLayoutConfigValue,
    parseSidebarLayoutConfig,
    restorePanelStatesFromSidebarLayout,
    mergePanelStatesWithSidebarLayoutFallback,
    SIDEBAR_LAYOUT_CONFIG_KEY,
    type SidebarLayoutSnapshot,
} from "./sidebarLayoutPersistence";
import type { PanelDefinitionInfo, PanelRuntimeState } from "./layoutStateReducers";

function def(overrides: Partial<PanelDefinitionInfo> & { id: string }): PanelDefinitionInfo {
    return {
        position: "left",
        order: 0,
        ...overrides,
    };
}

function state(overrides: Partial<PanelRuntimeState> & { id: string }): PanelRuntimeState {
    return {
        position: "left",
        order: 0,
        activityId: overrides.id,
        ...overrides,
    };
}

const snapshot: SidebarLayoutSnapshot = {
    version: 1,
    left: {
        width: 300,
        visible: true,
        activeActivityId: "files",
        activePanelId: "files",
    },
    right: {
        width: 280,
        visible: false,
        activeActivityId: "calendar",
        activePanelId: null,
    },
    panelStates: [
        { id: "files", position: "left", order: 0, activityId: "files" },
        { id: "calendar-panel", position: "right", order: 3, activityId: "custom-activity:calendar" },
    ],
    paneStates: [
        { id: "files", size: 320, expanded: true },
        { id: "calendar-panel", size: 220, expanded: false },
    ],
    convertiblePanelStates: [
        { descriptorId: "calendar", stateKey: "calendar", sourceParams: { month: "2026-03" } },
    ],
};

describe("parseSidebarLayoutConfig", () => {
    it("应解析合法的侧边栏布局配置", () => {
        const result = parseSidebarLayoutConfig({
            [SIDEBAR_LAYOUT_CONFIG_KEY]: buildSidebarLayoutConfigValue(snapshot),
        });

        expect(result).toEqual(snapshot);
    });

    it("缺少配置时返回 null", () => {
        expect(parseSidebarLayoutConfig({})).toBeNull();
    });

    it("应过滤非法 panel 与 pane 条目", () => {
        const result = parseSidebarLayoutConfig({
            [SIDEBAR_LAYOUT_CONFIG_KEY]: {
                left: { width: 280, visible: true },
                right: { width: 260, visible: true },
                panelStates: [
                    { id: "ok", position: "right", order: 1, activityId: "group" },
                    { id: "", order: 2, activityId: "bad" },
                    { id: "missing-order", activityId: "bad" },
                ],
                paneStates: [
                    { id: "ok", size: 180, expanded: true },
                    { size: 200, expanded: false },
                ],
                convertiblePanelStates: [
                    { descriptorId: "calendar", stateKey: "calendar" },
                    { descriptorId: "", stateKey: "bad" },
                ],
            },
        });

        expect(result?.panelStates).toEqual([
            { id: "ok", position: "right", order: 1, activityId: "group" },
        ]);
        expect(result?.paneStates).toEqual([
            { id: "ok", size: 180, expanded: true },
        ]);
        expect(result?.convertiblePanelStates).toEqual([
            { descriptorId: "calendar", stateKey: "calendar", sourceParams: undefined },
        ]);
    });
});

describe("restorePanelStatesFromSidebarLayout", () => {
    it("应优先使用持久化 panel 状态", () => {
        const result = restorePanelStatesFromSidebarLayout([
            def({ id: "files", position: "left", order: 4 }),
            def({ id: "calendar-panel", position: "left", order: 5, activityId: "calendar" }),
        ], snapshot);

        expect(result).toEqual(snapshot.panelStates);
    });

    it("对未持久化 panel 回退到定义默认值", () => {
        const result = restorePanelStatesFromSidebarLayout([
            def({ id: "files", position: "left", order: 1 }),
            def({ id: "outline", position: "right", order: 2, activityId: "outline" }),
        ], snapshot);

        expect(result).toEqual([
            { id: "files", position: "left", order: 0, activityId: "files" },
            { id: "outline", position: "right", order: 2, activityId: "outline" },
        ]);
    });
});

describe("mergePanelStatesWithSidebarLayoutFallback", () => {
    it("应保留当前运行时状态并给新增 panel 套用持久化回退", () => {
        const prev = [
            state({ id: "files", position: "right", order: 7, activityId: "custom-files" }),
        ];

        const result = mergePanelStatesWithSidebarLayoutFallback(prev, [
            def({ id: "files" }),
            def({ id: "calendar-panel", position: "left", order: 2 }),
            def({ id: "outline", position: "left", order: 3 }),
        ], snapshot);

        expect(result).toEqual([
            { id: "files", position: "right", order: 7, activityId: "custom-files" },
            { id: "calendar-panel", position: "right", order: 3, activityId: "custom-activity:calendar" },
            { id: "outline", position: "left", order: 3, activityId: "outline" },
        ]);
    });
});

/**
 * 回归：sidebar 拖拽 split 时 handleSidebarStateChange → saveSidebarLayoutSnapshot →
 * backendConfig 更新 → sidebarSnapshot 重算 → handleSidebarStateChange 新引用 →
 * useEffect 重触发 → 无限循环 (Maximum update depth exceeded)。
 *
 * 修复后，handleSidebarStateChange 通过 ref 读取 sidebarSnapshot，回调引用不再随
 * backendConfig 变更而重建；VSCodeWorkbench 也使用 ref 消费 onSidebarStateChange。
 *
 * 此测试验证 JSON 序列化幂等性（dedup guard 的二级兜底）：
 * build → parse → rebuild 后 JSON 必须与首次一致，否则 dedup guard 失效。
 */
describe("snapshot round-trip JSON stability (infinite loop regression)", () => {
    it("build → parse → rebuild 应产出相同 JSON", () => {
        const first = buildSidebarLayoutConfigValue(snapshot);
        const parsed = parseSidebarLayoutConfig({ [SIDEBAR_LAYOUT_CONFIG_KEY]: first });
        expect(parsed).not.toBeNull();
        const second = buildSidebarLayoutConfigValue(parsed!);

        expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    });

    it("sectionRatios 存在时 round-trip 应稳定", () => {
        const withRatios: SidebarLayoutSnapshot = {
            ...snapshot,
            sectionRatios: { "left-sidebar": 0.35, "right-sidebar": 0.25 },
        };

        const first = buildSidebarLayoutConfigValue(withRatios);
        const parsed = parseSidebarLayoutConfig({ [SIDEBAR_LAYOUT_CONFIG_KEY]: first });
        expect(parsed).not.toBeNull();
        const second = buildSidebarLayoutConfigValue(parsed!);

        expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    });

    it("sectionRatios 为 undefined 时 round-trip 应稳定", () => {
        const withoutRatios: SidebarLayoutSnapshot = {
            ...snapshot,
            sectionRatios: undefined,
        };

        const first = buildSidebarLayoutConfigValue(withoutRatios);
        const parsed = parseSidebarLayoutConfig({ [SIDEBAR_LAYOUT_CONFIG_KEY]: first });
        expect(parsed).not.toBeNull();
        const second = buildSidebarLayoutConfigValue(parsed!);

        expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    });
});