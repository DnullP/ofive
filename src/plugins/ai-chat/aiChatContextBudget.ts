/**
 * @module plugins/ai-chat/aiChatContextBudget
 * @description AI 聊天上下文预算工具：在发送前按配置压缩旧协议历史，避免长会话超过模型上下文。
 * @dependencies
 *   - ../../api/aiApi
 *
 * @exports
 *   - DEFAULT_AI_CHAT_CONTEXT_LIMIT_TOKENS
 *   - normalizeAiChatContextBudgetSettings
 *   - buildBudgetedAiChatHistory
 */

import type {
    AiChatHistoryContentBlock,
    AiChatHistoryMessage,
    AiChatSettings,
} from "../../api/aiApi";

export const DEFAULT_AI_CHAT_CONTEXT_LIMIT_TOKENS = 32000;
export const MIN_AI_CHAT_CONTEXT_LIMIT_TOKENS = 1000;
export const MAX_AI_CHAT_CONTEXT_LIMIT_TOKENS = 1000000;

export interface AiChatContextBudgetSettings {
    autoCompressContext: boolean;
    contextLimitTokens: number;
}

export interface AiChatContextBudgetResult {
    history: AiChatHistoryMessage[];
    estimatedTokensBefore: number;
    estimatedTokensAfter: number;
    compressedMessageCount: number;
    wasCompressed: boolean;
}

/**
 * @function normalizeAiChatContextBudgetSettings
 * @description 归一化 AI 上下文预算设置，为旧配置补齐默认值并限制极端输入。
 * @param settings 原始 AI 设置。
 * @returns 可直接用于请求前裁剪/压缩的预算设置。
 */
export function normalizeAiChatContextBudgetSettings(
    settings: Pick<AiChatSettings, "autoCompressContext" | "contextLimitTokens"> | null | undefined,
): AiChatContextBudgetSettings {
    const rawLimit = settings?.contextLimitTokens;
    const numericLimit = typeof rawLimit === "number" && Number.isFinite(rawLimit)
        ? Math.round(rawLimit)
        : DEFAULT_AI_CHAT_CONTEXT_LIMIT_TOKENS;

    return {
        autoCompressContext: settings?.autoCompressContext ?? true,
        contextLimitTokens: Math.min(
            MAX_AI_CHAT_CONTEXT_LIMIT_TOKENS,
            Math.max(MIN_AI_CHAT_CONTEXT_LIMIT_TOKENS, numericLimit),
        ),
    };
}

/**
 * @function buildBudgetedAiChatHistory
 * @description 根据上下文预算生成请求用协议历史，必要时把较早文本轮次压缩成摘要消息。
 * @param history 原始协议历史。
 * @param settings 上下文预算设置。
 * @returns 压缩后的历史与统计信息。
 */
export function buildBudgetedAiChatHistory(
    history: AiChatHistoryMessage[],
    settings: Pick<AiChatSettings, "autoCompressContext" | "contextLimitTokens"> | null | undefined,
): AiChatContextBudgetResult {
    const budget = normalizeAiChatContextBudgetSettings(settings);
    const estimatedTokensBefore = estimateHistoryTokens(history);

    if (!budget.autoCompressContext || estimatedTokensBefore <= budget.contextLimitTokens) {
        return {
            history,
            estimatedTokensBefore,
            estimatedTokensAfter: estimatedTokensBefore,
            compressedMessageCount: 0,
            wasCompressed: false,
        };
    }

    const recentMessages: AiChatHistoryMessage[] = [];
    let recentEstimatedTokens = 0;
    for (let index = history.length - 1; index >= 0; index -= 1) {
        const message = history[index];
        if (!message) {
            continue;
        }

        const messageTokens = estimateMessageTokens(message);
        const shouldKeepMessage = recentMessages.length < 6
            || recentEstimatedTokens + messageTokens <= Math.floor(budget.contextLimitTokens * 0.62);
        if (!shouldKeepMessage) {
            break;
        }

        recentMessages.unshift(message);
        recentEstimatedTokens += messageTokens;
    }

    if (recentMessages.length >= history.length) {
        return {
            history,
            estimatedTokensBefore,
            estimatedTokensAfter: estimatedTokensBefore,
            compressedMessageCount: 0,
            wasCompressed: false,
        };
    }

    const olderMessages = history.slice(0, history.length - recentMessages.length);
    const remainingBudget = Math.max(
        160,
        budget.contextLimitTokens - recentEstimatedTokens - 120,
    );
    const summaryText = buildCompressedHistorySummary(olderMessages, remainingBudget);
    const summaryMessage = createCompressedSummaryMessage(summaryText, olderMessages);
    const nextHistory = summaryText.trim()
        ? [summaryMessage, ...recentMessages]
        : recentMessages;
    const estimatedTokensAfter = estimateHistoryTokens(nextHistory);

    return {
        history: nextHistory,
        estimatedTokensBefore,
        estimatedTokensAfter,
        compressedMessageCount: olderMessages.length,
        wasCompressed: true,
    };
}

function estimateHistoryTokens(history: AiChatHistoryMessage[]): number {
    return history.reduce((total, message) => total + estimateMessageTokens(message), 0);
}

function estimateMessageTokens(message: AiChatHistoryMessage): number {
    return estimateTextTokens([
        message.role,
        message.text,
        message.reasoningText ?? "",
        ...(message.contentBlocks ?? []).map(serializeContentBlockForBudget),
    ].join("\n"));
}

function estimateTextTokens(text: string): number {
    const normalized = text.replace(/\s+/g, " ").trim();
    if (!normalized) {
        return 0;
    }

    return Math.max(1, Math.ceil(normalized.length / 4));
}

function serializeContentBlockForBudget(block: AiChatHistoryContentBlock): string {
    if (block.kind === "text" || block.kind === "thinking") {
        return block.text ?? "";
    }

    if (block.kind === "tool-use") {
        return [
            "tool-use",
            block.toolName ?? "",
            block.inputJson ?? "",
        ].join("\n");
    }

    return [
        "tool-result",
        block.toolName ?? "",
        block.resultJson ?? "",
    ].join("\n");
}

function buildCompressedHistorySummary(
    messages: AiChatHistoryMessage[],
    budgetTokens: number,
): string {
    const maxChars = Math.max(600, budgetTokens * 4);
    const lines: string[] = [
        "Conversation context summary (automatically compressed by ofive to fit the configured context budget):",
    ];

    messages.forEach((message) => {
        const text = summarizeMessageForBudget(message);
        if (!text) {
            return;
        }

        lines.push(`${message.role}: ${text}`);
    });

    const summary = lines.join("\n");
    if (summary.length <= maxChars) {
        return summary;
    }

    return `${summary.slice(0, Math.max(0, maxChars - 16)).trimEnd()}\n[truncated]`;
}

function summarizeMessageForBudget(message: AiChatHistoryMessage): string {
    const contentParts: string[] = [];
    const reasoningText = message.reasoningText?.replace(/\s+/g, " ").trim();
    if (reasoningText) {
        contentParts.push(`reasoning: ${reasoningText}`);
    }

    const text = message.text.replace(/\s+/g, " ").trim();
    if (text) {
        contentParts.push(text);
    }

    (message.contentBlocks ?? []).forEach((block) => {
        if (block.kind === "text" || block.kind === "thinking") {
            const blockText = block.text?.replace(/\s+/g, " ").trim();
            if (blockText) {
                contentParts.push(blockText);
            }
            return;
        }

        if (block.kind === "tool-use") {
            contentParts.push(`tool call: ${block.toolName ?? "unknown"}`);
            return;
        }

        contentParts.push(`tool result: ${block.toolName ?? block.toolUseId ?? "unknown"}`);
    });

    return contentParts.join(" | ");
}

function createCompressedSummaryMessage(
    summaryText: string,
    messages: AiChatHistoryMessage[],
): AiChatHistoryMessage {
    const firstCreatedAt = messages[0]?.createdAtUnixMs ?? Date.now();
    return {
        id: `ai-chat-context-summary-${firstCreatedAt}-${messages.length}`,
        role: "user",
        text: summaryText,
        createdAtUnixMs: firstCreatedAt,
        contentBlocks: [{
            kind: "text",
            text: summaryText,
        }],
    };
}
