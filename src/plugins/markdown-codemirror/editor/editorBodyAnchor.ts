/**
 * @module plugins/markdown-codemirror/editor/editorBodyAnchor
 * @description 编辑器正文锚点工具：负责计算用户应进入的第一处正文可编辑位置。
 * @dependencies
 *  - @codemirror/state
 *  - ./syntaxPlugins/frontmatterSyntaxExtension
 *
 * @example
 *   const anchor = resolveEditorBodyAnchor(view.state);
 *   view.dispatch({ selection: { anchor }, scrollIntoView: true });
 *
 * @exports
 *  - resolveEditorBodyAnchor
 */

import type { EditorState } from "@codemirror/state";

import { parseFrontmatterBlock } from "./syntaxPlugins/frontmatterSyntaxExtension";

/**
 * @function resolveEditorBodyAnchor
 * @description 解析编辑器正文首个可编辑位置；若文档包含 frontmatter，则跳过它并返回后续首行起点。
 * @param state CodeMirror 编辑器状态。
 * @returns 正文首个可编辑光标锚点偏移。
 */
export function resolveEditorBodyAnchor(state: EditorState): number {
    const frontmatterBlock = parseFrontmatterBlock(state);
    if (!frontmatterBlock) {
        return 0;
    }

    if (frontmatterBlock.endLineNumber >= state.doc.lines) {
        return state.doc.length;
    }

    return state.doc.line(frontmatterBlock.endLineNumber + 1).from;
}

/**
 * @interface EditorBodySelectionRange
 * @description 正文范围选择结果；用于将 metadata 区域排除在正文选择之外。
 */
export interface EditorBodySelectionRange {
    /** 选区起点。 */
    anchor: number;
    /** 选区终点。 */
    head: number;
}

/**
 * @function resolveEditorBodySelectionRange
 * @description 解析正文的完整可选范围；若存在 frontmatter，则仅返回其后的正文区间。
 * @param state CodeMirror 编辑器状态。
 * @returns 正文选区范围。
 */
export function resolveEditorBodySelectionRange(state: EditorState): EditorBodySelectionRange {
    const anchor = resolveEditorBodyAnchor(state);
    return {
        anchor,
        head: state.doc.length,
    };
}