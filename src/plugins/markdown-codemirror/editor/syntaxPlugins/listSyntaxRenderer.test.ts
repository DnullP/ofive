/**
 * @module plugins/markdown-codemirror/editor/syntaxPlugins/listSyntaxRenderer.test
 * @description Markdown 列表语法解析测试：覆盖无序列表、有序列表、task list 与非列表场景。
 */

import { describe, expect, test } from "bun:test";
import { EditorState } from "@codemirror/state";
import { getLineSyntaxRendererSnapshot } from "../syntaxRenderRegistry";
import type { LineSyntaxDecorationContext, SyntaxDecorationRange } from "../syntaxRenderRegistry";
import {
    applyListLineDecorations,
    buildTaskCheckboxToggleSpec,
    detectMarkdownListLine,
    registerListSyntaxRenderer,
} from "./listSyntaxRenderer";

function createListDecorationContext(
    lineText: string,
    selectionFrom: number,
): {
    context: LineSyntaxDecorationContext;
    ranges: SyntaxDecorationRange[];
} {
    const ranges: SyntaxDecorationRange[] = [];
    return {
        context: {
            view: {
                state: {
                    selection: {
                        ranges: [{
                            from: selectionFrom,
                            to: selectionFrom,
                            empty: true,
                        }],
                    },
                },
            } as never,
            lineText,
            lineFrom: 0,
            ranges,
        },
        ranges,
    };
}

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

describe("applyListLineDecorations", () => {
    test("editing 列表行时应回退源码并让 marker 区间包含后续空格", () => {
        const { context, ranges } = createListDecorationContext("- item", 3);

        applyListLineDecorations(context);

        expect(ranges).toHaveLength(2);
        expect(ranges[0]).toMatchObject({ from: 0, to: 2 });
        expect((ranges[0]?.decoration as unknown as { spec?: { class?: string } }).spec?.class)
            .toContain("cm-list-syntax-marker-source-unordered");
        expect(ranges[1]).toMatchObject({ from: 0, to: 0 });
        expect((ranges[1]?.decoration as unknown as { spec?: { class?: string } }).spec?.class)
            .toContain("cm-list-source-line-unordered");
    });

    test("editing task list 时源码 marker 区间应覆盖 checkbox 前缀", () => {
        const { context, ranges } = createListDecorationContext("- [ ] pending", 7);

        applyListLineDecorations(context);

        expect(ranges).toHaveLength(2);
        expect(ranges[0]).toMatchObject({ from: 0, to: 6 });
        expect((ranges[0]?.decoration as unknown as { spec?: { class?: string } }).spec?.class)
            .toContain("cm-list-syntax-marker-source-task");
        expect((ranges[1]?.decoration as unknown as { spec?: { class?: string } }).spec?.class)
            .toContain("cm-list-source-line-task");
    });
});

describe("registerListSyntaxRenderer", () => {
    test("列表编辑态装饰应允许在 IME 组合态保留，避免 compositionstart 重建活动行 DOM", () => {
        registerListSyntaxRenderer();

        const renderer = getLineSyntaxRendererSnapshot().find((entry) => entry.id === "list-line");

        expect(renderer?.allowComposingSelectionLine).toBe(true);
    });
});
