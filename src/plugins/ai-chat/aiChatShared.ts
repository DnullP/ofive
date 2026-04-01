/**
 * @module plugins/ai-chat/aiChatShared
 * @description AI 聊天前端共享状态工具：负责会话标题、历史归一化、设置合并与错误展示格式化。
 * @dependencies
 *   - ../../api/aiApi
 *   - ../../i18n
 *
 * @example
 *   const historyState = ensureHistoryState(rawHistory);
 *   const display = formatAiPanelError(errorMessage);
 *
 * @exports
 *   - AiPanelErrorDisplay
 *   - resolveVendor
 *   - mergeSettingsForVendor
 *   - formatAiPanelError
 *   - createConversationSessionId
 *   - createConversationRecord
 *   - sortConversations
 *   - deriveConversationTitle
 *   - ensureHistoryState
 *   - buildPersistableHistory
 *   - filterConversations
 *   - formatConversationTime
 */

import type {
    AiChatConversationRecord,
    AiChatHistoryContentBlock,
    AiChatHistoryMessage,
    AiChatHistoryState,
    AiChatSettings,
    AiVendorDefinition,
} from "../../api/aiApi";
import i18n from "../../i18n";

/**
 * @interface AiPanelErrorDisplay
 * @description AI 面板错误展示模型。
 * @field summary 面向用户的摘要。
 * @field detail 进一步错误细节。
 */
export interface AiPanelErrorDisplay {
    summary: string;
    detail: string | null;
}

let chatConversationSequence = 1;

/**
 * @function createConversationSessionId
 * @description 为指定会话生成新的后端 sessionId。
 * @param conversationId 会话 ID。
 * @returns 唯一 sessionId。
 */
export function createConversationSessionId(conversationId: string): string {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return `ai-chat-session-${conversationId}-${crypto.randomUUID()}`;
    }

    return `ai-chat-session-${conversationId}-${Date.now()}-${String(chatConversationSequence)}`;
}

/**
 * @function nextConversationId
 * @description 生成会话唯一 ID。
 * @returns 会话 ID。
 */
function nextConversationId(): string {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return crypto.randomUUID();
    }

    const nextId = `ai-chat-conversation-${Date.now()}-${String(chatConversationSequence)}`;
    chatConversationSequence += 1;
    return nextId;
}

/**
 * @function resolveVendor
 * @description 根据 vendorId 在目录中查找 vendor 定义。
 * @param vendorCatalog vendor 列表。
 * @param vendorId vendor 标识。
 * @returns 对应 vendor 或 null。
 */
export function resolveVendor(
    vendorCatalog: AiVendorDefinition[],
    vendorId: string,
): AiVendorDefinition | null {
    return vendorCatalog.find((vendor) => vendor.id === vendorId) ?? null;
}

/**
 * @function mergeSettingsForVendor
 * @description 将当前设置与目标 vendor 的字段定义合并。
 * @param currentSettings 当前设置。
 * @param vendor 目标 vendor。
 * @returns 合并后的设置。
 */
export function mergeSettingsForVendor(
    currentSettings: AiChatSettings,
    vendor: AiVendorDefinition,
): AiChatSettings {
    const isSameVendor = currentSettings.vendorId === vendor.id;
    const nextFieldValues: Record<string, string> = {};
    vendor.fields.forEach((field) => {
        const currentValue = currentSettings.fieldValues[field.key];
        if (isSameVendor && currentValue !== undefined) {
            nextFieldValues[field.key] = currentValue;
            return;
        }

        nextFieldValues[field.key] = field.defaultValue ?? "";
    });

    return {
        vendorId: vendor.id,
        model: isSameVendor
            ? currentSettings.model || vendor.defaultModel
            : vendor.defaultModel,
        fieldValues: nextFieldValues,
    };
}

/**
 * @function formatAiPanelError
 * @description 将后端错误拆分为适合侧栏展示的摘要和详情。
 * @param rawError 原始错误文本。
 * @returns 展示用错误对象。
 */
export function formatAiPanelError(rawError: string): AiPanelErrorDisplay {
    const trimmed = rawError.trim();
    if (!trimmed) {
        return {
            summary: "AI request failed",
            detail: null,
        };
    }

    const firstSeparatorIndex = trimmed.indexOf(": ");
    if (firstSeparatorIndex <= 0) {
        return {
            summary: trimmed,
            detail: null,
        };
    }

    return {
        summary: trimmed.slice(0, firstSeparatorIndex).trim() || trimmed,
        detail: trimmed.slice(firstSeparatorIndex + 2).trim() || null,
    };
}

/**
 * @function createConversationRecord
 * @description 创建空会话记录。
 * @returns 新会话记录。
 */
export function createConversationRecord(): AiChatConversationRecord {
    const now = Date.now();
    const id = nextConversationId();
    return {
        id,
        sessionId: createConversationSessionId(id),
        title: i18n.t("aiChatPlugin.untitledConversation"),
        createdAtUnixMs: now,
        updatedAtUnixMs: now,
        messages: [],
        protocolMessages: [],
    };
}

/**
 * @function buildFallbackProtocolMessages
 * @description 从可见消息构建最小可用的协议历史，兼容旧版持久化数据。
 * @param messages 可见消息列表。
 * @returns 协议历史消息列表。
 */
function buildFallbackProtocolMessages(
    messages: AiChatHistoryMessage[],
): AiChatHistoryMessage[] {
    return messages
        .filter((message) => {
            return message.text.trim().length > 0 ||
                (message.reasoningText ?? "").trim().length > 0 ||
                (message.contentBlocks?.length ?? 0) > 0;
        })
        .map((message) => {
            const contentBlocks = message.contentBlocks?.length
                ? message.contentBlocks
                : buildContentBlocksFromVisibleMessage(message);

            return {
                ...message,
                contentBlocks,
            };
        });
}

/**
 * @function buildContentBlocksFromVisibleMessage
 * @description 从当前可见消息派生最小协议块集合。
 * @param message 可见消息。
 * @returns 协议内容块。
 */
function buildContentBlocksFromVisibleMessage(
    message: AiChatHistoryMessage,
): AiChatHistoryContentBlock[] {
    const blocks: AiChatHistoryContentBlock[] = [];
    if ((message.reasoningText ?? "").trim()) {
        blocks.push({
            kind: "thinking",
            text: message.reasoningText?.trim(),
        });
    }
    if (message.text.trim()) {
        blocks.push({
            kind: "text",
            text: message.text.trim(),
        });
    }
    return blocks;
}

/**
 * @function sortConversations
 * @description 按更新时间倒序排列会话。
 * @param conversations 会话列表。
 * @returns 排序结果。
 */
export function sortConversations(
    conversations: AiChatConversationRecord[],
): AiChatConversationRecord[] {
    return [...conversations].sort((left, right) => {
        if (left.updatedAtUnixMs === right.updatedAtUnixMs) {
            return left.createdAtUnixMs - right.createdAtUnixMs;
        }
        return right.updatedAtUnixMs - left.updatedAtUnixMs;
    });
}

/**
 * @function deriveConversationTitle
 * @description 根据首条用户消息生成会话标题。
 * @param messages 会话消息。
 * @returns 标题文本。
 */
export function deriveConversationTitle(
    messages: AiChatHistoryMessage[],
): string {
    const firstUserMessage = messages.find((message) => {
        return message.role === "user" && message.text.trim().length > 0;
    });
    if (!firstUserMessage) {
        return i18n.t("aiChatPlugin.untitledConversation");
    }

    const normalized = firstUserMessage.text.replace(/\s+/g, " ").trim();
    if (normalized.length <= 26) {
        return normalized;
    }
    return `${normalized.slice(0, 26).trimEnd()}...`;
}

/**
 * @function ensureHistoryState
 * @description 保证历史状态始终有一个可用会话。
 * @param history 历史状态。
 * @returns 修正后的历史状态。
 */
export function ensureHistoryState(
    history: AiChatHistoryState,
): AiChatHistoryState {
    if (history.conversations.length === 0) {
        const conversation = createConversationRecord();
        return {
            activeConversationId: conversation.id,
            conversations: [conversation],
        };
    }

    const activeConversationId = history.activeConversationId
        && history.conversations.some((conversation) => {
            return conversation.id === history.activeConversationId;
        })
        ? history.activeConversationId
        : history.conversations[0]?.id ?? null;

    return {
        activeConversationId,
        conversations: sortConversations(history.conversations.map((conversation) => ({
            ...conversation,
            protocolMessages: conversation.protocolMessages?.length
                ? conversation.protocolMessages
                : buildFallbackProtocolMessages(conversation.messages),
        }))),
    };
}

/**
 * @function buildPersistableHistory
 * @description 生成可持久化的历史状态。
 * @param historyState 当前历史状态。
 * @returns 过滤后的历史状态。
 */
export function buildPersistableHistory(
    historyState: AiChatHistoryState,
): AiChatHistoryState {
    return {
        activeConversationId: historyState.activeConversationId,
        conversations: sortConversations(historyState.conversations).map(
            (conversation) => ({
                ...conversation,
                title: deriveConversationTitle(conversation.messages),
                messages: conversation.messages.filter((message) => {
                    return message.text.trim().length > 0 ||
                        (message.reasoningText ?? "").trim().length > 0;
                }),
                protocolMessages: (conversation.protocolMessages?.length
                    ? conversation.protocolMessages
                    : buildFallbackProtocolMessages(conversation.messages)
                ).filter((message) => {
                    return message.text.trim().length > 0 ||
                        (message.reasoningText ?? "").trim().length > 0 ||
                        (message.contentBlocks?.length ?? 0) > 0;
                }),
            }),
        ),
    };
}

/**
 * @function filterConversations
 * @description 按查询词过滤会话，匹配标题与消息正文。
 * @param conversations 会话列表。
 * @param query 查询词。
 * @returns 过滤后的会话列表。
 */
export function filterConversations(
    conversations: AiChatConversationRecord[],
    query: string,
): AiChatConversationRecord[] {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (!normalizedQuery) {
        return conversations;
    }

    return conversations.filter((conversation) => {
        if (conversation.title.toLocaleLowerCase().includes(normalizedQuery)) {
            return true;
        }

        return conversation.messages.some((message) => {
            return message.text.toLocaleLowerCase().includes(normalizedQuery) ||
                (message.reasoningText ?? "").toLocaleLowerCase().includes(normalizedQuery);
        });
    });
}

/**
 * @function formatConversationTime
 * @description 格式化会话更新时间。
 * @param timestamp 时间戳。
 * @returns 格式化结果。
 */
export function formatConversationTime(timestamp: number): string {
    const date = new Date(timestamp);
    const now = new Date();
    const isSameDay = date.toDateString() === now.toDateString();

    return new Intl.DateTimeFormat(
        i18n.language === "zh" ? "zh-CN" : "en-US",
        {
            month: isSameDay ? undefined : "2-digit",
            day: isSameDay ? undefined : "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
        },
    ).format(date);
}