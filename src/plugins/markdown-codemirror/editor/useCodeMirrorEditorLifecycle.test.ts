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
    revealEditorSelection,
    resolveInitialEditorSelection,
    restoreEditorSelectionWithoutScrolling,
    safeDestroyEditorView,
    syncEditorTabGutterWidth,
    updateEditorGutterResizeObserver,
    type EditorGutterResizeObserverState,
} from "./useCodeMirrorEditorLifecycle";

/**
 * @function createStyleRecorder
 * @description 创建一个可记录 CSS 变量写入的最小 style 桩。
 * @returns style 桩与写入记录读取器。
 */
function createStyleRecorder(): {
    style: { setProperty(name: string, value: string): void; getPropertyValue(name: string): string };
    getWriteCount(): number;
} {
    const values = new Map<string, string>();
    let writeCount = 0;
    return {
        style: {
            setProperty(name: string, value: string): void {
                writeCount += 1;
                values.set(name, value);
            },
            getPropertyValue(name: string): string {
                return values.get(name) ?? "";
            },
        },
        getWriteCount(): number {
            return writeCount;
        },
    };
}

describe("syncEditorTabGutterWidth", () => {
    test("skips writes when tab root is missing", () => {
        expect(() => syncEditorTabGutterWidth({
            tabRoot: null,
            view: null,
            displayMode: "read",
        })).not.toThrow();
    });

    test("clears gutter offset when not in edit mode", () => {
        const recorder = createStyleRecorder();
        const tabRoot = recorder as unknown as HTMLDivElement;

        syncEditorTabGutterWidth({
            tabRoot,
            view: null,
            displayMode: "read",
        });

        expect(tabRoot.style.getPropertyValue("--cm-tab-gutter-width")).toBe("0px");
        expect(recorder.getWriteCount()).toBe(1);
    });

    test("writes measured gutter width for edit mode", () => {
        const recorder = createStyleRecorder();
        const tabRoot = recorder as unknown as HTMLDivElement;
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
        expect(recorder.getWriteCount()).toBe(1);
    });

    test("skips duplicate CSS writes when resize does not change gutter width", () => {
        const recorder = createStyleRecorder();
        const tabRoot = recorder as unknown as HTMLDivElement;
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
        syncEditorTabGutterWidth({
            tabRoot,
            view: view as never,
            displayMode: "edit",
        });

        expect(tabRoot.style.getPropertyValue("--cm-tab-gutter-width")).toBe("42.38px");
        expect(recorder.getWriteCount()).toBe(1);
    });
});

describe("updateEditorGutterResizeObserver", () => {
    function createResizeObserverRecorder(): {
        observer: Pick<ResizeObserver, "observe" | "unobserve">;
        observed: HTMLElement[];
        unobserved: HTMLElement[];
    } {
        const observed: HTMLElement[] = [];
        const unobserved: HTMLElement[] = [];
        return {
            observer: {
                observe(element: Element): void {
                    observed.push(element as HTMLElement);
                },
                unobserve(element: Element): void {
                    unobserved.push(element as HTMLElement);
                },
            },
            observed,
            unobserved,
        };
    }

    test("observes a gutter element when live resize is not lightweight", () => {
        const state: EditorGutterResizeObserverState = { observedElement: null, paused: false };
        const gutter = {} as HTMLElement;
        const recorder = createResizeObserverRecorder();

        updateEditorGutterResizeObserver({
            resizeObserver: recorder.observer,
            state,
            nextElement: gutter,
            paused: false,
        });

        expect(state.observedElement).toBe(gutter);
        expect(state.paused).toBe(false);
        expect(recorder.observed).toEqual([gutter]);
        expect(recorder.unobserved).toEqual([]);
    });

    test("unobserves the active gutter while layout lightweight mode is active", () => {
        const gutter = {} as HTMLElement;
        const state: EditorGutterResizeObserverState = { observedElement: gutter, paused: false };
        const recorder = createResizeObserverRecorder();

        updateEditorGutterResizeObserver({
            resizeObserver: recorder.observer,
            state,
            nextElement: gutter,
            paused: true,
        });

        expect(state.observedElement).toBeNull();
        expect(state.paused).toBe(true);
        expect(recorder.observed).toEqual([]);
        expect(recorder.unobserved).toEqual([gutter]);
    });

    test("resumes observation after layout lightweight mode ends", () => {
        const gutter = {} as HTMLElement;
        const state: EditorGutterResizeObserverState = { observedElement: null, paused: true };
        const recorder = createResizeObserverRecorder();

        updateEditorGutterResizeObserver({
            resizeObserver: recorder.observer,
            state,
            nextElement: gutter,
            paused: false,
        });

        expect(state.observedElement).toBe(gutter);
        expect(state.paused).toBe(false);
        expect(recorder.observed).toEqual([gutter]);
        expect(recorder.unobserved).toEqual([]);
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

describe("restoreEditorSelectionWithoutScrolling", () => {
    test("restores selection while preserving the current viewport", () => {
        const dispatchedSelections: Array<{ anchor: number; head: number }> = [];
        const selectionMain = { anchor: 0, head: 0 };
        const scrollDOM = {
            scrollTop: 2800,
            scrollLeft: 24,
        };

        const view = {
            state: {
                selection: {
                    main: selectionMain,
                },
            },
            scrollDOM,
            dispatch(spec: { selection?: { anchor: number; head: number } }): void {
                if (!spec.selection) {
                    return;
                }

                dispatchedSelections.push(spec.selection);
                selectionMain.anchor = spec.selection.anchor;
                selectionMain.head = spec.selection.head;

                // Simulate a browser/editor scroll jump caused by caret restoration.
                scrollDOM.scrollTop = 96;
                scrollDOM.scrollLeft = 0;
            },
        } as unknown as Pick<
            import("codemirror").EditorView,
            "state" | "dispatch" | "scrollDOM"
        >;

        restoreEditorSelectionWithoutScrolling(view, {
            anchor: 12,
            head: 34,
        });

        expect(dispatchedSelections).toEqual([{ anchor: 12, head: 34 }]);
        expect(selectionMain).toEqual({ anchor: 12, head: 34 });
        expect(scrollDOM.scrollTop).toBe(2800);
        expect(scrollDOM.scrollLeft).toBe(24);
    });

    test("skips dispatch when the selection already matches", () => {
        let dispatched = false;
        const view = {
            state: {
                selection: {
                    main: {
                        anchor: 12,
                        head: 34,
                    },
                },
            },
            scrollDOM: {
                scrollTop: 2800,
                scrollLeft: 24,
            },
            dispatch(): void {
                dispatched = true;
            },
        } as unknown as Pick<
            import("codemirror").EditorView,
            "state" | "dispatch" | "scrollDOM"
        >;

        restoreEditorSelectionWithoutScrolling(view, {
            anchor: 12,
            head: 34,
        });

        expect(dispatched).toBe(false);
    });
});

describe("revealEditorSelection", () => {
    test("dispatches an explicit scroll-into-view effect even when selection already matches", () => {
        const dispatched: Array<{
            selection?: { anchor: number; head: number };
            effects?: unknown;
        }> = [];

        const view = {
            state: {
                selection: {
                    main: {
                        anchor: 12,
                        head: 34,
                    },
                },
            },
            dispatch(spec: { selection?: { anchor: number; head: number }; effects?: unknown }): void {
                dispatched.push(spec);
            },
        } as unknown as Pick<
            import("codemirror").EditorView,
            "state" | "dispatch"
        >;

        revealEditorSelection(view, {
            anchor: 12,
            head: 34,
        });

        expect(dispatched).toHaveLength(1);
        expect(dispatched[0]?.selection).toEqual({ anchor: 12, head: 34 });
        expect(dispatched[0]?.effects).toBeTruthy();
    });
});

describe("resolveInitialEditorSelection", () => {
    test("seeds the first open of a frontmatter note at the body anchor", () => {
        const initialDoc = [
            "---",
            "title: Demo",
            "---",
            "# Body",
            "",
        ].join("\n");
        const bodyAnchor = initialDoc.indexOf("# Body");

        expect(resolveInitialEditorSelection({
            initialDoc,
            restoredViewState: null,
            editorTabRestoreMode: "viewport",
            initialCursorOffset: null,
        })).toEqual({
            anchor: bodyAnchor,
            head: bodyAnchor,
        });
    });

    test("prefers an explicit initial cursor offset over the body anchor", () => {
        expect(resolveInitialEditorSelection({
            initialDoc: "---\ntitle: Demo\n---\n# Body\n",
            restoredViewState: null,
            editorTabRestoreMode: "viewport",
            initialCursorOffset: 7,
        })).toEqual({
            anchor: 7,
            head: 7,
        });
    });

    test("prefers an explicit initial cursor offset over restored runtime state", () => {
        expect(resolveInitialEditorSelection({
            initialDoc: "---\ntitle: Demo\n---\n# Body\n",
            restoredViewState: {
                articleId: "file:test.md",
                anchor: 19,
                head: 23,
                scrollTop: 180,
                scrollLeft: 0,
                scrollSnapshot: null,
            },
            editorTabRestoreMode: "viewport",
            initialCursorOffset: 7,
        })).toEqual({
            anchor: 7,
            head: 7,
        });
    });

    test("prefers restored cursor selection in cursor restore mode", () => {
        expect(resolveInitialEditorSelection({
            initialDoc: "---\ntitle: Demo\n---\n# Body\n",
            restoredViewState: {
                articleId: "file:test.md",
                anchor: 19,
                head: 23,
                scrollTop: 180,
                scrollLeft: 0,
                scrollSnapshot: null,
            },
            editorTabRestoreMode: "cursor",
            initialCursorOffset: null,
        })).toEqual({
            anchor: 19,
            head: 23,
        });
    });

    test("seeds restored selection in viewport restore mode without requiring editor focus", () => {
        expect(resolveInitialEditorSelection({
            initialDoc: "---\ntitle: Demo\n---\n# Body\n",
            restoredViewState: {
                articleId: "file:test.md",
                anchor: 19,
                head: 23,
                scrollTop: 180,
                scrollLeft: 0,
                scrollSnapshot: null,
            },
            editorTabRestoreMode: "viewport",
            initialCursorOffset: null,
        })).toEqual({
            anchor: 19,
            head: 23,
        });
    });
});
