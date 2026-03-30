/**
 * @module plugins/markdown-codemirror/editor/markdownTableModel.test
 * @description markdownTableModel 模块单元测试：覆盖表格解析、序列化与行列操作。
 */

import { describe, expect, test } from "bun:test";
import {
    createDefaultMarkdownTableModel,
    deleteMarkdownTableColumnAt,
    deleteMarkdownTableRowAt,
    insertMarkdownTableColumnAt,
    insertMarkdownTableRowAt,
    parseMarkdownTableLines,
    serializeMarkdownTable,
    splitMarkdownTableCells,
    updateMarkdownTableCell,
} from "./markdownTableModel";

describe("splitMarkdownTableCells", () => {
    test("should split a pipe-delimited row", () => {
        expect(splitMarkdownTableCells("| a | b | c |"))
            .toEqual(["a", "b", "c"]);
    });

    test("should keep escaped pipes inside a cell", () => {
        expect(splitMarkdownTableCells("| a \\| b | [[note]] |"))
            .toEqual(["a \\| b", "[[note]]"]);
    });
});

describe("parseMarkdownTableLines", () => {
    test("should parse a valid markdown table", () => {
        const model = parseMarkdownTableLines([
            "| Name | Status |",
            "| :--- | ---: |",
            "| Task | Open |",
        ]);

        expect(model).not.toBeNull();
        expect(model?.headers).toEqual(["Name", "Status"]);
        expect(model?.alignments).toEqual(["left", "right"]);
        expect(model?.rows).toEqual([["Task", "Open"]]);
    });

    test("should reject non-table content", () => {
        expect(parseMarkdownTableLines(["hello", "world"])).toBeNull();
    });
});

describe("serializeMarkdownTable", () => {
    test("should serialize the default model", () => {
        expect(serializeMarkdownTable(createDefaultMarkdownTableModel())).toBe(
            [
                "| Column 1 | Column 2 |",
                "| -------- | -------- |",
                "| Cell 1   | Cell 2   |",
                "| Cell 3   | Cell 4   |",
            ].join("\n"),
        );
    });
});

describe("markdown table operations", () => {
    test("should update a single cell", () => {
        const nextModel = updateMarkdownTableCell(
            createDefaultMarkdownTableModel(),
            { section: "body", rowIndex: 1, columnIndex: 0 },
            "**Done** [[note]]",
        );

        expect(nextModel.rows[1]?.[0]).toBe("**Done** [[note]]");
    });

    test("should insert and delete rows", () => {
        const insertedModel = insertMarkdownTableRowAt(createDefaultMarkdownTableModel(), 1);
        expect(insertedModel.rows).toHaveLength(3);
        expect(insertedModel.rows[1]).toEqual(["", ""]);

        const deletedModel = deleteMarkdownTableRowAt(insertedModel, 1);
        expect(deletedModel.rows).toHaveLength(2);
    });

    test("should insert and delete columns", () => {
        const insertedModel = insertMarkdownTableColumnAt(createDefaultMarkdownTableModel(), 1);
        expect(insertedModel.headers).toHaveLength(3);
        expect(insertedModel.rows[0]).toEqual(["Cell 1", "", "Cell 2"]);

        const deletedModel = deleteMarkdownTableColumnAt(insertedModel, 1);
        expect(deletedModel.headers).toHaveLength(2);
        expect(deletedModel.rows[0]).toEqual(["Cell 1", "Cell 2"]);
    });
});