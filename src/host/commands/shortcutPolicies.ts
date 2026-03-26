/**
 * @module host/commands/shortcutPolicies
 * @description 快捷键策略常量：定义系统保留键与绑定策略辅助函数。
 * @dependencies 无
 */

/**
 * @constant SYSTEM_RESERVED_BINDINGS
 * @description 当前由宿主层保留的系统级快捷键集合。
 */
export const SYSTEM_RESERVED_BINDINGS = [
    "Cmd+W",
    "Ctrl+W",
    "Cmd+Q",
    "Ctrl+Q",
] as const;

/**
 * @type ShortcutBindingPolicy
 * @description 快捷键绑定策略。
 */
export type ShortcutBindingPolicy =
    | "user-configurable"
    | "prefer-system-reserved"
    | "system-reserved";

/**
 * @function isSystemReservedBinding
 * @description 判断给定快捷键是否属于系统保留键。
 * @param shortcut 快捷键字符串。
 * @returns 属于系统保留键时返回 true。
 */
export function isSystemReservedBinding(shortcut: string): boolean {
    return SYSTEM_RESERVED_BINDINGS.includes(shortcut as (typeof SYSTEM_RESERVED_BINDINGS)[number]);
}

/**
 * @function allowsSystemReservedBinding
 * @description 判断绑定策略是否允许使用系统保留键。
 * @param policy 绑定策略。
 * @returns 允许使用系统保留键时返回 true。
 */
export function allowsSystemReservedBinding(policy: ShortcutBindingPolicy): boolean {
    return policy === "prefer-system-reserved" || policy === "system-reserved";
}