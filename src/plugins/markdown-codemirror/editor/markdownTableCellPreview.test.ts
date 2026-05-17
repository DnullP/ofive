/**
 * @module plugins/markdown-codemirror/editor/markdownTableCellPreview.test
 * @description Markdown 表格单元格预览预处理单元测试。
 * @dependencies
 *  - bun:test
 *  - ./markdownTableCellPreview
 */

import { describe, expect, test } from "bun:test";
import {
    normalizeMarkdownTableCellPreviewSource,
    prepareMarkdownTableCellPreviewMarkdown,
} from "./markdownTableCellPreview";

describe("markdownTableCellPreview", () => {
    test("should restore escaped table pipes before wikilink transformation", () => {
        expect(normalizeMarkdownTableCellPreviewSource("[[guide\\|Guide Alias]]")).toBe(
            "[[guide|Guide Alias]]",
        );

        expect(prepareMarkdownTableCellPreviewMarkdown("[[guide\\|Guide Alias]]")).toBe(
            "[Guide Alias](/__ofive_wikilink__/guide)",
        );
    });

    test("should reuse read-mode enhanced inline syntax transformation", () => {
        expect(prepareMarkdownTableCellPreviewMarkdown("**bold** ==mark== $E=mc^2$ #topic")).toBe(
            "**bold** [mark](/__ofive_highlight__/mark) [$E=mc^2$](/__ofive_inline_latex__/E%3Dmc%5E2) [#topic](/__ofive_tag__/topic)",
        );
    });
});
