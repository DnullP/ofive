/**
 * @module tests/panelOrderUtils.test
 * @description 回归测试：验证同侧栏拖拽后排序会持久化，避免后续操作触发位置回退。
 */

import { describe, expect, test } from "bun:test";
import { applyPanelOrderForPosition } from "../src/layout/panelOrderUtils";

describe("applyPanelOrderForPosition", () => {
    test("同侧栏拖拽后应按 Paneview 顺序持久化 order", () => {
        const previous = [
            { id: "files", position: "left" as const, order: 0, activityId: "files" },
            { id: "search", position: "left" as const, order: 1, activityId: "search" },
            { id: "graph", position: "left" as const, order: 2, activityId: "graph" },
            { id: "outline", position: "right" as const, order: 0, activityId: "outline" },
        ];

        const next = applyPanelOrderForPosition(previous, "left", ["graph", "files", "search"]);

        expect(next.find((item) => item.id === "graph")?.order).toBe(0);
        expect(next.find((item) => item.id === "files")?.order).toBe(1);
        expect(next.find((item) => item.id === "search")?.order).toBe(2);
    });

    test("只更新目标侧栏，不应影响另一侧栏", () => {
        const previous = [
            { id: "files", position: "left" as const, order: 0, activityId: "files" },
            { id: "graph", position: "left" as const, order: 1, activityId: "graph" },
            { id: "outline", position: "right" as const, order: 0, activityId: "outline" },
            { id: "meta", position: "right" as const, order: 1, activityId: "meta" },
        ];

        const next = applyPanelOrderForPosition(previous, "left", ["graph", "files"]);

        expect(next.find((item) => item.id === "outline")?.order).toBe(0);
        expect(next.find((item) => item.id === "meta")?.order).toBe(1);
    });

    test("当顺序未变化时应保持稳定", () => {
        const previous = [
            { id: "files", position: "left" as const, order: 0, activityId: "files" },
            { id: "search", position: "left" as const, order: 1, activityId: "search" },
        ];

        const next = applyPanelOrderForPosition(previous, "left", ["files", "search"]);

        expect(next).toEqual(previous);
    });
});
