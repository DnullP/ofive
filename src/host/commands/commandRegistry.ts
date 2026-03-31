/**
 * @module host/commands/commandRegistry
 * @description 前端命令注册表：管理内置命令与插件命令的注册、查询和执行。
 * @dependencies
 *  - ./builtins
 *  - ./commandTypes
 *  - ./shortcutGovernance
 *  - ./shortcutPolicies
 *
 * @example
 *   registerCommand({ id: "demo.open", title: "demo.open", execute: () => undefined });
 *
 * @exports
 *   - registerCommand 注册单条命令
 *   - registerCommands 批量注册命令
 *   - unregisterCommand 注销命令
 *   - subscribeCommands 订阅命令变更
 *   - getCommandDefinition 获取命令定义
 *   - executeCommand 执行命令
 *   - getEditableShortcutCommandDefinitions 获取可编辑快捷键命令
 *   - getCommandDefinitions 获取全部命令定义
 *   - isEditorScopedCommand 判断编辑器作用域
 *   - getCommandRouteClass 获取快捷键路由域
 *   - getCommandBindingPolicy 获取绑定策略
 *   - getCommandCondition 获取单条件
 *   - getCommandConditions 获取全部条件
 */

import { COMMAND_DEFINITIONS } from "./builtins";
import type {
    BuiltinCommandId,
    CommandContext,
    CommandDefinition,
    CommandId,
} from "./commandTypes";
import type { ShortcutCondition } from "../conditions/conditionEvaluator";
import type { CommandRouteClass } from "./shortcutGovernance";
import type { ShortcutBindingPolicy } from "./shortcutPolicies";

const builtinCommandIds = new Set<string>(Object.keys(COMMAND_DEFINITIONS));
const commandDefinitionsMap = new Map<string, CommandDefinition>(
    Object.values(COMMAND_DEFINITIONS).map((definition) => [definition.id, definition]),
);
const commandListeners = new Set<() => void>();
let cachedCommandDefinitions = Array.from(commandDefinitionsMap.values());

/**
 * @function emitCommandRegistry
 * @description 广播命令注册表变化。
 * @returns 无返回值。
 */
function emitCommandRegistry(): void {
    cachedCommandDefinitions = Array.from(commandDefinitionsMap.values());
    commandListeners.forEach((listener) => listener());
}

/**
 * @function registerCommand
 * @description 注册单条命令定义；若 id 已存在则覆盖。
 * @param definition 命令定义。
 * @returns 取消注册函数。
 */
export function registerCommand(definition: CommandDefinition): () => void {
    commandDefinitionsMap.set(definition.id, definition);
    console.info("[command-system] registered command", {
        commandId: definition.id,
    });
    emitCommandRegistry();

    return () => {
        unregisterCommand(definition.id);
    };
}

/**
 * @function registerCommands
 * @description 批量注册多条命令定义。
 * @param definitions 命令定义列表。
 * @returns 取消注册函数。
 */
export function registerCommands(definitions: CommandDefinition[]): () => void {
    const cleanupFns = definitions.map((definition) => registerCommand(definition));
    return () => {
        cleanupFns.forEach((cleanup) => cleanup());
    };
}

/**
 * @function unregisterCommand
 * @description 注销指定命令；若是内置命令则恢复为默认定义。
 * @param commandId 命令 id。
 * @returns 无返回值。
 */
export function unregisterCommand(commandId: CommandId): void {
    if (builtinCommandIds.has(commandId)) {
        const builtinDefinition = COMMAND_DEFINITIONS[commandId as BuiltinCommandId];
        commandDefinitionsMap.set(commandId, builtinDefinition);
        emitCommandRegistry();
        return;
    }

    if (!commandDefinitionsMap.has(commandId)) {
        return;
    }

    commandDefinitionsMap.delete(commandId);
    console.info("[command-system] unregistered command", { commandId });
    emitCommandRegistry();
}

/**
 * @function subscribeCommands
 * @description 订阅命令注册表变化。
 * @param listener 监听函数。
 * @returns 取消订阅函数。
 */
export function subscribeCommands(listener: () => void): () => void {
    commandListeners.add(listener);
    return () => {
        commandListeners.delete(listener);
    };
}

/**
 * @function getCommandDefinition
 * @description 获取单条命令定义。
 * @param commandId 命令 id。
 * @returns 命令定义；未找到时返回 undefined。
 */
export function getCommandDefinition(commandId: CommandId): CommandDefinition | undefined {
    return commandDefinitionsMap.get(commandId);
}

/**
 * @function executeCommand
 * @description 执行指定指令。
 * @param commandId 指令 id。
 * @param context 指令执行上下文。
 * @returns 无返回值。
 */
export function executeCommand(commandId: CommandId, context: CommandContext): void {
    const command = getCommandDefinition(commandId);
    if (!command) {
        console.warn("[command-system] command not found", { commandId });
        return;
    }

    console.info("[command-system] execute", { commandId });
    const executeResult = command.execute(context);
    if (executeResult instanceof Promise) {
        void executeResult.catch((error) => {
            console.error("[command-system] execute failed", {
                commandId,
                error: error instanceof Error ? error.message : String(error),
            });
        });
    }
}

/**
 * @function getEditableShortcutCommandDefinitions
 * @description 获取可在设置页编辑快捷键的指令定义列表。
 * @returns 指令定义数组。
 */
export function getEditableShortcutCommandDefinitions(): CommandDefinition[] {
    return getCommandDefinitions().filter((command) => command.shortcut?.editableInSettings === true);
}

/**
 * @function getCommandDefinitions
 * @description 获取系统内全部指令定义。
 * @returns 指令定义数组。
 */
export function getCommandDefinitions(): CommandDefinition[] {
    return cachedCommandDefinitions;
}

/**
 * @function isEditorScopedCommand
 * @description 判断是否为编辑器作用域指令。
 * @param commandId 指令 id。
 * @returns 编辑器作用域返回 true。
 */
export function isEditorScopedCommand(commandId: CommandId): boolean {
    return (getCommandDefinition(commandId)?.scope ?? "global") === "editor";
}

/**
 * @function getCommandRouteClass
 * @description 获取命令快捷键路由域。
 * @param commandId 指令 id。
 * @returns 路由域。
 */
export function getCommandRouteClass(commandId: CommandId): CommandRouteClass {
    const definition = getCommandDefinition(commandId);
    if (!definition) {
        return "frontend-window";
    }

    if (definition.routeClass) {
        return definition.routeClass;
    }

    return definition.scope === "editor" ? "frontend-editor" : "frontend-window";
}

/**
 * @function getCommandBindingPolicy
 * @description 获取命令快捷键绑定策略。
 * @param commandId 指令 id。
 * @returns 绑定策略。
 */
export function getCommandBindingPolicy(commandId: CommandId): ShortcutBindingPolicy {
    return getCommandDefinition(commandId)?.shortcut?.bindingPolicy ?? "user-configurable";
}

/**
 * @function getCommandCondition
 * @description 获取指令的触发条件。
 * @param commandId 指令 id。
 * @returns 条件标识；无条件时返回 undefined。
 */
export function getCommandCondition(commandId: CommandId): ShortcutCondition | undefined {
    return getCommandDefinition(commandId)?.condition;
}

/**
 * @function getCommandConditions
 * @description 获取指令全部触发条件，兼容单条件字段与复合条件列表。
 * @param commandId 指令 id。
 * @returns 条件数组；无条件时返回空数组。
 */
export function getCommandConditions(commandId: CommandId): ShortcutCondition[] {
    const definition = getCommandDefinition(commandId);
    if (!definition) {
        return [];
    }

    const conditions = [...(definition.conditions ?? [])];
    if (definition.condition) {
        conditions.unshift(definition.condition);
    }

    return [...new Set(conditions)];
}