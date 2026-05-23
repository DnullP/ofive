/**
 * @module plugins/markdown-codemirror/editor/MarkdownReadView.test
 * @description 阅读态 WikiLink 预览边界测试：验证鼠标在锚点与预览内部移动时不会误触发关闭。
 * @dependencies
 *  - bun:test
 *  - ./MarkdownReadView
 */

import { describe, expect, it } from "bun:test";

import {
    revealMarkdownReadViewLine,
    shouldKeepReadModeWikiLinkPreviewHovered,
} from "./MarkdownReadView";

describe("shouldKeepReadModeWikiLinkPreviewHovered", () => {
    it("鼠标从锚点移入 preview 时应继续保活", () => {
        expect(shouldKeepReadModeWikiLinkPreviewHovered(true, false)).toBe(true);
    });

    it("relatedTarget 丢失但指针仍在 preview 盒模型内时应继续保活", () => {
        expect(shouldKeepReadModeWikiLinkPreviewHovered(false, true)).toBe(true);
    });

    it("鼠标真正离开 preview 链路时应允许关闭", () => {
        expect(shouldKeepReadModeWikiLinkPreviewHovered(false, false)).toBe(false);
    });
});

describe("revealMarkdownReadViewLine", () => {
    it("默认将阅读态目标块对齐到顶部，保持历史 reveal 行为", () => {
        let capturedOptions: ScrollIntoViewOptions | undefined;
        const target = {
            dataset: { sourceLine: "12" },
            scrollIntoView: (options?: boolean | ScrollIntoViewOptions) => {
                capturedOptions = options as ScrollIntoViewOptions;
            },
        } as unknown as HTMLElement;
        const root = {
            classList: { contains: (className: string) => className === "cm-tab-reader" },
            querySelectorAll: () => [target],
        } as unknown as HTMLElement;

        expect(revealMarkdownReadViewLine(root, 12)).toBe(true);
        expect(capturedOptions).toEqual({ block: "start", inline: "nearest" });
    });

    it("支持将阅读态目标块尽量对齐到视口中间", () => {
        let capturedOptions: ScrollIntoViewOptions | undefined;
        const target = {
            dataset: { sourceLine: "48" },
            scrollIntoView: (options?: boolean | ScrollIntoViewOptions) => {
                capturedOptions = options as ScrollIntoViewOptions;
            },
        } as unknown as HTMLElement;
        const root = {
            classList: { contains: (className: string) => className === "cm-tab-reader" },
            querySelectorAll: () => [target],
        } as unknown as HTMLElement;

        expect(revealMarkdownReadViewLine(root, 48, { block: "center" })).toBe(true);
        expect(capturedOptions).toEqual({ block: "center", inline: "nearest" });
    });
});
