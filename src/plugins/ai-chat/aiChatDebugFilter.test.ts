/**
 * @module plugins/ai-chat/aiChatDebugFilter.test
 * @description AI 调试日志过滤单元测试：覆盖等级归一化与过滤行为。
 * @dependencies
 *   - bun:test
 *   - ./aiChatDebugFilter
 */

import { describe, expect, it } from "bun:test";

import {
    filterChatDebugEntries,
    normalizeChatDebugLevel,
} from "./aiChatDebugFilter";

describe("aiChatDebugFilter", () => {
    it("应将未知等级回退为 debug", () => {
        expect(normalizeChatDebugLevel("unknown")).toBe("debug");
    });

    it("应按指定等级过滤调试日志", () => {
        const entries = [
            { level: "info" as const, title: "A" },
            { level: "error" as const, title: "B" },
            { level: "debug" as const, title: "C" },
        ];

        expect(filterChatDebugEntries(entries, "error")).toEqual([
            { level: "error", title: "B" },
        ]);
    });

    it("应在 all 过滤下返回全部日志", () => {
        const entries = [
            { level: "warn" as const, title: "A" },
            { level: "error" as const, title: "B" },
        ];

        expect(filterChatDebugEntries(entries, "all")).toEqual(entries);
    });
});