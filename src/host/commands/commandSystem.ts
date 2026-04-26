/**
 * @module host/commands/commandSystem
 * @description 前端指令系统兼容入口：对外继续暴露命令类型、内置命令和注册表能力。
 * @dependencies
 *  - ./builtins
 *  - ./commandRegistry
 *  - ./commandTypes
 *
 * @example
 *   executeCommand("tab.closeFocused", { activeTabId: "file:test-resources/notes/guide.md", closeTab: (id) => api.close(id), openFileTab: () => undefined, getExistingMarkdownPaths: () => [] });
 *
 * @exports
 *   - COMMAND_DEFINITIONS 当前系统内置命令集合
 *   - 所有命令类型定义与注册表 API
 */

export { COMMAND_DEFINITIONS } from "./builtins";
export {
    executeCommand,
    getCommandBindingPolicy,
    getCommandCondition,
    getCommandConditions,
    getCommandDefinition,
    getCommandDefinitions,
    getCommandRouteClass,
    getEditableShortcutCommandDefinitions,
    isEditorScopedCommand,
    registerCommand,
    registerCommands,
    subscribeCommands,
    unregisterCommand,
} from "./commandRegistry";
export type {
    BuiltinCommandId,
    CommandContext,
    CommandDefinition,
    CommandId,
    CommandScope,
    CommandShortcutMeta,
    CreateEntryDraftRequest,
    DeleteConfirmationRequest,
    EditorNativeCommandId,
} from "./commandTypes";
