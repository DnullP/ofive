/**
 * @module plugins/markdown-codemirror/editor/MarkdownReadView.test
 * @description 阅读态 WikiLink 预览边界测试：验证鼠标在锚点与预览内部移动时不会误触发关闭。
 * @dependencies
 *  - bun:test
 *  - ./MarkdownReadView
 */

import { describe, expect, it } from "bun:test";

import { shouldKeepReadModeWikiLinkPreviewHovered } from "./MarkdownReadView";

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