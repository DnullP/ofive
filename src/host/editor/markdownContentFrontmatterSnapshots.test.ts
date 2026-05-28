/**
 * @module host/editor/markdownContentFrontmatterSnapshots.test
 * @description canonical Markdown 内容派生 frontmatter 查询测试。
 * @dependencies
 *  - bun:test
 *  - ./editorContextStore
 *  - ./markdownContentFrontmatterSnapshots
 */

import { describe, expect, it } from "bun:test";
import { reportArticleContent, resetEditorContext } from "./editorContextStore";
import { overlayMarkdownContentFrontmatterMatches } from "./markdownContentFrontmatterSnapshots";

describe("overlayMarkdownContentFrontmatterMatches", () => {
    it("should replace persisted frontmatter matches with canonical editor content", () => {
        resetEditorContext();

        reportArticleContent({
            articleId: "file:notes/day.md#view-2",
            path: "notes/day.md",
            content: [
                "---",
                "title: Live Day",
                "date: 2026-03-25",
                "---",
                "# Body",
            ].join("\n"),
        });

        const matches = overlayMarkdownContentFrontmatterMatches([
            {
                relativePath: "notes/day.md",
                title: "Stale Day",
                matchedFieldName: "date",
                matchedFieldValues: ["2026-03-24"],
                frontmatter: { title: "Stale Day", date: "2026-03-24" },
            },
            {
                relativePath: "notes/other.md",
                title: "Other",
                matchedFieldName: "date",
                matchedFieldValues: ["2026-03-24"],
                frontmatter: { date: "2026-03-24" },
            },
        ], { fieldName: "date" });

        expect(matches.map((match) => `${match.relativePath}:${match.title}:${match.matchedFieldValues.join(",")}`)).toEqual([
            "notes/day.md:Live Day:2026-03-25",
            "notes/other.md:Other:2026-03-24",
        ]);
    });

    it("should remove stale persisted matches when canonical content no longer has the field", () => {
        resetEditorContext();

        reportArticleContent({
            articleId: "file:notes/removed.md",
            path: "notes/removed.md",
            content: [
                "---",
                "title: Removed",
                "---",
                "# Body",
            ].join("\n"),
        });

        expect(overlayMarkdownContentFrontmatterMatches([
            {
                relativePath: "notes/removed.md",
                title: "Removed",
                matchedFieldName: "date",
                matchedFieldValues: ["2026-03-24"],
                frontmatter: { date: "2026-03-24" },
            },
        ], { fieldName: "date" })).toEqual([]);
    });
});
