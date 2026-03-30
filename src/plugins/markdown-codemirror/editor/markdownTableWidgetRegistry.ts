/**
 * @module plugins/markdown-codemirror/editor/markdownTableWidgetRegistry
 * @description Markdown 表格 widget 聚焦注册表：记录当前聚焦的表格编辑器，并为宿主层提供脏数据 flush 能力。
 * @dependencies 无
 *
 * @example
 *   setFocusedMarkdownTableEditor({
 *     flushPendingChanges: () => commitTable(),
 *   });
 *
 *   if (isMarkdownTableEditorFocused()) {
 *     flushFocusedMarkdownTableEditor();
 *   }
 */

/**
 * @interface FocusedMarkdownTableEditor
 * @description 当前聚焦的 Markdown 表格编辑器能力集合。
 */
export interface FocusedMarkdownTableEditor {
    /** 将当前表格草稿 flush 回编辑器文档。 */
    flushPendingChanges: () => void;
}

let focusedMarkdownTableEditor: FocusedMarkdownTableEditor | null = null;

/**
 * @function setFocusedMarkdownTableEditor
 * @description 声明当前聚焦的 Markdown 表格编辑器。
 * @param editor 聚焦编辑器能力。
 */
export function setFocusedMarkdownTableEditor(editor: FocusedMarkdownTableEditor): void {
    focusedMarkdownTableEditor = editor;
    console.info("[markdown-table-widget-registry] focused editor set");
}

/**
 * @function clearFocusedMarkdownTableEditor
 * @description 清理当前聚焦的 Markdown 表格编辑器。
 * @param editor 可选；传入时仅当其与当前聚焦项相同才清理。
 */
export function clearFocusedMarkdownTableEditor(editor?: FocusedMarkdownTableEditor): void {
    if (editor && focusedMarkdownTableEditor !== editor) {
        return;
    }

    if (!focusedMarkdownTableEditor) {
        return;
    }

    focusedMarkdownTableEditor = null;
    console.info("[markdown-table-widget-registry] focused editor cleared");
}

/**
 * @function isMarkdownTableEditorFocused
 * @description 判断当前是否有 Markdown 表格编辑器处于聚焦态。
 * @returns 若存在聚焦表格编辑器则返回 true。
 */
export function isMarkdownTableEditorFocused(): boolean {
    return focusedMarkdownTableEditor !== null;
}

/**
 * @function flushFocusedMarkdownTableEditor
 * @description 将当前聚焦表格编辑器中的草稿 flush 回编辑器文档。
 */
export function flushFocusedMarkdownTableEditor(): void {
    if (!focusedMarkdownTableEditor) {
        console.warn("[markdown-table-widget-registry] flush skipped: no focused editor");
        return;
    }

    focusedMarkdownTableEditor.flushPendingChanges();
}