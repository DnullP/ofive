/**
 * @module plugins/ai-chat/aiChatStreamState.test
 * @description AI 聊天流式状态单元测试：覆盖 debug、confirmation、完成态与错误态迁移。
 * @dependencies
 *   - bun:test
 *   - ./aiChatStreamState
 */

import { describe, expect, it } from "bun:test";
import type { AiChatStreamEventPayload } from "../../api/aiApi";
import {
    createEmptyPendingStreamBinding,
    createPendingStreamBinding,
    reduceAiChatStreamEvent,
} from "./aiChatStreamState";

function createPayload(
    eventType: AiChatStreamEventPayload["eventType"],
    overrides: Partial<AiChatStreamEventPayload> = {},
): AiChatStreamEventPayload {
    return {
        streamId: "stream-1",
        eventType,
        sessionId: "session-1",
        agentName: null,
        deltaText: null,
        accumulatedText: null,
        reasoningDeltaText: null,
        reasoningAccumulatedText: null,
        historyContentBlocksJson: null,
        debugTitle: null,
        debugLevel: null,
        debugText: null,
        confirmationId: null,
        confirmationHint: null,
        confirmationToolName: null,
        confirmationToolArgsJson: null,
        error: null,
        done: false,
        ...overrides,
    };
}

describe("aiChatStreamState", () => {
    it("应在首次事件时绑定 streamId 并产出 debug entry", () => {
        const transition = reduceAiChatStreamEvent({
            payload: createPayload("debug", {
                debugTitle: "trace",
                debugText: "payload",
                debugLevel: "error",
            }),
            binding: createPendingStreamBinding("conversation-1", "session-1", "assistant-1"),
            debugEntryId: "debug-1",
            debugFallbackTitle: "fallback",
            confirmationFallbackHint: "fallback-hint",
        });

        expect(transition.matchesBinding).toBe(true);
        expect(transition.nextBinding.streamId).toBe("stream-1");
        expect(transition.nextDebugEntry).toEqual({
            id: "debug-1",
            streamId: "stream-1",
            level: "error",
            title: "trace",
            text: "payload",
        });
    });

    it("应在 confirmation 事件时生成确认状态并清空 binding", () => {
        const transition = reduceAiChatStreamEvent({
            payload: createPayload("confirmation", {
                confirmationId: "confirm-1",
                confirmationHint: "need approval",
                confirmationToolName: "vault.write",
                confirmationToolArgsJson: '{"path":"A.md"}',
            }),
            binding: createPendingStreamBinding("conversation-1", "session-1", "assistant-1", "stream-1"),
            debugEntryId: "debug-1",
            debugFallbackTitle: "fallback",
            confirmationFallbackHint: "fallback-hint",
        });

        expect(transition.shouldStopStreaming).toBe(true);
        expect(transition.nextBinding).toEqual(createEmptyPendingStreamBinding());
        expect(transition.nextConfirmation?.confirmationId).toBe("confirm-1");
        expect(transition.nextAssistantText).toBe("need approval");
    });

    it("应在 done 事件时停止流并清理 pending confirmation", () => {
        const transition = reduceAiChatStreamEvent({
            payload: createPayload("done", {
                accumulatedText: "final response",
                done: true,
            }),
            binding: createPendingStreamBinding("conversation-1", "session-1", "assistant-1", "stream-1"),
            debugEntryId: "debug-1",
            debugFallbackTitle: "fallback",
            confirmationFallbackHint: "fallback-hint",
        });

        expect(transition.isDone).toBe(true);
        expect(transition.shouldStopStreaming).toBe(true);
        expect(transition.shouldClearPendingConfirmation).toBe(true);
        expect(transition.nextAssistantText).toBe("final response");
        expect(transition.nextAssistantReasoningText).toBe(null);
    });

    it("应在 delta 事件时单独透传 reasoning 文本", () => {
        const transition = reduceAiChatStreamEvent({
            payload: createPayload("delta", {
                accumulatedText: null,
                reasoningAccumulatedText: "先推理，再回答",
            }),
            binding: createPendingStreamBinding("conversation-1", "session-1", "assistant-1", "stream-1"),
            debugEntryId: "debug-1",
            debugFallbackTitle: "fallback",
            confirmationFallbackHint: "fallback-hint",
        });

        expect(transition.nextAssistantText).toBe(null);
        expect(transition.nextAssistantReasoningText).toBe("先推理，再回答");
    });

    it("应在 stopped 事件时保留已有内容并结束当前 binding", () => {
        const transition = reduceAiChatStreamEvent({
            payload: createPayload("stopped", {
                done: true,
            }),
            binding: createPendingStreamBinding("conversation-1", "session-1", "assistant-1", "stream-1", true),
            debugEntryId: "debug-1",
            debugFallbackTitle: "fallback",
            confirmationFallbackHint: "fallback-hint",
        });

        expect(transition.wasStopped).toBe(true);
        expect(transition.shouldStopStreaming).toBe(true);
        expect(transition.shouldClearPendingConfirmation).toBe(true);
        expect(transition.nextBinding).toEqual(createEmptyPendingStreamBinding());
    });

    it("应在 error 事件时返回错误并重置 binding", () => {
        const transition = reduceAiChatStreamEvent({
            payload: createPayload("error", {
                error: "boom",
            }),
            binding: createPendingStreamBinding("conversation-1", "session-1", "assistant-1", "stream-1"),
            debugEntryId: "debug-1",
            debugFallbackTitle: "fallback",
            confirmationFallbackHint: "fallback-hint",
        });

        expect(transition.errorMessage).toBe("boom");
        expect(transition.shouldStopStreaming).toBe(true);
        expect(transition.nextBinding).toEqual(createEmptyPendingStreamBinding());
    });
});