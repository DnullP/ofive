/**
 * @module plugins/markdown-codemirror/editor/markdownTablePreviewPolicy
 * @description 控制 Markdown 表格单元格 rich preview 的初始渲染规模。
 */

import type {
    MarkdownTableCellPosition,
    MarkdownTableModel,
} from "./markdownTableModel";

const IMMEDIATE_RICH_CELL_PREVIEW_MAX_COUNT = 96;
const INITIAL_LARGE_TABLE_RICH_CELL_PREVIEW_COUNT = 0;

export function getMarkdownTableCellFlatIndex(
    position: MarkdownTableCellPosition,
    columnCount: number,
): number {
    if (position.section === "header") {
        return position.columnIndex;
    }

    return columnCount * (position.rowIndex + 1) + position.columnIndex;
}

export function resolveInitialRichPreviewLimit(model: MarkdownTableModel): number {
    const cellCount = model.headers.length * (model.rows.length + 1);
    return cellCount <= IMMEDIATE_RICH_CELL_PREVIEW_MAX_COUNT
        ? cellCount
        : INITIAL_LARGE_TABLE_RICH_CELL_PREVIEW_COUNT;
}
