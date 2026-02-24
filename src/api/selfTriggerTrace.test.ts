/**
 * @module api/selfTriggerTrace.test
 * @description 写入溯源（write trace）机制测试：
 *   确保 traceId 注册后能正确识别自触发事件，
 *   过期后自动失效，不会造成误判或内存泄漏。
 * @dependencies
 *  - bun:test
 *  - ./selfTriggerTrace
 *
 * @example
 *   bun test src/api/selfTriggerTrace.test.ts
 */

import { afterEach, describe, expect, it } from "bun:test";
import {
    clearAllWriteTraces,
    createWriteTraceId,
    getActiveTraceCount,
    isSelfTriggeredPayload,
    registerLocalWriteTrace,
} from "./selfTriggerTrace";

afterEach(() => {
    clearAllWriteTraces();
});

describe("selfTriggerTrace", () => {
    // ────────── createWriteTraceId ──────────

    /**
     * traceId 应以 "vault-save-" 前缀开头。
     */
    it("should generate trace id with vault-save prefix", () => {
        const id = createWriteTraceId();
        expect(id.startsWith("vault-save-")).toBe(true);
    });

    /**
     * 每次调用应生成不同的 traceId。
     */
    it("should generate unique trace ids", () => {
        const ids = new Set(Array.from({ length: 50 }, () => createWriteTraceId()));
        expect(ids.size).toBe(50);
    });

    // ────────── registerLocalWriteTrace + isSelfTriggeredPayload ──────────

    /**
     * 注册后的 traceId 应被 isSelfTriggeredPayload 识别。
     */
    it("should recognize registered trace as self-triggered", () => {
        const traceId = createWriteTraceId();
        registerLocalWriteTrace(traceId);

        const result = isSelfTriggeredPayload({ sourceTraceId: traceId });
        expect(result).toBe(true);
    });

    /**
     * 未注册的 traceId 不应被识别为自触发。
     */
    it("should not recognize unregistered trace", () => {
        const result = isSelfTriggeredPayload({
            sourceTraceId: "vault-save-unknown-id",
        });
        expect(result).toBe(false);
    });

    /**
     * sourceTraceId 为 null 时不应被识别。
     */
    it("should return false for null sourceTraceId", () => {
        const result = isSelfTriggeredPayload({ sourceTraceId: null });
        expect(result).toBe(false);
    });

    /**
     * sourceTraceId 为空字符串时不应被识别。
     */
    it("should return false for empty sourceTraceId", () => {
        const result = isSelfTriggeredPayload({ sourceTraceId: "" });
        expect(result).toBe(false);
    });

    /**
     * sourceTraceId 前后有空格时应正确 trim 并匹配。
     */
    it("should trim sourceTraceId before matching", () => {
        const traceId = createWriteTraceId();
        registerLocalWriteTrace(traceId);

        const result = isSelfTriggeredPayload({ sourceTraceId: `  ${traceId}  ` });
        expect(result).toBe(true);
    });

    /**
     * 多个不同的 traceId 同时注册，各自独立识别。
     */
    it("should track multiple traces independently", () => {
        const id1 = createWriteTraceId();
        const id2 = createWriteTraceId();
        registerLocalWriteTrace(id1);
        registerLocalWriteTrace(id2);

        expect(isSelfTriggeredPayload({ sourceTraceId: id1 })).toBe(true);
        expect(isSelfTriggeredPayload({ sourceTraceId: id2 })).toBe(true);
        expect(getActiveTraceCount()).toBe(2);
    });

    // ────────── clearAllWriteTraces ──────────

    /**
     * clearAllWriteTraces 应清空所有已注册 trace。
     */
    it("should clear all traces", () => {
        registerLocalWriteTrace(createWriteTraceId());
        registerLocalWriteTrace(createWriteTraceId());
        expect(getActiveTraceCount()).toBe(2);

        clearAllWriteTraces();
        expect(getActiveTraceCount()).toBe(0);
    });

    /**
     * 清空后，之前注册的 traceId 不应再被识别。
     */
    it("should not recognize cleared traces", () => {
        const traceId = createWriteTraceId();
        registerLocalWriteTrace(traceId);

        clearAllWriteTraces();

        const result = isSelfTriggeredPayload({ sourceTraceId: traceId });
        expect(result).toBe(false);
    });

    // ────────── 不应产生事件死循环的保障 ──────────

    /**
     * 自触发标识检查不会消费（移除）traceId，
     * 允许同一写入对应的多个 watcher 事件（如 RenameMode 的 From+To）
     * 都被正确过滤。
     */
    it("should allow checking same trace multiple times without consuming it", () => {
        const traceId = createWriteTraceId();
        registerLocalWriteTrace(traceId);

        // 模拟 RenameMode 的 From 和 To 各触发一次事件
        expect(isSelfTriggeredPayload({ sourceTraceId: traceId })).toBe(true);
        expect(isSelfTriggeredPayload({ sourceTraceId: traceId })).toBe(true);
        expect(isSelfTriggeredPayload({ sourceTraceId: traceId })).toBe(true);
    });

    /**
     * 没有 sourceTraceId 的外部事件应始终被识别为非自触发，
     * 确保外部文件变更能正常触发 tree refresh。
     */
    it("should always pass external events (no traceId) even when traces are registered", () => {
        registerLocalWriteTrace(createWriteTraceId());
        registerLocalWriteTrace(createWriteTraceId());

        // 外部事件没有 sourceTraceId
        expect(isSelfTriggeredPayload({ sourceTraceId: null })).toBe(false);
        expect(isSelfTriggeredPayload({ sourceTraceId: "" })).toBe(false);
    });
});
