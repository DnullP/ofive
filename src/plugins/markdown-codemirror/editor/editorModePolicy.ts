/**
 * @module plugins/markdown-codemirror/editor/editorModePolicy
 * @description 编辑器显示模式策略模块，负责定义编辑态与阅读态下的交互边界。
 * @dependencies
 *  - ../../../host/commands/commandSystem
 *
 * @example
 *   import {
 *       canExecuteEditorNativeCommandInMode,
 *       canMutateEditorDocument,
 *       toggleEditorDisplayMode,
 *   } from "./editorModePolicy";
 *
 * @exports
 *   - EditorDisplayMode 编辑器显示模式类型
 *   - canExecuteEditorNativeCommandInMode 判断当前模式是否允许执行编辑器原生命令
 *   - canMutateEditorDocument 判断当前模式是否允许修改文档内容
 *   - toggleEditorDisplayMode 切换编辑器显示模式
 */

import type { EditorNativeCommandId } from "../../../host/commands/commandSystem";
import type { EditorDisplayMode } from "../../../host/store/editorDisplayModeStore";

const READ_MODE_ALLOWED_COMMANDS = new Set<EditorNativeCommandId>([
    "editor.find",
    "editor.selectAll",
]);

/**
 * @function canExecuteEditorNativeCommandInMode
 * @description 判断指定显示模式下是否允许执行某个编辑器原生命令。
 * @param mode 当前显示模式。
 * @param commandId 待执行命令。
 * @returns 允许执行时返回 true。
 */
export function canExecuteEditorNativeCommandInMode(
    mode: EditorDisplayMode,
    commandId: EditorNativeCommandId,
): boolean {
    if (mode === "edit") {
        return true;
    }

    return READ_MODE_ALLOWED_COMMANDS.has(commandId);
}

/**
 * @function canMutateEditorDocument
 * @description 判断当前显示模式是否允许修改文档内容。
 * @param mode 当前显示模式。
 * @returns 编辑态返回 true，阅读态返回 false。
 */
export function canMutateEditorDocument(mode: EditorDisplayMode): boolean {
    return mode === "edit";
}

/**
 * @function toggleEditorDisplayMode
 * @description 在编辑态与阅读态之间切换。
 * @param mode 当前显示模式。
 * @returns 切换后的显示模式。
 */
export function toggleEditorDisplayMode(mode: EditorDisplayMode): EditorDisplayMode {
    return mode === "edit" ? "read" : "edit";
}