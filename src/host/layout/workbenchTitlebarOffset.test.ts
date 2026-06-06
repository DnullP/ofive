/**
 * @module host/layout/workbenchTitlebarOffset.test
 * @description Regression tests for macOS titlebar offset sync avoiding resize hot-path attribute churn.
 */

import { describe, expect, test } from "bun:test";
import {
    syncWorkbenchTitlebarOffsetTarget,
    WORKBENCH_MAC_LEFT_TITLEBAR_OFFSET,
    WORKBENCH_TITLEBAR_OFFSET_ATTR,
} from "./workbenchTitlebarOffset";

function createStripStub(rect: { top: number; left: number; width: number; height: number }): HTMLElement & {
    setCount: number;
    removeCount: number;
} {
    const attrs = new Map<string, string>();
    return {
        setCount: 0,
        removeCount: 0,
        getBoundingClientRect: () => rect as DOMRect,
        getAttribute: (name: string) => attrs.get(name) ?? null,
        hasAttribute: (name: string) => attrs.has(name),
        setAttribute(name: string, value: string): void {
            this.setCount += 1;
            attrs.set(name, value);
        },
        removeAttribute(name: string): void {
            this.removeCount += 1;
            attrs.delete(name);
        },
    } as HTMLElement & { setCount: number; removeCount: number };
}

function createRootStub(strips: HTMLElement[]): HTMLElement {
    return {
        querySelectorAll(selector: string): HTMLElement[] {
            return selector === ".layout-v2-tab-section__strip" ? strips : [];
        },
    } as unknown as HTMLElement;
}

describe("syncWorkbenchTitlebarOffsetTarget", () => {
    test("marks the top-left visible tab strip", () => {
        const first = createStripStub({ top: 40, left: 20, width: 200, height: 38 });
        const second = createStripStub({ top: 10, left: 80, width: 200, height: 38 });
        const third = createStripStub({ top: 10, left: 24, width: 200, height: 38 });

        syncWorkbenchTitlebarOffsetTarget(createRootStub([first, second, third]));

        expect(first.getAttribute(WORKBENCH_TITLEBAR_OFFSET_ATTR)).toBeNull();
        expect(second.getAttribute(WORKBENCH_TITLEBAR_OFFSET_ATTR)).toBeNull();
        expect(third.getAttribute(WORKBENCH_TITLEBAR_OFFSET_ATTR)).toBe(WORKBENCH_MAC_LEFT_TITLEBAR_OFFSET);
    });

    test("does not rewrite attributes when the target is unchanged during resize", () => {
        const first = createStripStub({ top: 10, left: 24, width: 200, height: 38 });
        const second = createStripStub({ top: 10, left: 280, width: 200, height: 38 });
        const root = createRootStub([first, second]);

        syncWorkbenchTitlebarOffsetTarget(root);
        syncWorkbenchTitlebarOffsetTarget(root);

        expect(first.getAttribute(WORKBENCH_TITLEBAR_OFFSET_ATTR)).toBe(WORKBENCH_MAC_LEFT_TITLEBAR_OFFSET);
        expect(first.setCount).toBe(1);
        expect(first.removeCount).toBe(0);
        expect(second.setCount).toBe(0);
        expect(second.removeCount).toBe(0);
    });
});
