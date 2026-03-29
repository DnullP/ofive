/**
 * @module plugins/ai-chat/aiChatDebugExport.test
 * @description AI 调试日志导出单元测试：覆盖复制文本格式化结果。
 * @dependencies
 *   - bun:test
 *   - ./aiChatDebugExport
 */

import { describe, expect, it } from "bun:test";

import { formatAiChatDebugEntriesForClipboard } from "./aiChatDebugExport";

describe("aiChatDebugExport", () => {
    it("应将调试日志格式化为稳定的纯文本副本", () => {
        const formatted = formatAiChatDebugEntriesForClipboard([
            {
                id: "debug-1",
                streamId: "stream-a",
                level: "error",
                title: "Capability call failed",
                text: "capability=vault.save_canvas_document error=invalid payload",
            },
            {
                id: "debug-2",
                streamId: "stream-a",
                level: "info",
                title: "Model HTTP request",
                text: "{\"model\":\"demo\"}",
            },
        ]);

        expect(formatted).toContain("#1 [ERROR] Capability call failed");
        expect(formatted).toContain("stream=stream-a");
        expect(formatted).toContain("capability=vault.save_canvas_document error=invalid payload");
        expect(formatted).toContain("---");
        expect(formatted).toContain("#2 [INFO] Model HTTP request");
    });

    it("应在没有调试日志时返回空字符串", () => {
        expect(formatAiChatDebugEntriesForClipboard([])).toBe("");
    });
});