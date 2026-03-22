/**
 * @module plugins/aiChatPlugin
 * @description AI 聊天插件：注册右侧聊天面板和 AI 设置选栏。
 */

import React, {
    useEffect,
    useMemo,
    useRef,
    useState,
    type ChangeEvent,
    type KeyboardEvent,
    type ReactNode,
} from "react";
import { ArrowUp, Bot, Check, Plus, Sparkles, X } from "lucide-react";
import {
    getAiChatHistory,
    getAiChatSettings,
    getAiVendorCatalog,
    getAiVendorModels,
    saveAiChatHistory,
    saveAiChatSettings,
    startAiChatStream,
    submitAiChatConfirmation,
    subscribeAiChatStreamEvents,
    type AiChatConversationRecord,
    type AiChatHistoryMessage,
    type AiChatHistoryState,
    type AiChatSettings,
    type AiChatStreamEventPayload,
    type AiVendorDefinition,
    type AiVendorModelDefinition,
} from "../api/aiApi";
import { registerActivity } from "../host/registry/activityRegistry";
import { registerPanel } from "../host/registry/panelRegistry";
import { registerSettingsSection } from "../host/settings/settingsRegistry";
import { useVaultState } from "../host/store/vaultStore";
import i18n from "../i18n";
import "./aiChatPlugin.css";

i18n.addResourceBundle("en", "translation", {
    aiChatPlugin: {
        title: "AI Chat",
        draftPlaceholder: "Ask about this vault...",
        send: "Send",
        sending: "Running...",
        quickPromptsLabel: "Quick start",
        quickPromptSummarize: "Summarize this note into a short outline.",
        quickPromptRefine: "Rewrite this note to be clearer and tighter.",
        quickPromptPlan: "Turn this into a step-by-step plan.",
        readyStatus: "Ready",
        missingConfigStatus: "Setup required",
        streamingStatus: "Running",
        vendorMissing: "Complete AI settings before chatting.",
        settingsSection: "settings.aiSection",
        settingsTitle: "AI Chat Settings",
        settingsSubtitle: "Choose a vendor and fill only the fields required by that vendor.",
        vendorLabel: "Model Vendor",
        vendorDescription: "The vendor list and field schema are provided by the Rust backend.",
        modelLabel: "Model",
        modelDescription: "Load vendor-supported models from the backend, then choose one or keep a manual override.",
        refreshModels: "Refresh models",
        refreshingModels: "Loading models...",
        modelLoadHint: "Available models are fetched from the backend using the current vendor credentials.",
        modelLoadEmpty: "No models returned. You can still enter a model manually.",
        modelUpdatedNeedsSave: "Loaded supported models. The current model was replaced with {{model}} in the form. Save settings before chatting.",
        noVault: "Open a vault before configuring AI chat.",
        loadingSettings: "Loading AI settings...",
        save: "Save AI Settings",
        saveSuccess: "AI settings saved.",
        configuredVendor: "Configured vendor",
        assistant: "Assistant",
        user: "You",
        composerHint: "Enter sends. Shift+Enter adds a new line.",
        composerHintMissing: "AI settings are incomplete.",
        tabChat: "Chat",
        tabDebug: "Debug",
        debugEmptyTitle: "No debug log yet.",
        debugEmptyBody: "Raw model requests and responses for the active conversation will appear here.",
        debugEntryFallbackTitle: "Debug trace",
        confirmationFallbackHint: "This action will modify the vault.",
        confirmationToolLabel: "Tool",
        confirmApprove: "Approve",
        confirmReject: "Reject",
        confirmSubmitting: "Submitting...",
        historySection: "Conversations",
        historyEmpty: "No conversation yet.",
        newConversation: "New",
        untitledConversation: "New conversation",
        emptyTitle: "Start from a quick prompt.",
        emptyBody: "You can switch conversations at any time.",
    },
    settings: {
        aiSection: "AI Chat",
    },
}, true, true);

i18n.addResourceBundle("zh", "translation", {
    aiChatPlugin: {
        title: "AI 对话",
        draftPlaceholder: "询问这个仓库里的内容...",
        send: "发送",
        sending: "执行中...",
        quickPromptsLabel: "快捷开始",
        quickPromptSummarize: "把这篇笔记压缩成简短大纲。",
        quickPromptRefine: "把这篇笔记改写得更清楚、更紧凑。",
        quickPromptPlan: "把这个想法拆成一步步计划。",
        readyStatus: "就绪",
        missingConfigStatus: "需要配置",
        streamingStatus: "执行中",
        vendorMissing: "先补全 AI 设置，再开始对话。",
        settingsSection: "settings.aiSection",
        settingsTitle: "AI 对话设置",
        settingsSubtitle: "先选择 vendor，再填写该 vendor 需要的动态字段。",
        vendorLabel: "模型供应商",
        vendorDescription: "vendor 列表与字段模式由 Rust 后端提供。",
        modelLabel: "模型名称",
        modelDescription: "通过后端按当前 vendor 凭证拉取可用模型，再从列表里选择，或继续手动覆盖。",
        refreshModels: "刷新模型列表",
        refreshingModels: "正在加载模型...",
        modelLoadHint: "模型列表由后端结合当前 vendor 凭证动态拉取。",
        modelLoadEmpty: "后端没有返回模型列表，你仍然可以手动填写模型名。",
        modelUpdatedNeedsSave: "已拉取支持的模型列表，表单中的模型已切换为 {{model}}。请先保存设置再开始聊天。",
        noVault: "请先打开一个仓库，再配置 AI 对话。",
        loadingSettings: "正在加载 AI 设置...",
        save: "保存 AI 设置",
        saveSuccess: "AI 设置已保存。",
        configuredVendor: "当前配置 vendor",
        assistant: "助手",
        user: "你",
        composerHint: "Enter 发送，Shift+Enter 换行。",
        composerHintMissing: "AI 设置尚未完成。",
        tabChat: "对话",
        tabDebug: "调试",
        debugEmptyTitle: "还没有调试日志。",
        debugEmptyBody: "当前会话的原始模型请求和响应会显示在这里。",
        debugEntryFallbackTitle: "调试轨迹",
        confirmationFallbackHint: "这个操作会修改仓库内容。",
        confirmationToolLabel: "工具",
        confirmApprove: "批准",
        confirmReject: "拒绝",
        confirmSubmitting: "提交中...",
        historySection: "会话",
        historyEmpty: "还没有会话。",
        newConversation: "新建",
        untitledConversation: "新对话",
        emptyTitle: "从一个快捷提示开始。",
        emptyBody: "你可以随时切换会话继续聊。",
    },
    settings: {
        aiSection: "AI 对话",
    },
}, true, true);

const AI_CHAT_PANEL_ID = "ai-chat";
const AI_CHAT_SETTINGS_UPDATED_EVENT = "ofive:ai-settings-updated";

interface ChatDebugEntry {
    id: string;
    streamId: string;
    title: string;
    text: string;
}

interface PendingStreamBinding {
    streamId: string | null;
    conversationId: string | null;
    sessionId: string | null;
    assistantMessageId: string | null;
}

interface PendingToolConfirmation {
    confirmationId: string;
    sessionId: string;
    assistantMessageId: string;
    conversationId: string;
    hint: string;
    toolName: string;
    toolArgsJson: string;
    isSubmitting: boolean;
}

interface QuickPromptDefinition {
    id: string;
    translationKey: string;
}

interface AiPanelErrorDisplay {
    summary: string;
    detail: string | null;
}

let chatMessageSequence = 1;
let chatDebugSequence = 1;
let chatConversationSequence = 1;

const QUICK_PROMPTS: QuickPromptDefinition[] = [
    { id: "summarize", translationKey: "aiChatPlugin.quickPromptSummarize" },
    { id: "refine", translationKey: "aiChatPlugin.quickPromptRefine" },
    { id: "plan", translationKey: "aiChatPlugin.quickPromptPlan" },
];

/**
 * @function nextChatMessageId
 * @description 生成面板内消息唯一 ID。
 * @returns 消息 ID。
 */
function nextChatMessageId(): string {
    const nextId = `ai-chat-message-${String(chatMessageSequence)}`;
    chatMessageSequence += 1;
    return nextId;
}

/**
 * @function nextChatDebugEntryId
 * @description 生成调试日志唯一 ID。
 * @returns 调试日志 ID。
 */
function nextChatDebugEntryId(): string {
    const nextId = `ai-chat-debug-${String(chatDebugSequence)}`;
    chatDebugSequence += 1;
    return nextId;
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
function resolveVendor(
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
function mergeSettingsForVendor(
    currentSettings: AiChatSettings,
    vendor: AiVendorDefinition,
): AiChatSettings {
    const nextFieldValues: Record<string, string> = {};
    vendor.fields.forEach((field) => {
        const currentValue = currentSettings.fieldValues[field.key];
        nextFieldValues[field.key] = currentValue ?? field.defaultValue ?? "";
    });

    return {
        vendorId: vendor.id,
        model: currentSettings.model || vendor.defaultModel,
        fieldValues: nextFieldValues,
    };
}

/**
 * @function formatAiPanelError
 * @description 将后端错误拆分为适合侧栏展示的摘要和详情。
 * @param rawError 原始错误文本。
 * @returns 展示用错误对象。
 */
function formatAiPanelError(rawError: string): AiPanelErrorDisplay {
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
function createConversationRecord(): AiChatConversationRecord {
    const now = Date.now();
    const id = nextConversationId();
    return {
        id,
        sessionId: `ai-chat-session-${id}`,
        title: i18n.t("aiChatPlugin.untitledConversation"),
        createdAtUnixMs: now,
        updatedAtUnixMs: now,
        messages: [],
    };
}

/**
 * @function sortConversations
 * @description 按更新时间倒序排列会话。
 * @param conversations 会话列表。
 * @returns 排序结果。
 */
function sortConversations(conversations: AiChatConversationRecord[]): AiChatConversationRecord[] {
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
function deriveConversationTitle(messages: AiChatHistoryMessage[]): string {
    const firstUserMessage = messages.find((message) => message.role === "user" && message.text.trim().length > 0);
    if (!firstUserMessage) {
        return i18n.t("aiChatPlugin.untitledConversation");
    }

    const normalized = firstUserMessage.text.replace(/\s+/g, " ").trim();
    if (normalized.length <= 26) {
        return normalized;
    }
    return `${normalized.slice(0, 26)}...`;
}

/**
 * @function ensureHistoryState
 * @description 保证历史状态始终有一个可用会话。
 * @param history 历史状态。
 * @returns 修正后的历史状态。
 */
function ensureHistoryState(history: AiChatHistoryState): AiChatHistoryState {
    if (history.conversations.length === 0) {
        const conversation = createConversationRecord();
        return {
            activeConversationId: conversation.id,
            conversations: [conversation],
        };
    }

    const activeConversationId = history.activeConversationId
        && history.conversations.some((conversation) => conversation.id === history.activeConversationId)
        ? history.activeConversationId
        : history.conversations[0]?.id ?? null;

    return {
        activeConversationId,
        conversations: sortConversations(history.conversations),
    };
}

/**
 * @function buildPersistableHistory
 * @description 生成可持久化的历史状态。
 * @param historyState 当前历史状态。
 * @returns 过滤后的历史状态。
 */
function buildPersistableHistory(historyState: AiChatHistoryState): AiChatHistoryState {
    return {
        activeConversationId: historyState.activeConversationId,
        conversations: sortConversations(historyState.conversations).map((conversation) => ({
            ...conversation,
            title: deriveConversationTitle(conversation.messages),
            messages: conversation.messages.filter((message) => message.text.trim().length > 0),
        })),
    };
}

/**
 * @function formatConversationTime
 * @description 格式化会话更新时间。
 * @param timestamp 时间戳。
 * @returns 格式化结果。
 */
function formatConversationTime(timestamp: number): string {
    const date = new Date(timestamp);
    const now = new Date();
    const isSameDay = date.toDateString() === now.toDateString();

    return new Intl.DateTimeFormat(i18n.language === "zh" ? "zh-CN" : "en-US", {
        month: isSameDay ? undefined : "2-digit",
        day: isSameDay ? undefined : "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
    }).format(date);
}

/**
 * @function ChatPanel
 * @description 渲染右侧 AI 聊天面板。
 * @returns 面板 React 节点。
 */
function ChatPanel(): ReactNode {
    const { currentVaultPath } = useVaultState();
    const [historyState, setHistoryState] = useState<AiChatHistoryState | null>(null);
    const [debugEntriesByConversation, setDebugEntriesByConversation] = useState<Record<string, ChatDebugEntry[]>>({});
    const [pendingConfirmations, setPendingConfirmations] = useState<Record<string, PendingToolConfirmation>>({});
    const [activeTab, setActiveTab] = useState<"chat" | "debug">("chat");
    const [draft, setDraft] = useState("");
    const [isStreaming, setIsStreaming] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [settings, setSettings] = useState<AiChatSettings | null>(null);
    const [vendorCatalog, setVendorCatalog] = useState<AiVendorDefinition[]>([]);
    const streamBindingRef = useRef<PendingStreamBinding>({
        streamId: null,
        conversationId: null,
        sessionId: null,
        assistantMessageId: null,
    });
    const historyLoadedRef = useRef(false);
    const historySaveTimerRef = useRef<number | null>(null);
    const threadViewportRef = useRef<HTMLDivElement | null>(null);
    const debugViewportRef = useRef<HTMLDivElement | null>(null);

    /**
     * @function updateConversation
     * @description 更新指定会话。
     * @param conversationId 会话 ID。
     * @param updater 更新函数。
     */
    const updateConversation = (
        conversationId: string,
        updater: (conversation: AiChatConversationRecord) => AiChatConversationRecord,
    ): void => {
        setHistoryState((currentState) => {
            if (!currentState) {
                return currentState;
            }

            const nextConversations = currentState.conversations.map((conversation) => {
                if (conversation.id !== conversationId) {
                    return conversation;
                }
                const updatedConversation = updater(conversation);
                return {
                    ...updatedConversation,
                    title: deriveConversationTitle(updatedConversation.messages),
                };
            });

            return {
                ...currentState,
                conversations: sortConversations(nextConversations),
            };
        });
    };

    /**
     * @function setPendingConfirmationState
     * @description 设置一条确认请求的当前状态。
     * @param confirmation 确认请求。
     */
    const setPendingConfirmationState = (confirmation: PendingToolConfirmation): void => {
        setPendingConfirmations((current) => ({
            ...current,
            [confirmation.assistantMessageId]: confirmation,
        }));
    };

    /**
     * @function clearPendingConfirmationState
     * @description 清理一条确认请求状态。
     * @param assistantMessageId 助手消息 ID。
     */
    const clearPendingConfirmationState = (assistantMessageId: string): void => {
        setPendingConfirmations((current) => {
            const next = { ...current };
            delete next[assistantMessageId];
            return next;
        });
    };

    /**
     * @function appendDebugEntry
     * @description 向指定会话追加调试日志。
     * @param conversationId 会话 ID。
     * @param entry 调试日志条目。
     */
    const appendDebugEntry = (conversationId: string, entry: ChatDebugEntry): void => {
        setDebugEntriesByConversation((current) => ({
            ...current,
            [conversationId]: [...(current[conversationId] ?? []), entry],
        }));
    };

    const selectedVendor = useMemo(() => {
        if (!settings) {
            return null;
        }
        return resolveVendor(vendorCatalog, settings.vendorId);
    }, [settings, vendorCatalog]);

    const isVendorConfigured = useMemo(() => {
        if (!settings || !selectedVendor) {
            return false;
        }

        return selectedVendor.fields
            .filter((field) => field.required)
            .every((field) => (settings.fieldValues[field.key] ?? "").trim().length > 0);
    }, [selectedVendor, settings]);

    const activeConversation = useMemo(() => {
        if (!historyState?.activeConversationId) {
            return null;
        }
        return historyState.conversations.find((conversation) => {
            return conversation.id === historyState.activeConversationId;
        }) ?? null;
    }, [historyState]);

    const currentDebugEntries = useMemo(() => {
        if (!activeConversation) {
            return [];
        }
        return debugEntriesByConversation[activeConversation.id] ?? [];
    }, [activeConversation, debugEntriesByConversation]);

    const formattedError = useMemo(() => {
        if (!error) {
            return null;
        }
        return formatAiPanelError(error);
    }, [error]);

    const panelStatusLabel = useMemo(() => {
        if (!currentVaultPath) {
            return i18n.t("aiChatPlugin.noVault");
        }
        if (!isVendorConfigured) {
            return i18n.t("aiChatPlugin.missingConfigStatus");
        }
        if (isStreaming) {
            return i18n.t("aiChatPlugin.streamingStatus");
        }
        return i18n.t("aiChatPlugin.readyStatus");
    }, [currentVaultPath, isStreaming, isVendorConfigured]);

    const canSend = Boolean(currentVaultPath && activeConversation && draft.trim() && !isStreaming && isVendorConfigured);

    useEffect(() => {
        let disposed = false;

        if (!currentVaultPath) {
            setHistoryState(null);
            setSettings(null);
            historyLoadedRef.current = false;
            return;
        }

        Promise.all([getAiVendorCatalog(), getAiChatSettings(), getAiChatHistory()])
            .then(([catalog, nextSettings, history]) => {
                if (disposed) {
                    return;
                }
                setVendorCatalog(catalog);
                setSettings(nextSettings);
                setHistoryState(ensureHistoryState(history));
                setDebugEntriesByConversation({});
                setPendingConfirmations({});
                historyLoadedRef.current = true;
            })
            .catch((loadError) => {
                if (disposed) {
                    return;
                }
                setError(loadError instanceof Error ? loadError.message : String(loadError));
            });

        const handleSettingsUpdated = (): void => {
            void getAiChatSettings().then((nextSettings) => {
                if (!disposed) {
                    setSettings(nextSettings);
                }
            });
        };

        window.addEventListener(AI_CHAT_SETTINGS_UPDATED_EVENT, handleSettingsUpdated);

        return () => {
            disposed = true;
            window.removeEventListener(AI_CHAT_SETTINGS_UPDATED_EVENT, handleSettingsUpdated);
        };
    }, [currentVaultPath]);

    useEffect(() => {
        if (!historyLoadedRef.current || !historyState || !currentVaultPath) {
            return;
        }

        if (historySaveTimerRef.current !== null) {
            window.clearTimeout(historySaveTimerRef.current);
        }

        historySaveTimerRef.current = window.setTimeout(() => {
            void saveAiChatHistory(buildPersistableHistory(historyState)).catch((saveError) => {
                setError(saveError instanceof Error ? saveError.message : String(saveError));
            });
        }, 400);

        return () => {
            if (historySaveTimerRef.current !== null) {
                window.clearTimeout(historySaveTimerRef.current);
                historySaveTimerRef.current = null;
            }
        };
    }, [historyState, currentVaultPath]);

    useEffect(() => {
        let disposed = false;
        let cleanup: (() => void) | undefined;

        void subscribeAiChatStreamEvents((payload: AiChatStreamEventPayload) => {
            if (disposed) {
                return;
            }

            const binding = streamBindingRef.current;
            if (!binding.assistantMessageId || !binding.conversationId) {
                return;
            }

            if (!binding.streamId) {
                binding.streamId = payload.streamId;
            }
            if (binding.streamId !== payload.streamId) {
                return;
            }

            if (payload.eventType === "debug") {
                appendDebugEntry(binding.conversationId, {
                    id: nextChatDebugEntryId(),
                    streamId: payload.streamId,
                    title: payload.debugTitle ?? i18n.t("aiChatPlugin.debugEntryFallbackTitle"),
                    text: payload.debugText ?? "",
                });
                return;
            }

            if (payload.eventType === "confirmation") {
                const confirmationText = payload.confirmationHint ?? i18n.t("aiChatPlugin.confirmationFallbackHint");
                updateConversation(binding.conversationId, (conversation) => ({
                    ...conversation,
                    updatedAtUnixMs: Date.now(),
                    messages: conversation.messages.map((message) => {
                        if (message.id !== binding.assistantMessageId) {
                            return message;
                        }
                        return {
                            ...message,
                            text: confirmationText,
                        };
                    }),
                }));

                setIsStreaming(false);

                if (payload.confirmationId && payload.sessionId) {
                    setPendingConfirmationState({
                        confirmationId: payload.confirmationId,
                        sessionId: payload.sessionId,
                        assistantMessageId: binding.assistantMessageId,
                        conversationId: binding.conversationId,
                        hint: payload.confirmationHint ?? "",
                        toolName: payload.confirmationToolName ?? "",
                        toolArgsJson: payload.confirmationToolArgsJson ?? "{}",
                        isSubmitting: false,
                    });
                } else {
                    setError("AI confirmation payload is incomplete");
                }

                streamBindingRef.current = {
                    streamId: null,
                    conversationId: null,
                    sessionId: null,
                    assistantMessageId: null,
                };
                return;
            }

            if (payload.eventType === "delta" || payload.eventType === "done") {
                updateConversation(binding.conversationId, (conversation) => ({
                    ...conversation,
                    updatedAtUnixMs: Date.now(),
                    messages: conversation.messages.map((message) => {
                        if (message.id !== binding.assistantMessageId) {
                            return message;
                        }
                        return {
                            ...message,
                            text: payload.accumulatedText ?? message.text,
                        };
                    }),
                }));
            }

            if (payload.eventType === "error") {
                setError(payload.error ?? "AI stream failed");
                setIsStreaming(false);
                clearPendingConfirmationState(binding.assistantMessageId);
                streamBindingRef.current = {
                    streamId: null,
                    conversationId: null,
                    sessionId: null,
                    assistantMessageId: null,
                };
                return;
            }

            if (payload.eventType === "done") {
                setIsStreaming(false);
                clearPendingConfirmationState(binding.assistantMessageId);
                streamBindingRef.current = {
                    streamId: null,
                    conversationId: null,
                    sessionId: null,
                    assistantMessageId: null,
                };
            }
        }).then((unlisten) => {
            cleanup = unlisten;
        });

        return () => {
            disposed = true;
            cleanup?.();
        };
    }, []);

    useEffect(() => {
        const viewport = threadViewportRef.current;
        if (viewport) {
            viewport.scrollTop = viewport.scrollHeight;
        }
    }, [activeConversation?.messages, pendingConfirmations]);

    useEffect(() => {
        const viewport = debugViewportRef.current;
        if (viewport) {
            viewport.scrollTop = viewport.scrollHeight;
        }
    }, [currentDebugEntries]);

    /**
     * @function handleCreateConversation
     * @description 创建并切换到新会话。
     */
    const handleCreateConversation = (): void => {
        if (isStreaming) {
            return;
        }
        const conversation = createConversationRecord();
        setHistoryState((currentState) => {
            if (!currentState) {
                return {
                    activeConversationId: conversation.id,
                    conversations: [conversation],
                };
            }
            return {
                activeConversationId: conversation.id,
                conversations: sortConversations([conversation, ...currentState.conversations]),
            };
        });
        setActiveTab("chat");
        setDraft("");
        setError(null);
    };

    /**
     * @function handleSelectConversation
     * @description 切换活动会话。
     * @param conversationId 会话 ID。
     */
    const handleSelectConversation = (conversationId: string): void => {
        if (isStreaming) {
            return;
        }
        setHistoryState((currentState) => currentState ? {
            ...currentState,
            activeConversationId: conversationId,
        } : currentState);
        setActiveTab("chat");
        setError(null);
    };

    /**
     * @function handleToolDecision
     * @description 在对话中批准或拒绝工具调用。
     * @param confirmation 确认请求。
     * @param approved 是否批准。
     */
    const handleToolDecision = async (
        confirmation: PendingToolConfirmation,
        approved: boolean,
    ): Promise<void> => {
        setError(null);
        setPendingConfirmationState({
            ...confirmation,
            isSubmitting: true,
        });
        setIsStreaming(true);
        streamBindingRef.current = {
            streamId: null,
            conversationId: confirmation.conversationId,
            sessionId: confirmation.sessionId,
            assistantMessageId: confirmation.assistantMessageId,
        };

        try {
            const response = await submitAiChatConfirmation({
                confirmationId: confirmation.confirmationId,
                confirmed: approved,
                sessionId: confirmation.sessionId,
            });
            streamBindingRef.current = {
                streamId: response.streamId,
                conversationId: confirmation.conversationId,
                sessionId: confirmation.sessionId,
                assistantMessageId: confirmation.assistantMessageId,
            };
            clearPendingConfirmationState(confirmation.assistantMessageId);
        } catch (submitError) {
            setError(submitError instanceof Error ? submitError.message : String(submitError));
            setIsStreaming(false);
            setPendingConfirmationState({
                ...confirmation,
                isSubmitting: false,
            });
            streamBindingRef.current = {
                streamId: null,
                conversationId: null,
                sessionId: null,
                assistantMessageId: null,
            };
        }
    };

    /**
     * @function handleSubmit
     * @description 提交当前输入并启动流式聊天。
     */
    const handleSubmit = async (): Promise<void> => {
        if (!activeConversation) {
            return;
        }

        const trimmed = draft.trim();
        if (!trimmed || isStreaming) {
            return;
        }

        const userMessage: AiChatHistoryMessage = {
            id: nextChatMessageId(),
            role: "user",
            text: trimmed,
            createdAtUnixMs: Date.now(),
        };
        const assistantMessage: AiChatHistoryMessage = {
            id: nextChatMessageId(),
            role: "assistant",
            text: "",
            createdAtUnixMs: Date.now(),
        };
        const history = activeConversation.messages;

        setDraft("");
        setError(null);
        setIsStreaming(true);
        setActiveTab("chat");
        updateConversation(activeConversation.id, (conversation) => ({
            ...conversation,
            updatedAtUnixMs: Date.now(),
            messages: [...conversation.messages, userMessage, assistantMessage],
        }));

        streamBindingRef.current = {
            streamId: null,
            conversationId: activeConversation.id,
            sessionId: activeConversation.sessionId,
            assistantMessageId: assistantMessage.id,
        };

        try {
            const response = await startAiChatStream({
                message: trimmed,
                sessionId: activeConversation.sessionId,
                history,
            });
            streamBindingRef.current = {
                streamId: response.streamId,
                conversationId: activeConversation.id,
                sessionId: activeConversation.sessionId,
                assistantMessageId: assistantMessage.id,
            };
        } catch (submitError) {
            setError(submitError instanceof Error ? submitError.message : String(submitError));
            setIsStreaming(false);
            streamBindingRef.current = {
                streamId: null,
                conversationId: null,
                sessionId: null,
                assistantMessageId: null,
            };
        }
    };

    /**
     * @function handleQuickPromptClick
     * @description 将推荐 prompt 填入输入框。
     * @param prompt 推荐 prompt 文本。
     */
    const handleQuickPromptClick = (prompt: string): void => {
        setDraft(prompt);
    };

    /**
     * @function handleInputKeyDown
     * @description 在输入框中按 Enter 发送，Shift+Enter 换行。
     * @param event 键盘事件。
     */
    const handleInputKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
        if (event.key !== "Enter" || event.shiftKey) {
            return;
        }

        event.preventDefault();
        if (canSend) {
            void handleSubmit();
        }
    };

    return (
        <div className="ai-chat-panel">
            <div className="ai-chat-header">
                <div className="ai-chat-header-main">
                    <div className="ai-chat-title">{i18n.t("aiChatPlugin.title")}</div>
                    <div className="ai-chat-header-badges">
                        <span className="ai-chat-vendor-badge">
                            {selectedVendor?.title ?? "-"}
                            <strong>{settings?.model ?? "-"}</strong>
                        </span>
                        <span className={`ai-chat-status-chip ${!isVendorConfigured ? "warning" : ""}`}>
                            {panelStatusLabel}
                        </span>
                    </div>
                </div>

                <div className="ai-chat-conversation-bar">
                    <div className="ai-chat-conversation-bar-header">
                        <span className="ai-chat-section-label">{i18n.t("aiChatPlugin.historySection")}</span>
                        <button
                            type="button"
                            className="ai-chat-conversation-create"
                            disabled={isStreaming}
                            onClick={handleCreateConversation}
                        >
                            <Plus size={13} strokeWidth={2} />
                            <span>{i18n.t("aiChatPlugin.newConversation")}</span>
                        </button>
                    </div>
                    <div className="ai-chat-conversation-list">
                        {historyState?.conversations.length ? historyState.conversations.map((conversation) => (
                            <button
                                key={conversation.id}
                                type="button"
                                className={`ai-chat-conversation-item ${historyState.activeConversationId === conversation.id ? "active" : ""}`}
                                disabled={isStreaming}
                                onClick={() => {
                                    handleSelectConversation(conversation.id);
                                }}
                            >
                                <span className="ai-chat-conversation-title">{conversation.title}</span>
                                <span className="ai-chat-conversation-time">{formatConversationTime(conversation.updatedAtUnixMs)}</span>
                            </button>
                        )) : (
                            <div className="ai-chat-conversation-empty">{i18n.t("aiChatPlugin.historyEmpty")}</div>
                        )}
                    </div>
                </div>

                {formattedError ? (
                    <div className="ai-chat-status error" title={error ?? undefined}>
                        <div className="ai-chat-status-title">{formattedError.summary}</div>
                        {formattedError.detail ? (
                            <div className="ai-chat-status-detail">{formattedError.detail}</div>
                        ) : null}
                    </div>
                ) : null}
            </div>

            <div className="ai-chat-tab-strip" role="tablist" aria-label={i18n.t("aiChatPlugin.title")}>
                <button
                    type="button"
                    role="tab"
                    aria-selected={activeTab === "chat"}
                    className={`ai-chat-tab-button ${activeTab === "chat" ? "active" : ""}`}
                    onClick={() => {
                        setActiveTab("chat");
                    }}
                >
                    {i18n.t("aiChatPlugin.tabChat")}
                </button>
                <button
                    type="button"
                    role="tab"
                    aria-selected={activeTab === "debug"}
                    className={`ai-chat-tab-button ${activeTab === "debug" ? "active" : ""}`}
                    onClick={() => {
                        setActiveTab("debug");
                    }}
                >
                    {i18n.t("aiChatPlugin.tabDebug")}
                </button>
            </div>

            {activeTab === "chat" ? (
                <div className="ai-chat-thread-shell" role="tabpanel">
                    {!activeConversation?.messages.length ? (
                        <div className="ai-chat-welcome-card">
                            <div className="ai-chat-welcome-title">{i18n.t("aiChatPlugin.emptyTitle")}</div>
                            <div className="ai-chat-welcome-body">{i18n.t("aiChatPlugin.emptyBody")}</div>
                            <div className="ai-chat-quick-prompts-label">{i18n.t("aiChatPlugin.quickPromptsLabel")}</div>
                            <div className="ai-chat-quick-prompts-grid">
                                {QUICK_PROMPTS.map((prompt) => {
                                    const promptText = i18n.t(prompt.translationKey);
                                    return (
                                        <button
                                            key={prompt.id}
                                            type="button"
                                            className="ai-chat-quick-prompt"
                                            onClick={() => {
                                                handleQuickPromptClick(promptText);
                                            }}
                                        >
                                            <Sparkles size={13} strokeWidth={1.8} />
                                            <span>{promptText}</span>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    ) : null}

                    <div ref={threadViewportRef} className="ai-chat-messages">
                        {activeConversation?.messages.map((message) => {
                            const confirmation = pendingConfirmations[message.id];

                            return (
                                <div key={message.id} className={`ai-chat-message ${message.role}`}>
                                    <div className="ai-chat-message-avatar">
                                        {message.role === "assistant"
                                            ? <Bot size={14} strokeWidth={1.8} />
                                            : <ArrowUp size={14} strokeWidth={1.8} />}
                                    </div>
                                    <div className="ai-chat-message-content">
                                        <div className="ai-chat-message-role">
                                            {message.role === "assistant"
                                                ? i18n.t("aiChatPlugin.assistant")
                                                : i18n.t("aiChatPlugin.user")}
                                        </div>
                                        <div className="ai-chat-message-bubble">{message.text || "..."}</div>
                                        {confirmation ? (
                                            <div className="ai-chat-confirmation-card">
                                                <div className="ai-chat-confirmation-meta">
                                                    <span>{confirmation.hint || i18n.t("aiChatPlugin.confirmationFallbackHint")}</span>
                                                    {confirmation.toolName ? (
                                                        <span>{i18n.t("aiChatPlugin.confirmationToolLabel")}: {confirmation.toolName}</span>
                                                    ) : null}
                                                </div>
                                                {confirmation.toolArgsJson && confirmation.toolArgsJson !== "{}" ? (
                                                    <pre className="ai-chat-confirmation-args">{confirmation.toolArgsJson}</pre>
                                                ) : null}
                                                <div className="ai-chat-confirmation-actions">
                                                    <button
                                                        type="button"
                                                        className="ai-chat-confirm-button reject"
                                                        disabled={confirmation.isSubmitting}
                                                        onClick={() => {
                                                            void handleToolDecision(confirmation, false);
                                                        }}
                                                    >
                                                        <X size={13} strokeWidth={2} />
                                                        <span>{confirmation.isSubmitting
                                                            ? i18n.t("aiChatPlugin.confirmSubmitting")
                                                            : i18n.t("aiChatPlugin.confirmReject")}</span>
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className="ai-chat-confirm-button approve"
                                                        disabled={confirmation.isSubmitting}
                                                        onClick={() => {
                                                            void handleToolDecision(confirmation, true);
                                                        }}
                                                    >
                                                        <Check size={13} strokeWidth={2} />
                                                        <span>{confirmation.isSubmitting
                                                            ? i18n.t("aiChatPlugin.confirmSubmitting")
                                                            : i18n.t("aiChatPlugin.confirmApprove")}</span>
                                                    </button>
                                                </div>
                                            </div>
                                        ) : null}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            ) : (
                <div className="ai-chat-debug-shell" role="tabpanel">
                    {currentDebugEntries.length === 0 ? (
                        <div className="ai-chat-debug-empty">
                            <div className="ai-chat-debug-empty-title">{i18n.t("aiChatPlugin.debugEmptyTitle")}</div>
                            <div className="ai-chat-debug-empty-body">{i18n.t("aiChatPlugin.debugEmptyBody")}</div>
                        </div>
                    ) : null}
                    <div ref={debugViewportRef} className="ai-chat-debug-list">
                        {currentDebugEntries.map((entry) => (
                            <div key={entry.id} className="ai-chat-debug-entry">
                                <div className="ai-chat-debug-entry-header">
                                    <span className="ai-chat-debug-entry-title">{entry.title}</span>
                                    <span className="ai-chat-debug-entry-stream">{entry.streamId}</span>
                                </div>
                                <pre className="ai-chat-debug-entry-body">{entry.text}</pre>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <div className="ai-chat-composer">
                {!isVendorConfigured ? (
                    <div className="ai-chat-status">{i18n.t("aiChatPlugin.vendorMissing")}</div>
                ) : null}

                <textarea
                    className="ai-chat-input"
                    value={draft}
                    placeholder={i18n.t("aiChatPlugin.draftPlaceholder")}
                    disabled={!currentVaultPath || isStreaming || !activeConversation}
                    onKeyDown={handleInputKeyDown}
                    onChange={(event) => {
                        setDraft(event.target.value);
                    }}
                />
                <div className="ai-chat-composer-row">
                    <div className="ai-chat-composer-hint">
                        {isVendorConfigured
                            ? i18n.t("aiChatPlugin.composerHint")
                            : i18n.t("aiChatPlugin.composerHintMissing")}
                    </div>
                    <button
                        type="button"
                        className="ai-chat-send-button"
                        disabled={!canSend}
                        onClick={() => {
                            void handleSubmit();
                        }}
                    >
                        <span>{isStreaming ? i18n.t("aiChatPlugin.sending") : i18n.t("aiChatPlugin.send")}</span>
                        <ArrowUp size={14} strokeWidth={2} />
                    </button>
                </div>
            </div>
        </div>
    );
}

/**
 * @function AiChatSettingsSection
 * @description 渲染 AI 设置页，按照后端返回的 schema 动态生成表单。
 * @returns 设置页 React 节点。
 */
function AiChatSettingsSection(): ReactNode {
    const { currentVaultPath } = useVaultState();
    const [vendorCatalog, setVendorCatalog] = useState<AiVendorDefinition[]>([]);
    const [settings, setSettings] = useState<AiChatSettings | null>(null);
    const [availableModels, setAvailableModels] = useState<AiVendorModelDefinition[]>([]);
    const [isLoadingModels, setIsLoadingModels] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [feedback, setFeedback] = useState<string | null>(null);
    const [feedbackIsError, setFeedbackIsError] = useState(false);

    const selectedVendor = useMemo(() => {
        if (!settings) {
            return null;
        }
        return resolveVendor(vendorCatalog, settings.vendorId);
    }, [settings, vendorCatalog]);

    useEffect(() => {
        let disposed = false;

        if (!currentVaultPath) {
            setSettings(null);
            setVendorCatalog([]);
            return;
        }

        setIsLoading(true);
        Promise.all([getAiVendorCatalog(), getAiChatSettings()])
            .then(([catalog, currentSettings]) => {
                if (disposed) {
                    return;
                }
                const initialVendor = resolveVendor(catalog, currentSettings.vendorId) ?? catalog[0] ?? null;
                setVendorCatalog(catalog);
                setSettings(initialVendor ? mergeSettingsForVendor(currentSettings, initialVendor) : currentSettings);
                setFeedback(null);
                setFeedbackIsError(false);
            })
            .catch((loadError) => {
                if (disposed) {
                    return;
                }
                setFeedback(loadError instanceof Error ? loadError.message : String(loadError));
                setFeedbackIsError(true);
            })
            .finally(() => {
                if (!disposed) {
                    setIsLoading(false);
                }
            });

        return () => {
            disposed = true;
        };
    }, [currentVaultPath]);

    /**
     * @function loadVendorModels
     * @description 使用当前设置草稿刷新 vendor 模型列表。
     * @param targetSettings 设置草稿。
     */
    const loadVendorModels = async (targetSettings: AiChatSettings): Promise<void> => {
        setIsLoadingModels(true);
        try {
            const models = await getAiVendorModels(targetSettings);
            setAvailableModels(models);
            setFeedback(models.length === 0 ? i18n.t("aiChatPlugin.modelLoadEmpty") : null);
            setFeedbackIsError(false);

            if (models.length > 0 && !models.some((model) => model.id === targetSettings.model)) {
                const nextModel = models[0].id;
                setSettings((currentSettings) => currentSettings ? {
                    ...currentSettings,
                    model: nextModel,
                } : currentSettings);
                setFeedback(i18n.t("aiChatPlugin.modelUpdatedNeedsSave", { model: nextModel }));
            }
        } catch (loadError) {
            setAvailableModels([]);
            setFeedback(loadError instanceof Error ? loadError.message : String(loadError));
            setFeedbackIsError(true);
        } finally {
            setIsLoadingModels(false);
        }
    };

    useEffect(() => {
        if (!settings || !selectedVendor) {
            setAvailableModels([]);
            return;
        }

        const authToken = settings.fieldValues.authToken?.trim() ?? "";
        if (!authToken) {
            setAvailableModels([]);
            return;
        }

        void loadVendorModels(settings);
    }, [selectedVendor?.id]);

    /**
     * @function updateFieldValue
     * @description 更新单个动态字段值。
     * @param fieldKey 字段键。
     * @param value 新值。
     */
    const updateFieldValue = (fieldKey: string, value: string): void => {
        setSettings((currentSettings) => {
            if (!currentSettings) {
                return currentSettings;
            }
            return {
                ...currentSettings,
                fieldValues: {
                    ...currentSettings.fieldValues,
                    [fieldKey]: value,
                },
            };
        });
    };

    /**
     * @function handleVendorChange
     * @description 切换 vendor 并重建表单字段。
     * @param event 选择事件。
     */
    const handleVendorChange = (event: ChangeEvent<HTMLSelectElement>): void => {
        const nextVendor = resolveVendor(vendorCatalog, event.target.value);
        if (!nextVendor) {
            return;
        }

        setAvailableModels([]);
        setSettings((currentSettings) => mergeSettingsForVendor(currentSettings ?? {
            vendorId: nextVendor.id,
            model: nextVendor.defaultModel,
            fieldValues: {},
        }, nextVendor));
    };

    /**
     * @function handleSave
     * @description 保存当前 AI 设置。
     */
    const handleSave = async (): Promise<void> => {
        if (!settings) {
            return;
        }

        setIsSaving(true);
        setFeedback(null);
        setFeedbackIsError(false);

        try {
            const savedSettings = await saveAiChatSettings(settings);
            const vendor = resolveVendor(vendorCatalog, savedSettings.vendorId);
            setSettings(vendor ? mergeSettingsForVendor(savedSettings, vendor) : savedSettings);
            setFeedback(i18n.t("aiChatPlugin.saveSuccess"));
            window.dispatchEvent(new Event(AI_CHAT_SETTINGS_UPDATED_EVENT));
        } catch (saveError) {
            setFeedback(saveError instanceof Error ? saveError.message : String(saveError));
            setFeedbackIsError(true);
        } finally {
            setIsSaving(false);
        }
    };

    if (!currentVaultPath) {
        return (
            <div className="settings-item-group">
                <div className="ai-chat-settings-row">
                    <div className="ai-chat-settings-label">{i18n.t("aiChatPlugin.settingsTitle")}</div>
                    <div className="ai-chat-settings-desc">{i18n.t("aiChatPlugin.noVault")}</div>
                </div>
            </div>
        );
    }

    if (isLoading || !settings) {
        return (
            <div className="settings-item-group">
                <div className="ai-chat-settings-row">
                    <div className="ai-chat-settings-label">{i18n.t("aiChatPlugin.settingsTitle")}</div>
                    <div className="ai-chat-settings-desc">{i18n.t("aiChatPlugin.loadingSettings")}</div>
                </div>
            </div>
        );
    }

    return (
        <div className="settings-item-group ai-chat-settings-form">
            <div className="ai-chat-settings-row">
                <div className="ai-chat-settings-label">{i18n.t("aiChatPlugin.settingsTitle")}</div>
                <div className="ai-chat-settings-desc">{i18n.t("aiChatPlugin.settingsSubtitle")}</div>
            </div>

            <div className="ai-chat-settings-row">
                <div className="ai-chat-settings-label">{i18n.t("aiChatPlugin.vendorLabel")}</div>
                <div className="ai-chat-settings-desc">{i18n.t("aiChatPlugin.vendorDescription")}</div>
                <select
                    className="settings-compact-select"
                    value={settings.vendorId}
                    onChange={handleVendorChange}
                >
                    {vendorCatalog.map((vendor) => (
                        <option key={vendor.id} value={vendor.id}>{vendor.title}</option>
                    ))}
                </select>
            </div>

            <div className="ai-chat-settings-row">
                <div className="ai-chat-settings-label">{i18n.t("aiChatPlugin.modelLabel")}</div>
                <div className="ai-chat-settings-desc">{i18n.t("aiChatPlugin.modelDescription")}</div>
                <div className="ai-chat-settings-inline-actions">
                    <select
                        className="settings-compact-select ai-chat-settings-model-select"
                        value={settings.model}
                        onChange={(event) => {
                            setSettings((currentSettings) => currentSettings ? {
                                ...currentSettings,
                                model: event.target.value,
                            } : currentSettings);
                        }}
                    >
                        {availableModels.length === 0 ? (
                            <option value={settings.model}>{settings.model || "-"}</option>
                        ) : availableModels.map((model) => (
                            <option key={model.id} value={model.id}>{model.id}</option>
                        ))}
                    </select>
                    <button
                        type="button"
                        className="ai-chat-settings-refresh"
                        disabled={isLoadingModels}
                        onClick={() => {
                            void loadVendorModels(settings);
                        }}
                    >
                        {isLoadingModels
                            ? i18n.t("aiChatPlugin.refreshingModels")
                            : i18n.t("aiChatPlugin.refreshModels")}
                    </button>
                </div>
                <div className="ai-chat-settings-desc">{i18n.t("aiChatPlugin.modelLoadHint")}</div>
                <input
                    className="ai-chat-settings-input"
                    type="text"
                    value={settings.model}
                    onChange={(event) => {
                        setSettings((currentSettings) => currentSettings ? {
                            ...currentSettings,
                            model: event.target.value,
                        } : currentSettings);
                    }}
                />
            </div>

            {selectedVendor?.fields.map((field) => (
                <div key={field.key} className="ai-chat-settings-row">
                    <div className="ai-chat-settings-label">{field.label}</div>
                    <div className="ai-chat-settings-desc">{field.description}</div>
                    <input
                        className="ai-chat-settings-input"
                        type={field.fieldType}
                        required={field.required}
                        placeholder={field.placeholder ?? undefined}
                        value={settings.fieldValues[field.key] ?? ""}
                        onChange={(event) => {
                            updateFieldValue(field.key, event.target.value);
                        }}
                    />
                </div>
            ))}

            <div className="ai-chat-settings-actions">
                <div className={`ai-chat-settings-feedback ${feedbackIsError ? "error" : ""}`}>
                    {feedback ?? `${i18n.t("aiChatPlugin.configuredVendor")}: ${selectedVendor?.title ?? "-"}`}
                </div>
                <button
                    type="button"
                    className="ai-chat-settings-save"
                    disabled={isSaving}
                    onClick={() => {
                        void handleSave();
                    }}
                >
                    {isSaving ? i18n.t("aiChatPlugin.sending") : i18n.t("aiChatPlugin.save")}
                </button>
            </div>
        </div>
    );
}

/**
 * @function activatePlugin
 * @description 注册 AI 聊天 panel、activity 图标与设置选栏。
 * @returns 插件清理函数。
 */
export function activatePlugin(): () => void {
    const unregisterActivity = registerActivity({
        type: "panel-container",
        id: AI_CHAT_PANEL_ID,
        title: () => i18n.t("aiChatPlugin.title"),
        icon: React.createElement(Bot, { size: 18, strokeWidth: 1.8 }),
        defaultSection: "top",
        defaultBar: "right",
        defaultOrder: 1,
    });

    const unregisterPanel = registerPanel({
        id: AI_CHAT_PANEL_ID,
        title: () => i18n.t("aiChatPlugin.title"),
        activityId: AI_CHAT_PANEL_ID,
        defaultPosition: "right",
        defaultOrder: 1,
        render: () => <ChatPanel />,
    });

    const unregisterSettings = registerSettingsSection({
        id: AI_CHAT_PANEL_ID,
        title: "aiChatPlugin.settingsSection",
        order: 45,
        render: () => <AiChatSettingsSection />,
    });

    console.info("[aiChatPlugin] registered ai chat plugin");

    return () => {
        unregisterSettings();
        unregisterPanel();
        unregisterActivity();
        console.info("[aiChatPlugin] unregistered ai chat plugin");
    };
}
