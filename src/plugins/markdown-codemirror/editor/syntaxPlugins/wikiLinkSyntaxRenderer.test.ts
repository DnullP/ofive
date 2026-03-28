/**
 * @module plugins/markdown-codemirror/editor/syntaxPlugins/wikiLinkSyntaxRenderer.test
 * @description WikiLink 解析测试：覆盖普通链接、别名链接与非法输入，确保别名显示文本稳定。
 * @dependencies
 *  - bun:test
 *  - ./wikiLinkSyntaxRenderer
 *
 * @example
 *   bun test src/plugins/markdown-codemirror/editor/syntaxPlugins/wikiLinkSyntaxRenderer.test.ts
 */

import { describe, expect, it } from "bun:test";
import { parseWikiLinkParts } from "./wikiLinkParser";

describe("parseWikiLinkParts", () => {
    it("should use target as display text when alias is absent", () => {
        expect(parseWikiLinkParts("Network Segment")).toEqual({
            target: "Network Segment",
            displayText: "Network Segment",
            hasExplicitDisplayText: false,
        });
    });

    it("should expose alias as display text when explicit alias exists", () => {
        expect(parseWikiLinkParts("Network Segment|网段")).toEqual({
            target: "Network Segment",
            displayText: "网段",
            hasExplicitDisplayText: true,
        });
    });

    it("should preserve additional pipes inside alias text", () => {
        expect(parseWikiLinkParts("Network Segment|A|B")).toEqual({
            target: "Network Segment",
            displayText: "A|B",
            hasExplicitDisplayText: true,
        });
    });

    it("should reject wikilinks whose target is empty", () => {
        expect(parseWikiLinkParts("|网段")).toBeNull();
        expect(parseWikiLinkParts("   ")).toBeNull();
    });
});