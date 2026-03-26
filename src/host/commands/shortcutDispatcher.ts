/**
 * @module host/commands/shortcutDispatcher
 * @description 统一快捷键调度模块：收敛全局层与编辑器层的快捷键命中、条件判断与消费决策。
 * @dependencies
 *  - ./commandSystem
 *  - ./focusContext
 *  - ./systemShortcutSubsystem
 *  - ../store/shortcutStore
 *
 * @example
 *   const result = dispatchShortcut({
 *       event,
 *       bindings,
 *       source: "global",
 *       conditionContext: createConditionContext({ focusedComponent: detectFocusedComponentFromEvent(event) }),
 *   });
 */

import {
    getCommandConditions,
    isEditorScopedCommand,
    type CommandId,
} from "./commandSystem";
import {
    createConditionContext,
    evaluateConditions,
    type ConditionContext,
} from "../conditions/conditionEvaluator";
import { resolveSystemShortcutCommand } from "./systemShortcutSubsystem";
import { matchShortcut } from "../store/shortcutStore";

/**
 * @type ShortcutDispatchSource
 * @description 快捷键事件来源层级。
 */
export type ShortcutDispatchSource = "global" | "editor";

/**
 * @interface ShortcutDispatchRequest
 * @description 快捷键调度输入。
 */
export interface ShortcutDispatchRequest {
    /** 原始键盘事件。 */
    event: KeyboardEvent;
    /** 当前快捷键绑定快照。 */
    bindings: Record<CommandId, string>;
    /** 事件来源层级。 */
    source: ShortcutDispatchSource;
    /** 当前条件上下文。 */
    conditionContext: ConditionContext;
    /** 编辑器托管的候选快捷键集合，仅 editor 来源使用。 */
    managedShortcutCandidates?: string[];
}

/**
 * @type ShortcutDispatchReason
 * @description 快捷键调度决策原因。
 */
export type ShortcutDispatchReason =
    | "system-binding"
    | "system-reserved"
    | "conditioned-match"
    | "unconditioned-match"
    | "managed-editor-shortcut"
    | "editor-command-deferred"
    | "no-match";

/**
 * @interface ShortcutDispatchResult
 * @description 快捷键调度结果。
 */
export interface ShortcutDispatchResult {
    /** 决策类型。 */
    kind: "execute" | "block-native" | "none";
    /** 命中的命令 ID。 */
    commandId: CommandId | null;
    /** 是否需要阻止默认行为。 */
    shouldPreventDefault: boolean;
    /** 是否需要停止事件传播。 */
    shouldStopPropagation: boolean;
    /** 是否需要广播关闭标签页快捷键信号。 */
    notifyTabClose: boolean;
    /** 调度决策原因。 */
    reason: ShortcutDispatchReason;
}

/**
 * @function buildNoneResult
 * @description 构建未命中的默认结果。
 * @param reason 未命中原因。
 * @returns 调度结果。
 */
function buildNoneResult(reason: ShortcutDispatchReason): ShortcutDispatchResult {
    return {
        kind: "none",
        commandId: null,
        shouldPreventDefault: false,
        shouldStopPropagation: false,
        notifyTabClose: false,
        reason,
    };
}

/**
 * @function buildExecuteResult
 * @description 构建执行命令结果。
 * @param commandId 命中的命令。
 * @param reason 命中原因。
 * @returns 调度结果。
 */
function buildExecuteResult(
    commandId: CommandId,
    reason: Extract<ShortcutDispatchReason, "system-binding" | "system-reserved" | "conditioned-match" | "unconditioned-match">,
): ShortcutDispatchResult {
    return {
        kind: "execute",
        commandId,
        shouldPreventDefault: true,
        shouldStopPropagation: true,
        notifyTabClose: commandId === "tab.closeFocused",
        reason,
    };
}

/**
 * @function buildBlockNativeResult
 * @description 构建仅阻断原生快捷键链路的结果。
 * @returns 调度结果。
 */
function buildBlockNativeResult(): ShortcutDispatchResult {
    return {
        kind: "block-native",
        commandId: null,
        shouldPreventDefault: true,
        shouldStopPropagation: true,
        notifyTabClose: false,
        reason: "managed-editor-shortcut",
    };
}

/**
 * @function findMatchingCommandIds
 * @description 找到与当前键盘事件匹配的命令列表。
 * @param event 键盘事件。
 * @param bindings 当前绑定。
 * @returns 命中的命令 ID 数组。
 */
function findMatchingCommandIds(
    event: KeyboardEvent,
    bindings: Record<CommandId, string>,
): CommandId[] {
    return Object.entries(bindings)
        .filter(([, shortcut]) => matchShortcut(event, shortcut))
        .map(([id]) => id as CommandId);
}

/**
 * @function dispatchGlobalShortcut
 * @description 处理窗口层快捷键仲裁。
 * @param request 调度输入。
 * @returns 调度结果。
 */
function dispatchGlobalShortcut(
    request: ShortcutDispatchRequest,
): ShortcutDispatchResult {
    const systemShortcutResolution = resolveSystemShortcutCommand(request.event, request.bindings);
    if (systemShortcutResolution) {
        return buildExecuteResult(
            systemShortcutResolution.commandId,
            systemShortcutResolution.source === "binding" ? "system-binding" : "system-reserved",
        );
    }

    const matchingCommandIds = findMatchingCommandIds(request.event, request.bindings);
    if (matchingCommandIds.length === 0) {
        return buildNoneResult("no-match");
    }

    const conditionedMatch = matchingCommandIds.find((id) => {
        const conditions = getCommandConditions(id);
        return conditions.length > 0 && evaluateConditions(conditions, request.conditionContext);
    });

    const unconditionedMatch = matchingCommandIds.find((id) => {
        const conditions = getCommandConditions(id);
        return conditions.length === 0 && !isEditorScopedCommand(id);
    });

    const commandId = conditionedMatch ?? unconditionedMatch ?? null;
    if (!commandId) {
        return buildNoneResult("no-match");
    }

    if (isEditorScopedCommand(commandId)) {
        return buildNoneResult("editor-command-deferred");
    }

    return buildExecuteResult(
        commandId,
        conditionedMatch ? "conditioned-match" : "unconditioned-match",
    );
}

/**
 * @function dispatchEditorShortcut
 * @description 处理编辑器层快捷键仲裁。
 * @param request 调度输入。
 * @returns 调度结果。
 */
function dispatchEditorShortcut(
    request: ShortcutDispatchRequest,
): ShortcutDispatchResult {
    const systemShortcutResolution = resolveSystemShortcutCommand(request.event, request.bindings);
    if (systemShortcutResolution) {
        return buildExecuteResult(
            systemShortcutResolution.commandId,
            systemShortcutResolution.source === "binding" ? "system-binding" : "system-reserved",
        );
    }

    const commandId = findMatchingCommandIds(request.event, request.bindings).find((id) => {
        const conditions = getCommandConditions(id);
        return evaluateConditions(conditions, request.conditionContext);
    });

    if (commandId) {
        return buildExecuteResult(commandId, "conditioned-match");
    }

    const shouldBlockNativeShortcut = (request.managedShortcutCandidates ?? []).some((shortcut) =>
        matchShortcut(request.event, shortcut),
    );
    if (shouldBlockNativeShortcut) {
        return buildBlockNativeResult();
    }

    return buildNoneResult("no-match");
}

/**
 * @function dispatchShortcut
 * @description 统一快捷键调度入口，根据来源层级委派到对应仲裁逻辑。
 * @param request 调度输入。
 * @returns 调度结果。
 */
export function dispatchShortcut(
    request: ShortcutDispatchRequest,
): ShortcutDispatchResult {
    const normalizedRequest: ShortcutDispatchRequest = {
        ...request,
        conditionContext: createConditionContext(request.conditionContext),
    };

    if (normalizedRequest.source === "editor") {
        return dispatchEditorShortcut(normalizedRequest);
    }

    return dispatchGlobalShortcut(normalizedRequest);
}