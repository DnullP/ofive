/**
 * @module plugins/markdown-codemirror/editor/syntaxPlugins/markdownTableSyntaxExtension.test
 * @description Markdown 表格 widget 回归测试：确保底层空光标仍停留在表格源码里时，
 *   不会继续隐藏源码并把 selection 留在不可映射位置。
 */

import { describe, expect, test } from "bun:test";
import { shouldKeepMarkdownTableSourceVisible } from "./markdownTableSyntaxExtension";

describe("shouldKeepMarkdownTableSourceVisible", () => {
    test("空光标停留在表格源码范围内时应保留源码可见", () => {
        expect(shouldKeepMarkdownTableSourceVisible(
            { from: 12, to: 48 },
            [{ from: 24, to: 24, empty: true }],
        )).toBe(true);
    });

    test("选区已离开表格源码时应允许 widget 接管", () => {
        expect(shouldKeepMarkdownTableSourceVisible(
            { from: 12, to: 48 },
            [{ from: 60, to: 60, empty: true }],
        )).toBe(false);
    });
});