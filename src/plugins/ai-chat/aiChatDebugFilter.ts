/**
 * @module plugins/ai-chat/aiChatDebugFilter
 * @description AI 调试日志过滤模块：负责归一化调试等级并按选定等级过滤日志条目。
 * @dependencies
 *   - none
 *
 * @example
 *   const visible = filterChatDebugEntries(entries, "error");
 */

export type ChatDebugLevel = "debug" | "info" | "warn" | "error";

export type ChatDebugFilterValue = "all" | ChatDebugLevel;

export interface ChatDebugEntryLike {
    level: ChatDebugLevel;
}

/**
 * @function normalizeChatDebugLevel
 * @description 将后端传来的调试等级归一化为前端支持的等级值。
 * @param level 原始等级字符串。
 * @returns 合法调试等级；无法识别时回退为 `debug`。
 */
export function normalizeChatDebugLevel(level: string | null | undefined): ChatDebugLevel {
    switch ((level ?? "").trim().toLowerCase()) {
    case "error":
    case "warn":
    case "info":
    case "debug":
        return (level ?? "debug").trim().toLowerCase() as ChatDebugLevel;
    default:
        return "debug";
    }
}

/**
 * @function filterChatDebugEntries
 * @description 按等级过滤调试日志条目。
 * @param entries 原始日志列表。
 * @param filter 当前过滤条件。
 * @returns 过滤后的日志列表。
 */
export function filterChatDebugEntries<T extends ChatDebugEntryLike>(
    entries: T[],
    filter: ChatDebugFilterValue,
): T[] {
    if (filter === "all") {
        return entries;
    }

    return entries.filter((entry) => entry.level === filter);
}