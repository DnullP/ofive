/**
 * @module plugins/markdown-codemirror/editor/markdownTableWheelForwarding.test
 * @description Markdown 表格内部滚轮转发的帧级合并回归测试。
 */

import { describe, expect, test } from "bun:test";
import {
    MarkdownTableWheelForwarder,
    resolveMarkdownTableEditorWheelDeltaY,
} from "./markdownTableWheelForwarding";

interface TestWheelEvent {
    defaultPrevented: boolean;
    deltaX: number;
    deltaY: number;
    deltaMode: number;
    ctrlKey: boolean;
    shiftKey: boolean;
    preventDefault(): void;
}

function createWheelEvent(overrides: Partial<TestWheelEvent> = {}): TestWheelEvent {
    return {
        defaultPrevented: false,
        deltaX: 0,
        deltaY: 4,
        deltaMode: 0,
        ctrlKey: false,
        shiftKey: false,
        preventDefault(): void {
            this.defaultPrevented = true;
        },
        ...overrides,
    };
}

function createForwarderHarness(): {
    scrollTarget: {
        scrollTop: number;
        scrollHeight: number;
        clientHeight: number;
        dispatchEvent(event: Event): boolean;
    };
    dispatchedScrollEvents: Event[];
    forwarder: MarkdownTableWheelForwarder;
    scheduledFrameCount(): number;
    flushNextFrame(): void;
} {
    const frameCallbacks = new Map<number, FrameRequestCallback>();
    const dispatchedScrollEvents: Event[] = [];
    let nextFrameId = 1;
    const scrollTarget = {
        scrollTop: 0,
        scrollHeight: 10_000,
        clientHeight: 500,
        dispatchEvent(event: Event): boolean {
            dispatchedScrollEvents.push(event);
            return true;
        },
    };
    const forwarder = new MarkdownTableWheelForwarder({
        scrollTarget,
        getLineHeight: () => 20,
        getPageHeight: () => scrollTarget.clientHeight,
        isAlive: () => true,
        requestFrame: (callback) => {
            const frameId = nextFrameId;
            nextFrameId += 1;
            frameCallbacks.set(frameId, callback);
            return frameId;
        },
        cancelFrame: (frameId) => {
            frameCallbacks.delete(frameId);
        },
        createScrollEvent: () => new Event("scroll"),
    });

    return {
        scrollTarget,
        dispatchedScrollEvents,
        forwarder,
        scheduledFrameCount: () => frameCallbacks.size,
        flushNextFrame: () => {
            const entry = frameCallbacks.entries().next().value as
                | [number, FrameRequestCallback]
                | undefined;
            if (entry === undefined) {
                throw new Error("No frame scheduled");
            }
            const [frameId, callback] = entry;
            frameCallbacks.delete(frameId);
            callback(16);
        },
    };
}

describe("MarkdownTableWheelForwarder", () => {
    test("妙控板式高频小 wheel 应合并到单个动画帧再更新主编辑器滚动", () => {
        const harness = createForwarderHarness();
        const wheelEvents = Array.from({ length: 120 }, () => createWheelEvent({ deltaY: 4 }));

        for (const wheelEvent of wheelEvents) {
            expect(harness.forwarder.handleWheel(wheelEvent)).toBe(true);
            expect(wheelEvent.defaultPrevented).toBe(true);
        }

        expect(harness.scrollTarget.scrollTop).toBe(0);
        expect(harness.dispatchedScrollEvents).toHaveLength(0);
        expect(harness.scheduledFrameCount()).toBe(1);

        harness.flushNextFrame();

        expect(harness.scrollTarget.scrollTop).toBe(480);
        expect(harness.dispatchedScrollEvents).toHaveLength(1);
    });

    test("横向滚动、Shift 横滚和 Ctrl 缩放手势不转发给主编辑器", () => {
        const harness = createForwarderHarness();
        const events = [
            createWheelEvent({ deltaX: 40, deltaY: 8 }),
            createWheelEvent({ deltaY: 40, shiftKey: true }),
            createWheelEvent({ deltaY: 40, ctrlKey: true }),
        ];

        for (const wheelEvent of events) {
            expect(harness.forwarder.handleWheel(wheelEvent)).toBe(false);
            expect(wheelEvent.defaultPrevented).toBe(false);
        }

        expect(harness.scheduledFrameCount()).toBe(0);
        expect(harness.scrollTarget.scrollTop).toBe(0);
    });
});

describe("resolveMarkdownTableEditorWheelDeltaY", () => {
    test("非像素 wheel delta 应按行高或视口高度归一化", () => {
        expect(resolveMarkdownTableEditorWheelDeltaY({
            deltaX: 0,
            deltaY: 3,
            deltaMode: 1,
            lineHeight: 20,
            pageHeight: 600,
        })).toBe(60);

        expect(resolveMarkdownTableEditorWheelDeltaY({
            deltaX: 0,
            deltaY: 1,
            deltaMode: 2,
            lineHeight: 20,
            pageHeight: 480,
        })).toBe(480);
    });
});
