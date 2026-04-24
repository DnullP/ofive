import type { EditorView } from "codemirror";

interface FocusEditorViewPreservingViewportOptions {
    scheduleFrame?: (callback: () => void) => void;
    restoreFrames?: number;
}

function restoreEditorViewport(
    view: Pick<EditorView, "scrollDOM">,
    preservedScrollTop: number,
    preservedScrollLeft: number,
): void {
    if (
        view.scrollDOM.scrollTop !== preservedScrollTop
        || view.scrollDOM.scrollLeft !== preservedScrollLeft
    ) {
        view.scrollDOM.scrollTop = preservedScrollTop;
        view.scrollDOM.scrollLeft = preservedScrollLeft;
    }
}

export function focusEditorViewPreservingViewport(
    view: Pick<EditorView, "contentDOM" | "focus" | "scrollDOM">,
    options: FocusEditorViewPreservingViewportOptions = {},
): void {
    const preservedScrollTop = view.scrollDOM.scrollTop;
    const preservedScrollLeft = view.scrollDOM.scrollLeft;

    try {
        view.contentDOM.focus({ preventScroll: true });
    } catch {
        view.focus();
    }

    restoreEditorViewport(view, preservedScrollTop, preservedScrollLeft);

    const restoreFrames = Math.max(0, options.restoreFrames ?? 2);
    const scheduleFrame = options.scheduleFrame
        ?? (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function"
            ? (callback: () => void) => {
                window.requestAnimationFrame(() => {
                    callback();
                });
            }
            : null);

    if (!scheduleFrame || restoreFrames === 0) {
        return;
    }

    let remainingFrames = restoreFrames;
    const restoreOnFrame = (): void => {
        restoreEditorViewport(view, preservedScrollTop, preservedScrollLeft);
        remainingFrames -= 1;
        if (remainingFrames > 0) {
            scheduleFrame(restoreOnFrame);
        }
    };

    scheduleFrame(restoreOnFrame);
}