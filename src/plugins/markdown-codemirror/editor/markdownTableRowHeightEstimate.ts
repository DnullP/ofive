/**
 * @module plugins/markdown-codemirror/editor/markdownTableRowHeightEstimate
 * @description Markdown 表格大数据渲染的稳定行高估算。
 */

import type { MarkdownTableModel } from "./markdownTableModel";

export const MARKDOWN_TABLE_MIN_ROW_HEIGHT = 38;
export const MARKDOWN_TABLE_HEADER_HEIGHT = 38;
export const MARKDOWN_TABLE_VERTICAL_CHROME_HEIGHT = 50;

const DEFAULT_TABLE_COLUMN_WIDTH = 164;
const CELL_HORIZONTAL_PADDING = 20;
const ESTIMATED_CHARACTER_WIDTH = 7;
const ESTIMATED_LINE_HEIGHT = 18;
const CELL_VERTICAL_PADDING = 16;
const MAX_ESTIMATED_ROW_HEIGHT = 160;

function estimateLineCountForCell(value: string, columnWidth: number): number {
    const usableWidth = Math.max(48, columnWidth - CELL_HORIZONTAL_PADDING);
    const charactersPerLine = Math.max(8, Math.floor(usableWidth / ESTIMATED_CHARACTER_WIDTH));
    return value
        .split(/\r?\n/)
        .reduce((lineCount, line) => lineCount + Math.max(1, Math.ceil(line.length / charactersPerLine)), 0);
}

export function estimateMarkdownTableRowHeight(
    cells: readonly string[],
    columnWidths: readonly number[] | null | undefined,
): number {
    const lineCount = cells.reduce((maxLineCount, cell, columnIndex) => {
        const columnWidth = columnWidths?.[columnIndex] ?? DEFAULT_TABLE_COLUMN_WIDTH;
        return Math.max(maxLineCount, estimateLineCountForCell(cell, columnWidth));
    }, 1);

    return Math.min(
        MAX_ESTIMATED_ROW_HEIGHT,
        Math.max(MARKDOWN_TABLE_MIN_ROW_HEIGHT, CELL_VERTICAL_PADDING + lineCount * ESTIMATED_LINE_HEIGHT),
    );
}

export function estimateMarkdownTableBodyRowHeights(
    model: Pick<MarkdownTableModel, "rows">,
    columnWidths: readonly number[] | null | undefined,
    persistedRowHeights: readonly number[] | null | undefined,
): number[] {
    return model.rows.map((row, rowIndex) => {
        const persistedHeight = Number(persistedRowHeights?.[rowIndex]);
        if (Number.isFinite(persistedHeight) && persistedHeight > 0) {
            return Math.max(MARKDOWN_TABLE_MIN_ROW_HEIGHT, Math.round(persistedHeight));
        }

        return estimateMarkdownTableRowHeight(row, columnWidths);
    });
}

export function estimateMarkdownTableWidgetHeight(
    model: Pick<MarkdownTableModel, "rows">,
    columnWidths: readonly number[] | null | undefined,
    persistedRowHeights: readonly number[] | null | undefined,
): number {
    const bodyRowsHeight = estimateMarkdownTableBodyRowHeights(model, columnWidths, persistedRowHeights)
        .reduce((totalHeight, rowHeight) => totalHeight + rowHeight, 0);

    return MARKDOWN_TABLE_VERTICAL_CHROME_HEIGHT
        + MARKDOWN_TABLE_HEADER_HEIGHT
        + bodyRowsHeight;
}
