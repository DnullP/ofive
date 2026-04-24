import { describe, expect, test } from "bun:test";

import { focusEditorViewPreservingViewport } from "./editorActivationFocus";

describe("focusEditorViewPreservingViewport", () => {
    test("restores the viewport when focus changes scroll immediately", () => {
        let fallbackFocusCalled = false;
        const view = {
            contentDOM: {
                focus(): void {
                    view.scrollDOM.scrollTop = 96;
                    view.scrollDOM.scrollLeft = 8;
                },
            },
            focus(): void {
                fallbackFocusCalled = true;
            },
            scrollDOM: {
                scrollTop: 2800,
                scrollLeft: 24,
            },
        };

        focusEditorViewPreservingViewport(view as never, {
            scheduleFrame: () => {
                // noop
            },
        });

        expect(fallbackFocusCalled).toBe(false);
        expect(view.scrollDOM.scrollTop).toBe(2800);
        expect(view.scrollDOM.scrollLeft).toBe(24);
    });

    test("restores the viewport when scroll changes on a later frame", () => {
        const scheduledFrames: Array<() => void> = [];
        const view = {
            contentDOM: {
                focus(): void {
                    // noop
                },
            },
            focus(): void {
                // noop
            },
            scrollDOM: {
                scrollTop: 2800,
                scrollLeft: 24,
            },
        };

        focusEditorViewPreservingViewport(view as never, {
            restoreFrames: 2,
            scheduleFrame: (callback) => {
                scheduledFrames.push(callback);
            },
        });

        view.scrollDOM.scrollTop = 120;
        view.scrollDOM.scrollLeft = 0;
        scheduledFrames.shift()?.();

        expect(view.scrollDOM.scrollTop).toBe(2800);
        expect(view.scrollDOM.scrollLeft).toBe(24);
        expect(scheduledFrames).toHaveLength(1);
    });

    test("falls back to view.focus when preventScroll focus is unavailable", () => {
        let fallbackFocusCalled = false;
        const view = {
            contentDOM: {
                focus(): never {
                    throw new Error("unsupported");
                },
            },
            focus(): void {
                fallbackFocusCalled = true;
                view.scrollDOM.scrollTop = 160;
            },
            scrollDOM: {
                scrollTop: 2800,
                scrollLeft: 24,
            },
        };

        focusEditorViewPreservingViewport(view as never, {
            scheduleFrame: () => {
                // noop
            },
        });

        expect(fallbackFocusCalled).toBe(true);
        expect(view.scrollDOM.scrollTop).toBe(2800);
        expect(view.scrollDOM.scrollLeft).toBe(24);
    });
});