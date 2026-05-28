/**
 * @module plugins/markdown-codemirror/editor/markdownTableWheelForwarding
 * @description Markdown 表格内部滚轮事件转发到 CodeMirror scroller 的帧级合并器。
 */

const WHEEL_DELTA_LINE_MODE = 1;
const WHEEL_DELTA_PAGE_MODE = 2;

export interface MarkdownTableEditorWheelDeltaOptions {
    deltaX: number;
    deltaY: number;
    deltaMode: number;
    lineHeight: number;
    pageHeight: number;
    ctrlKey?: boolean;
    shiftKey?: boolean;
}

interface MarkdownTableWheelEventLike {
    defaultPrevented: boolean;
    deltaX: number;
    deltaY: number;
    deltaMode: number;
    ctrlKey: boolean;
    shiftKey: boolean;
    preventDefault(): void;
}

interface MarkdownTableScrollTarget {
    scrollTop: number;
    scrollHeight: number;
    clientHeight: number;
    dispatchEvent(event: Event): boolean;
}

interface MarkdownTableWheelForwarderOptions {
    scrollTarget: MarkdownTableScrollTarget;
    getLineHeight(): number;
    getPageHeight(): number;
    isAlive(): boolean;
    requestFrame(callback: FrameRequestCallback): number;
    cancelFrame(frameId: number): void;
    createScrollEvent(): Event;
}

export function clampMarkdownTableForwardedScrollTop(
    scrollTarget: Pick<MarkdownTableScrollTarget, "scrollHeight" | "clientHeight">,
    nextScrollTop: number,
): number {
    const maxScrollTop = Math.max(0, scrollTarget.scrollHeight - scrollTarget.clientHeight);
    return Math.max(0, Math.min(maxScrollTop, nextScrollTop));
}

function shouldForwardMarkdownTableWheelToEditor(
    options: Pick<MarkdownTableEditorWheelDeltaOptions, "deltaX" | "deltaY" | "ctrlKey" | "shiftKey">,
): boolean {
    if (options.ctrlKey || options.shiftKey) {
        return false;
    }

    return Math.abs(options.deltaY) > Math.abs(options.deltaX);
}

export function resolveMarkdownTableEditorWheelDeltaY(
    options: MarkdownTableEditorWheelDeltaOptions,
): number {
    if (!shouldForwardMarkdownTableWheelToEditor(options)) {
        return 0;
    }

    if (options.deltaMode === WHEEL_DELTA_LINE_MODE) {
        return options.deltaY * Math.max(1, options.lineHeight);
    }

    if (options.deltaMode === WHEEL_DELTA_PAGE_MODE) {
        return options.deltaY * Math.max(1, options.pageHeight);
    }

    return options.deltaY;
}

export class MarkdownTableWheelForwarder {
    private pendingDeltaY = 0;
    private frameId: number | null = null;

    constructor(private readonly options: MarkdownTableWheelForwarderOptions) {}

    handleWheel(event: MarkdownTableWheelEventLike): boolean {
        if (event.defaultPrevented || !this.options.isAlive()) {
            return false;
        }

        const deltaY = resolveMarkdownTableEditorWheelDeltaY({
            deltaX: event.deltaX,
            deltaY: event.deltaY,
            deltaMode: event.deltaMode,
            lineHeight: this.options.getLineHeight(),
            pageHeight: this.options.getPageHeight(),
            ctrlKey: event.ctrlKey,
            shiftKey: event.shiftKey,
        });
        if (deltaY === 0) {
            return false;
        }

        const scrollTarget = this.options.scrollTarget;
        const nextScrollTop = clampMarkdownTableForwardedScrollTop(
            scrollTarget,
            scrollTarget.scrollTop + this.pendingDeltaY + deltaY,
        );
        if (nextScrollTop === scrollTarget.scrollTop && this.pendingDeltaY === 0) {
            return false;
        }

        event.preventDefault();
        this.pendingDeltaY += deltaY;
        this.scheduleFlush();
        return true;
    }

    flush(): void {
        this.frameId = null;
        if (!this.options.isAlive()) {
            this.pendingDeltaY = 0;
            return;
        }

        const scrollTarget = this.options.scrollTarget;
        const nextScrollTop = clampMarkdownTableForwardedScrollTop(
            scrollTarget,
            scrollTarget.scrollTop + this.pendingDeltaY,
        );
        this.pendingDeltaY = 0;
        if (nextScrollTop === scrollTarget.scrollTop) {
            return;
        }

        scrollTarget.scrollTop = nextScrollTop;
        scrollTarget.dispatchEvent(this.options.createScrollEvent());
    }

    destroy(): void {
        if (this.frameId !== null) {
            this.options.cancelFrame(this.frameId);
            this.frameId = null;
        }
        this.pendingDeltaY = 0;
    }

    private scheduleFlush(): void {
        if (this.frameId !== null) {
            return;
        }

        this.frameId = this.options.requestFrame(() => {
            this.flush();
        });
    }
}
