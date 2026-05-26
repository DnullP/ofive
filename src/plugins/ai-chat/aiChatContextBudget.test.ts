/**
 * @module plugins/ai-chat/aiChatContextBudget.test
 * @description AI 聊天上下文预算工具回归测试。
 * @dependencies
 *   - bun:test
 *   - ./aiChatContextBudget
 */

import { describe, expect, it } from "bun:test";
import type { AiChatHistoryMessage } from "../../api/aiApi";
import {
    buildBudgetedAiChatHistory,
    normalizeAiChatContextBudgetSettings,
} from "./aiChatContextBudget";

function createMessage(index: number, text: string): AiChatHistoryMessage {
    return {
        id: `message-${index}`,
        role: index % 2 === 0 ? "assistant" : "user",
        text,
        createdAtUnixMs: index,
        contentBlocks: [{
            kind: "text",
            text,
        }],
    };
}

describe("aiChatContextBudget", () => {
    it("应规范化上下文预算默认值与范围", () => {
        expect(normalizeAiChatContextBudgetSettings({}).autoCompressContext).toBe(true);
        expect(normalizeAiChatContextBudgetSettings({ contextLimitTokens: 42 }).contextLimitTokens).toBe(1000);
        expect(normalizeAiChatContextBudgetSettings({ contextLimitTokens: 2_000_000 }).contextLimitTokens).toBe(1_000_000);
    });

    it("应在超过预算时压缩旧协议历史并保留最近消息", () => {
        const history = Array.from({ length: 12 }, (_, index) => {
            return createMessage(index, `message ${index} ${"detail ".repeat(120)}`);
        });

        const result = buildBudgetedAiChatHistory(history, {
            autoCompressContext: true,
            contextLimitTokens: 1200,
        });

        expect(result.wasCompressed).toBe(true);
        expect(result.compressedMessageCount).toBeGreaterThan(0);
        expect(result.history[0]?.text).toContain("Conversation context summary");
        expect(result.history[result.history.length - 1]?.id).toBe("message-11");
        expect(result.estimatedTokensAfter).toBeLessThan(result.estimatedTokensBefore);
    });

    it("应在关闭自动压缩时原样返回历史", () => {
        const history = [
            createMessage(1, "hello"),
            createMessage(2, "world"),
        ];

        const result = buildBudgetedAiChatHistory(history, {
            autoCompressContext: false,
            contextLimitTokens: 1000,
        });

        expect(result.wasCompressed).toBe(false);
        expect(result.history).toBe(history);
    });
});
