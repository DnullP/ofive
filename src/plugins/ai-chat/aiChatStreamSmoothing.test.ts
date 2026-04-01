/**
 * @module plugins/ai-chat/aiChatStreamSmoothing.test
 * @description AI 聊天流式平滑测试：验证文本推进策略能按 backlog 自适应提速，并优先展示 reasoning。
 * @dependencies
 *   - bun:test
 *   - ./aiChatStreamSmoothing
 */

import { describe, expect, it } from "bun:test";

import {
    advanceAiChatSmoothedMessageState,
    isAiChatSmoothedMessageSettled,
    syncAiChatSmoothedMessageTargets,
} from "./aiChatStreamSmoothing";

describe("aiChatStreamSmoothing", () => {
    it("应在同步目标时保留当前已显示进度", () => {
        const initial = syncAiChatSmoothedMessageTargets(null, {
            messageId: "assistant-1",
            targetText: "hello",
            active: true,
        });

        const progressed = {
            ...initial,
            displayText: "he",
        };
        const next = syncAiChatSmoothedMessageTargets(progressed, {
            messageId: "assistant-1",
            targetText: "hello world",
            active: true,
        });

        expect(next.displayText).toBe("he");
        expect(next.targetText).toBe("hello world");
    });

    it("应优先推进 reasoning 再推进最终回答", () => {
        const state = syncAiChatSmoothedMessageTargets(null, {
            messageId: "assistant-1",
            targetReasoningText: "plan first",
            targetText: "final answer",
            active: true,
        });

        const next = advanceAiChatSmoothedMessageState(state, 16);

        expect(next.displayReasoningText.length).toBeGreaterThan(0);
        expect(next.displayText).toBe("");
    });

    it("应在 backlog 较大时加速追平", () => {
        const smallBacklogState = {
            messageId: "assistant-1",
            targetText: "small backlog",
            displayText: "",
            targetReasoningText: "",
            displayReasoningText: "",
            active: true,
        };
        const largeBacklogState = {
            ...smallBacklogState,
            targetText: "x".repeat(400),
        };

        const smallBacklogNext = advanceAiChatSmoothedMessageState(smallBacklogState, 16);
        const largeBacklogNext = advanceAiChatSmoothedMessageState(largeBacklogState, 16);

        expect(largeBacklogNext.displayText.length).toBeGreaterThan(smallBacklogNext.displayText.length);
    });

    it("应在显示追平后标记为 settled", () => {
        const settled = {
            messageId: "assistant-1",
            targetText: "done",
            displayText: "done",
            targetReasoningText: "think",
            displayReasoningText: "think",
            active: false,
        };

        expect(isAiChatSmoothedMessageSettled(settled)).toBe(true);
        expect(advanceAiChatSmoothedMessageState(settled, 16)).toBe(settled);
    });
});