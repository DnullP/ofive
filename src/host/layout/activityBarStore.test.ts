/**
 * @module host/layout/activityBarStore.test
 * @description 活动栏配置纯函数测试。
 *
 * @dependencies
 *   - bun:test
 *   - ./activityBarStore
 *
 * @example
 *   bun test src/host/layout/activityBarStore.test.ts
 */

import { describe, expect, it } from "bun:test";
import {
    dedupeActivityBarItems,
    mergeActivityBarConfig,
    projectActivityBarConfigFromRuntime,
    reorderActivityBarItems,
    type ActivityBarItemConfig,
} from "./activityBarStore";

describe("dedupeActivityBarItems", () => {
    it("应按 id 去重并保留最后一次出现的配置", () => {
        const result = dedupeActivityBarItems([
            { id: "calendar", section: "top", visible: true, bar: "left" },
            { id: "files", section: "top", visible: true, bar: "left" },
            { id: "calendar", section: "bottom", visible: false, bar: "right" },
        ]);

        expect(result).toEqual<ActivityBarItemConfig[]>([
            { id: "files", section: "top", visible: true, bar: "left" },
            { id: "calendar", section: "bottom", visible: false, bar: "right" },
        ]);
    });
});

describe("mergeActivityBarConfig", () => {
    it("应忽略配置中的重复 id，避免重复渲染 icon", () => {
        const result = mergeActivityBarConfig([
            { id: "calendar", section: "top", bar: "left" },
            { id: "files", section: "top", bar: "left" },
        ], {
            items: [
                { id: "calendar", section: "top", visible: true, bar: "left" },
                { id: "calendar", section: "bottom", visible: false, bar: "right" },
                { id: "files", section: "top", visible: true, bar: "left" },
            ],
        });

        expect(result).toEqual([
            { id: "calendar", section: "top", visible: true, bar: "left" },
            { id: "files", section: "top", visible: true, bar: "left" },
        ]);
    });
});

describe("reorderActivityBarItems", () => {
    it("应按 strip 可见顺序重排活动项，并让隐藏项保持在 bar 末尾", () => {
        const result = reorderActivityBarItems([
            { id: "files", section: "top", visible: true, bar: "left" },
            { id: "search", section: "top", visible: true, bar: "left" },
            { id: "graph", section: "bottom", visible: true, bar: "left" },
            { id: "hidden", section: "top", visible: false, bar: "left" },
            { id: "outline", section: "top", visible: true, bar: "right" },
        ], {
            sourceBarId: "left",
            targetBarId: "left",
            iconId: "graph",
            targetIndex: 1,
        });

        expect(result).toEqual<ActivityBarItemConfig[]>([
            { id: "files", section: "top", visible: true, bar: "left" },
            { id: "graph", section: "bottom", visible: true, bar: "left" },
            { id: "search", section: "top", visible: true, bar: "left" },
            { id: "hidden", section: "top", visible: false, bar: "left" },
            { id: "outline", section: "top", visible: true, bar: "right" },
        ]);
    });
});

describe("projectActivityBarConfigFromRuntime", () => {
    it("应仅用 runtime order 覆盖受 layout 管理的可见 strip 顺序", () => {
        const result = projectActivityBarConfigFromRuntime([
            { id: "files", section: "top", visible: true, bar: "left" },
            { id: "__settings__", section: "bottom", visible: true, bar: "left" },
            { id: "graph", section: "bottom", visible: true, bar: "left" },
            { id: "hidden", section: "top", visible: false, bar: "left" },
            { id: "outline", section: "top", visible: true, bar: "right" },
        ], {
            left: ["graph", "files"],
            right: ["outline"],
        });

        expect(result.items).toEqual<ActivityBarItemConfig[]>([
            { id: "graph", section: "bottom", visible: true, bar: "left" },
            { id: "__settings__", section: "bottom", visible: true, bar: "left" },
            { id: "files", section: "top", visible: true, bar: "left" },
            { id: "hidden", section: "top", visible: false, bar: "left" },
            { id: "outline", section: "top", visible: true, bar: "right" },
        ]);
    });
});