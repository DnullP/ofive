/**
 * @module plugins/markdown-codemirror/editor/syntaxPlugins/markdownTableSyntaxExtension.test
 * @description Markdown 表格 widget 回归测试：确保底层空光标仍停留在表格源码里时，
 *   不会继续隐藏源码并把 selection 留在不可映射位置。
 */

import { describe, expect, test } from "bun:test";
import {
    estimateMarkdownTableWidgetHeight,
    resolveMarkdownTableEditorWheelDeltaY,
    shouldKeepMarkdownTableSourceVisible,
} from "./markdownTableSyntaxExtension";

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

    test("空光标位于表格开区间结尾时应视为已离开源码", () => {
        expect(shouldKeepMarkdownTableSourceVisible(
            { from: 12, to: 48 },
            [{ from: 48, to: 48, empty: true }],
        )).toBe(false);
    });
});

describe("estimateMarkdownTableWidgetHeight", () => {
    test("大型表格应在 React 挂载前提供接近真实表格的高度下限", () => {
        const estimatedHeight = estimateMarkdownTableWidgetHeight({
            rows: Array.from({ length: 48 }, () => ["A", "B", "C"]),
        }, null);

        expect(estimatedHeight).toBeGreaterThan(1800);
    });

    test("估算高度应覆盖完整可视 widget，避免向上滚动时二次补偿 scrollTop", () => {
        const estimatedHeight = estimateMarkdownTableWidgetHeight({
            rows: Array.from({ length: 44 }, () => ["metric", "owner", "status", "detail"]),
        }, null);

        expect(estimatedHeight).toBe(1760);
    });

    test("应优先使用持久化行高估算已调整过的表格", () => {
        const estimatedHeight = estimateMarkdownTableWidgetHeight({
            rows: [
                ["one", "two"],
                ["three", "four"],
            ],
        }, {
            rowHeights: [96, 128],
        });

        expect(estimatedHeight).toBe(312);
    });
});

describe("resolveMarkdownTableEditorWheelDeltaY", () => {
    test("竖向触控板滚动应交给主编辑器滚动容器", () => {
        expect(resolveMarkdownTableEditorWheelDeltaY({
            deltaX: 1,
            deltaY: 24,
            deltaMode: 0,
            lineHeight: 18,
            pageHeight: 600,
        })).toBe(24);
    });

    test("横向滚动应保留给表格自身横向滚动容器", () => {
        expect(resolveMarkdownTableEditorWheelDeltaY({
            deltaX: 48,
            deltaY: 12,
            deltaMode: 0,
            lineHeight: 18,
            pageHeight: 600,
        })).toBe(0);
    });

    test("Shift 横滚与 Ctrl 缩放手势不应被表格转成编辑器竖向滚动", () => {
        expect(resolveMarkdownTableEditorWheelDeltaY({
            deltaX: 0,
            deltaY: 42,
            deltaMode: 0,
            lineHeight: 18,
            pageHeight: 600,
            shiftKey: true,
        })).toBe(0);

        expect(resolveMarkdownTableEditorWheelDeltaY({
            deltaX: 0,
            deltaY: 42,
            deltaMode: 0,
            lineHeight: 18,
            pageHeight: 600,
            ctrlKey: true,
        })).toBe(0);
    });

    test("非像素 wheel delta 应按行高或视口高度归一化", () => {
        expect(resolveMarkdownTableEditorWheelDeltaY({
            deltaX: 0,
            deltaY: 3,
            deltaMode: 1,
            lineHeight: 20,
            pageHeight: 600,
        })).toBe(60);

        expect(resolveMarkdownTableEditorWheelDeltaY({
            deltaX: 0,
            deltaY: 1,
            deltaMode: 2,
            lineHeight: 20,
            pageHeight: 480,
        })).toBe(480);
    });
});
