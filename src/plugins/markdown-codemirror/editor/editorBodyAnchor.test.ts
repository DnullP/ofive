/**
 * @module plugins/markdown-codemirror/editor/editorBodyAnchor.test
 * @description editorBodyAnchor 单元测试：验证光标锚点能正确跳过 frontmatter 并落在正文首行。
 */

import { EditorState } from "@codemirror/state";
import { describe, expect, test } from "bun:test";

import { resolveEditorBodyAnchor } from "./editorBodyAnchor";

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