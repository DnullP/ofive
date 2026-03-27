/**
 * @module plugins/ai-chat/aiChatStreamState
 * @description AI 聊天流式状态辅助模块：负责 stream binding、debug/confirmation 派生与事件状态迁移。
 * @dependencies
 *   - ../../api/aiApi
 *
 * @example
 *   const transition = reduceAiChatStreamEvent({
 *     payload,
 *     binding,
 *     debugEntryId: "debug-1",
 *     debugFallbackTitle: "Debug trace",
 *     confirmationFallbackHint: "This action will modify the vault.",
 *   });
 *
 * @exports
 *   - ChatDebugEntry
 *   - PendingStreamBinding
 *   - PendingToolConfirmation
 *   - AiChatStreamTransition
 *   - createEmptyPendingStreamBinding
 *   - createPendingStreamBinding
 *   - reduceAiChatStreamEvent
 */

import type { AiChatStreamEventPayload } from "../../api/aiApi";

export interface ChatDebugEntry {
    id: string;
    streamId: string;
    title: string;
    text: string;
}

export interface PendingStreamBinding {
    streamId: string | null;
    conversationId: string | null;
    sessionId: string | null;
    assistantMessageId: string | null;
}

export interface PendingToolConfirmation {
    confirmationId: string;
    sessionId: string;
    assistantMessageId: string;
    conversationId: string;
    hint: string;
    toolName: string;
    toolArgsJson: string;
    isSubmitting: boolean;
}

export interface AiChatStreamTransition {
    matchesBinding: boolean;
    nextBinding: PendingStreamBinding;
    nextAssistantText: string | null;
    nextDebugEntry: ChatDebugEntry | null;
    nextConfirmation: PendingToolConfirmation | null;
    errorMessage: string | null;
    shouldStopStreaming: boolean;
    shouldClearPendingConfirmation: boolean;
    isDone: boolean;
}

export interface ReduceAiChatStreamEventInput {
    payload: AiChatStreamEventPayload;
    binding: PendingStreamBinding;
    debugEntryId: string;
    debugFallbackTitle: string;
    confirmationFallbackHint: string;
}

export function createEmptyPendingStreamBinding(): PendingStreamBinding {
    return {
        streamId: null,
        conversationId: null,
        sessionId: null,
        assistantMessageId: null,
    };
}

export function createPendingStreamBinding(
    conversationId: string,
    sessionId: string,
    assistantMessageId: string,
    streamId: string | null = null,
): PendingStreamBinding {
    return {
        streamId,
        conversationId,
        sessionId,
        assistantMessageId,
    };
}

export function reduceAiChatStreamEvent(
    input: ReduceAiChatStreamEventInput,
): AiChatStreamTransition {
    const {
        payload,
        binding,
        debugEntryId,
        debugFallbackTitle,
        confirmationFallbackHint,
    } = input;

    if (!binding.assistantMessageId || !binding.conversationId) {
        return {
            matchesBinding: false,
            nextBinding: binding,
            nextAssistantText: null,
            nextDebugEntry: null,
            nextConfirmation: null,
            errorMessage: null,
            shouldStopStreaming: false,
            shouldClearPendingConfirmation: false,
            isDone: false,
        };
    }

    const nextBinding = !binding.streamId
        ? {
            ...binding,
            streamId: payload.streamId,
        }
        : binding;

    if (nextBinding.streamId !== payload.streamId) {
        return {
            matchesBinding: false,
            nextBinding,
            nextAssistantText: null,
            nextDebugEntry: null,
            nextConfirmation: null,
            errorMessage: null,
            shouldStopStreaming: false,
            shouldClearPendingConfirmation: false,
            isDone: false,
        };
    }

    if (payload.eventType === "debug") {
        return {
            matchesBinding: true,
            nextBinding,
            nextAssistantText: null,
            nextDebugEntry: {
                id: debugEntryId,
                streamId: payload.streamId,
                title: payload.debugTitle ?? debugFallbackTitle,
                text: payload.debugText ?? "",
            },
            nextConfirmation: null,
            errorMessage: null,
            shouldStopStreaming: false,
            shouldClearPendingConfirmation: false,
            isDone: false,
        };
    }

    if (payload.eventType === "confirmation") {
        const confirmation = payload.confirmationId && payload.sessionId
            ? {
                confirmationId: payload.confirmationId,
                sessionId: payload.sessionId,
                assistantMessageId: nextBinding.assistantMessageId!,
                conversationId: nextBinding.conversationId!,
                hint: payload.confirmationHint ?? "",
                toolName: payload.confirmationToolName ?? "",
                toolArgsJson: payload.confirmationToolArgsJson ?? "{}",
                isSubmitting: false,
            }
            : null;

        return {
            matchesBinding: true,
            nextBinding: createEmptyPendingStreamBinding(),
            nextAssistantText: payload.confirmationHint ?? confirmationFallbackHint,
            nextDebugEntry: null,
            nextConfirmation: confirmation,
            errorMessage: confirmation ? null : "AI confirmation payload is incomplete",
            shouldStopStreaming: true,
            shouldClearPendingConfirmation: false,
            isDone: false,
        };
    }

    if (payload.eventType === "error") {
        return {
            matchesBinding: true,
            nextBinding: createEmptyPendingStreamBinding(),
            nextAssistantText: null,
            nextDebugEntry: null,
            nextConfirmation: null,
            errorMessage: payload.error ?? "AI stream failed",
            shouldStopStreaming: true,
            shouldClearPendingConfirmation: true,
            isDone: false,
        };
    }

    if (payload.eventType === "delta" || payload.eventType === "done") {
        return {
            matchesBinding: true,
            nextBinding: payload.eventType === "done"
                ? createEmptyPendingStreamBinding()
                : nextBinding,
            nextAssistantText: payload.accumulatedText,
            nextDebugEntry: null,
            nextConfirmation: null,
            errorMessage: null,
            shouldStopStreaming: payload.eventType === "done",
            shouldClearPendingConfirmation: payload.eventType === "done",
            isDone: payload.eventType === "done",
        };
    }

    return {
        matchesBinding: true,
        nextBinding,
        nextAssistantText: null,
        nextDebugEntry: null,
        nextConfirmation: null,
        errorMessage: null,
        shouldStopStreaming: false,
        shouldClearPendingConfirmation: false,
        isDone: false,
    };
}