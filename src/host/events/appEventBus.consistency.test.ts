/**
 * @module host/events/appEventBus.consistency.test
 * @description 事件总线一致性测试：
 *   验证 vault.fs / vault.config 事件的 dispatch → subscribe 流程，
 *   检验 TREE_REFRESH_EVENT_TYPES 过滤规则是否正确，
 *   确保 unsubscribe 后不再收到事件（防止死循环积累），
 *   以及并发多订阅者不会互相干扰。
 * @dependencies
 *  - bun:test
 *  - ./appEventBus
 *
 * @example
 *   bun test src/host/events/appEventBus.consistency.test.ts
 */

import { afterEach, describe, expect, it } from "bun:test";
import type { VaultFsEventPayload, VaultConfigEventPayload } from "../../api/vaultApi";
import {
    dispatchVaultFsBusEventForTest,
    dispatchVaultConfigBusEventForTest,
    subscribeVaultFsBusEvent,
    subscribeVaultConfigBusEvent,
} from "./appEventBus";

// ────────── 辅助工厂 ──────────

let eventSeq = 0;

/**
 * 生成 vault.fs 事件负载。
 * @param overrides 可选覆盖字段。
 * @returns 完整的 VaultFsEventPayload。
 */
function makeFsPayload(
    overrides: Partial<VaultFsEventPayload> = {},
): VaultFsEventPayload {
    eventSeq += 1;
    return {
        eventId: `test-fs-${eventSeq}`,
        sourceTraceId: null,
        eventType: "created",
        relativePath: `test/file-${eventSeq}.md`,
        oldRelativePath: null,
        ...overrides,
    };
}

/**
 * 生成 vault.config 事件负载。
 * @param overrides 可选覆盖字段。
 * @returns 完整的 VaultConfigEventPayload。
 */
function makeConfigPayload(
    overrides: Partial<VaultConfigEventPayload> = {},
): VaultConfigEventPayload {
    eventSeq += 1;
    return {
        eventId: `test-cfg-${eventSeq}`,
        sourceTraceId: null,
        eventType: "modified",
        relativePath: ".ofive/config.json",
        oldRelativePath: null,
        ...overrides,
    };
}

// ────────── vault.fs 事件一致性 ──────────

describe("vault.fs event bus consistency", () => {
    /** 跟踪测试中注册的 unsubscribe 函数，afterEach 自动清理 */
    const cleanups: (() => void)[] = [];
    afterEach(() => {
        cleanups.forEach((fn) => fn());
        cleanups.length = 0;
    });

    /**
     * dispatch 的事件应该到达 subscribe 监听器，
     * payload 字段完整不丢失。
     */
    it("should deliver vault.fs event payload to subscriber", () => {
        let received: VaultFsEventPayload | null = null;
        const unlisten = subscribeVaultFsBusEvent((p) => {
            received = p;
        });
        cleanups.push(unlisten);

        const payload = makeFsPayload({
            eventType: "moved",
            relativePath: "notes/new.md",
            oldRelativePath: "notes/old.md",
            sourceTraceId: "trace-123",
        });
        dispatchVaultFsBusEventForTest(payload);

        expect(received).not.toBeNull();
        expect(received!.eventId).toBe(payload.eventId);
        expect(received!.eventType).toBe("moved");
        expect(received!.relativePath).toBe("notes/new.md");
        expect(received!.oldRelativePath).toBe("notes/old.md");
        expect(received!.sourceTraceId).toBe("trace-123");
    });

    /**
     * 取消订阅后不应再收到后续事件。
     * 这是防止事件死循环的基本保障。
     */
    it("should not receive events after unsubscribe", () => {
        let callCount = 0;
        const unlisten = subscribeVaultFsBusEvent(() => {
            callCount += 1;
        });

        dispatchVaultFsBusEventForTest(makeFsPayload());
        expect(callCount).toBe(1);

        unlisten();
        dispatchVaultFsBusEventForTest(makeFsPayload());
        expect(callCount).toBe(1); // 没有增长
    });

    /**
     * 多个订阅者应该各自独立接收同一事件，互不干扰。
     */
    it("should deliver events to multiple subscribers independently", () => {
        const received1: string[] = [];
        const received2: string[] = [];

        const u1 = subscribeVaultFsBusEvent((p) => received1.push(p.eventId));
        const u2 = subscribeVaultFsBusEvent((p) => received2.push(p.eventId));
        cleanups.push(u1, u2);

        const p1 = makeFsPayload();
        const p2 = makeFsPayload();
        dispatchVaultFsBusEventForTest(p1);
        dispatchVaultFsBusEventForTest(p2);

        expect(received1).toEqual([p1.eventId, p2.eventId]);
        expect(received2).toEqual([p1.eventId, p2.eventId]);
    });

    /**
     * 取消其中一个订阅者后，其他订阅者仍正常接收。
     */
    it("should keep other subscribers active after one unsubscribes", () => {
        const received1: string[] = [];
        const received2: string[] = [];

        const u1 = subscribeVaultFsBusEvent((p) => received1.push(p.eventId));
        const u2 = subscribeVaultFsBusEvent((p) => received2.push(p.eventId));
        cleanups.push(u2); // u1 将手动取消

        dispatchVaultFsBusEventForTest(makeFsPayload()); // both receive
        u1(); // unsubscribe first

        const afterUnsub = makeFsPayload();
        dispatchVaultFsBusEventForTest(afterUnsub);

        expect(received1.length).toBe(1); // 停止增长
        expect(received2.length).toBe(2); // 继续接收
        expect(received2[1]).toBe(afterUnsub.eventId);
    });

    /**
     * 所有 TREE_REFRESH_EVENT_TYPES ("created" / "deleted" / "moved")
     * 应该都能正常到达订阅者。
     */
    it("should deliver all tree-refresh event types", () => {
        const types: string[] = [];
        const unlisten = subscribeVaultFsBusEvent((p) => types.push(p.eventType));
        cleanups.push(unlisten);

        for (const t of ["created", "deleted", "moved"] as const) {
            dispatchVaultFsBusEventForTest(makeFsPayload({ eventType: t }));
        }

        expect(types).toEqual(["created", "deleted", "moved"]);
    });

    /**
     * "modified" 类型事件应到达订阅者（总线不过滤），
     * 过滤由消费者（useVaultTreeSync）决定。
     */
    it("should deliver modified event type (bus does not filter)", () => {
        let received = false;
        const unlisten = subscribeVaultFsBusEvent(() => {
            received = true;
        });
        cleanups.push(unlisten);

        dispatchVaultFsBusEventForTest(makeFsPayload({ eventType: "modified" }));
        expect(received).toBe(true);
    });

    /**
     * 快速连续 dispatch 多个事件时，订阅者应完整接收所有事件，
     * 不遗漏不合并（合并由业务层 debounce 处理）。
     */
    it("should deliver all events even in rapid succession", () => {
        const received: string[] = [];
        const unlisten = subscribeVaultFsBusEvent((p) => received.push(p.eventId));
        cleanups.push(unlisten);

        const events = Array.from({ length: 100 }, () => makeFsPayload());
        events.forEach((p) => dispatchVaultFsBusEventForTest(p));

        expect(received.length).toBe(100);
        expect(received).toEqual(events.map((e) => e.eventId));
    });
});

// ────────── vault.config 事件一致性 ──────────

describe("vault.config event bus consistency", () => {
    const cleanups: (() => void)[] = [];
    afterEach(() => {
        cleanups.forEach((fn) => fn());
        cleanups.length = 0;
    });

    /**
     * config 事件应正常到达订阅者。
     */
    it("should deliver vault.config event payload to subscriber", () => {
        let received: VaultConfigEventPayload | null = null;
        const unlisten = subscribeVaultConfigBusEvent((p) => {
            received = p;
        });
        cleanups.push(unlisten);

        const payload = makeConfigPayload({ eventType: "created" });
        dispatchVaultConfigBusEventForTest(payload);

        expect(received).not.toBeNull();
        expect(received!.eventId).toBe(payload.eventId);
        expect(received!.eventType).toBe("created");
    });

    /**
     * vault.fs 和 vault.config 应互不干扰。
     */
    it("should isolate vault.fs and vault.config channels", () => {
        let fsCount = 0;
        let cfgCount = 0;

        const u1 = subscribeVaultFsBusEvent(() => { fsCount += 1; });
        const u2 = subscribeVaultConfigBusEvent(() => { cfgCount += 1; });
        cleanups.push(u1, u2);

        dispatchVaultFsBusEventForTest(makeFsPayload());
        dispatchVaultConfigBusEventForTest(makeConfigPayload());

        expect(fsCount).toBe(1);  // 不会被 config 事件触发
        expect(cfgCount).toBe(1); // 不会被 fs 事件触发
    });
});

// ────────── 事件死循环保障 ──────────

describe("no event dead loop guarantees", () => {
    const cleanups: (() => void)[] = [];
    afterEach(() => {
        cleanups.forEach((fn) => fn());
        cleanups.length = 0;
    });

    /**
     * 在订阅者内部再次 dispatch 同类型事件时，
     * 不应产生无限递归（浏览器 EventTarget 是同步的）。
     * 设置安全上限防护。
     */
    it("should not infinitely recurse when subscriber re-dispatches", () => {
        let callCount = 0;
        const MAX_REENTRANT = 5;

        const unlisten = subscribeVaultFsBusEvent((_p) => {
            callCount += 1;
            if (callCount < MAX_REENTRANT) {
                // 订阅者内重新 dispatch → 同步递归
                dispatchVaultFsBusEventForTest(
                    makeFsPayload({ eventType: "created" }),
                );
            }
        });
        cleanups.push(unlisten);

        dispatchVaultFsBusEventForTest(makeFsPayload({ eventType: "created" }));

        // EventTarget 是同步递归的，应精确等于 MAX_REENTRANT
        expect(callCount).toBe(MAX_REENTRANT);
    });

    /**
     * 只要 unsubscribe 在 dispatch 前调用，就不会收到任何事件，
     * 确保组件卸载后不残留事件处理。
     */
    it("should guarantee cleanup prevents stale handler invocation", () => {
        let staleCallCount = 0;
        const unlisten = subscribeVaultFsBusEvent(() => {
            staleCallCount += 1;
        });

        // 模拟组件 unmount：先 unlisten
        unlisten();

        // 后续所有事件都不应触达
        for (let i = 0; i < 10; i++) {
            dispatchVaultFsBusEventForTest(makeFsPayload());
        }
        expect(staleCallCount).toBe(0);
    });
});
