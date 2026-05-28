/**
 * @module plugins/markdown-codemirror/editor/markdownTableVirtualization
 * @description Markdown 表格行虚拟化区间计算。
 */

import { MARKDOWN_TABLE_MIN_ROW_HEIGHT } from "./markdownTableRowHeightEstimate";

export const MARKDOWN_TABLE_ROW_VIRTUALIZATION_THRESHOLD = 160;
export const MARKDOWN_TABLE_ROW_VIRTUALIZATION_OVERSCAN = 12;

export interface MarkdownTableVirtualRange {
    enabled: boolean;
    startIndex: number;
    endIndex: number;
    beforeHeight: number;
    afterHeight: number;
    totalHeight: number;
}

interface ResolveMarkdownTableVirtualRangeOptions {
    rowCount: number;
    rowHeights: readonly number[];
    viewportTop: number;
    viewportBottom: number;
    overscanRows?: number;
}

export function shouldVirtualizeMarkdownTableRows(rowCount: number): boolean {
    return rowCount >= MARKDOWN_TABLE_ROW_VIRTUALIZATION_THRESHOLD;
}

function resolveRowHeight(rowHeights: readonly number[], rowIndex: number): number {
    const rowHeight = Number(rowHeights[rowIndex]);
    return Number.isFinite(rowHeight) && rowHeight > 0
        ? Math.max(MARKDOWN_TABLE_MIN_ROW_HEIGHT, rowHeight)
        : MARKDOWN_TABLE_MIN_ROW_HEIGHT;
}

function sumRowHeights(rowHeights: readonly number[], fromIndex: number, toIndex: number): number {
    let totalHeight = 0;
    for (let rowIndex = fromIndex; rowIndex < toIndex; rowIndex += 1) {
        totalHeight += resolveRowHeight(rowHeights, rowIndex);
    }
    return totalHeight;
}

function findRowIndexAtOffset(rowHeights: readonly number[], rowCount: number, offset: number): number {
    let currentOffset = 0;
    for (let rowIndex = 0; rowIndex < rowCount; rowIndex += 1) {
        currentOffset += resolveRowHeight(rowHeights, rowIndex);
        if (currentOffset > offset) {
            return rowIndex;
        }
    }

    return Math.max(0, rowCount - 1);
}

export function resolveMarkdownTableVirtualRange(
    options: ResolveMarkdownTableVirtualRangeOptions,
): MarkdownTableVirtualRange {
    const { rowCount, rowHeights } = options;
    const totalHeight = sumRowHeights(rowHeights, 0, rowCount);
    if (!shouldVirtualizeMarkdownTableRows(rowCount)) {
        return {
            enabled: false,
            startIndex: 0,
            endIndex: rowCount,
            beforeHeight: 0,
            afterHeight: 0,
            totalHeight,
        };
    }

    const overscanRows = options.overscanRows ?? MARKDOWN_TABLE_ROW_VIRTUALIZATION_OVERSCAN;
    const safeViewportTop = Math.max(0, Math.min(totalHeight, options.viewportTop));
    const safeViewportBottom = Math.max(safeViewportTop, Math.min(totalHeight, options.viewportBottom));
    const firstVisibleRow = findRowIndexAtOffset(rowHeights, rowCount, safeViewportTop);
    const lastVisibleRow = findRowIndexAtOffset(rowHeights, rowCount, safeViewportBottom);
    const startIndex = Math.max(0, firstVisibleRow - overscanRows);
    const endIndex = Math.min(rowCount, lastVisibleRow + overscanRows + 1);
    const beforeHeight = sumRowHeights(rowHeights, 0, startIndex);
    const visibleHeight = sumRowHeights(rowHeights, startIndex, endIndex);

    return {
        enabled: true,
        startIndex,
        endIndex,
        beforeHeight,
        afterHeight: Math.max(0, totalHeight - beforeHeight - visibleHeight),
        totalHeight,
    };
}
