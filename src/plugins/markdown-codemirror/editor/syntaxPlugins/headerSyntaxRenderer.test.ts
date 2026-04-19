/**
 * @module plugins/markdown-codemirror/editor/syntaxPlugins/headerSyntaxRenderer.test
 * @description 标题行语法渲染回归测试：编辑标题行时必须完整回退源码，避免 `#` 与标题内容错行。
 */

import { describe, expect, test } from "bun:test";
import type { LineSyntaxDecorationContext, SyntaxDecorationRange } from "../syntaxRenderRegistry";
import { applyHeaderLineDecorations } from "./headerSyntaxRenderer";

function createContext(selectionFrom: number, selectionTo = selectionFrom): {
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
                            to: selectionTo,
                            empty: selectionFrom === selectionTo,
                        }],
                    },
                },
            } as never,
            lineText: "# layout-v2",
            lineFrom: 0,
            ranges,
        },
        ranges,
    };
}

describe("applyHeaderLineDecorations", () => {
    test("editing 标题行时应完全回退源码，不添加任何装饰", () => {
        const { context, ranges } = createContext(5);

        applyHeaderLineDecorations(context);

        expect(ranges).toHaveLength(1);
        expect(ranges[0]).toMatchObject({ from: 0, to: 0 });
        expect((ranges[0]?.decoration as unknown as { spec?: { class?: string } }).spec?.class)
            .toContain("cm-rendered-header-source-line");
    });

    test("非编辑态时应隐藏 marker 并仅渲染标题内容", () => {
        const { context, ranges } = createContext(20);

        applyHeaderLineDecorations(context);

        expect(ranges).toHaveLength(2);
        expect(ranges[0]).toMatchObject({ from: 0, to: 2 });
        expect(ranges[1]).toMatchObject({ from: 2, to: 11 });
    });
});