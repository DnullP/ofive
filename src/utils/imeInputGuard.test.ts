/**
 * @module utils/imeInputGuard.test
 * @description 输入法组合态保护工具单元测试：覆盖 Enter 提交判定与 composition 结束后 blur 延迟提交窗口。
 * @dependencies
 *   - bun:test
 *   - ./imeInputGuard
 */

import { describe, expect, it } from "bun:test";

import {
    isImeComposing,
    shouldDeferBlurCommitAfterComposition,
    shouldSubmitPlainEnter,
} from "./imeInputGuard";

describe("imeInputGuard", () => {
    it("应在 isComposing 为 true 时识别为输入法组合态", () => {
        expect(isImeComposing({
            isComposing: true,
            keyCode: 13,
        })).toBe(true);
    });

    it("应在仅提供 keyCode 229 时仍识别为输入法组合态", () => {
        expect(isImeComposing({
            isComposing: false,
            keyCode: 229,
        })).toBe(true);
    });

    it("应允许普通 Enter 触发纯文本提交", () => {
        expect(shouldSubmitPlainEnter({
            key: "Enter",
            nativeEvent: {
                isComposing: false,
                keyCode: 13,
            },
        })).toBe(true);
    });

    it("应在组合态 Enter 时阻止提交", () => {
        expect(shouldSubmitPlainEnter({
            key: "Enter",
            nativeEvent: {
                isComposing: true,
                keyCode: 229,
            },
        })).toBe(false);
    });

    it("应在带修饰键的 Enter 时阻止纯文本提交", () => {
        expect(shouldSubmitPlainEnter({
            key: "Enter",
            shiftKey: true,
            nativeEvent: {
                isComposing: false,
                keyCode: 13,
            },
        })).toBe(false);
    });

    it("应在输入法组合过程中延后 blur 提交", () => {
        expect(shouldDeferBlurCommitAfterComposition({
            isComposing: true,
            lastCompositionEndAt: 0,
            now: 200,
        })).toBe(true);
    });

    it("应在组合态刚结束的宽限窗口内延后 blur 提交", () => {
        expect(shouldDeferBlurCommitAfterComposition({
            isComposing: false,
            lastCompositionEndAt: 100,
            now: 120,
        })).toBe(true);
    });

    it("应在宽限窗口结束后允许 blur 提交", () => {
        expect(shouldDeferBlurCommitAfterComposition({
            isComposing: false,
            lastCompositionEndAt: 100,
            now: 160,
        })).toBe(false);
    });
});