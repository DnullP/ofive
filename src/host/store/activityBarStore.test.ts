/**
 * @module host/store/activityBarStore.test
 * @description 活动栏配置纯函数测试。
 *
 * @dependencies
 *   - bun:test
 *   - ./activityBarStore
 *
 * @example
 *   bun test src/host/store/activityBarStore.test.ts
 */

import { describe, expect, it } from "bun:test";
import {
    dedupeActivityBarItems,
    mergeActivityBarConfig,
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