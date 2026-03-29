/**
 * @module plugins/markdown-codemirror/editor/markdownReadTransform.test
 * @description markdownReadTransform 模块单元测试。
 * @dependencies
 *  - bun:test
 *  - ./markdownReadTransform
 */

import { describe, expect, test } from "bun:test";
import {
    decodeReadModeWikiLinkHref,
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

    test("should keep image embed wikilinks untouched", () => {
        expect(transformMarkdownForReadMode("![[Images/demo.png]]")).toBe("![[Images/demo.png]]");
    });

    test("should decode read mode wikilink href", () => {
        expect(decodeReadModeWikiLinkHref("/__ofive_wikilink__/Note%2FChild")).toBe("Note/Child");
        expect(decodeReadModeWikiLinkHref("ofive-wikilink://Note%2FChild")).toBe("Note/Child");
        expect(decodeReadModeWikiLinkHref("https://example.com")).toBeNull();
    });
});