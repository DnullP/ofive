/**
 * @module plugins/ai-chat/aiChatToolCallRecords.test
 * @description AI 聊天工具调用可见记录状态测试。
 * @dependencies
 *   - bun:test
 *   - ./aiChatToolCallRecords
 */

import { describe, expect, it } from "bun:test";
import type { ChatDebugEntry } from "./aiChatStreamState";
import { reduceAiChatToolCallDebugEntry } from "./aiChatToolCallRecords";

function createDebugEntry(
    title: string,
    text: string,
): ChatDebugEntry {
    return {
        id: `debug-${title}`,
        streamId: "stream-1",
        level: "info",
        title,
        text,
    };
}

describe("aiChatToolCallRecords", () => {
    it("应从 capability started/completed debug 日志生成并更新工具调用记录", () => {
        const started = reduceAiChatToolCallDebugEntry({
            assistantMessageId: "assistant-1",
            records: [],
            entry: createDebugEntry(
                "Capability call started",
                "capability=vault.read_markdown_file input={\"relativePath\":\"A.md\"}",
            ),
            recordId: "tool-call-1",
            nowUnixMs: 10,
        });

        expect(started.changed).toBe(true);
        expect(started.records).toHaveLength(1);
        expect(started.records[0]?.status).toBe("calling");
        expect(started.records[0]?.inputText).toBe("{\"relativePath\":\"A.md\"}");

        const completed = reduceAiChatToolCallDebugEntry({
            assistantMessageId: "assistant-1",
            records: started.records,
            entry: createDebugEntry(
                "Capability call completed",
                "capability=vault.read_markdown_file output={\"content\":\"ok\"}",
            ),
            recordId: "tool-call-2",
            nowUnixMs: 30,
        });

        expect(completed.records).toHaveLength(1);
        expect(completed.records[0]?.id).toBe("tool-call-1");
        expect(completed.records[0]?.status).toBe("completed");
        expect(completed.records[0]?.outputText).toBe("{\"content\":\"ok\"}");
        expect(completed.records[0]?.completedAtUnixMs).toBe(30);
    });

    it("应在没有 started 事件时仍显示失败工具记录", () => {
        const failed = reduceAiChatToolCallDebugEntry({
            assistantMessageId: "assistant-1",
            records: [],
            entry: createDebugEntry(
                "Capability call failed",
                "capability=vault.apply_markdown_patch error=invalid diff",
            ),
            recordId: "tool-call-1",
            nowUnixMs: 10,
        });

        expect(failed.changed).toBe(true);
        expect(failed.records).toHaveLength(1);
        expect(failed.records[0]?.status).toBe("failed");
        expect(failed.records[0]?.errorText).toBe("invalid diff");
    });

    it("应忽略非 capability 调用日志", () => {
        const next = reduceAiChatToolCallDebugEntry({
            assistantMessageId: "assistant-1",
            records: [],
            entry: createDebugEntry("Model request", "prompt"),
            recordId: "tool-call-1",
            nowUnixMs: 10,
        });

        expect(next.changed).toBe(false);
        expect(next.records).toHaveLength(0);
    });
});
