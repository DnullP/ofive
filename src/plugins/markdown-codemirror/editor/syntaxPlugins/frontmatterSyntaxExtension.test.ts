/**
 * @module plugins/markdown-codemirror/editor/syntaxPlugins/frontmatterSyntaxExtension.test
 * @description frontmatter 语法插件的单元测试：校验区块解析边界，避免把 closing delimiter
 *   后的换行错误吞入 widget 替换范围。
 */

import { EditorState } from "@codemirror/state";
import { describe, expect, test } from "bun:test";
import { isFrontmatterBlockSelected, parseFrontmatterBlock } from "./frontmatterSyntaxExtension";

/**
 * @function createState
 * @description 构造仅包含文档内容的 EditorState，供 frontmatter 边界测试复用。
 * @param doc 文档文本。
 * @returns EditorState 实例。
 */
function createState(doc: string): EditorState {
    return EditorState.create({ doc });
}

describe("parseFrontmatterBlock", () => {
    test("closing delimiter 后的换行不应并入 frontmatter 范围", () => {
        const doc = ["---", "title: demo", "---", "body line"].join("\n");
        const state = createState(doc);

        const block = parseFrontmatterBlock(state);

        expect(block).not.toBeNull();
        expect(block?.from).toBe(0);
        expect(block?.to).toBe(state.doc.line(3).to);
        expect(state.doc.sliceString(block!.to, block!.to + 1)).toBe("\n");
        expect(block?.yamlText).toBe("title: demo");
    });

    test("EOF 结束的 frontmatter 仍应正确解析", () => {
        const doc = ["---", "title: demo", "---"].join("\n");
        const state = createState(doc);

        const block = parseFrontmatterBlock(state);

        expect(block).not.toBeNull();
        expect(block?.to).toBe(state.doc.line(3).to);
        expect(block?.endLineNumber).toBe(3);
    });
});

describe("isFrontmatterBlockSelected", () => {
    test("非空选区与 frontmatter 区块相交时应返回 true", () => {
        expect(isFrontmatterBlockSelected(
            { from: 0, to: 18 },
            [{ from: 0, to: 32, empty: false }],
        )).toBe(true);
    });

    test("空光标或不相交选区不应触发 frontmatter 选中态", () => {
        expect(isFrontmatterBlockSelected(
            { from: 0, to: 18 },
            [
                { from: 6, to: 6, empty: true },
                { from: 18, to: 24, empty: false },
            ],
        )).toBe(false);
    });
});