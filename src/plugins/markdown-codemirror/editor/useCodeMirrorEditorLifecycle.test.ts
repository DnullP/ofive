/**
 * @module plugins/markdown-codemirror/editor/useCodeMirrorEditorLifecycle.test
 * @description CodeMirror 生命周期辅助函数测试：覆盖 gutter 对齐补偿与安全销毁行为。
 * @dependencies
 *  - bun:test
 *  - ./useCodeMirrorEditorLifecycle
 *
 * @example
 *   bun test src/plugins/markdown-codemirror/editor/useCodeMirrorEditorLifecycle.test.ts
 *
 * @exports
 *  - 无
 */

import { describe, expect, test } from "bun:test";
import {
    safeDestroyEditorView,
    shouldFlushEditorAutoSaveOnBlur,
    syncEditorTabGutterWidth,
} from "./useCodeMirrorEditorLifecycle";

/**
 * @function createStyleRecorder
 * @description 创建一个可记录 CSS 变量写入的最小 style 桩。
 * @returns style 桩与写入记录读取器。
 */
function createStyleRecorder(): {
    style: { setProperty(name: string, value: string): void; getPropertyValue(name: string): string };
} {
    const values = new Map<string, string>();
    return {
        style: {
            setProperty(name: string, value: string): void {
                values.set(name, value);
            },
            getPropertyValue(name: string): string {
                return values.get(name) ?? "";
            },
        },
    };
}

describe("syncEditorTabGutterWidth", () => {
    test("clears gutter offset when not in edit mode", () => {
        const tabRoot = createStyleRecorder() as unknown as HTMLDivElement;

        syncEditorTabGutterWidth({
            tabRoot,
            view: null,
            displayMode: "read",
        });

        expect(tabRoot.style.getPropertyValue("--cm-tab-gutter-width")).toBe("0px");
    });

    test("writes measured gutter width for edit mode", () => {
        const tabRoot = createStyleRecorder() as unknown as HTMLDivElement;
        const gutterElement = {
            getBoundingClientRect(): DOMRect {
                return { width: 42.375 } as DOMRect;
            },
        };
        const view = {
            dom: {
                querySelector(selector: string): unknown {
                    return selector === ".cm-gutters" ? gutterElement : null;
                },
            },
        } as unknown as { dom: { querySelector(selector: string): unknown } };

        syncEditorTabGutterWidth({
            tabRoot,
            view: view as never,
            displayMode: "edit",
        });

        expect(tabRoot.style.getPropertyValue("--cm-tab-gutter-width")).toBe("42.38px");
    });
});

describe("safeDestroyEditorView", () => {
    test("neutralizes measure loop entry points after destroy", () => {
        const cancelledFrames: number[] = [];
        const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;
        globalThis.cancelAnimationFrame = (handle: number): void => {
            cancelledFrames.push(handle);
        };

        let destroyCalled = false;

        const view = {
            measureScheduled: 19,
            destroy(): void {
                destroyCalled = true;
            },
            requestMeasure(): void {
                throw new Error("should be replaced");
            },
            measure(): void {
                throw new Error("should be replaced");
            },
            dispatch(): void {
                throw new Error("should be replaced");
            },
            update(): void {
                throw new Error("should be replaced");
            },
        } as unknown as {
            measureScheduled: number;
            destroy(): void;
            requestMeasure(): void;
            measure(): void;
            dispatch(): void;
            update(): void;
            destroyed?: boolean;
        };

        try {
            safeDestroyEditorView(view as never);

            expect(destroyCalled).toBe(true);
            expect(cancelledFrames).toEqual([19]);
            expect(view.measureScheduled).toBe(-1);
            expect(view.destroyed).toBe(true);
            expect(() => view.requestMeasure()).not.toThrow();
            expect(() => view.measure()).not.toThrow();
            expect(() => view.dispatch()).not.toThrow();
            expect(() => view.update()).not.toThrow();
        } finally {
            globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
        }
    });
});

describe("shouldFlushEditorAutoSaveOnBlur", () => {
    test("IME 组合期间不应立即 flush autosave", () => {
        expect(shouldFlushEditorAutoSaveOnBlur({
            isComposing: true,
            lastCompositionEndAt: 0,
            now: 100,
        })).toBe(false);
    });

    test("组合刚结束的短窗口内不应立即 flush autosave", () => {
        expect(shouldFlushEditorAutoSaveOnBlur({
            isComposing: false,
            lastCompositionEndAt: 100,
            now: 120,
        })).toBe(false);
    });

    test("组合稳定结束后允许 flush autosave", () => {
        expect(shouldFlushEditorAutoSaveOnBlur({
            isComposing: false,
            lastCompositionEndAt: 100,
            now: 200,
        })).toBe(true);
    });
});