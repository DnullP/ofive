/**
 * @module host/layout/dockviewLayoutAnimationState.test
 * @description Dockview FLIP 动画事务状态测试，覆盖交叉操作下的释放与过期规则。
 * @dependencies
 *   - bun:test
 *   - ./dockviewLayoutAnimationState
 */

import { describe, expect, it } from "bun:test";
import {
    createPendingDockviewLayoutAnimation,
    hasPendingDockviewLayoutAnimationExpired,
    isPendingDockviewLayoutAnimationReady,
    markPendingDockviewLayoutAnimationReleased,
} from "./dockviewLayoutAnimationState";

describe("dockviewLayoutAnimationState", () => {
    it("should mark programmatic captures as immediately ready", () => {
        const pending = createPendingDockviewLayoutAnimation({
            id: 1,
            reason: "split-entering",
            source: "programmatic",
            previousRects: [],
            capturedAt: 100,
        });

        expect(isPendingDockviewLayoutAnimationReady(pending)).toBe(true);
        expect(pending.releasedAt).toBe(100);
    });

    it("should keep drag captures blocked until release", () => {
        const pending = createPendingDockviewLayoutAnimation({
            id: 2,
            reason: "split-entering",
            source: "drag",
            previousRects: [],
            capturedAt: 100,
        });

        expect(isPendingDockviewLayoutAnimationReady(pending)).toBe(false);
        const released = markPendingDockviewLayoutAnimationReleased(pending, 2, 260);
        expect(released).not.toBeNull();
        expect(isPendingDockviewLayoutAnimationReady(released!)).toBe(true);
        expect(released?.releasedAt).toBe(260);
    });

    it("should ignore stale release attempts from older captures", () => {
        const newerPending = createPendingDockviewLayoutAnimation({
            id: 5,
            reason: "split-entering",
            source: "drag",
            previousRects: [],
            capturedAt: 200,
        });

        const result = markPendingDockviewLayoutAnimationReleased(newerPending, 4, 260);
        expect(result).toBe(newerPending);
        expect(result?.releasedAt).toBeNull();
    });

    it("should not expire a drag capture before release even if drag time is long", () => {
        const pending = createPendingDockviewLayoutAnimation({
            id: 7,
            reason: "split-entering",
            source: "drag",
            previousRects: [],
            capturedAt: 100,
        });

        expect(hasPendingDockviewLayoutAnimationExpired(pending, 1100, 500)).toBe(false);

        const released = markPendingDockviewLayoutAnimationReleased(pending, 7, 1200)!;
        expect(hasPendingDockviewLayoutAnimationExpired(released, 1400, 500)).toBe(false);
        expect(hasPendingDockviewLayoutAnimationExpired(released, 1805, 500)).toBe(true);
    });
});