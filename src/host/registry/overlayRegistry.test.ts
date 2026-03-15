/**
 * @module host/registry/overlayRegistry.test
 * @description Overlay 注册中心单元测试：覆盖注册、排序、注销与订阅逻辑。
 * @dependencies
 *   - bun:test
 *   - ./overlayRegistry
 *
 * @example
 *   bun test src/host/registry/overlayRegistry.test.ts
 */

import { afterEach, describe, expect, it } from "bun:test";
import {
    getOverlaysSnapshot,
    registerOverlay,
    subscribeOverlays,
    unregisterOverlay,
    type OverlayDescriptor,
} from "./overlayRegistry";

/**
 * @function createOverlay
 * @description 创建测试用 Overlay 描述。
 * @param overrides 覆盖字段。
 * @returns Overlay 描述。
 */
function createOverlay(overrides: Partial<OverlayDescriptor> & { id: string }): OverlayDescriptor {
    return {
        id: overrides.id,
        order: overrides.order ?? 0,
        render: overrides.render ?? (() => null),
    };
}

describe("overlayRegistry", () => {
    afterEach(() => {
        for (const overlay of getOverlaysSnapshot()) {
            unregisterOverlay(overlay.id);
        }
    });

    it("应注册 overlay 并返回快照", () => {
        registerOverlay(createOverlay({ id: "quick-switcher", order: 20 }));

        const snapshot = getOverlaysSnapshot();
        expect(snapshot).toHaveLength(1);
        expect(snapshot[0]?.id).toBe("quick-switcher");
    });

    it("应按 order 升序排序，相同 order 时按 id 排序", () => {
        registerOverlay(createOverlay({ id: "b", order: 10 }));
        registerOverlay(createOverlay({ id: "a", order: 10 }));
        registerOverlay(createOverlay({ id: "c", order: 20 }));

        expect(getOverlaysSnapshot().map((overlay) => overlay.id)).toEqual(["a", "b", "c"]);
    });

    it("相同 id 注册应覆盖旧条目", () => {
        registerOverlay(createOverlay({ id: "quick-switcher", order: 10 }));
        registerOverlay(createOverlay({ id: "quick-switcher", order: 30 }));

        const snapshot = getOverlaysSnapshot();
        expect(snapshot).toHaveLength(1);
        expect(snapshot[0]?.order).toBe(30);
    });

    it("应在变化时通知监听器", () => {
        let notifyCount = 0;
        const unsubscribe = subscribeOverlays(() => {
            notifyCount += 1;
        });

        registerOverlay(createOverlay({ id: "quick-switcher" }));
        unregisterOverlay("quick-switcher");
        unsubscribe();

        expect(notifyCount).toBe(2);
    });
});