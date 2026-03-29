/**
 * @module plugins/ai-chat/aiChatInputPolicy.test
 * @description AI 聊天输入策略单元测试：覆盖 Enter 发送、Shift+Enter 换行与中文输入法组合态保护。
 * @dependencies
 *   - bun:test
 *   - ./aiChatInputPolicy
 */

import { describe, expect, it } from "bun:test";

import { shouldSubmitAiChatComposer } from "./aiChatInputPolicy";

describe("aiChatInputPolicy", () => {
    it("应在普通 Enter 时允许发送", () => {
        expect(shouldSubmitAiChatComposer({
            key: "Enter",
            shiftKey: false,
            nativeEvent: {
                isComposing: false,
                keyCode: 13,
            },
        })).toBe(true);
    });

    it("应在 Shift+Enter 时不发送", () => {
        expect(shouldSubmitAiChatComposer({
            key: "Enter",
            shiftKey: true,
            nativeEvent: {
                isComposing: false,
                keyCode: 13,
            },
        })).toBe(false);
    });

    it("应在输入法组合态 Enter 时不发送", () => {
        expect(shouldSubmitAiChatComposer({
            key: "Enter",
            shiftKey: false,
            nativeEvent: {
                isComposing: true,
                keyCode: 229,
            },
        })).toBe(false);
    });

    it("应在浏览器仅提供 keyCode 229 时仍识别为组合态", () => {
        expect(shouldSubmitAiChatComposer({
            key: "Enter",
            shiftKey: false,
            nativeEvent: {
                isComposing: false,
                keyCode: 229,
            },
        })).toBe(false);
    });
});