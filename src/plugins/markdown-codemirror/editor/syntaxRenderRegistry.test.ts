/**
 * @module plugins/markdown-codemirror/editor/syntaxRenderRegistry.test
 * @description 行内语法渲染回归测试：IME 或窗口失焦时，只要 selection 仍停留在 token 上，
 *   helper 仍应回退源码，避免把当前光标位置隐藏成不可映射状态。
 */

import { describe, expect, test } from "bun:test";
import {
    addDelimitedInlineSyntaxDecoration,
    addInlineSyntaxDecoration,
    type LineSyntaxDecorationContext,
    pushLineSyntaxDecoration,
    shouldApplyLineSyntaxRenderer,
    shouldSuppressLineSyntaxRendering,
    type SyntaxDecorationRange,
} from "./syntaxRenderRegistry";
import { Decoration } from "@codemirror/view";

function createContext(selectionFrom: number, selectionTo = selectionFrom): {
    context: LineSyntaxDecorationContext;
    ranges: SyntaxDecorationRange[];
} {
    const ranges: SyntaxDecorationRange[] = [];
    return {
        context: {
            view: {
                hasFocus: false,
                state: {
                    selection: {
                        ranges: [{
                            from: selectionFrom,
                            to: selectionTo,
                            empty: selectionFrom === selectionTo,
                        }],
                    },
                },
            } as never,
            lineText: "## 标题 [[链接]]",
            lineFrom: 0,
            ranges,
        },
        ranges,
    };
}

describe("addInlineSyntaxDecoration", () => {
    test("selection 命中 token 时即使 view 已失焦也应回退源码", () => {
        const { context, ranges } = createContext(4, 6);

        addInlineSyntaxDecoration(context, 3, "标题", "cm-rendered-inline");

        expect(ranges).toHaveLength(0);
    });
});

describe("addDelimitedInlineSyntaxDecoration", () => {
    test("selection 命中带分隔符 token 时即使 view 已失焦也不应隐藏标记", () => {
        const { context, ranges } = createContext(6, 10);

        addDelimitedInlineSyntaxDecoration(context, 6, "[[链接]]", 2, 2, "cm-rendered-wikilink");

        expect(ranges).toHaveLength(0);
    });
});

describe("shouldSuppressLineSyntaxRendering", () => {
    test("IME 组合态下应跳过当前选区所在行的语法渲染", () => {
        const result = shouldSuppressLineSyntaxRendering(
            {
                composing: true,
                state: {
                    selection: {
                        ranges: [{ from: 12, to: 12, empty: true }],
                    },
                },
            } as never,
            10,
            20,
        );

        expect(result).toBe(true);
    });

    test("非组合态时不应跳过当前行渲染", () => {
        const result = shouldSuppressLineSyntaxRendering(
            {
                composing: false,
                state: {
                    selection: {
                        ranges: [{ from: 12, to: 12, empty: true }],
                    },
                },
            } as never,
            10,
            20,
        );

        expect(result).toBe(false);
    });
});

describe("pushLineSyntaxDecoration", () => {
    test("supports zero-width line decorations", () => {
        const ranges: SyntaxDecorationRange[] = [];

        pushLineSyntaxDecoration(ranges, 8, Decoration.line({ class: "cm-demo-line" }));

        expect(ranges).toHaveLength(1);
        expect(ranges[0]).toMatchObject({ from: 8, to: 8 });
    });
});

describe("shouldApplyLineSyntaxRenderer", () => {
    test("suppressed composing line blocks normal renderers", () => {
        expect(shouldApplyLineSyntaxRenderer({}, true)).toBe(false);
    });

    test("suppressed composing line still allows explicitly safe renderers", () => {
        expect(shouldApplyLineSyntaxRenderer({ allowComposingSelectionLine: true }, true)).toBe(true);
    });
});