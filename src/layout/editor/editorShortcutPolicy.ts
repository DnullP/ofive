/**
 * @module layout/editor/editorShortcutPolicy
 * @description 编辑器快捷键策略模块：维护编辑器托管命令和默认回退组合。
 * @dependencies
 *  - ../../host/commands/commandSystem
 */

import {
    COMMAND_DEFINITIONS,
    type CommandId,
    type EditorNativeCommandId,
} from "../../host/commands/commandSystem";

/**
 * @constant EDITOR_MANAGED_NATIVE_COMMAND_IDS
 * @description 由快捷键系统托管的编辑器原生命令列表。
 */
export const EDITOR_MANAGED_NATIVE_COMMAND_IDS: EditorNativeCommandId[] = [
    "editor.undo",
    "editor.redo",
    "editor.selectAll",
    "editor.find",
    "editor.toggleComment",
    "editor.indentMore",
    "editor.indentLess",
    "editor.toggleBold",
    "editor.toggleItalic",
    "editor.toggleStrikethrough",
    "editor.toggleInlineCode",
    "editor.toggleHighlight",
    "editor.insertLink",
];

/**
 * @constant EDITOR_NATIVE_FALLBACK_SHORTCUTS
 * @description 编辑器默认快捷键回退集合；用于拦截 CodeMirror/浏览器内置链路。
 */
export const EDITOR_NATIVE_FALLBACK_SHORTCUTS: Record<EditorNativeCommandId, string[]> = {
    "editor.undo": ["Cmd+Z", "Ctrl+Z"],
    "editor.redo": ["Cmd+Shift+Z", "Cmd+Y", "Ctrl+Shift+Z", "Ctrl+Y"],
    "editor.selectAll": ["Cmd+A", "Ctrl+A"],
    "editor.find": ["Cmd+F", "Ctrl+F"],
    "editor.toggleComment": ["Cmd+/", "Ctrl+/"],
    "editor.indentMore": ["Cmd+]", "Ctrl+]"],
    "editor.indentLess": ["Cmd+[", "Ctrl+["],
    "editor.toggleBold": ["Cmd+B", "Ctrl+B"],
    "editor.toggleItalic": ["Cmd+I", "Ctrl+I"],
    "editor.toggleStrikethrough": ["Cmd+Shift+X", "Ctrl+Shift+X"],
    "editor.toggleInlineCode": ["Cmd+E", "Ctrl+E"],
    "editor.toggleHighlight": ["Cmd+Shift+H", "Ctrl+Shift+H"],
    "editor.insertLink": ["Cmd+K", "Ctrl+K"],
};

/**
 * @function collectManagedEditorShortcutCandidates
 * @description 汇总编辑器受管快捷键候选集合，用于阻断默认快捷键链路。
 * @param bindings 当前快捷键绑定。
 * @returns 候选快捷键字符串数组。
 */
export function collectManagedEditorShortcutCandidates(bindings: Record<CommandId, string>): string[] {
    const candidates = new Set<string>();

    EDITOR_MANAGED_NATIVE_COMMAND_IDS.forEach((commandId) => {
        const configuredShortcut = bindings[commandId]?.trim() ?? "";
        if (configuredShortcut.length > 0) {
            candidates.add(configuredShortcut);
        }

        const defaultShortcut = COMMAND_DEFINITIONS[commandId].shortcut?.defaultBinding?.trim() ?? "";
        if (defaultShortcut.length > 0) {
            candidates.add(defaultShortcut);
        }

        EDITOR_NATIVE_FALLBACK_SHORTCUTS[commandId].forEach((shortcut) => {
            if (shortcut.trim().length > 0) {
                candidates.add(shortcut);
            }
        });
    });

    return [...candidates];
}
