/**
 * @module host/commands/shortcutGovernance
 * @description 快捷键治理模块：提供路由/策略解释、冲突分析与设置页状态摘要。
 * @dependencies
 *  - ./shortcutPolicies
 */

import {
    allowsSystemReservedBinding,
    isSystemReservedBinding,
    type ShortcutBindingPolicy,
} from "./shortcutPolicies";
import type { ShortcutCondition } from "../conditions/conditionEvaluator";

/**
 * @type CommandRouteClass
 * @description 命令快捷键路由域。
 */
export type CommandRouteClass =
    | "frontend-window"
    | "frontend-editor"
    | "native-reserved";

/**
 * @interface ShortcutGovernanceCommand
 * @description 参与快捷键治理分析的命令元信息。
 */
export interface ShortcutGovernanceCommand {
    id: string;
    title: string;
    routeClass: CommandRouteClass;
    bindingPolicy: ShortcutBindingPolicy;
    condition?: ShortcutCondition;
    conditions?: ShortcutCondition[];
}

/**
 * @type ShortcutGovernanceIssueType
 * @description 快捷键治理问题类型。
 */
export type ShortcutGovernanceIssueType =
    | "reserved-binding-not-allowed"
    | "hard-conflict"
    | "conditional-overlap";

/**
 * @interface ShortcutGovernanceIssue
 * @description 单条快捷键治理问题。
 */
export interface ShortcutGovernanceIssue {
    type: ShortcutGovernanceIssueType;
    severity: "error" | "warning" | "info";
    binding: string;
    relatedCommandIds: string[];
}

/**
 * @interface ShortcutGovernanceSummary
 * @description 单条命令的快捷键治理摘要。
 */
export interface ShortcutGovernanceSummary {
    commandId: string;
    binding: string;
    routeClass: CommandRouteClass;
    bindingPolicy: ShortcutBindingPolicy;
    issues: ShortcutGovernanceIssue[];
}

/**
 * @function resolveCommandConditions
 * @description 解析命令的完整条件列表。
 * @param command 命令元信息。
 * @returns 条件数组。
 */
function resolveCommandConditions(command: ShortcutGovernanceCommand): ShortcutCondition[] {
    const conditions = [...(command.conditions ?? [])];
    if (command.condition) {
        conditions.unshift(command.condition);
    }
    return [...new Set(conditions)];
}

/**
 * @function hasHardConflict
 * @description 判断两组条件是否构成硬冲突。
 * @param left 左侧条件。
 * @param right 右侧条件。
 * @returns 硬冲突返回 true。
 */
function hasHardConflict(
    left: ShortcutCondition[],
    right: ShortcutCondition[],
): boolean {
    if (left.length === 0 || right.length === 0) {
        return true;
    }

    if (left.length !== right.length) {
        return false;
    }

    return left.every((condition) => right.includes(condition));
}

/**
 * @function analyzeShortcutGovernance
 * @description 基于命令元信息与绑定快照生成快捷键治理摘要。
 * @param commands 命令定义数组。
 * @param bindings 当前绑定快照。
 * @returns 按 commandId 索引的治理摘要。
 */
export function analyzeShortcutGovernance(
    commands: ShortcutGovernanceCommand[],
    bindings: Record<string, string>,
): Record<string, ShortcutGovernanceSummary> {
    const byId = new Map(commands.map((command) => [command.id, command]));
    const bindingGroups = new Map<string, string[]>();

    Object.entries(bindings).forEach(([commandId, binding]) => {
        if (!binding || binding.trim().length === 0) {
            return;
        }

        const current = bindingGroups.get(binding) ?? [];
        current.push(commandId);
        bindingGroups.set(binding, current);
    });

    return commands.reduce((accumulator, command) => {
        const binding = bindings[command.id] ?? "";
        const issues: ShortcutGovernanceIssue[] = [];

        if (binding && isSystemReservedBinding(binding) && !allowsSystemReservedBinding(command.bindingPolicy)) {
            issues.push({
                type: "reserved-binding-not-allowed",
                severity: "error",
                binding,
                relatedCommandIds: [],
            });
        }

        const sameBindingCommandIds = (bindingGroups.get(binding) ?? []).filter((id) => id !== command.id);
        if (binding && sameBindingCommandIds.length > 0) {
            const ownConditions = resolveCommandConditions(command);
            const hardConflictIds: string[] = [];
            const conditionalOverlapIds: string[] = [];

            sameBindingCommandIds.forEach((otherId) => {
                const otherCommand = byId.get(otherId);
                if (!otherCommand) {
                    return;
                }

                const otherConditions = resolveCommandConditions(otherCommand);
                if (hasHardConflict(ownConditions, otherConditions)) {
                    hardConflictIds.push(otherId);
                } else {
                    conditionalOverlapIds.push(otherId);
                }
            });

            if (hardConflictIds.length > 0) {
                issues.push({
                    type: "hard-conflict",
                    severity: "warning",
                    binding,
                    relatedCommandIds: hardConflictIds,
                });
            }

            if (conditionalOverlapIds.length > 0) {
                issues.push({
                    type: "conditional-overlap",
                    severity: "info",
                    binding,
                    relatedCommandIds: conditionalOverlapIds,
                });
            }
        }

        accumulator[command.id] = {
            commandId: command.id,
            binding,
            routeClass: command.routeClass,
            bindingPolicy: command.bindingPolicy,
            issues,
        };

        return accumulator;
    }, {} as Record<string, ShortcutGovernanceSummary>);
}