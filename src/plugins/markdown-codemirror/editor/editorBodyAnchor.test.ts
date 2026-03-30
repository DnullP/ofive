/**
 * @module plugins/markdown-codemirror/editor/editorBodyAnchor.test
 * @description editorBodyAnchor 单元测试：验证光标锚点能正确跳过 frontmatter 并落在正文首行。
 */

import { EditorState } from "@codemirror/state";
import { describe, expect, test } from "bun:test";

import { resolveEditorBodyAnchor, resolveEditorBodySelectionRange } from "./editorBodyAnchor";

describe("resolveEditorBodyAnchor", () => {
    test("无 frontmatter 时应返回文档起始位置", () => {
        const state = EditorState.create({
            doc: "# Title\n\nBody",
        });

        expect(resolveEditorBodyAnchor(state)).toBe(0);
    });

    test("存在 frontmatter 时应返回其后第一行起点", () => {
        const doc = "---\ntitle: Demo\n---\n\n# Body";
        const state = EditorState.create({ doc });

        expect(resolveEditorBodyAnchor(state)).toBe(state.doc.line(4).from);
    });

    test("frontmatter 占满全文时应返回文档末尾", () => {
        const doc = "---\ntitle: Demo\n---";
        const state = EditorState.create({ doc });

        expect(resolveEditorBodyAnchor(state)).toBe(state.doc.length);
    });
});

describe("resolveEditorBodySelectionRange", () => {
    test("无 frontmatter 时应覆盖整篇文档", () => {
        const state = EditorState.create({
            doc: "# Title\n\nBody",
        });

        expect(resolveEditorBodySelectionRange(state)).toEqual({
            anchor: 0,
            head: state.doc.length,
        });
    });

    test("存在 frontmatter 时不应把 metadata 纳入正文全选范围", () => {
        const doc = "---\ntitle: Demo\n---\n\n# Body\ncontent";
        const state = EditorState.create({ doc });

        expect(resolveEditorBodySelectionRange(state)).toEqual({
            anchor: state.doc.line(4).from,
            head: state.doc.length,
        });
    });

    test("只有 frontmatter 时正文全选应退化为空选区", () => {
        const doc = "---\ntitle: Demo\n---";
        const state = EditorState.create({ doc });

        expect(resolveEditorBodySelectionRange(state)).toEqual({
            anchor: state.doc.length,
            head: state.doc.length,
        });
    });
});