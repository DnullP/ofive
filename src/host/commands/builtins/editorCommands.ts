/**
 * @module host/commands/builtins/editorCommands
 * @description 内置编辑器命令：封装编辑器原生命令到统一指令系统。
 * @dependencies
 *  - ../commandTypes
 *
 * @example
 *   EDITOR_COMMAND_DEFINITIONS["editor.undo"].execute(context);
 *
 * @exports
 *   - EDITOR_COMMAND_DEFINITIONS 编辑器内置命令集合
 */

import type { CommandDefinition } from "../commandTypes";

/**
 * @function createEditorNativeCommandDefinition
 * @description 为编辑器原生命令生成统一的命令定义。
 * @param definition 基础命令定义。
 * @returns 完整命令定义。
 */
function createEditorNativeCommandDefinition(
    definition: Pick<CommandDefinition, "id" | "title" | "shortcut">,
): CommandDefinition {
    return {
        ...definition,
        scope: "editor",
        routeClass: "frontend-editor",
        condition: "editorFocused",
        execute(context) {
            context.executeEditorNativeCommand?.(definition.id as never);
        },
    };
}

/**
 * @constant EDITOR_COMMAND_DEFINITIONS
 * @description 编辑器内置命令集合。
 */
export const EDITOR_COMMAND_DEFINITIONS = {
    "editor.undo": createEditorNativeCommandDefinition({
        id: "editor.undo",
        title: "commands.undo",
        shortcut: {
            defaultBinding: "Cmd+Z",
            editableInSettings: true,
        },
    }),
    "editor.redo": createEditorNativeCommandDefinition({
        id: "editor.redo",
        title: "commands.redo",
        shortcut: {
            defaultBinding: "Cmd+Shift+Z",
            editableInSettings: true,
        },
    }),
    "editor.selectAll": {
        ...createEditorNativeCommandDefinition({
            id: "editor.selectAll",
            title: "commands.selectAll",
            shortcut: {
                defaultBinding: "Cmd+A",
                editableInSettings: true,
            },
        }),
        condition: "editorBodyFocused",
    },
    "editor.find": createEditorNativeCommandDefinition({
        id: "editor.find",
        title: "commands.find",
        shortcut: {
            defaultBinding: "Cmd+F",
            editableInSettings: true,
        },
    }),
    "editor.toggleComment": createEditorNativeCommandDefinition({
        id: "editor.toggleComment",
        title: "commands.toggleComment",
        shortcut: {
            defaultBinding: "Cmd+/",
            editableInSettings: true,
        },
    }),
    "editor.indentMore": createEditorNativeCommandDefinition({
        id: "editor.indentMore",
        title: "commands.increaseIndent",
        shortcut: {
            defaultBinding: "Cmd+]",
            editableInSettings: true,
        },
    }),
    "editor.indentLess": createEditorNativeCommandDefinition({
        id: "editor.indentLess",
        title: "commands.decreaseIndent",
        shortcut: {
            defaultBinding: "Cmd+[",
            editableInSettings: true,
        },
    }),
    "editor.toggleBold": createEditorNativeCommandDefinition({
        id: "editor.toggleBold",
        title: "commands.toggleBold",
        shortcut: {
            defaultBinding: "Cmd+B",
            editableInSettings: true,
        },
    }),
    "editor.toggleItalic": createEditorNativeCommandDefinition({
        id: "editor.toggleItalic",
        title: "commands.toggleItalic",
        shortcut: {
            defaultBinding: "Cmd+I",
            editableInSettings: true,
        },
    }),
    "editor.toggleStrikethrough": createEditorNativeCommandDefinition({
        id: "editor.toggleStrikethrough",
        title: "commands.toggleStrikethrough",
        shortcut: {
            defaultBinding: "Cmd+Shift+X",
            editableInSettings: true,
        },
    }),
    "editor.toggleInlineCode": createEditorNativeCommandDefinition({
        id: "editor.toggleInlineCode",
        title: "commands.toggleInlineCode",
        shortcut: {
            defaultBinding: "Cmd+E",
            editableInSettings: true,
        },
    }),
    "editor.toggleHighlight": createEditorNativeCommandDefinition({
        id: "editor.toggleHighlight",
        title: "commands.toggleHighlight",
        shortcut: {
            defaultBinding: "Cmd+Shift+H",
            editableInSettings: true,
        },
    }),
    "editor.insertLink": createEditorNativeCommandDefinition({
        id: "editor.insertLink",
        title: "commands.insertLink",
        shortcut: {
            defaultBinding: "Cmd+K",
            editableInSettings: true,
        },
    }),
    "editor.insertTask": createEditorNativeCommandDefinition({
        id: "editor.insertTask",
        title: "commands.insertTask",
        shortcut: {
            defaultBinding: "",
            editableInSettings: true,
        },
    }),
    "editor.insertFrontmatter": createEditorNativeCommandDefinition({
        id: "editor.insertFrontmatter",
        title: "commands.insertFrontmatter",
        shortcut: {
            defaultBinding: "",
            editableInSettings: true,
        },
    }),
    "editor.insertTable": createEditorNativeCommandDefinition({
        id: "editor.insertTable",
        title: "commands.insertTable",
        shortcut: {
            defaultBinding: "",
            editableInSettings: true,
        },
    }),
} satisfies Record<string, CommandDefinition>;