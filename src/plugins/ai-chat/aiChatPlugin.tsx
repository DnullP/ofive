/**
 * @module plugins/ai-chat/aiChatPlugin
 * @description AI 聊天插件：注册右侧聊天面板，并通过插件拥有的 settings store 向 host 贡献 AI 设置选栏。
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
import type { IDockviewPanelProps } from "dockview";
import { ArrowUp, Bot, Check, Copy, Plus, Sparkles, X } from "lucide-react";
import {
    getAiChatHistory,
    getAiVendorCatalog,
    getAiVendorModels,
    saveAiChatHistory,
    startAiChatStream,
    submitAiChatConfirmation,
    subscribeAiChatStreamEvents,
    type AiChatConversationRecord,
    type AiChatHistoryMessage,
    type AiChatHistoryState,
    type AiChatSettings,
    type AiVendorDefinition,
    type AiVendorModelDefinition,
} from "../../api/aiApi";
import {
    ensureAiChatSettingsLoaded,
    getAiChatSettingsSnapshot,
    resetAiChatSettingsStore,
    saveAiChatSettingsToStore,
    subscribeAiChatSettingsSnapshot,
} from "./aiChatSettingsStore";
import {
    buildPersistableHistory,
    createConversationRecord,
    deriveConversationTitle,
    ensureHistoryState,
    filterConversations,
    formatAiPanelError,
    formatConversationTime,
    mergeSettingsForVendor,
    resolveVendor,
    sortConversations,
} from "./aiChatShared";
import {
    createEmptyPendingStreamBinding,
    createPendingStreamBinding,
    reduceAiChatStreamEvent,
    type ChatDebugEntry,
    type PendingStreamBinding,
    type PendingToolConfirmation,
} from "./aiChatStreamState";
import {
    filterChatDebugEntries,
    type ChatDebugFilterValue,
} from "./aiChatDebugFilter";
import { formatAiChatDebugEntriesForClipboard } from "./aiChatDebugExport";
import { shouldSubmitAiChatComposer } from "./aiChatInputPolicy";
import { AiChatMessageMarkdown } from "./aiChatMessageMarkdown";
import { buildConfirmationPreview } from "./aiChatConfirmationPreview";
import { registerActivity } from "../../host/registry/activityRegistry";
import { registerPanel } from "../../host/registry/panelRegistry";
import { registerTabComponent } from "../../host/registry/tabComponentRegistry";
import {
    buildConvertibleViewTabParams,
    registerConvertibleView,
} from "../../host/registry";
import { registerSettingsItem, registerSettingsSection } from "../../host/settings/settingsRegistry";
import { registerPluginOwnedStore } from "../../host/store/storeRegistry";
import { useVaultState } from "../../host/vault/vaultStore";
import i18n from "../../i18n";
import "./aiChatPlugin.css";

const AI_CHAT_PANEL_ID = "ai-chat";
const AI_CHAT_PLUGIN_ID = "ai-chat";
const AI_CHAT_TAB_COMPONENT_ID = "ai-chat-tab";
const AI_CHAT_CONVERTIBLE_ID = "ai-chat";

interface QuickPromptDefinition {
    id: string;
    translationKey: string;
}

let chatMessageSequence = 1;
let chatDebugSequence = 1;

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
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return `ai-chat-message-${crypto.randomUUID()}`;
    }

    const nextId = `ai-chat-message-${Date.now()}-${String(chatMessageSequence)}`;
    chatMessageSequence += 1;
    return nextId;
}

/**
 * @function nextChatDebugEntryId
 * @description 生成调试日志唯一 ID。
 * @returns 调试日志 ID。
 */
function nextChatDebugEntryId(): string {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return `ai-chat-debug-${crypto.randomUUID()}`;
    }

    const nextId = `ai-chat-debug-${Date.now()}-${String(chatDebugSequence)}`;
    chatDebugSequence += 1;
    return nextId;
}

/**
 * @function AiChatView
 * @description 渲染可在 pane 和 tab 之间复用的 AI 聊天视图。
 * @returns React 节点。
 */
function AiChatView(): ReactNode {
    const { currentVaultPath } = useVaultState();
    const [historyState, setHistoryState] = useState<AiChatHistoryState | null>(null);
    const [debugEntriesByConversation, setDebugEntriesByConversation] = useState<Record<string, ChatDebugEntry[]>>({});
    const [pendingConfirmations, setPendingConfirmations] = useState<Record<string, PendingToolConfirmation>>({});
    const [activeTab, setActiveTab] = useState<"history" | "chat" | "debug">("chat");
    const [debugFilter, setDebugFilter] = useState<ChatDebugFilterValue>("all");
    const [debugCopyState, setDebugCopyState] = useState<"idle" | "copied" | "error">("idle");
    const [conversationQuery, setConversationQuery] = useState("");
    const [draft, setDraft] = useState("");
    const [isStreaming, setIsStreaming] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [settings, setSettings] = useState<AiChatSettings | null>(null);
    const [vendorCatalog, setVendorCatalog] = useState<AiVendorDefinition[]>([]);
    const streamBindingRef = useRef<PendingStreamBinding>(createEmptyPendingStreamBinding());
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

    const visibleDebugEntries = useMemo(() => {
        return filterChatDebugEntries(currentDebugEntries, debugFilter);
    }, [currentDebugEntries, debugFilter]);

    const allDebugEntriesText = useMemo(() => {
        return formatAiChatDebugEntriesForClipboard(currentDebugEntries);
    }, [currentDebugEntries]);

    const filteredConversations = useMemo(() => {
        return filterConversations(historyState?.conversations ?? [], conversationQuery);
    }, [conversationQuery, historyState?.conversations]);

    const formattedError = useMemo(() => {
        if (!error) {
            return null;
        }
        return formatAiPanelError(error);
    }, [error]);

    const composerModelLabel = useMemo(() => {
        const configuredModel = settings?.model?.trim() ?? "";
        if (configuredModel) {
            return configuredModel;
        }
        if (!currentVaultPath || !isVendorConfigured) {
            return i18n.t("aiChatPlugin.composerHintMissing");
        }
        return "-";
    }, [currentVaultPath, isVendorConfigured, settings?.model]);

    const canSend = Boolean(currentVaultPath && activeConversation && draft.trim() && !isStreaming && isVendorConfigured);

    useEffect(() => {
        let disposed = false;

        if (!currentVaultPath) {
            setHistoryState(null);
            setSettings(null);
            historyLoadedRef.current = false;
            resetAiChatSettingsStore();
            return;
        }

        Promise.all([
            getAiVendorCatalog(),
            ensureAiChatSettingsLoaded(currentVaultPath),
            getAiChatHistory(),
        ])
            .then(([catalog, nextSettings, history]) => {
                if (disposed) {
                    return;
                }
                setVendorCatalog(catalog);
                setSettings(nextSettings);
                setHistoryState(ensureHistoryState(history));
                setDebugEntriesByConversation({});
                setPendingConfirmations({});
                setDebugFilter("all");
                setDebugCopyState("idle");
                historyLoadedRef.current = true;
            })
            .catch((loadError) => {
                if (disposed) {
                    return;
                }
                setError(loadError instanceof Error ? loadError.message : String(loadError));
            });

        const unsubscribe = subscribeAiChatSettingsSnapshot(() => {
            if (disposed) {
                return;
            }

            const snapshot = getAiChatSettingsSnapshot();
            if (snapshot.vaultPath !== currentVaultPath) {
                return;
            }

            setSettings(snapshot.settings);
        });

        return () => {
            disposed = true;
            unsubscribe();
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

        void subscribeAiChatStreamEvents((payload) => {
            if (disposed) {
                return;
            }

            const binding = streamBindingRef.current;
            const transition = reduceAiChatStreamEvent({
                payload,
                binding,
                debugEntryId: nextChatDebugEntryId(),
                debugFallbackTitle: i18n.t("aiChatPlugin.debugEntryFallbackTitle"),
                confirmationFallbackHint: i18n.t("aiChatPlugin.confirmationFallbackHint"),
            });

            streamBindingRef.current = transition.nextBinding;

            if (!transition.matchesBinding) {
                if (!binding.streamId && transition.nextBinding.streamId === payload.streamId) {
                    console.info("[aiChatPlugin] stream bound", {
                        streamId: payload.streamId,
                        conversationId: binding.conversationId,
                        sessionId: binding.sessionId,
                    });
                }
                return;
            }

            if (!binding.streamId && transition.nextBinding.streamId === payload.streamId) {
                console.info("[aiChatPlugin] stream bound", {
                    streamId: payload.streamId,
                    conversationId: binding.conversationId,
                    sessionId: binding.sessionId,
                });
            }

            if (transition.nextDebugEntry) {
                console.debug("[aiChatPlugin] stream debug chunk", {
                    streamId: payload.streamId,
                    title: transition.nextDebugEntry.title,
                });
                appendDebugEntry(binding.conversationId!, transition.nextDebugEntry);
                return;
            }

            if (transition.nextAssistantText) {
                updateConversation(binding.conversationId!, (conversation) => ({
                    ...conversation,
                    updatedAtUnixMs: Date.now(),
                    messages: conversation.messages.map((message) => {
                        if (message.id !== binding.assistantMessageId) {
                            return message;
                        }
                        return {
                            ...message,
                            text: transition.nextAssistantText ?? message.text,
                        };
                    }),
                }));
            }

            if (transition.nextConfirmation) {
                console.info("[aiChatPlugin] stream confirmation requested", {
                    streamId: payload.streamId,
                    confirmationId: transition.nextConfirmation.confirmationId,
                    toolName: transition.nextConfirmation.toolName || null,
                });
                setPendingConfirmationState(transition.nextConfirmation);
            }

            if (transition.errorMessage) {
                if (payload.eventType === "error") {
                    console.warn("[aiChatPlugin] stream failed", {
                        streamId: payload.streamId,
                        message: transition.errorMessage,
                    });
                }
                setError(transition.errorMessage);
            }

            if (transition.shouldStopStreaming) {
                setIsStreaming(false);
            }

            if (transition.shouldClearPendingConfirmation) {
                clearPendingConfirmationState(binding.assistantMessageId!);
            }

            if (transition.nextConfirmation) {
                return;
            }

            if (transition.isDone) {
                console.info("[aiChatPlugin] stream completed", {
                    streamId: payload.streamId,
                    conversationId: binding.conversationId,
                });
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

    useEffect(() => {
        if (debugCopyState === "idle") {
            return;
        }

        const timer = window.setTimeout(() => {
            setDebugCopyState("idle");
        }, 1600);

        return () => {
            window.clearTimeout(timer);
        };
    }, [debugCopyState]);

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
        setConversationQuery("");
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
        setConversationQuery("");
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
        streamBindingRef.current = createPendingStreamBinding(
            confirmation.conversationId,
            confirmation.sessionId,
            confirmation.assistantMessageId,
        );

        try {
            const response = await submitAiChatConfirmation({
                confirmationId: confirmation.confirmationId,
                confirmed: approved,
                sessionId: confirmation.sessionId,
            });
            streamBindingRef.current = createPendingStreamBinding(
                confirmation.conversationId,
                confirmation.sessionId,
                confirmation.assistantMessageId,
                response.streamId,
            );
            clearPendingConfirmationState(confirmation.assistantMessageId);
        } catch (submitError) {
            setError(submitError instanceof Error ? submitError.message : String(submitError));
            setIsStreaming(false);
            setPendingConfirmationState({
                ...confirmation,
                isSubmitting: false,
            });
            streamBindingRef.current = createEmptyPendingStreamBinding();
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

        console.info("[aiChatPlugin] submit message", {
            conversationId: activeConversation.id,
            sessionId: activeConversation.sessionId,
            messageLength: trimmed.length,
        });

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

        streamBindingRef.current = createPendingStreamBinding(
            activeConversation.id,
            activeConversation.sessionId,
            assistantMessage.id,
        );

        try {
            const response = await startAiChatStream({
                message: trimmed,
                sessionId: activeConversation.sessionId,
                history,
            });
            streamBindingRef.current = createPendingStreamBinding(
                activeConversation.id,
                activeConversation.sessionId,
                assistantMessage.id,
                response.streamId,
            );
        } catch (submitError) {
            setError(submitError instanceof Error ? submitError.message : String(submitError));
            setIsStreaming(false);
            streamBindingRef.current = createEmptyPendingStreamBinding();
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
        if (!shouldSubmitAiChatComposer({
            key: event.key,
            shiftKey: event.shiftKey,
            nativeEvent: event.nativeEvent,
        })) {
            return;
        }

        event.preventDefault();
        if (canSend) {
            void handleSubmit();
        }
    };

    /**
     * @function handleCopyAllDebugLogs
     * @description 将当前会话的全部调试日志复制到系统剪贴板。
     * @returns Promise<void>
     */
    const handleCopyAllDebugLogs = async (): Promise<void> => {
        if (!allDebugEntriesText) {
            return;
        }

        try {
            await navigator.clipboard.writeText(allDebugEntriesText);
            setDebugCopyState("copied");
        } catch (copyError) {
            setDebugCopyState("error");
            console.error("[ai-chat] copy debug logs failed", {
                error: copyError,
            });
        }
    };

    return (
        <div className="ai-chat-panel">
            <div className="ai-chat-header">
                <div className="ai-chat-header-actions">
                    <button
                        type="button"
                        className="ai-chat-conversation-manage"
                        disabled={isStreaming}
                        onClick={() => {
                            setActiveTab("history");
                        }}
                    >
                        <span>{i18n.t("aiChatPlugin.conversationManager")}</span>
                    </button>
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
                    aria-selected={activeTab === "history"}
                    className={`ai-chat-tab-button ${activeTab === "history" ? "active" : ""}`}
                    onClick={() => {
                        setActiveTab("history");
                    }}
                >
                    {i18n.t("aiChatPlugin.tabHistory")}
                </button>
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

            {activeTab === "history" ? (
                <div className="ai-chat-history-shell" role="tabpanel">
                    <div className="ai-chat-history-toolbar">
                        <input
                            className="ai-chat-history-search"
                            type="text"
                            value={conversationQuery}
                            placeholder={i18n.t("aiChatPlugin.conversationSearchPlaceholder")}
                            onChange={(event) => {
                                setConversationQuery(event.target.value);
                            }}
                        />
                        <button
                            type="button"
                            className="ai-chat-conversation-manage"
                            onClick={() => {
                                setActiveTab("chat");
                            }}
                        >
                            <span>{i18n.t("aiChatPlugin.conversationBackToChat")}</span>
                        </button>
                    </div>
                    <div className="ai-chat-history-list">
                        {filteredConversations.length ? filteredConversations.map((conversation) => (
                            <button
                                key={conversation.id}
                                type="button"
                                className={`ai-chat-history-item ${historyState?.activeConversationId === conversation.id ? "active" : ""}`}
                                disabled={isStreaming}
                                onClick={() => {
                                    handleSelectConversation(conversation.id);
                                }}
                            >
                                <div className="ai-chat-history-item-main">
                                    <span className="ai-chat-conversation-title">{conversation.title}</span>
                                    <span className="ai-chat-history-preview">{conversation.messages[conversation.messages.length - 1]?.text || i18n.t("aiChatPlugin.historyEmpty")}</span>
                                </div>
                                <span className="ai-chat-conversation-time">{formatConversationTime(conversation.updatedAtUnixMs)}</span>
                            </button>
                        )) : (
                            <div className="ai-chat-conversation-empty">{i18n.t("aiChatPlugin.conversationSearchEmpty")}</div>
                        )}
                    </div>
                </div>
            ) : activeTab === "chat" ? (
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
                            const confirmationPreview = confirmation
                                ? buildConfirmationPreview(confirmation)
                                : null;

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
                                        <div className="ai-chat-message-bubble">
                                            <AiChatMessageMarkdown
                                                content={message.text}
                                                role={message.role}
                                            />
                                        </div>
                                        {confirmation ? (
                                            <div className="ai-chat-confirmation-card">
                                                <div className="ai-chat-confirmation-meta">
                                                    <span>{confirmation.hint || i18n.t("aiChatPlugin.confirmationFallbackHint")}</span>
                                                    {confirmation.toolName ? (
                                                        <span>{i18n.t("aiChatPlugin.confirmationToolLabel")}: {confirmation.toolName}</span>
                                                    ) : null}
                                                    {confirmationPreview?.kind === "markdown-patch" ? (
                                                        <span>{i18n.t("aiChatPlugin.confirmationTargetLabel")}: {confirmationPreview.relativePath}</span>
                                                    ) : null}
                                                </div>
                                                {confirmationPreview?.kind === "markdown-patch" ? (
                                                    <div className="ai-chat-confirmation-preview">
                                                        <div className="ai-chat-confirmation-preview-label">
                                                            {i18n.t("aiChatPlugin.confirmationDiffLabel", {
                                                                count: confirmationPreview.hunkCount,
                                                            })}
                                                        </div>
                                                        <pre className="ai-chat-confirmation-diff">{confirmationPreview.diffText}</pre>
                                                    </div>
                                                ) : null}
                                                {confirmationPreview?.kind === "generic" ? (
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
                    <div className="ai-chat-debug-toolbar">
                        <div className="ai-chat-debug-filter-group">
                            {(["all", "error", "warn", "info", "debug"] as const).map((level) => (
                                <button
                                    key={level}
                                    type="button"
                                    className={`ai-chat-debug-filter ${debugFilter === level ? "active" : ""}`}
                                    onClick={() => {
                                        setDebugFilter(level);
                                    }}
                                >
                                    {i18n.t(`aiChatPlugin.debugFilter${level.charAt(0).toUpperCase()}${level.slice(1)}`)}
                                </button>
                            ))}
                        </div>
                        <button
                            type="button"
                            className={`ai-chat-debug-copy-button state-${debugCopyState}`}
                            disabled={!allDebugEntriesText}
                            onClick={() => {
                                void handleCopyAllDebugLogs();
                            }}
                        >
                            <Copy size={13} strokeWidth={1.9} />
                            <span>{i18n.t(
                                debugCopyState === "copied"
                                    ? "aiChatPlugin.debugCopyCopied"
                                    : debugCopyState === "error"
                                        ? "aiChatPlugin.debugCopyFailed"
                                        : "aiChatPlugin.debugCopyAll",
                            )}</span>
                        </button>
                    </div>
                    {visibleDebugEntries.length === 0 ? (
                        <div className="ai-chat-debug-empty">
                            <div className="ai-chat-debug-empty-title">{i18n.t("aiChatPlugin.debugEmptyTitle")}</div>
                            <div className="ai-chat-debug-empty-body">{i18n.t("aiChatPlugin.debugEmptyBody", { filter: i18n.t(`aiChatPlugin.debugFilter${debugFilter.charAt(0).toUpperCase()}${debugFilter.slice(1)}`) })}</div>
                        </div>
                    ) : null}
                    <div ref={debugViewportRef} className="ai-chat-debug-list">
                        {visibleDebugEntries.map((entry) => (
                            <div key={entry.id} className={`ai-chat-debug-entry level-${entry.level}`}>
                                <div className="ai-chat-debug-entry-header">
                                    <div className="ai-chat-debug-entry-meta">
                                        <span className="ai-chat-debug-entry-title">{entry.title}</span>
                                        <span className={`ai-chat-debug-entry-level level-${entry.level}`}>{entry.level}</span>
                                    </div>
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
                    disabled={!currentVaultPath || isStreaming || !activeConversation || activeTab === "history"}
                    onKeyDown={handleInputKeyDown}
                    onChange={(event) => {
                        setDraft(event.target.value);
                    }}
                />
                <div className="ai-chat-composer-row">
                    <div className="ai-chat-composer-hint">
                        {composerModelLabel}
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
 * @function AiChatTab
 * @description 渲染主区域中的 AI 聊天标签页。
 * @param _props Dockview 面板属性；当前实现不依赖额外参数。
 * @returns React 节点。
 */
function AiChatTab(_props: IDockviewPanelProps<Record<string, unknown>>): ReactNode {
    return <AiChatView />;
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

    const canLoadVendorModels = useMemo(() => {
        if (!settings || !selectedVendor) {
            return false;
        }

        return selectedVendor.fields
            .filter((field) => field.required)
            .every((field) => (settings.fieldValues[field.key] ?? "").trim().length > 0);
    }, [selectedVendor, settings]);

    useEffect(() => {
        let disposed = false;

        if (!currentVaultPath) {
            setSettings(null);
            setVendorCatalog([]);
            resetAiChatSettingsStore();
            return;
        }

        setIsLoading(true);
        Promise.all([
            getAiVendorCatalog(),
            ensureAiChatSettingsLoaded(currentVaultPath),
        ])
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

    useEffect(() => {
        if (!currentVaultPath) {
            return;
        }

        let disposed = false;
        const unsubscribe = subscribeAiChatSettingsSnapshot(() => {
            if (disposed) {
                return;
            }

            const snapshot = getAiChatSettingsSnapshot();
            if (snapshot.vaultPath !== currentVaultPath || !snapshot.settings) {
                return;
            }

            const nextVendor = resolveVendor(vendorCatalog, snapshot.settings.vendorId);
            setSettings(nextVendor
                ? mergeSettingsForVendor(snapshot.settings, nextVendor)
                : snapshot.settings);
        });

        return () => {
            disposed = true;
            unsubscribe();
        };
    }, [currentVaultPath, vendorCatalog]);

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

        if (!canLoadVendorModels) {
            setAvailableModels([]);
            return;
        }

        void loadVendorModels(settings);
    }, [canLoadVendorModels, selectedVendor?.id]);

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
        if (!settings || !currentVaultPath) {
            return;
        }

        setIsSaving(true);
        setFeedback(null);
        setFeedbackIsError(false);

        try {
            const savedSettings = await saveAiChatSettingsToStore(currentVaultPath, settings);
            const vendor = resolveVendor(vendorCatalog, savedSettings.vendorId);
            const nextSettings = vendor ? mergeSettingsForVendor(savedSettings, vendor) : savedSettings;
            setSettings(nextSettings);

            if (vendor) {
                const canRefreshModels = vendor.fields
                    .filter((field) => field.required)
                    .every((field) => (nextSettings.fieldValues[field.key] ?? "").trim().length > 0);
                if (canRefreshModels) {
                    void loadVendorModels(nextSettings);
                } else {
                    setAvailableModels([]);
                }
            }

            setFeedback(i18n.t("aiChatPlugin.saveSuccess"));
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
                <select
                    className="settings-compact-select ai-chat-settings-model-select"
                    value={settings.model}
                    disabled={isLoadingModels}
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
 * @function registerAiChatSettingsSection
 * @description 注册 AI 设置选栏。
 * @returns 取消注册函数。
 */
function registerAiChatSettingsSection(): () => void {
    const unregisterSection = registerSettingsSection({
        id: AI_CHAT_PANEL_ID,
        title: "settings.aiSection",
        order: 45,
    });

    const unregisterItem = registerSettingsItem({
        id: "ai-chat-settings-panel",
        sectionId: AI_CHAT_PANEL_ID,
        order: 10,
        kind: "custom",
        title: "settings.aiSection",
        render: () => <AiChatSettingsSection />,
    });

    return () => {
        unregisterItem();
        unregisterSection();
    };
}

/**
 * @function activatePlugin
 * @description 注册 AI 聊天 panel、activity 图标，以及 AI chat 插件拥有的 settings store。
 * @returns 插件清理函数。
 */
export function activatePlugin(): () => void {
    const unregisterTabComponent = registerTabComponent({
        id: AI_CHAT_TAB_COMPONENT_ID,
        component: AiChatTab,
        lifecycleScope: "vault",
    });

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
        render: () => <AiChatView />,
    });

    const unregisterConvertibleView = registerConvertibleView({
        id: AI_CHAT_CONVERTIBLE_ID,
        tabComponentId: AI_CHAT_TAB_COMPONENT_ID,
        panelId: AI_CHAT_PANEL_ID,
        defaultMode: "panel",
        buildTabInstance: ({ stateKey, params }) => ({
            id: AI_CHAT_PANEL_ID,
            title: i18n.t("aiChatPlugin.title"),
            component: AI_CHAT_TAB_COMPONENT_ID,
            params: buildConvertibleViewTabParams({
                descriptorId: AI_CHAT_CONVERTIBLE_ID,
                stateKey,
            }, params),
        }),
    });

    const unregisterAiChatSettingsStore = registerPluginOwnedStore(AI_CHAT_PLUGIN_ID, {
        storeId: "settings",
        title: "AI Chat Settings Store",
        description: "Vault-scoped AI chat settings and provider configuration state.",
        scope: "plugin-private",
        tags: ["ai-chat", "settings", "llm"],
        schema: {
            summary: "Govern vault-scoped AI chat settings hydration, save, and reset behavior for the plugin.",
            state: {
                fields: [
                    {
                        name: "vaultPath",
                        description: "The vault path whose AI settings are currently loaded.",
                        valueType: "string",
                        initialValue: "null",
                    },
                    {
                        name: "settings",
                        description: "The currently loaded AI chat settings snapshot.",
                        valueType: "object",
                        initialValue: "null",
                        persisted: true,
                    },
                    {
                        name: "isLoading",
                        description: "Settings load or save request is in flight.",
                        valueType: "boolean",
                        initialValue: "false",
                        allowedValues: ["true", "false"],
                    },
                    {
                        name: "error",
                        description: "Latest AI settings load or save error message.",
                        valueType: "string",
                        initialValue: "null",
                    },
                ],
                invariants: [
                    "settings belongs to vaultPath when vaultPath is non-null",
                    "isLoading=false after every resolved or rejected settings request",
                ],
                actions: [
                    {
                        id: "ensure-loaded",
                        description: "Load AI settings for the active vault and cache the snapshot.",
                        updates: ["vaultPath", "settings", "isLoading", "error"],
                        sideEffects: ["invoke ai settings read API"],
                    },
                    {
                        id: "save-settings",
                        description: "Persist AI settings for the active vault and refresh the cached snapshot.",
                        updates: ["vaultPath", "settings", "isLoading", "error"],
                        sideEffects: ["invoke ai settings save API"],
                    },
                    {
                        id: "reset-settings",
                        description: "Clear cached AI settings when vault context changes or plugin resets.",
                        updates: ["vaultPath", "settings", "isLoading", "error"],
                    },
                ],
            },
            flow: {
                kind: "state-machine",
                description: "AI chat settings move through idle, loading, ready, and error snapshots around async persistence.",
                initialState: "idle",
                states: [
                    { id: "idle", description: "No vault settings snapshot is currently loaded." },
                    { id: "loading", description: "AI settings are being loaded or saved." },
                    { id: "ready", description: "AI settings snapshot is available for the active vault." },
                    { id: "error", description: "Last async settings request failed and error is retained." },
                ],
                transitions: [
                    {
                        event: "load-or-save-request",
                        from: ["idle", "ready", "error"],
                        to: "loading",
                        description: "A load or save request enters the async loading phase.",
                        sideEffects: ["invoke ai chat settings API"],
                    },
                    {
                        event: "request-success",
                        from: ["loading"],
                        to: "ready",
                        description: "Successful load or save produces a ready settings snapshot.",
                    },
                    {
                        event: "request-failure",
                        from: ["loading"],
                        to: "error",
                        description: "Failed load or save records an error snapshot.",
                    },
                    {
                        event: "reset-context",
                        from: ["ready", "error"],
                        to: "idle",
                        description: "Vault switch or plugin reset clears cached settings.",
                    },
                ],
                failureModes: [
                    "async API failure leaves the previous settings snapshot or null plus error",
                    "vault switch must reset cached settings before the next load completes",
                ],
            },
        },
        getSnapshot: () => getAiChatSettingsSnapshot(),
        subscribe: (listener) => subscribeAiChatSettingsSnapshot(listener),
        contributions: [{
            kind: "settings",
            activate: () => registerAiChatSettingsSection(),
        }],
    });

    console.info("[aiChatPlugin] registered ai chat plugin");

    return () => {
        unregisterAiChatSettingsStore();
        unregisterConvertibleView();
        unregisterPanel();
        unregisterActivity();
        unregisterTabComponent();
        console.info("[aiChatPlugin] unregistered ai chat plugin");
    };
}
