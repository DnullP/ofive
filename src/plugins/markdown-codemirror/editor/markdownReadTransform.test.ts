/**
 * @module plugins/markdown-codemirror/editor/markdownReadTransform.test
 * @description markdownReadTransform 模块单元测试。
 * @dependencies
 *  - bun:test
 *  - ./markdownReadTransform
 */

import { describe, expect, test } from "bun:test";
import {
    decodeReadModeBlockLatexHref,
    decodeReadModeHighlightHref,
    decodeReadModeInlineLatexHref,
    decodeReadModeMediaEmbedHref,
    decodeReadModeTagHref,
    decodeReadModeWikiLinkHref,
    prepareMarkdownForReadMode,
    transformMarkdownForReadMode,
} from "./markdownReadTransform";

describe("markdownReadTransform", () => {
    test("should transform simple wiki links into markdown links", () => {
        expect(transformMarkdownForReadMode("See [[Note]].")).toBe(
            "See [Note](/__ofive_wikilink__/Note).",
        );
    });

    test("should preserve alias text when transforming wiki links", () => {
        expect(transformMarkdownForReadMode("See [[Note|Alias]].")).toBe(
            "See [Alias](/__ofive_wikilink__/Note).",
        );
    });

    test("should transform image embeds into read mode media protocols", () => {
        expect(transformMarkdownForReadMode("![[Images/demo.png]]")).toBe(
            "![demo.png](/__ofive_media_embed__/Images%2Fdemo.png)",
        );
    });

    test("should extract frontmatter and transform enhanced inline syntax", () => {
        const prepared = prepareMarkdownForReadMode("---\ntitle: Demo\ntags:\n  - alpha\n  - beta\n---\n\n==mark== #tag $E=mc^2$");

        expect(prepared.hasFrontmatter).toBe(true);
        expect(prepared.frontmatter).toEqual([
            { key: "title", value: "Demo" },
            { key: "tags", value: "alpha, beta" },
        ]);
        expect(prepared.renderedMarkdown).toBe(
            "\n[mark](/__ofive_highlight__/mark) [#tag](/__ofive_tag__/tag) [$E=mc^2$](/__ofive_inline_latex__/E%3Dmc%5E2)",
        );
    });

    test("should convert block latex into a dedicated read mode protocol", () => {
        const prepared = prepareMarkdownForReadMode("Before\n\n$$\na+b\n$$\n\nAfter");

        expect(prepared.renderedMarkdown).toBe(
            "Before\n\n[LaTeX](/__ofive_block_latex__/a%2Bb)\n\nAfter",
        );
    });

    test("should convert single-line block latex into a dedicated read mode protocol", () => {
        const prepared = prepareMarkdownForReadMode("Before\n\n$$a+b$$\n\nAfter");

        expect(prepared.renderedMarkdown).toBe(
            "Before\n\n[LaTeX](/__ofive_block_latex__/a%2Bb)\n\nAfter",
        );
    });

    test("should isolate block latex into its own paragraph when adjacent text has no blank lines", () => {
        const prepared = prepareMarkdownForReadMode("Before\n$$a+b$$\nAfter");

        expect(prepared.renderedMarkdown).toBe(
            "Before\n\n[LaTeX](/__ofive_block_latex__/a%2Bb)\n\nAfter",
        );
    });

    test("should decode read mode wikilink href", () => {
        expect(decodeReadModeWikiLinkHref("/__ofive_wikilink__/Note%2FChild")).toBe("Note/Child");
        expect(decodeReadModeWikiLinkHref("ofive-wikilink://Note%2FChild")).toBe("Note/Child");
        expect(decodeReadModeWikiLinkHref("https://example.com")).toBeNull();
    });

    test("should decode read mode custom protocols", () => {
        expect(decodeReadModeMediaEmbedHref("/__ofive_media_embed__/Images%2Fdemo.png")).toBe("Images/demo.png");
        expect(decodeReadModeHighlightHref("/__ofive_highlight__/mark")).toBe("mark");
        expect(decodeReadModeTagHref("/__ofive_tag__/topic")).toBe("topic");
        expect(decodeReadModeInlineLatexHref("/__ofive_inline_latex__/E%3Dmc%5E2")).toBe("E=mc^2");
        expect(decodeReadModeBlockLatexHref("/__ofive_block_latex__/a%2Bb")).toBe("a+b");
    });
});