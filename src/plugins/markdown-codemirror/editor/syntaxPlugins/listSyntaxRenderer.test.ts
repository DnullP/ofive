/**
 * @module plugins/markdown-codemirror/editor/syntaxPlugins/listSyntaxRenderer.test
 * @description Markdown 列表语法解析测试：覆盖无序列表、有序列表、task list 与非列表场景。
 */

import { describe, expect, test } from "bun:test";
import { detectMarkdownListLine } from "./listSyntaxRenderer";

describe("detectMarkdownListLine", () => {
    test("识别无序列表并返回 marker 与内容区边界", () => {
        const match = detectMarkdownListLine("  - item");

        expect(match).toEqual({
            kind: "unordered",
            indentText: "  ",
            markerText: "-",
            markerStart: 2,
            contentStart: 4,
            taskState: null,
        });
    });

    test("识别有序列表并保留完整数字 marker", () => {
        const match = detectMarkdownListLine("   12. ordered item");

        expect(match).toEqual({
            kind: "ordered",
            indentText: "   ",
            markerText: "12.",
            markerStart: 3,
            contentStart: 7,
            taskState: null,
        });
    });

    test("识别已勾选 task list", () => {
        const match = detectMarkdownListLine("    - [x] done");

        expect(match).toEqual({
            kind: "task",
            indentText: "    ",
            markerText: "-",
            markerStart: 4,
            contentStart: 10,
            taskState: "checked",
        });
    });

    test("识别未勾选的有序 task list", () => {
        const match = detectMarkdownListLine("1) [ ] pending");

        expect(match).toEqual({
            kind: "task",
            indentText: "",
            markerText: "1)",
            markerStart: 0,
            contentStart: 7,
            taskState: "unchecked",
        });
    });

    test("非列表行返回 null", () => {
        expect(detectMarkdownListLine("> - quoted item")).toBeNull();
        expect(detectMarkdownListLine("---")).toBeNull();
        expect(detectMarkdownListLine("plain paragraph")).toBeNull();
        expect(detectMarkdownListLine("- ")).toBeNull();
    });
});