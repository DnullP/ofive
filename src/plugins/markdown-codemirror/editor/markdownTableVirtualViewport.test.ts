/**
 * @module plugins/markdown-codemirror/editor/markdownTableVirtualViewport.test
 * @description Markdown 表格虚拟窗口滚动几何回归测试。
 */

import { describe, expect, test } from "bun:test";
import {
    resolveMarkdownTableBodyTopInScroller,
    resolveMarkdownTableVirtualViewport,
} from "./markdownTableVirtualViewport";

describe("markdown table virtual viewport", () => {
    test("用 scroller scrollTop 与表格几何计算进入表体后的虚拟窗口", () => {
        const geometry = {
            scrollerScrollTop: 2_300,
            scrollerClientHeight: 720,
            scrollerTop: 100,
            tableTop: 260,
            headerHeight: 38,
        };

        expect(resolveMarkdownTableBodyTopInScroller(geometry)).toBe(2_498);
        expect(resolveMarkdownTableVirtualViewport(geometry)).toEqual({
            top: 0,
            bottom: 522,
        });
    });

    test("继续向下滚动时窗口 top 必须随 scrollTop 推进", () => {
        const baseGeometry = {
            scrollerClientHeight: 720,
            scrollerTop: 100,
            tableTop: -640,
            headerHeight: 38,
        };

        const earlyViewport = resolveMarkdownTableVirtualViewport({
            ...baseGeometry,
            scrollerScrollTop: 1_000,
        });
        const laterViewport = resolveMarkdownTableVirtualViewport({
            ...baseGeometry,
            tableTop: -1_540,
            scrollerScrollTop: 1_900,
        });

        expect(earlyViewport.top).toBe(702);
        expect(laterViewport.top).toBe(1_602);
        expect(laterViewport.top).toBeGreaterThan(earlyViewport.top);
    });
});
