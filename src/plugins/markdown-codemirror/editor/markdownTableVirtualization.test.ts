/**
 * @module plugins/markdown-codemirror/editor/markdownTableVirtualization.test
 * @description Markdown 表格千级行虚拟化策略测试。
 */

import { describe, expect, test } from "bun:test";
import {
    resolveMarkdownTableVirtualRange,
    shouldVirtualizeMarkdownTableRows,
} from "./markdownTableVirtualization";

describe("markdown table virtualization", () => {
    test("小表格不启用行虚拟化，避免损伤完整 DOM 交互", () => {
        expect(shouldVirtualizeMarkdownTableRows(40)).toBe(false);
        const range = resolveMarkdownTableVirtualRange({
            rowCount: 40,
            rowHeights: Array.from({ length: 40 }, () => 38),
            viewportTop: 0,
            viewportBottom: 600,
        });

        expect(range).toMatchObject({
            enabled: false,
            startIndex: 0,
            endIndex: 40,
            beforeHeight: 0,
            afterHeight: 0,
        });
    });

    test("千级表格只渲染视口附近的行，并保留上下占位高度", () => {
        const range = resolveMarkdownTableVirtualRange({
            rowCount: 1000,
            rowHeights: Array.from({ length: 1000 }, () => 38),
            viewportTop: 38 * 500,
            viewportBottom: 38 * 520,
            overscanRows: 8,
        });

        expect(range.enabled).toBe(true);
        expect(range.startIndex).toBe(492);
        expect(range.endIndex).toBe(529);
        expect(range.endIndex - range.startIndex).toBeLessThan(50);
        expect(range.beforeHeight).toBe(492 * 38);
        expect(range.afterHeight).toBe((1000 - 529) * 38);
    });
});
