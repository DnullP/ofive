/**
 * @module plugins/markdown-codemirror/editor/syntaxPlugins/listSyntaxRenderer.test
 * @description Markdown 列表语法解析测试：覆盖无序列表、有序列表、task list 与非列表场景。
 */

import { describe, expect, test } from "bun:test";
import { EditorState } from "@codemirror/state";
import {
    buildTaskCheckboxToggleSpec,
    detectMarkdownListLine,
} from "./listSyntaxRenderer";

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
            taskStateMarkerStart: null,
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
            taskStateMarkerStart: null,
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
            taskStateMarkerStart: 7,
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
            taskStateMarkerStart: 4,
        });
    });

    test("非列表行返回 null", () => {
        expect(detectMarkdownListLine("> - quoted item")).toBeNull();
        expect(detectMarkdownListLine("---")).toBeNull();
        expect(detectMarkdownListLine("plain paragraph")).toBeNull();
        expect(detectMarkdownListLine("- ")).toBeNull();
    });
});

describe("buildTaskCheckboxToggleSpec", () => {
    test("为未勾选 task 返回切换事务并保留原 selection", () => {
        const state = EditorState.create({
            doc: ["- [ ] pending", "plain paragraph"].join("\n"),
            selection: { anchor: 15 },
        });

        const spec = buildTaskCheckboxToggleSpec(state, 2);

        expect(spec).toEqual({
            from: 3,
            to: 4,
            insert: "x",
            selection: state.selection,
        });
    });

    test("为已勾选 task 返回取消勾选事务", () => {
        const state = EditorState.create({
            doc: "- [x] done",
            selection: { anchor: 9 },
        });

        const spec = buildTaskCheckboxToggleSpec(state, 1);

        expect(spec).toEqual({
            from: 3,
            to: 4,
            insert: " ",
            selection: state.selection,
        });
    });

    test("非 task 行返回 null", () => {
        const state = EditorState.create({
            doc: "- bullet item",
            selection: { anchor: 2 },
        });

        expect(buildTaskCheckboxToggleSpec(state, 1)).toBeNull();
    });
});