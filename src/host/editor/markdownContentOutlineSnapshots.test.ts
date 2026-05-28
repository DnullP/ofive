/**
 * @module host/editor/markdownContentOutlineSnapshots.test
 * @description canonical Markdown 内容派生大纲测试。
 * @dependencies
 *  - bun:test
 *  - ./editorContextStore
 *  - ./markdownContentOutlineSnapshots
 */

import { describe, expect, it } from "bun:test";
import { reportArticleContent, resetEditorContext } from "./editorContextStore";
import {
    getMarkdownContentOutlineSnapshot,
    overlayMarkdownContentOutlineSnapshot,
} from "./markdownContentOutlineSnapshots";

describe("markdownContentOutlineSnapshots", () => {
    it("should derive outline headings from canonical editor content", () => {
        resetEditorContext();

        reportArticleContent({
            articleId: "file:notes/outline.md#view-2",
            path: "notes/outline.md",
            content: [
                "---",
                "title: Hidden",
                "---",
                "# Visible",
                "```md",
                "## Hidden in code",
                "```",
                "## Also visible",
            ].join("\n"),
        });

        expect(getMarkdownContentOutlineSnapshot("notes/outline.md")?.headings).toEqual([
            { level: 1, text: "Visible", line: 4 },
            { level: 2, text: "Also visible", line: 8 },
        ]);
    });

    it("should replace persisted outline when the same path has canonical content", () => {
        resetEditorContext();

        reportArticleContent({
            articleId: "file:notes/live.md",
            path: "notes/live.md",
            content: "# Fresh",
        });

        expect(overlayMarkdownContentOutlineSnapshot({
            relativePath: "notes/live.md",
            headings: [{ level: 1, text: "Stale", line: 1 }],
        })).toEqual({
            relativePath: "notes/live.md",
            headings: [{ level: 1, text: "Fresh", line: 1 }],
        });
    });
});
