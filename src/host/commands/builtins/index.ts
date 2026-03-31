/**
 * @module host/commands/builtins
 * @description 内置命令聚合：按领域汇总 editor、file、window 三类内置命令定义。
 * @dependencies
 *  - ./editorCommands
 *  - ./fileCommands
 *  - ./windowCommands
 *  - ../commandTypes
 *
 * @example
 *   const definition = COMMAND_DEFINITIONS["editor.undo"];
 *
 * @exports
 *   - COMMAND_DEFINITIONS 全部内置命令定义
 */

import type { BuiltinCommandId, CommandDefinition } from "../commandTypes";
import { EDITOR_COMMAND_DEFINITIONS } from "./editorCommands";
import { FILE_COMMAND_DEFINITIONS } from "./fileCommands";
import { WINDOW_COMMAND_DEFINITIONS } from "./windowCommands";

/**
 * @constant COMMAND_DEFINITIONS
 * @description 当前系统内置指令集合。
 */
export const COMMAND_DEFINITIONS: Record<BuiltinCommandId, CommandDefinition> = {
    ...WINDOW_COMMAND_DEFINITIONS,
    ...FILE_COMMAND_DEFINITIONS,
    ...EDITOR_COMMAND_DEFINITIONS,
};