/**
 * @module plugins/markdown-codemirror/editor/markdownTableModel
 * @description Markdown 表格模型工具：负责解析、序列化与增删行列等纯数据操作。
 * @dependencies 无
 *
 * @example
 *   const model = parseMarkdownTableLines([
 *     "| Name | Status |",
 *     "| --- | --- |",
 *     "| Task | Open |",
 *   ]);
 *
 *   const next = insertMarkdownTableColumnAt(model!, 1);
 *   const markdown = serializeMarkdownTable(next);
 */

/**
 * @type MarkdownTableAlignment
 * @description Markdown 表格列对齐方式。
 */
export type MarkdownTableAlignment = "none" | "left" | "center" | "right";

/**
 * @interface MarkdownTableModel
 * @description Markdown 表格结构化模型。
 */
export interface MarkdownTableModel {
    /** 表头单元格。 */
    headers: string[];
    /** 每列对齐方式。 */
    alignments: MarkdownTableAlignment[];
    /** 表体行。 */
    rows: string[][];
}

/**
 * @interface MarkdownTableCellPosition
 * @description 表格单元格位置。
 */
export interface MarkdownTableCellPosition {
    /** 单元格所属分区。 */
    section: "header" | "body";
    /** 表体行索引；header 分区固定为 0。 */
    rowIndex: number;
    /** 列索引。 */
    columnIndex: number;
}

/**
 * @function createDefaultMarkdownTableModel
 * @description 创建默认 2 列 2 行的 Markdown 表格模型。
 * @returns 默认表格模型。
 */
export function createDefaultMarkdownTableModel(): MarkdownTableModel {
    return {
        headers: ["Column 1", "Column 2"],
        alignments: ["none", "none"],
        rows: [
            ["Cell 1", "Cell 2"],
            ["Cell 3", "Cell 4"],
        ],
    };
}

/**
 * @function cloneMarkdownTableModel
 * @description 深拷贝 Markdown 表格模型。
 * @param model 原始模型。
 * @returns 拷贝后的模型。
 */
export function cloneMarkdownTableModel(model: MarkdownTableModel): MarkdownTableModel {
    return {
        headers: [...model.headers],
        alignments: [...model.alignments],
        rows: model.rows.map((row) => [...row]),
    };
}

/**
 * @function splitMarkdownTableCells
 * @description 将单行 Markdown 表格文本拆分为单元格数组，保留转义管道符。
 * @param line 单行表格文本。
 * @returns 单元格数组；非表格行返回空数组。
 */
export function splitMarkdownTableCells(line: string): string[] {
    const trimmedLine = line.trim();
    if (!trimmedLine.includes("|")) {
        return [];
    }

    let normalizedLine = trimmedLine;
    if (normalizedLine.startsWith("|")) {
        normalizedLine = normalizedLine.slice(1);
    }
    if (normalizedLine.endsWith("|")) {
        normalizedLine = normalizedLine.slice(0, -1);
    }

    const cells: string[] = [];
    let currentCell = "";
    let isEscaped = false;

    for (const char of normalizedLine) {
        if (isEscaped) {
            currentCell += char;
            isEscaped = false;
            continue;
        }

        if (char === "\\") {
            currentCell += char;
            isEscaped = true;
            continue;
        }

        if (char === "|") {
            cells.push(currentCell.trim());
            currentCell = "";
            continue;
        }

        currentCell += char;
    }

    cells.push(currentCell.trim());
    return cells.length >= 2 ? cells : [];
}

/**
 * @function resolveAlignmentFromMarker
 * @description 将 Markdown 分隔行单元格解析为对齐配置。
 * @param cell 分隔行单元格内容。
 * @returns 对齐方式；非法分隔标记返回 null。
 */
function resolveAlignmentFromMarker(cell: string): MarkdownTableAlignment | null {
    const trimmedCell = cell.trim();
    if (!/^:?-{3,}:?$/.test(trimmedCell)) {
        return null;
    }

    const isLeft = trimmedCell.startsWith(":");
    const isRight = trimmedCell.endsWith(":");
    if (isLeft && isRight) {
        return "center";
    }
    if (isLeft) {
        return "left";
    }
    if (isRight) {
        return "right";
    }
    return "none";
}

/**
 * @function normalizeMarkdownTableRow
 * @description 将表格行按指定列数进行补齐或截断。
 * @param cells 原始单元格数组。
 * @param columnCount 目标列数。
 * @returns 规范化后的单元格数组。
 */
function normalizeMarkdownTableRow(cells: string[], columnCount: number): string[] {
    const nextCells = cells.slice(0, columnCount);
    while (nextCells.length < columnCount) {
        nextCells.push("");
    }
    return nextCells;
}

/**
 * @function parseMarkdownTableLines
 * @description 将 Markdown 表格文本行解析为结构化模型。
 * @param lines 表格文本行。
 * @returns 成功时返回表格模型，失败返回 null。
 */
export function parseMarkdownTableLines(lines: string[]): MarkdownTableModel | null {
    if (lines.length < 2) {
        return null;
    }

    const headerCells = splitMarkdownTableCells(lines[0] ?? "");
    if (headerCells.length < 2) {
        return null;
    }

    const separatorCells = splitMarkdownTableCells(lines[1] ?? "");
    if (separatorCells.length !== headerCells.length) {
        return null;
    }

    const alignments: MarkdownTableAlignment[] = [];
    for (const cell of separatorCells) {
        const alignment = resolveAlignmentFromMarker(cell);
        if (!alignment) {
            return null;
        }
        alignments.push(alignment);
    }

    const rows = lines.slice(2).map((line) => {
        const cells = splitMarkdownTableCells(line);
        return normalizeMarkdownTableRow(cells, headerCells.length);
    });

    return {
        headers: normalizeMarkdownTableRow(headerCells, headerCells.length),
        alignments,
        rows,
    };
}

/**
 * @function buildAlignmentMarker
 * @description 为指定列宽与对齐方式生成 Markdown 分隔行单元格。
 * @param width 列宽。
 * @param alignment 对齐方式。
 * @returns 分隔行单元格文本。
 */
function buildAlignmentMarker(width: number, alignment: MarkdownTableAlignment): string {
    const safeWidth = Math.max(3, width);
    if (alignment === "left") {
        return `:${"-".repeat(Math.max(2, safeWidth - 1))}`;
    }
    if (alignment === "right") {
        return `${"-".repeat(Math.max(2, safeWidth - 1))}:`;
    }
    if (alignment === "center") {
        return `:${"-".repeat(Math.max(1, safeWidth - 2))}:`;
    }
    return "-".repeat(safeWidth);
}

/**
 * @function serializeMarkdownTable
 * @description 将结构化表格模型序列化为 Markdown 表格文本。
 * @param model 表格模型。
 * @returns Markdown 表格文本。
 */
export function serializeMarkdownTable(model: MarkdownTableModel): string {
    const columnCount = model.headers.length;
    const widths = Array.from({ length: columnCount }, (_, columnIndex) => {
        const cellValues = [
            model.headers[columnIndex] ?? "",
            ...model.rows.map((row) => row[columnIndex] ?? ""),
        ];
        return Math.max(3, ...cellValues.map((value) => value.length));
    });

    const formatRow = (cells: string[]): string => `| ${cells.map((cell, columnIndex) =>
        (cell ?? "").padEnd(widths[columnIndex] ?? 3),
    ).join(" | ")} |`;

    const separatorRow = `| ${model.alignments.map((alignment, columnIndex) =>
        buildAlignmentMarker(widths[columnIndex] ?? 3, alignment).padEnd(widths[columnIndex] ?? 3),
    ).join(" | ")} |`;

    return [
        formatRow(model.headers),
        separatorRow,
        ...model.rows.map((row) => formatRow(normalizeMarkdownTableRow(row, columnCount))),
    ].join("\n");
}

/**
 * @function updateMarkdownTableCell
 * @description 更新指定单元格的文本内容。
 * @param model 原始模型。
 * @param position 单元格位置。
 * @param value 新文本。
 * @returns 更新后的模型。
 */
export function updateMarkdownTableCell(
    model: MarkdownTableModel,
    position: MarkdownTableCellPosition,
    value: string,
): MarkdownTableModel {
    const nextModel = cloneMarkdownTableModel(model);
    if (position.section === "header") {
        nextModel.headers[position.columnIndex] = value;
        return nextModel;
    }

    const targetRow = nextModel.rows[position.rowIndex];
    if (!targetRow) {
        return nextModel;
    }
    targetRow[position.columnIndex] = value;
    return nextModel;
}

/**
 * @function insertMarkdownTableRowAt
 * @description 在指定表体行位置插入新行。
 * @param model 原始模型。
 * @param rowIndex 新行插入位置。
 * @returns 更新后的模型。
 */
export function insertMarkdownTableRowAt(
    model: MarkdownTableModel,
    rowIndex: number,
): MarkdownTableModel {
    const nextModel = cloneMarkdownTableModel(model);
    const safeIndex = Math.max(0, Math.min(rowIndex, nextModel.rows.length));
    nextModel.rows.splice(safeIndex, 0, Array.from({ length: nextModel.headers.length }, () => ""));
    return nextModel;
}

/**
 * @function deleteMarkdownTableRowAt
 * @description 删除指定表体行；至少保留一行空白行。
 * @param model 原始模型。
 * @param rowIndex 待删除行索引。
 * @returns 更新后的模型。
 */
export function deleteMarkdownTableRowAt(
    model: MarkdownTableModel,
    rowIndex: number,
): MarkdownTableModel {
    const nextModel = cloneMarkdownTableModel(model);
    if (nextModel.rows.length <= 1) {
        nextModel.rows = [Array.from({ length: nextModel.headers.length }, () => "")];
        return nextModel;
    }

    nextModel.rows.splice(Math.max(0, Math.min(rowIndex, nextModel.rows.length - 1)), 1);
    return nextModel;
}

/**
 * @function insertMarkdownTableColumnAt
 * @description 在指定列位置插入新列。
 * @param model 原始模型。
 * @param columnIndex 新列插入位置。
 * @returns 更新后的模型。
 */
export function insertMarkdownTableColumnAt(
    model: MarkdownTableModel,
    columnIndex: number,
): MarkdownTableModel {
    const nextModel = cloneMarkdownTableModel(model);
    const safeIndex = Math.max(0, Math.min(columnIndex, nextModel.headers.length));
    nextModel.headers.splice(safeIndex, 0, `Column ${safeIndex + 1}`);
    nextModel.alignments.splice(safeIndex, 0, "none");
    nextModel.rows = nextModel.rows.map((row) => {
        const nextRow = [...row];
        nextRow.splice(safeIndex, 0, "");
        return nextRow;
    });
    return nextModel;
}

/**
 * @function deleteMarkdownTableColumnAt
 * @description 删除指定列；至少保留一列。
 * @param model 原始模型。
 * @param columnIndex 待删除列索引。
 * @returns 更新后的模型。
 */
export function deleteMarkdownTableColumnAt(
    model: MarkdownTableModel,
    columnIndex: number,
): MarkdownTableModel {
    const nextModel = cloneMarkdownTableModel(model);
    if (nextModel.headers.length <= 1) {
        nextModel.headers = ["Column 1"];
        nextModel.alignments = ["none"];
        nextModel.rows = nextModel.rows.map(() => [""]);
        return nextModel;
    }

    const safeIndex = Math.max(0, Math.min(columnIndex, nextModel.headers.length - 1));
    nextModel.headers.splice(safeIndex, 1);
    nextModel.alignments.splice(safeIndex, 1);
    nextModel.rows = nextModel.rows.map((row) => row.filter((_, index) => index !== safeIndex));
    return nextModel;
}