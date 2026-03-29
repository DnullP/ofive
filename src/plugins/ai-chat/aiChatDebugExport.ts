/**
 * @module plugins/ai-chat/aiChatDebugExport
 * @description AI 调试日志导出模块：负责将当前会话调试日志格式化为可复制的纯文本。
 * @dependencies
 *   - ./aiChatStreamState
 *
 * @example
 *   const text = formatAiChatDebugEntriesForClipboard(entries);
 *   await navigator.clipboard.writeText(text);
 */

import type { ChatDebugEntry } from "./aiChatStreamState";

/**
 * @function formatAiChatDebugEntriesForClipboard
 * @description 将调试日志列表格式化为适合粘贴到 issue、聊天窗口或文档中的纯文本。
 * @param entries 当前会话的调试日志列表。
 * @returns 格式化后的纯文本；无日志时返回空字符串。
 */
export function formatAiChatDebugEntriesForClipboard(entries: ChatDebugEntry[]): string {
    if (entries.length === 0) {
        return "";
    }

    return entries.map((entry, index) => {
        return [
            `#${String(index + 1)} [${entry.level.toUpperCase()}] ${entry.title}`,
            `stream=${entry.streamId}`,
            entry.text,
        ].join("\n");
    }).join("\n\n---\n\n");
}