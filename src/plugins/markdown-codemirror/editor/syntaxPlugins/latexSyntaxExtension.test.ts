/**
 * @module plugins/markdown-codemirror/editor/syntaxPlugins/latexSyntaxExtension.test
 * @description LaTeX 语法插件回归测试：验证块级公式在文末时仍保留 anchor line，
 *   避免 widget 因 closing line 被压成 0 高度而不可见。
 */

import { EditorState } from "@codemirror/state";
import { describe, expect, test } from "bun:test";
import {
    estimateBlockLatexWidgetHeight,
    resolveLatexBlockWidgetPlacement,
    resolveLatexPriorityExclusionRanges,
} from "./latexSyntaxExtension";

/**
 * @function createDoc
 * @description 构造测试用 CodeMirror 文档对象。
 * @param content 文档文本。
 * @returns 文档对象。
 */
function createDoc(content: string) {
    return EditorState.create({ doc: content }).doc;
}

describe("resolveLatexBlockWidgetPlacement", () => {
    test("单行块级公式位于文末时应替换当前行范围", () => {
        const doc = createDoc("$$x^2$$");

        const placement = resolveLatexBlockWidgetPlacement(doc, 1, 1);

        expect(placement).toEqual({
            from: doc.line(1).from,
            to: doc.line(1).to,
        });
    });

    test("多行块级公式应替换 opening 到 closing delimiter 范围", () => {
        const doc = createDoc(["before", "$$", "x^2", "$$"].join("\n"));

        const placement = resolveLatexBlockWidgetPlacement(doc, 2, 4);

        expect(placement).toEqual({
            from: doc.line(2).from,
            to: doc.line(4).to,
        });
    });
});

describe("estimateBlockLatexWidgetHeight", () => {
    test("复杂块级公式应获得高于默认行高的离屏估算", () => {
        const estimatedHeight = estimateBlockLatexWidgetHeight("\\sum_{i=1}^{24} \\frac{i}{i + 5}");

        expect(estimatedHeight).toBeGreaterThan(estimateBlockLatexWidgetHeight("x"));
    });

    test("多行块级公式随逻辑行数增加估算高度", () => {
        expect(estimateBlockLatexWidgetHeight(["a", "b", "c"].join("\n")))
            .toBeGreaterThan(estimateBlockLatexWidgetHeight("a"));
    });
});

describe("resolveLatexPriorityExclusionRanges", () => {
    test("代码块内的 $...$ 应被 LaTeX 渲染排斥区覆盖", () => {
        const doc = createDoc([
            "---",
            "title: Demo",
            "---",
            "",
            "  ```ts title=\"math.ts\"",
            "const formula = '$E=mc^2$';",
            "  ```",
            "",
            "$real$",
        ].join("\n"));

        const ranges = resolveLatexPriorityExclusionRanges(doc);

        expect(ranges).toEqual([
            { from: doc.line(1).from, to: doc.line(3).to },
            { from: doc.line(5).from, to: doc.line(7).to },
        ]);
    });
});
