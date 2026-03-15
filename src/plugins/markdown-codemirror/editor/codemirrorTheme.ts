/**
 * @module plugins/markdown-codemirror/editor/codemirrorTheme
 * @description CodeMirror 主题适配层：集中管理编辑器基础主题样式，统一接入全局风格 token。
 * @dependencies
 *  - codemirror (EditorView)
 *
 * @example
 *   extensions: [
 *     basicSetup,
 *     markdown(),
 *     createCodeMirrorThemeExtension(),
 *   ]
 *
 * @exports
 *  - createCodeMirrorThemeExtension
 */

import { EditorView } from "codemirror";

/**
 * @function createCodeMirrorThemeExtension
 * @description 创建统一的 CodeMirror 主题扩展。
 * @returns CodeMirror 主题扩展。
 */
export function createCodeMirrorThemeExtension() {
    return EditorView.theme({
        "&": {
            height: "100%",
            color: "var(--editor-text-color)",
            backgroundColor: "var(--editor-bg-color)",
        },
        ".cm-scroller": {
            backgroundColor: "var(--editor-bg-color)",
        },
        /* 活动行高亮横跨全宽，不受 cm-content 限宽影响 */
        ".cm-activeLine": {
            marginLeft: "-32px",
            marginRight: "-32px",
            paddingLeft: "32px",
            paddingRight: "32px",
            backgroundColor: "var(--editor-active-line-bg-color)",
        },
        ".cm-content": {
            caretColor: "var(--editor-caret-color)",
        },
        ".cm-cursor, .cm-dropCursor": {
            borderLeftColor: "var(--editor-caret-color)",
        },
        "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground": {
            backgroundColor: "var(--editor-selection-bg-color)",
        },
        ".cm-content ::selection": {
            backgroundColor: "var(--editor-selection-bg-color)",
            color: "var(--editor-selection-text-color)",
        },
        ".cm-activeLineGutter": {
            backgroundColor: "var(--editor-active-line-gutter-bg-color)",
        },
        ".cm-gutters": {
            color: "var(--editor-gutter-text-color)",
            backgroundColor: "var(--editor-gutter-bg-color)",
            borderRight: "1px solid var(--border-color)",
        },
    });
}
