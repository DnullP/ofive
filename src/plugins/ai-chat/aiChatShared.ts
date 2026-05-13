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
    AiChatProviderConfig,
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

/**
 * @interface AiChatRuntimeContextSnapshot
 * @description 单次 AI 请求携带的 ofive 前端运行上下文。
 */
export interface AiChatRuntimeContextSnapshot {
    schemaVersion: "ofive.ai.runtime-context.v1";
    vaultPath: string | null;
    activeFile: {
        articleId: string;
        path: string;
        title: string;
        kind: string;
    } | null;
    openTabs: AiChatRuntimeOpenTabSnapshot[];
    fileTree: {
        totalEntries: number;
        fileCount: number;
        directoryCount: number;
        samplePaths: string[];
    };
    projectReader: {
        projects: AiChatRuntimeProjectReaderProjectSnapshot[];
    } | null;
    ai: {
        vendorId: string | null;
        model: string | null;
    };
}

/**
 * @interface AiChatRuntimeOpenTabSnapshot
 * @description 工作区打开 tab 的最小上下文。
 */
export interface AiChatRuntimeOpenTabSnapshot {
    id: string;
    path: string | null;
    title: string | null;
    component: string | null;
    active: boolean;
    projectId: string | null;
    projectName: string | null;
    rootPath: string | null;
    relativePath: string | null;
}

/**
 * @interface AiChatRuntimeProjectReaderProjectSnapshot
 * @description 项目阅读器导入项目的最小上下文。
 */
export interface AiChatRuntimeProjectReaderProjectSnapshot {
    id: string;
    name: string;
    rootPath: string;
}

export interface BuildAiChatRuntimeContextSnapshotInput {
    vaultPath: string | null;
    activeFile: {
        articleId: string;
        path: string;
        title: string;
        kind: string;
    } | null;
    openTabs: AiChatRuntimeOpenTabSnapshot[];
    files: Array<{
        path: string;
        isDir: boolean;
    }>;
    projectReaderProjects?: AiChatRuntimeProjectReaderProjectSnapshot[];
    settings: AiChatSettings | null;
}

let chatConversationSequence = 1;

const AI_CHAT_CONTEXT_MAX_OPEN_TABS = 30;
const AI_CHAT_CONTEXT_MAX_SAMPLE_PATHS = 80;

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

export function createAiChatProviderId(): string {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return `ai-provider-${crypto.randomUUID()}`;
    }

    const nextId = `ai-provider-${Date.now()}-${String(chatConversationSequence)}`;
    chatConversationSequence += 1;
    return nextId;
}

export function resolveActiveProvider(settings: AiChatSettings): AiChatProviderConfig {
    const providers = settings.providers ?? [];
    const activeProvider = providers.find((provider) => provider.id === settings.activeProviderId)
        ?? providers[0]
        ?? null;

    if (activeProvider) {
        return activeProvider;
    }

    return {
        id: settings.activeProviderId?.trim() || createAiChatProviderId(),
        vendorId: settings.vendorId,
        title: settings.vendorId,
        model: settings.model,
        fieldValues: settings.fieldValues,
    };
}

function buildProviderTitle(
    vendor: AiVendorDefinition,
    existingProviders: AiChatProviderConfig[],
): string {
    const sameVendorCount = existingProviders.filter((provider) => provider.vendorId === vendor.id).length;
    return sameVendorCount === 0 ? vendor.title : `${vendor.title} ${sameVendorCount + 1}`;
}

export function createProviderForVendor(
    vendor: AiVendorDefinition,
    existingProviders: AiChatProviderConfig[] = [],
): AiChatProviderConfig {
    const fieldValues: Record<string, string> = {};
    vendor.fields.forEach((field) => {
        fieldValues[field.key] = field.defaultValue ?? "";
    });

    return {
        id: createAiChatProviderId(),
        vendorId: vendor.id,
        title: buildProviderTitle(vendor, existingProviders),
        model: vendor.defaultModel,
        fieldValues,
    };
}

export function mergeProviderForVendor(
    provider: AiChatProviderConfig,
    vendor: AiVendorDefinition,
): AiChatProviderConfig {
    const nextFieldValues: Record<string, string> = {};
    vendor.fields.forEach((field) => {
        nextFieldValues[field.key] = provider.fieldValues[field.key] ?? field.defaultValue ?? "";
    });

    return {
        ...provider,
        vendorId: vendor.id,
        title: provider.title.trim() || vendor.title,
        model: provider.model || vendor.defaultModel,
        fieldValues: nextFieldValues,
    };
}

export function withActiveProvider(
    settings: AiChatSettings,
    provider: AiChatProviderConfig,
): AiChatSettings {
    const providers = settings.providers ?? [];
    const nextProviders = providers.some((item) => item.id === provider.id)
        ? providers.map((item) => item.id === provider.id ? provider : item)
        : [...providers, provider];

    return {
        ...settings,
        vendorId: provider.vendorId,
        model: provider.model,
        fieldValues: provider.fieldValues,
        activeProviderId: provider.id,
        providers: nextProviders,
    };
}

export function ensureSettingsProviderList(
    settings: AiChatSettings,
    vendorCatalog: AiVendorDefinition[],
): AiChatSettings {
    let providers = [...(settings.providers ?? [])];
    if (providers.length === 0) {
        providers = [{
            id: settings.activeProviderId?.trim() || createAiChatProviderId(),
            vendorId: settings.vendorId,
            title: resolveVendor(vendorCatalog, settings.vendorId)?.title ?? settings.vendorId,
            model: settings.model,
            fieldValues: settings.fieldValues,
        }];
    }

    providers = providers.map((provider) => {
        const vendor = resolveVendor(vendorCatalog, provider.vendorId);
        return vendor ? mergeProviderForVendor(provider, vendor) : provider;
    });

    const activeProvider = providers.find((provider) => provider.id === settings.activeProviderId)
        ?? providers[0];
    if (!activeProvider) {
        return settings;
    }

    return {
        ...settings,
        vendorId: activeProvider.vendorId,
        model: activeProvider.model,
        fieldValues: activeProvider.fieldValues,
        activeProviderId: activeProvider.id,
        providers,
    };
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
    const activeProvider = resolveActiveProvider(currentSettings);
    const isSameVendor = activeProvider.vendorId === vendor.id;
    const nextFieldValues: Record<string, string> = {};
    vendor.fields.forEach((field) => {
        const currentValue = activeProvider.fieldValues[field.key];
        if (isSameVendor && currentValue !== undefined) {
            nextFieldValues[field.key] = currentValue;
            return;
        }

        nextFieldValues[field.key] = field.defaultValue ?? "";
    });

    return withActiveProvider(currentSettings, {
        ...activeProvider,
        vendorId: vendor.id,
        title: activeProvider.title.trim() || vendor.title,
        model: isSameVendor
            ? activeProvider.model || vendor.defaultModel
            : vendor.defaultModel,
        fieldValues: nextFieldValues,
    });
}

/**
 * @function buildAiChatRuntimeContextSnapshot
 * @description 为一次 AI 请求构建稳定、轻量的 ofive 运行上下文快照。
 * @param input 快照输入。
 * @returns 运行上下文快照。
 */
export function buildAiChatRuntimeContextSnapshot(
    input: BuildAiChatRuntimeContextSnapshotInput,
): AiChatRuntimeContextSnapshot {
    const normalizedFiles = input.files
        .map((entry) => ({
            path: entry.path.replace(/\\/g, "/"),
            isDir: entry.isDir,
        }))
        .filter((entry) => entry.path.trim().length > 0)
        .sort((left, right) => left.path.localeCompare(right.path));

    return {
        schemaVersion: "ofive.ai.runtime-context.v1",
        vaultPath: input.vaultPath,
        activeFile: input.activeFile
            ? {
                articleId: input.activeFile.articleId,
                path: input.activeFile.path.replace(/\\/g, "/"),
                title: input.activeFile.title,
                kind: input.activeFile.kind,
            }
            : null,
        openTabs: input.openTabs.slice(0, AI_CHAT_CONTEXT_MAX_OPEN_TABS).map((tab) => ({
            id: tab.id,
            path: tab.path ? tab.path.replace(/\\/g, "/") : null,
            title: tab.title,
            component: tab.component,
            active: tab.active,
            projectId: tab.projectId,
            projectName: tab.projectName,
            rootPath: tab.rootPath ? tab.rootPath.replace(/\\/g, "/") : null,
            relativePath: tab.relativePath ? tab.relativePath.replace(/\\/g, "/") : null,
        })),
        fileTree: {
            totalEntries: normalizedFiles.length,
            fileCount: normalizedFiles.filter((entry) => !entry.isDir).length,
            directoryCount: normalizedFiles.filter((entry) => entry.isDir).length,
            samplePaths: normalizedFiles
                .filter((entry) => !entry.isDir)
                .slice(0, AI_CHAT_CONTEXT_MAX_SAMPLE_PATHS)
                .map((entry) => entry.path),
        },
        projectReader: input.projectReaderProjects?.length
            ? {
                projects: input.projectReaderProjects.map((project) => ({
                    id: project.id,
                    name: project.name,
                    rootPath: project.rootPath.replace(/\\/g, "/"),
                })),
            }
            : null,
        ai: input.settings
            ? {
                vendorId: resolveActiveProvider(input.settings).vendorId.trim() || null,
                model: resolveActiveProvider(input.settings).model.trim() || null,
            }
            : {
                vendorId: null,
                model: null,
            },
    };
}

/**
 * @function serializeAiChatRuntimeContextSnapshot
 * @description 序列化 AI 请求上下文快照。
 * @param snapshot 运行上下文快照。
 * @returns JSON 字符串。
 */
export function serializeAiChatRuntimeContextSnapshot(
    snapshot: AiChatRuntimeContextSnapshot,
): string {
    return JSON.stringify(snapshot);
}

/**
 * @function formatAiChatDuration
 * @description 将生成耗时格式化为紧凑展示文本。
 * @param durationMs 毫秒耗时。
 * @returns 展示文本。
 */
export function formatAiChatDuration(durationMs: number | null | undefined): string | null {
    if (typeof durationMs !== "number" || !Number.isFinite(durationMs) || durationMs < 0) {
        return null;
    }

    if (durationMs < 1000) {
        return `${Math.round(durationMs)}ms`;
    }

    const seconds = durationMs / 1000;
    if (seconds < 10) {
        return `${seconds.toFixed(1)}s`;
    }

    if (seconds < 60) {
        return `${Math.round(seconds)}s`;
    }

    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.round(seconds % 60);
    return `${minutes}m ${String(remainingSeconds).padStart(2, "0")}s`;
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
 * @function isVisibleConversationMessage
 * @description 判断消息是否应出现在可见聊天记录中，排除仅用于模型协议恢复的工具消息。
 * @param message 历史消息。
 * @returns 可见消息返回 true。
 */
function isVisibleConversationMessage(message: AiChatHistoryMessage): boolean {
    if (isLegacyVisibleToolTranscript(message.text)) {
        return false;
    }

    if (
        message.text.trim().length > 0 ||
        (message.reasoningText ?? "").trim().length > 0
    ) {
        return true;
    }

    const contentBlocks = message.contentBlocks ?? [];
    if (contentBlocks.length === 0) {
        return false;
    }

    return contentBlocks.some((block) => {
        return block.kind === "text" || block.kind === "thinking";
    });
}

function isLegacyVisibleToolTranscript(text: string): boolean {
    const trimmed = text.trimStart();
    return trimmed.startsWith("[tool:")
        || trimmed.startsWith("[tool_")
        || trimmed.startsWith("[confirmation:");
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
            messages: conversation.messages.filter(isVisibleConversationMessage),
            protocolMessages: conversation.protocolMessages?.length
                ? conversation.protocolMessages.filter(isVisibleConversationMessage)
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
                messages: conversation.messages.filter(isVisibleConversationMessage),
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
