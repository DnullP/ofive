/**
 * @module plugins/calendar/calendarDateUtils.test
 * @description 日历日期工具单元测试：验证 date frontmatter 归一化、月视图网格与每日笔记路径生成。
 * @dependencies
 *  - bun:test
 *  - ./calendarDateUtils
 */

import { describe, expect, it } from "bun:test";
import {
    buildCalendarMonthGrid,
    buildDailyNoteInitialContent,
    buildDailyNoteRelativePath,
    normalizeFrontmatterDateToDayKey,
    shiftCalendarMonth,
    toCalendarDayKey,
} from "./calendarDateUtils";

describe("calendarDateUtils", () => {
    it("应将 frontmatter timestamp 归一化为日期键", () => {
        expect(normalizeFrontmatterDateToDayKey("2024-07-09 09:30:00")).toBe("2024-07-09");
        expect(normalizeFrontmatterDateToDayKey("2024-07-09T09:30:00+08:00")).toBe("2024-07-09");
    });

    it("应拒绝非法日期", () => {
        expect(normalizeFrontmatterDateToDayKey("2024-02-30")).toBeNull();
        expect(normalizeFrontmatterDateToDayKey("not-a-date")).toBeNull();
    });

    it("应生成固定 42 格的月视图网格", () => {
        const grid = buildCalendarMonthGrid(new Date(2024, 6, 9), new Date(2024, 6, 9));
        expect(grid.length).toBe(42);
        expect(grid.some((cell) => cell.dayKey === "2024-07-09" && cell.isToday)).toBe(true);
    });

    it("应生成每日笔记默认路径与内容", () => {
        expect(buildDailyNoteRelativePath("2024-07-09")).toBe("Daily/2024-07-09.md");
        expect(buildDailyNoteInitialContent("2024-07-09")).toBe(
            "---\ndate: 2024-07-09\n---\n# 2024-07-09\n",
        );
    });

    it("应支持月份偏移和日期键格式化", () => {
        expect(toCalendarDayKey(new Date(2024, 0, 2))).toBe("2024-01-02");
        expect(toCalendarDayKey(shiftCalendarMonth(new Date(2024, 0, 15), 1))).toBe("2024-02-01");
    });
});