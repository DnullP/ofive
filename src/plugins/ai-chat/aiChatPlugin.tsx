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
import type { WorkbenchTabProps } from "../../host/layout/workbenchContracts";
import { ArrowUp, Bot, Check, Copy, Plus, Sparkles, X } from "lucide-react";
import {
    getAiChatHistory,
    getAiVendorCatalog,
    getAiVendorModels,
    saveAiChatHistory,
    stopAiChatStream,
    startAiChatStream,
    submitAiChatConfirmation,
    subscribeAiChatStreamEvents,
    type AiChatConversationRecord,
    type AiChatHistoryContentBlock,
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
    createConversationSessionId,
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
    isPendingStreamBindingActive,
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
import {
    advanceAiChatSmoothedMessageState,
    isAiChatSmoothedMessageSettled,
    syncAiChatSmoothedMessageTargets,
    type AiChatSmoothedMessageState,
} from "./aiChatStreamSmoothing";
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
const AI_CHAT_TAB_ID = "ai-chat-tab-instance";
const AI_CHAT_CONVERTIBLE_ID = "ai-chat";

interface QuickPromptDefinition {
    id: string;
    translationKey: string;
}

let chatMessageSequence = 1;
let chatDebugSequence = 1;
const AI_CHAT_CONFIRMATION_TOOL_NAME = "adk_request_confirmation";

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
 * @function findBindingForStreamEvent
 * @description 根据事件中的 streamId 或 sessionId 找到对应会话的 pending binding。
 * @param bindings 当前全部会话 binding。
 * @param payload 本次流事件。
 * @returns 匹配的 binding，未找到时返回 null。
 */
function findBindingForStreamEvent(
    bindings: Record<string, PendingStreamBinding>,
    payload: Parameters<typeof reduceAiChatStreamEvent>[0]["payload"],
): PendingStreamBinding | null {
    const exactBinding = Object.values(bindings).find((binding) => {
        return binding.streamId === payload.streamId;
    });
    if (exactBinding) {
        return exactBinding;
    }

    if (!payload.sessionId) {
        return null;
    }

    return Object.values(bindings).find((binding) => {
        return !binding.streamId && binding.sessionId === payload.sessionId;
    }) ?? null;
}

/**
 * @function createProtocolUserTextMessage
 * @description 将可见用户消息映射为协议历史消息。
 * @param message 可见用户消息。
 * @returns 协议历史消息。
 */
function createProtocolUserTextMessage(message: AiChatHistoryMessage): AiChatHistoryMessage {
    return {
        ...message,
        contentBlocks: [{
            kind: "text",
            text: message.text,
        }],
    };
}

/**
 * @function createProtocolAssistantMessage
 * @description 将流式事件中的内容块快照映射为协议历史中的助手消息。
 * @param assistantMessage 可见助手消息。
 * @param payload 流事件。
 * @returns 协议历史助手消息，不可构建时返回 null。
 */
function createProtocolAssistantMessage(
    assistantMessage: AiChatHistoryMessage,
    payload: Parameters<typeof reduceAiChatStreamEvent>[0]["payload"],
): AiChatHistoryMessage | null {
    const contentBlocks = parseHistoryContentBlocksJson(payload.historyContentBlocksJson);
    if (contentBlocks.length === 0) {
        if (!(payload.accumulatedText ?? "").trim() && !(payload.reasoningAccumulatedText ?? "").trim()) {
            return null;
        }

        return {
            id: `${assistantMessage.id}:${payload.streamId}:${payload.eventType}`,
            role: "assistant",
            text: payload.accumulatedText ?? assistantMessage.text,
            reasoningText: payload.reasoningAccumulatedText ?? assistantMessage.reasoningText,
            createdAtUnixMs: Date.now(),
            contentBlocks: [
                ...((payload.reasoningAccumulatedText ?? "").trim()
                    ? [{ kind: "thinking" as const, text: payload.reasoningAccumulatedText ?? "" }]
                    : []),
                ...((payload.accumulatedText ?? "").trim()
                    ? [{ kind: "text" as const, text: payload.accumulatedText ?? "" }]
                    : []),
            ],
        };
    }

    return {
        id: `${assistantMessage.id}:${payload.streamId}:${payload.eventType}`,
        role: "assistant",
        text: payload.accumulatedText ?? assistantMessage.text,
        reasoningText: payload.reasoningAccumulatedText ?? assistantMessage.reasoningText,
        createdAtUnixMs: Date.now(),
        contentBlocks,
    };
}

/**
 * @function createProtocolConfirmationResultMessage
 * @description 将确认结果映射为隐藏协议历史中的 tool-result 消息。
 * @param confirmation 确认请求。
 * @param approved 用户是否批准。
 * @returns 协议历史消息。
 */
function createProtocolConfirmationResultMessage(
    confirmation: PendingToolConfirmation,
    approved: boolean,
): AiChatHistoryMessage {
    return {
        id: `${confirmation.assistantMessageId}:${confirmation.confirmationId}:result`,
        role: "user",
        text: "",
        createdAtUnixMs: Date.now(),
        contentBlocks: [{
            kind: "tool-result",
            toolUseId: confirmation.confirmationId,
            toolName: AI_CHAT_CONFIRMATION_TOOL_NAME,
            resultJson: JSON.stringify({ confirmed: approved }),
        }],
    };
}

/**
 * @function parseHistoryContentBlocksJson
 * @description 解析流事件中的协议历史块 JSON。
 * @param rawJson 原始 JSON。
 * @returns 内容块数组。
 */
function parseHistoryContentBlocksJson(rawJson: string | null): AiChatHistoryContentBlock[] {
    if (!rawJson?.trim()) {
        return [];
    }

    try {
        const parsed = JSON.parse(rawJson) as unknown;
        if (!Array.isArray(parsed)) {
            return [];
        }

        return parsed.filter((item): item is AiChatHistoryContentBlock => {
            return typeof item === "object"
                && item !== null
                && typeof (item as Partial<AiChatHistoryContentBlock>).kind === "string";
        });
    } catch {
        return [];
    }
}

/**
 * @function shouldKeepAnimatingMessage
 * @description 判断一条平滑消息是否仍需保留在展示层状态中。
 * @param state 平滑消息状态。
 * @returns 若消息仍在接收或尚未追平则返回 true。
 */
function shouldKeepAnimatingMessage(state: AiChatSmoothedMessageState): boolean {
    return state.active || !isAiChatSmoothedMessageSettled(state);
}

/**
 * @function hasPendingSmoothedMessages
 * @description 判断当前是否存在尚未追平的展示层流式消息。
 * @param states 全部平滑消息状态。
 * @returns 若至少有一条消息仍需 reveal 则返回 true。
 */
function hasPendingSmoothedMessages(
    states: Record<string, AiChatSmoothedMessageState>,
): boolean {
    return Object.values(states).some((messageState) => {
        return !isAiChatSmoothedMessageSettled(messageState);
    });
}

/**
 * @function AiChatView
 * @description 渲染可在 pane 和 tab 之间复用的 AI 聊天视图。
 * @returns React 节点。
 */
function AiChatView(): ReactNode {
    const { currentVaultPath, backendReady } = useVaultState();
    const [historyState, setHistoryState] = useState<AiChatHistoryState | null>(null);
    const [bindingsByConversation, setBindingsByConversation] = useState<Record<string, PendingStreamBinding>>({});
    const [smoothedMessagesById, setSmoothedMessagesById] = useState<Record<string, AiChatSmoothedMessageState>>({});
    const [debugEntriesByConversation, setDebugEntriesByConversation] = useState<Record<string, ChatDebugEntry[]>>({});
    const [pendingConfirmations, setPendingConfirmations] = useState<Record<string, PendingToolConfirmation>>({});
    const [activeTab, setActiveTab] = useState<"history" | "chat" | "debug">("chat");
    const [debugFilter, setDebugFilter] = useState<ChatDebugFilterValue>("all");
    const [debugCopyState, setDebugCopyState] = useState<"idle" | "copied" | "error">("idle");
    const [conversationQuery, setConversationQuery] = useState("");
    const [draft, setDraft] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [settings, setSettings] = useState<AiChatSettings | null>(null);
    const [vendorCatalog, setVendorCatalog] = useState<AiVendorDefinition[]>([]);
    const bindingsRef = useRef<Record<string, PendingStreamBinding>>({});
    const smoothedMessagesRef = useRef<Record<string, AiChatSmoothedMessageState>>({});
    const historyLoadedRef = useRef(false);
    const historySaveTimerRef = useRef<number | null>(null);
    const threadViewportRef = useRef<HTMLDivElement | null>(null);
    const debugViewportRef = useRef<HTMLDivElement | null>(null);
    const smoothingFrameRef = useRef<number | null>(null);
    const smoothingLastFrameAtRef = useRef<number | null>(null);

    /**
     * @function commitBindings
     * @description 原子更新全部会话 binding，并同步 ref 快照。
     * @param updater 更新函数。
     */
    const commitBindings = (
        updater: (
            currentBindings: Record<string, PendingStreamBinding>,
        ) => Record<string, PendingStreamBinding>,
    ): void => {
        setBindingsByConversation((currentBindings) => {
            const nextBindings = updater(currentBindings);
            bindingsRef.current = nextBindings;
            return nextBindings;
        });
    };

    /**
     * @function setConversationBinding
     * @description 设置某个会话当前的运行 binding；若已结束则清理。
     * @param conversationId 会话 ID。
     * @param binding 新 binding。
     */
    const setConversationBinding = (
        conversationId: string,
        binding: PendingStreamBinding,
    ): void => {
        commitBindings((currentBindings) => {
            const nextBindings = { ...currentBindings };
            if (isPendingStreamBindingActive(binding)) {
                nextBindings[conversationId] = binding;
            } else {
                delete nextBindings[conversationId];
            }
            return nextBindings;
        });
    };

    /**
     * @function updateConversationBinding
     * @description 基于当前 binding 更新指定会话的运行状态。
     * @param conversationId 会话 ID。
     * @param updater 更新函数。
     */
    const updateConversationBinding = (
        conversationId: string,
        updater: (binding: PendingStreamBinding) => PendingStreamBinding,
    ): void => {
        commitBindings((currentBindings) => {
            const currentBinding = currentBindings[conversationId] ?? createEmptyPendingStreamBinding();
            const nextBinding = updater(currentBinding);
            const nextBindings = { ...currentBindings };
            if (isPendingStreamBindingActive(nextBinding)) {
                nextBindings[conversationId] = nextBinding;
            } else {
                delete nextBindings[conversationId];
            }
            return nextBindings;
        });
    };

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

    /**
     * @function commitSmoothedMessages
     * @description 原子更新全部流式平滑消息状态，并同步 ref 快照。
     * @param updater 更新函数。
     */
    const commitSmoothedMessages = (
        updater: (
            currentMessages: Record<string, AiChatSmoothedMessageState>,
        ) => Record<string, AiChatSmoothedMessageState>,
    ): void => {
        setSmoothedMessagesById((currentMessages) => {
            const nextMessages = updater(currentMessages);
            smoothedMessagesRef.current = nextMessages;
            return nextMessages;
        });
    };

    /**
     * @function scheduleSmoothingFrame
     * @description 在存在未追平文本时启动 requestAnimationFrame 循环推进展示层 reveal。
     */
    const scheduleSmoothingFrame = (): void => {
        if (smoothingFrameRef.current !== null) {
            return;
        }

        const animate = (timestamp: number): void => {
            const previousTimestamp = smoothingLastFrameAtRef.current;
            smoothingLastFrameAtRef.current = timestamp;
            const elapsedMs = previousTimestamp === null
                ? 16
                : timestamp - previousTimestamp;

            commitSmoothedMessages((currentMessages) => {
                let changed = false;
                const nextMessages: Record<string, AiChatSmoothedMessageState> = {};

                Object.entries(currentMessages).forEach(([messageId, messageState]) => {
                    const nextMessageState = advanceAiChatSmoothedMessageState(
                        messageState,
                        elapsedMs,
                    );

                    if (nextMessageState !== messageState) {
                        changed = true;
                    }

                    if (shouldKeepAnimatingMessage(nextMessageState)) {
                        nextMessages[messageId] = nextMessageState;
                        return;
                    }

                    changed = true;
                });

                return changed ? nextMessages : currentMessages;
            });

            const hasPendingMessages = Object.values(smoothedMessagesRef.current).some((messageState) => {
                return !isAiChatSmoothedMessageSettled(messageState);
            });

            if (!hasPendingMessages) {
                smoothingFrameRef.current = null;
                smoothingLastFrameAtRef.current = null;
                return;
            }

            smoothingFrameRef.current = window.requestAnimationFrame(animate);
        };

        smoothingFrameRef.current = window.requestAnimationFrame(animate);
    };

    /**
     * @function syncSmoothedAssistantMessage
     * @description 将后端累计文本同步到对应助手消息的平滑展示状态。
     * @param messageId 助手消息 ID。
     * @param targetText 最新累计答案文本。
     * @param targetReasoningText 最新累计 reasoning 文本。
     * @param active 当前是否仍在接收后端流式输出。
     */
    const syncSmoothedAssistantMessage = (
        messageId: string,
        targetText: string | null,
        targetReasoningText: string | null,
        active: boolean,
    ): void => {
        commitSmoothedMessages((currentMessages) => {
            const nextMessageState = syncAiChatSmoothedMessageTargets(
                currentMessages[messageId],
                {
                    messageId,
                    targetText,
                    targetReasoningText,
                    active,
                },
            );

            if (!shouldKeepAnimatingMessage(nextMessageState)) {
                if (!(messageId in currentMessages)) {
                    return currentMessages;
                }

                const nextMessages = { ...currentMessages };
                delete nextMessages[messageId];
                return nextMessages;
            }

            return {
                ...currentMessages,
                [messageId]: nextMessageState,
            };
        });
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

    const activeConversationBinding = useMemo(() => {
        if (!activeConversation) {
            return null;
        }
        return bindingsByConversation[activeConversation.id] ?? null;
    }, [activeConversation, bindingsByConversation]);

    const isActiveConversationStreaming = useMemo(() => {
        return isPendingStreamBindingActive(activeConversationBinding);
    }, [activeConversationBinding]);

    const isActiveConversationStopping = useMemo(() => {
        return Boolean(activeConversationBinding?.stopRequested);
    }, [activeConversationBinding]);

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

    const canSend = Boolean(
        currentVaultPath
        && activeConversation
        && draft.trim()
        && !isActiveConversationStreaming
        && isVendorConfigured,
    );

    useEffect(() => {
        let disposed = false;

        if (!currentVaultPath) {
            setHistoryState(null);
            setBindingsByConversation({});
            bindingsRef.current = {};
            setSmoothedMessagesById({});
            smoothedMessagesRef.current = {};
            setSettings(null);
            historyLoadedRef.current = false;
            resetAiChatSettingsStore();
            return;
        }

        // Wait for backend to be ready (set_current_vault completed)
        // before loading vault-scoped data.
        if (!backendReady) {
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
                setBindingsByConversation({});
                bindingsRef.current = {};
                setSmoothedMessagesById({});
                smoothedMessagesRef.current = {};
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
    }, [currentVaultPath, backendReady]);

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

            const binding = findBindingForStreamEvent(bindingsRef.current, payload);
            if (!binding) {
                return;
            }

            const transition = reduceAiChatStreamEvent({
                payload,
                binding,
                debugEntryId: nextChatDebugEntryId(),
                debugFallbackTitle: i18n.t("aiChatPlugin.debugEntryFallbackTitle"),
                confirmationFallbackHint: i18n.t("aiChatPlugin.confirmationFallbackHint"),
            });

            if (!transition.matchesBinding) {
                return;
            }

            if (!binding.streamId && transition.nextBinding.streamId === payload.streamId) {
                console.info("[aiChatPlugin] stream bound", {
                    streamId: payload.streamId,
                    conversationId: binding.conversationId,
                    sessionId: binding.sessionId,
                });
            }

            setConversationBinding(binding.conversationId!, transition.nextBinding);

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
                            reasoningText: transition.nextAssistantReasoningText ?? message.reasoningText,
                        };
                    }),
                }));
            } else if (transition.nextAssistantReasoningText) {
                updateConversation(binding.conversationId!, (conversation) => ({
                    ...conversation,
                    updatedAtUnixMs: Date.now(),
                    messages: conversation.messages.map((message) => {
                        if (message.id !== binding.assistantMessageId) {
                            return message;
                        }
                        return {
                            ...message,
                            reasoningText: transition.nextAssistantReasoningText ?? message.reasoningText,
                        };
                    }),
                }));
            }

            const shouldKeepSmoothedMessageActive = !(
                transition.isDone
                || transition.wasStopped
                || payload.eventType === "error"
                || transition.nextConfirmation !== null
            );
            syncSmoothedAssistantMessage(
                binding.assistantMessageId!,
                transition.nextAssistantText,
                transition.nextAssistantReasoningText,
                shouldKeepSmoothedMessageActive,
            );

            if (transition.nextConfirmation) {
                console.info("[aiChatPlugin] stream confirmation requested", {
                    streamId: payload.streamId,
                    confirmationId: transition.nextConfirmation.confirmationId,
                    toolName: transition.nextConfirmation.toolName || null,
                });
                updateConversation(binding.conversationId!, (conversation) => {
                    const assistantMessage = conversation.messages.find((message) => {
                        return message.id === binding.assistantMessageId;
                    });
                    const protocolMessage = assistantMessage
                        ? createProtocolAssistantMessage(assistantMessage, payload)
                        : null;

                    return protocolMessage ? {
                        ...conversation,
                        protocolMessages: [
                            ...(conversation.protocolMessages ?? []),
                            protocolMessage,
                        ],
                    } : conversation;
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

            if (transition.shouldClearPendingConfirmation) {
                clearPendingConfirmationState(binding.assistantMessageId!);
            }

            if (transition.wasStopped) {
                updateConversation(binding.conversationId!, (conversation) => ({
                    ...conversation,
                    updatedAtUnixMs: Date.now(),
                    messages: conversation.messages.map((message) => {
                        if (message.id !== binding.assistantMessageId) {
                            return message;
                        }

                        return {
                            ...message,
                            interruptedByUser: true,
                        };
                    }),
                    sessionId: createConversationSessionId(conversation.id),
                }));
            }

            if (transition.nextConfirmation) {
                return;
            }

            if (transition.wasStopped) {
                console.info("[aiChatPlugin] stream stopped", {
                    streamId: payload.streamId,
                    conversationId: binding.conversationId,
                });
                return;
            }

            if (transition.isDone) {
                updateConversation(binding.conversationId!, (conversation) => {
                    const assistantMessage = conversation.messages.find((message) => {
                        return message.id === binding.assistantMessageId;
                    });
                    const protocolMessage = assistantMessage
                        ? createProtocolAssistantMessage(assistantMessage, payload)
                        : null;

                    return protocolMessage ? {
                        ...conversation,
                        protocolMessages: [
                            ...(conversation.protocolMessages ?? []),
                            protocolMessage,
                        ],
                    } : conversation;
                });
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
        if (!hasPendingSmoothedMessages(smoothedMessagesById)) {
            return;
        }

        scheduleSmoothingFrame();
    }, [smoothedMessagesById]);

    useEffect(() => {
        return () => {
            if (smoothingFrameRef.current !== null) {
                window.cancelAnimationFrame(smoothingFrameRef.current);
                smoothingFrameRef.current = null;
            }
            smoothingLastFrameAtRef.current = null;
        };
    }, []);

    const activeConversationDisplaySignature = useMemo(() => {
        if (!activeConversation) {
            return "";
        }

        return activeConversation.messages.map((message) => {
            const smoothedMessage = smoothedMessagesById[message.id];
            const displayText = smoothedMessage?.displayText ?? message.text;
            const displayReasoningText = smoothedMessage?.displayReasoningText
                ?? message.reasoningText
                ?? "";

            return [message.id, displayText, displayReasoningText].join(":");
        }).join("|");
    }, [activeConversation, smoothedMessagesById]);

    useEffect(() => {
        const viewport = threadViewportRef.current;
        if (viewport) {
            viewport.scrollTop = viewport.scrollHeight;
        }
    }, [activeConversationDisplaySignature, pendingConfirmations]);

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
        setConversationBinding(confirmation.conversationId, createPendingStreamBinding(
            confirmation.conversationId,
            confirmation.sessionId,
            confirmation.assistantMessageId,
        ));

        try {
            const response = await submitAiChatConfirmation({
                confirmationId: confirmation.confirmationId,
                confirmed: approved,
                sessionId: confirmation.sessionId,
            });
            const currentBinding = bindingsRef.current[confirmation.conversationId];
            if (currentBinding) {
                const nextBinding = {
                    ...currentBinding,
                    streamId: response.streamId,
                };
                setConversationBinding(confirmation.conversationId, nextBinding);
                if (nextBinding.stopRequested) {
                    void stopAiChatStream(response.streamId).catch((stopError) => {
                        setError(stopError instanceof Error ? stopError.message : String(stopError));
                        updateConversationBinding(confirmation.conversationId, (binding) => ({
                            ...binding,
                            stopRequested: false,
                        }));
                    });
                }
            }
            clearPendingConfirmationState(confirmation.assistantMessageId);
            updateConversation(confirmation.conversationId, (conversation) => ({
                ...conversation,
                protocolMessages: [
                    ...(conversation.protocolMessages ?? []),
                    createProtocolConfirmationResultMessage(confirmation, approved),
                ],
            }));
        } catch (submitError) {
            setError(submitError instanceof Error ? submitError.message : String(submitError));
            setPendingConfirmationState({
                ...confirmation,
                isSubmitting: false,
            });
            setConversationBinding(
                confirmation.conversationId,
                createEmptyPendingStreamBinding(),
            );
        }
    };

    /**
     * @function handleStopConversation
     * @description 终止当前活动会话中仍在运行的后台流。
     * @returns Promise<void>
     */
    const handleStopConversation = async (): Promise<void> => {
        if (!activeConversation) {
            return;
        }

        const binding = bindingsRef.current[activeConversation.id];
        if (!binding || !isPendingStreamBindingActive(binding) || binding.stopRequested) {
            return;
        }

        setError(null);
        updateConversationBinding(activeConversation.id, (currentBinding) => ({
            ...currentBinding,
            stopRequested: true,
        }));

        if (!binding.streamId) {
            return;
        }

        try {
            await stopAiChatStream(binding.streamId);
        } catch (stopError) {
            setError(stopError instanceof Error ? stopError.message : String(stopError));
            updateConversationBinding(activeConversation.id, (currentBinding) => ({
                ...currentBinding,
                stopRequested: false,
            }));
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
        if (!trimmed || isActiveConversationStreaming) {
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
        const history = activeConversation.protocolMessages?.length
            ? activeConversation.protocolMessages
            : activeConversation.messages;

        setDraft("");
        setError(null);
        setActiveTab("chat");
        updateConversation(activeConversation.id, (conversation) => ({
            ...conversation,
            updatedAtUnixMs: Date.now(),
            messages: [...conversation.messages, userMessage, assistantMessage],
            protocolMessages: [
                ...(conversation.protocolMessages ?? []),
                createProtocolUserTextMessage(userMessage),
            ],
        }));

        setConversationBinding(activeConversation.id, createPendingStreamBinding(
            activeConversation.id,
            activeConversation.sessionId,
            assistantMessage.id,
        ));

        try {
            const response = await startAiChatStream({
                message: trimmed,
                sessionId: activeConversation.sessionId,
                history,
            });
            const currentBinding = bindingsRef.current[activeConversation.id];
            if (currentBinding) {
                const nextBinding = {
                    ...currentBinding,
                    streamId: response.streamId,
                };
                setConversationBinding(activeConversation.id, nextBinding);
                if (nextBinding.stopRequested) {
                    void stopAiChatStream(response.streamId).catch((stopError) => {
                        setError(stopError instanceof Error ? stopError.message : String(stopError));
                        updateConversationBinding(activeConversation.id, (binding) => ({
                            ...binding,
                            stopRequested: false,
                        }));
                    });
                }
            }
        } catch (submitError) {
            setError(submitError instanceof Error ? submitError.message : String(submitError));
            setConversationBinding(activeConversation.id, createEmptyPendingStreamBinding());
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
                        onClick={() => {
                            setActiveTab("history");
                        }}
                    >
                        <span>{i18n.t("aiChatPlugin.conversationManager")}</span>
                    </button>
                    <button
                        type="button"
                        className="ai-chat-conversation-create"
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
                                onClick={() => {
                                    handleSelectConversation(conversation.id);
                                }}
                            >
                                {/** ai-chat-history-item-title-row：标题与运行态标签，配套样式见 ai-chat-history-item-title-row / ai-chat-history-status */}
                                <div className="ai-chat-history-item-main">
                                    <div className="ai-chat-history-item-title-row">
                                        <span className="ai-chat-conversation-title">{conversation.title}</span>
                                        {isPendingStreamBindingActive(bindingsByConversation[conversation.id]) ? (
                                            <span className={`ai-chat-history-status ${bindingsByConversation[conversation.id]?.stopRequested ? "stopping" : "running"}`}>
                                                {bindingsByConversation[conversation.id]?.stopRequested
                                                    ? i18n.t("aiChatPlugin.conversationStopping")
                                                    : i18n.t("aiChatPlugin.conversationRunning")}
                                            </span>
                                        ) : null}
                                    </div>
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
                            const smoothedMessage = smoothedMessagesById[message.id];
                            const renderedMessageText = smoothedMessage?.displayText ?? message.text;
                            const renderedReasoningText = smoothedMessage?.displayReasoningText
                                ?? message.reasoningText
                                ?? "";
                            const isStreamingMessage = message.role === "assistant"
                                && Boolean(
                                    smoothedMessage
                                    && (smoothedMessage.active || !isAiChatSmoothedMessageSettled(smoothedMessage)),
                                );

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
                                                content={renderedMessageText}
                                                reasoningContent={renderedReasoningText}
                                                role={message.role}
                                                streaming={isStreamingMessage}
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
                    disabled={!currentVaultPath || isActiveConversationStreaming || !activeConversation || activeTab === "history"}
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
                        aria-busy={isActiveConversationStopping}
                        disabled={isActiveConversationStreaming ? isActiveConversationStopping : !canSend}
                        onClick={() => {
                            if (isActiveConversationStreaming) {
                                void handleStopConversation();
                                return;
                            }
                            void handleSubmit();
                        }}
                    >
                        <span>{isActiveConversationStreaming
                            ? isActiveConversationStopping
                                ? i18n.t("aiChatPlugin.stopping")
                                : i18n.t("aiChatPlugin.stop")
                            : i18n.t("aiChatPlugin.send")}</span>
                        {isActiveConversationStreaming
                            ? <X size={14} strokeWidth={2} />
                            : <ArrowUp size={14} strokeWidth={2} />}
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
function AiChatTab(_props: WorkbenchTabProps<Record<string, unknown>>): ReactNode {
    return <AiChatView />;
}

/**
 * @function AiChatSettingsSection
 * @description 渲染 AI 设置页，按照后端返回的 schema 动态生成表单。
 * @returns 设置页 React 节点。
 */
function AiChatSettingsSection(): ReactNode {
    const { currentVaultPath, backendReady } = useVaultState();
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

        // Wait for backend to be ready (set_current_vault completed)
        // before loading vault-scoped data.
        if (!backendReady) {
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
    }, [currentVaultPath, backendReady]);

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
            id: AI_CHAT_TAB_ID,
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
