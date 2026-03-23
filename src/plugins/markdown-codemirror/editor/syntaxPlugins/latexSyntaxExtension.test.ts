/**
 * @module plugins/markdown-codemirror/editor/syntaxPlugins/latexSyntaxExtension.test
 * @description LaTeX 语法插件回归测试：验证块级公式在文末时仍保留 anchor line，
 *   避免 widget 因 closing line 被压成 0 高度而不可见。
 */

import { EditorState } from "@codemirror/state";
import { describe, expect, test } from "bun:test";
import { resolveLatexBlockWidgetPlacement } from "./latexSyntaxExtension";

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
    test("单行块级公式位于文末时应保留当前行为 anchor", () => {
        const doc = createDoc("$$x^2$$");

        const placement = resolveLatexBlockWidgetPlacement(doc, 1, 1);

        expect(placement.hiddenLineNumbers).toEqual([]);
        expect(placement.anchorLineNumber).toBe(1);
        expect(placement.widgetPos).toBe(doc.line(1).to);
        expect(placement.widgetSide).toBe(-1);
    });

    test("多行块级公式应仅隐藏 closing line 之前的源码行", () => {
        const doc = createDoc(["before", "$$", "x^2", "$$"].join("\n"));

        const placement = resolveLatexBlockWidgetPlacement(doc, 2, 4);

        expect(placement.hiddenLineNumbers).toEqual([2, 3]);
        expect(placement.anchorLineNumber).toBe(4);
        expect(placement.widgetPos).toBe(doc.line(4).to);
        expect(placement.widgetSide).toBe(-1);
    });
});