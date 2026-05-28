/**
 * @module plugins/ai-chat/aiChatRuntimeStore
 * @description AI 聊天组件运行态缓存：在 sidebar split、tab/pane 迁移等 remount 期间保留流绑定与浏览状态。
 * @dependencies
 *   - ../../api/aiApi
 *   - ./aiChatDebugFilter
 *   - ./aiChatStreamSmoothing
 *   - ./aiChatStreamState
 *   - ./aiChatToolCallRecords
 *
 * @exports
 *   - getAiChatRuntimeSnapshot
 *   - subscribeAiChatRuntimeSnapshot
 *   - updateAiChatRuntimeSnapshot
 *   - resetAiChatRuntimeSnapshot
 */

import type { AiChatHistoryState } from "../../api/aiApi";
import type { ChatDebugFilterValue } from "./aiChatDebugFilter";
import type { AiChatSmoothedMessageState } from "./aiChatStreamSmoothing";
import type {
    ChatDebugEntry,
    PendingStreamBinding,
    PendingToolConfirmation,
} from "./aiChatStreamState";
import type { AiChatToolCallRecord } from "./aiChatToolCallRecords";

export interface AiChatEditingUserMessageState {
    conversationId: string;
    messageId: string;
    draft: string;
}

export interface AiChatRuntimeSnapshot {
    activeTab: "history" | "chat" | "debug";
    bindingsByConversation: Record<string, PendingStreamBinding>;
    conversationQuery: string;
    debugCopyState: "idle" | "copied" | "error";
    debugEntriesByConversation: Record<string, ChatDebugEntry[]>;
    debugFilter: ChatDebugFilterValue;
    draft: string;
    editingUserMessage: AiChatEditingUserMessageState | null;
    error: string | null;
    historyLoaded: boolean;
    historyState: AiChatHistoryState | null;
    isConversationReplaying: boolean;
    pendingConfirmations: Record<string, PendingToolConfirmation>;
    smoothedMessagesById: Record<string, AiChatSmoothedMessageState>;
    toolCallRecordsByMessageId: Record<string, AiChatToolCallRecord[]>;
    vaultPath: string | null;
}

function createEmptyAiChatRuntimeSnapshot(
    vaultPath: string | null = null,
): AiChatRuntimeSnapshot {
    return {
        activeTab: "chat",
        bindingsByConversation: {},
        conversationQuery: "",
        debugCopyState: "idle",
        debugEntriesByConversation: {},
        debugFilter: "all",
        draft: "",
        editingUserMessage: null,
        error: null,
        historyLoaded: false,
        historyState: null,
        isConversationReplaying: false,
        pendingConfirmations: {},
        smoothedMessagesById: {},
        toolCallRecordsByMessageId: {},
        vaultPath,
    };
}

let runtimeSnapshot = createEmptyAiChatRuntimeSnapshot();
const listeners = new Set<() => void>();

function emit(): void {
    listeners.forEach((listener) => {
        listener();
    });
}

/**
 * @function subscribeAiChatRuntimeSnapshot
 * @description 订阅 AI 聊天运行态快照变化。
 * @param listener 订阅回调。
 * @returns 取消订阅函数。
 */
export function subscribeAiChatRuntimeSnapshot(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/**
 * @function getAiChatRuntimeSnapshot
 * @description 读取当前 AI 聊天运行态快照。
 * @returns 最新运行态快照。
 */
export function getAiChatRuntimeSnapshot(): AiChatRuntimeSnapshot {
    return runtimeSnapshot;
}

/**
 * @function updateAiChatRuntimeSnapshot
 * @description 合并写入 AI 聊天运行态快照。
 * @param patch 快照局部更新。
 */
export function updateAiChatRuntimeSnapshot(
    patch: Partial<AiChatRuntimeSnapshot>,
): void {
    runtimeSnapshot = {
        ...runtimeSnapshot,
        ...patch,
    };
    emit();
}

/**
 * @function resetAiChatRuntimeSnapshot
 * @description 清空当前运行态，可选择保留新的 vault 路径占位。
 * @param vaultPath 新运行态对应的 vault 路径。
 */
export function resetAiChatRuntimeSnapshot(vaultPath: string | null = null): void {
    runtimeSnapshot = createEmptyAiChatRuntimeSnapshot(vaultPath);
    emit();
}
