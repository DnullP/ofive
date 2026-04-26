/**
 * @module plugins/markdown-codemirror/editor/editorTabOutExtension.test
 * @description TabOut 目标计算单元测试。
 */

import { describe, expect, it } from "bun:test";
import { EditorState } from "@codemirror/state";
import { findEditorTabOutTarget } from "./editorTabOutExtension";

function createStateFromCursorMarker(input: string): EditorState {
    const cursor = input.indexOf("|");
    if (cursor < 0) {
        throw new Error("cursor marker missing");
    }

    return EditorState.create({
        doc: input.slice(0, cursor) + input.slice(cursor + 1),
        selection: { anchor: cursor },
    });
}

describe("findEditorTabOutTarget", () => {
    it("光标紧贴右括号时跳到括号右侧", () => {
        const state = createStateFromCursorMarker("(alpha|)");
        const target = findEditorTabOutTarget(state);

        expect(target?.to).toBe(state.doc.toString().indexOf(")") + 1);
        expect(target?.closer).toBe(")");
    });

    it("允许光标与右括号之间存在行内空白", () => {
        const state = createStateFromCursorMarker("[alpha|  ]");
        const target = findEditorTabOutTarget(state);

        expect(target?.to).toBe(state.doc.toString().indexOf("]") + 1);
        expect(target?.closer).toBe("]");
    });

    it("右侧先遇到正文内容时不接管 Tab", () => {
        const state = createStateFromCursorMarker("(alpha| beta)");

        expect(findEditorTabOutTarget(state)).toBeNull();
    });

    it("没有匹配左括号时不接管 Tab", () => {
        const state = createStateFromCursorMarker("alpha|)");

        expect(findEditorTabOutTarget(state)).toBeNull();
    });

    it("不会把 Markdown 引用符当成可跳出的右尖括号", () => {
        const state = createStateFromCursorMarker("|> quote");

        expect(findEditorTabOutTarget(state)).toBeNull();
    });

    it("不会跨行查找闭合括号", () => {
        const state = createStateFromCursorMarker("(alpha|\n)");

        expect(findEditorTabOutTarget(state)).toBeNull();
    });

    it("非空选择不接管 Tab", () => {
        const state = EditorState.create({
            doc: "(alpha)",
            selection: { anchor: 1, head: 4 },
        });

        expect(findEditorTabOutTarget(state)).toBeNull();
    });

    it("支持中文全角闭合括号", () => {
        const state = createStateFromCursorMarker("（内容|）");
        const target = findEditorTabOutTarget(state);

        expect(target?.closer).toBe("）");
        expect(target?.to).toBe(state.doc.length);
    });
});
