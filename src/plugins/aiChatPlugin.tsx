/**
 * @module plugins/aiChatPlugin
 * @description AI 聊天插件：注册右侧聊天面板和 AI 设置选栏。
 *
 *   该插件复用宿主已有的插件扩展点：
 *   - activityRegistry：注册独立图标入口
 *   - panelRegistry：注册右侧 panel 聊天面板
 *   - settingsRegistry：注册动态 AI 设置页
 *
 * @dependencies
 *   - react
 *   - lucide-react
 *   - ../api/aiApi
 *   - ../host/registry/activityRegistry
 *   - ../host/registry/panelRegistry
 *   - ../host/settings/settingsRegistry
 *   - ../host/store/vaultStore
 *   - i18next
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
import { confirm } from "@tauri-apps/plugin-dialog";
import { ArrowUp, Bot, SlidersHorizontal, Sparkles } from "lucide-react";
import {
    getAiChatSettings,
    getAiVendorCatalog,
    getAiVendorModels,
    saveAiChatSettings,
    startAiChatStream,
    submitAiChatConfirmation,
    subscribeAiChatStreamEvents,
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
        subtitle: "A right-side copilot-style panel backed by the Go sidecar.",
        empty: "Ask a question to start a streamed conversation. The backend will read the currently saved AI vendor configuration.",
        draftPlaceholder: "Ask anything about your notes or workflow...",
        send: "Send",
        sending: "Generating...",
        emptyEyebrow: "Context-aware sidecar assistant",
        emptyTitle: "Draft, inspect, and refine without leaving your notes.",
        emptyBody: "Use the panel like a coding copilot: start from a quick prompt, then iterate in a focused thread on the right.",
        quickPromptsLabel: "Start with a prompt",
        quickPromptSummarize: "Summarize the current note into a compact outline.",
        quickPromptRefine: "Rewrite selected content to be sharper and more concise.",
        quickPromptPlan: "Turn this idea into an execution plan with clear next steps.",
        readyStatus: "Ready",
        missingConfigStatus: "Setup required",
        streamingStatus: "Streaming response",
        vaultStatus: "Vault connected",
        notConfiguredShort: "Vendor configuration incomplete",
        vendorMissing: "Open Settings and complete the AI vendor configuration before chatting.",
        settingsSection: "settings.aiSection",
        settingsTitle: "AI Chat Settings",
        settingsSubtitle: "Choose a vendor and fill only the fields required by that vendor.",
        vendorLabel: "Model Vendor",
        vendorDescription: "The vendor list and field schema are provided by the Rust backend.",
        modelLabel: "Model",
        modelDescription: "Load the vendor-supported models from the backend, then choose one or keep a manual override.",
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
        composerHint: "Responses are streamed from Rust through Tauri events.",
        composerHintMissing: "Complete the vendor fields in Settings before starting a chat.",
        settingsHint: "Configure vendor",
        settingsHintCompact: "Configure",
        threadLabel: "Conversation",
        tabChat: "Chat",
        tabDebug: "Debug Log",
        debugEmptyTitle: "No model traces yet.",
        debugEmptyBody: "Each raw model request and raw model response will appear here after you send a message.",
        debugEntryFallbackTitle: "Debug trace",
        confirmationFallbackHint: "The assistant wants to run a tool that modifies your vault.",
        confirmationToolLabel: "Tool",
        confirmationArgsLabel: "Arguments",
    },
    settings: {
        aiSection: "AI Chat",
    },
}, true, true);

i18n.addResourceBundle("zh", "translation", {
    aiChatPlugin: {
        title: "AI 对话",
        subtitle: "一个放在右侧的 Copilot 风格聊天面板，由 Go sidecar 驱动。",
        empty: "输入问题即可开始流式对话。后端会读取当前仓库里保存的 AI vendor 配置。",
        draftPlaceholder: "询问你的笔记、知识点或工作流问题...",
        send: "发送",
        sending: "生成中...",
        emptyEyebrow: "具备上下文感知的 sidecar 助手",
        emptyTitle: "不用离开笔记区，就能起草、检查和迭代内容。",
        emptyBody: "把它当成右侧常驻 Copilot：先点一个快捷提示，再围绕当前问题持续追问。",
        quickPromptsLabel: "从一个快捷提示开始",
        quickPromptSummarize: "把当前笔记压缩成一份清晰的大纲。",
        quickPromptRefine: "把选中内容改写得更准确、更凝练。",
        quickPromptPlan: "把这个想法拆成一份可执行计划。",
        readyStatus: "就绪",
        missingConfigStatus: "需要配置",
        streamingStatus: "正在流式生成",
        vaultStatus: "仓库已连接",
        notConfiguredShort: "Vendor 配置未完成",
        vendorMissing: "请先打开设置页，完成 AI vendor 配置后再开始聊天。",
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
        composerHint: "响应通过 Rust 后端转发为 Tauri 流事件。",
        composerHintMissing: "先到设置页补全 vendor 必填字段，再开始对话。",
        settingsHint: "去配置 vendor",
        settingsHintCompact: "配置",
        threadLabel: "会话",
        tabChat: "对话",
        tabDebug: "调试日志",
        debugEmptyTitle: "还没有模型调试轨迹。",
        debugEmptyBody: "发送消息后，这里会展示每次发给模型的原始请求和模型返回的原始内容。",
        debugEntryFallbackTitle: "调试轨迹",
        confirmationFallbackHint: "助手准备执行一个会修改仓库内容的工具。",
        confirmationToolLabel: "工具",
        confirmationArgsLabel: "参数",
    },
    settings: {
        aiSection: "AI 对话",
    },
}, true, true);

const AI_CHAT_PANEL_ID = "ai-chat";
const AI_CHAT_SETTINGS_UPDATED_EVENT = "ofive:ai-settings-updated";

interface ChatMessage {
    id: string;
    role: "assistant" | "user";
    text: string;
}

interface PendingStreamBinding {
    streamId: string | null;
    assistantMessageId: string | null;
}

interface ChatDebugEntry {
    id: string;
    streamId: string;
    title: string;
    text: string;
}

interface QuickPromptDefinition {
    id: string;
    translationKey: string;
}

interface AiPanelErrorDisplay {
    summary: string;
    detail: string | null;
}

interface PendingToolConfirmation {
    confirmationId: string;
    sessionId: string;
    assistantMessageId: string;
    hint: string;
    toolName: string;
    toolArgsJson: string;
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
    const nextId = `ai-chat-message-${String(chatMessageSequence)}`;
    chatMessageSequence += 1;
    return nextId;
}

/**
 * @function nextChatDebugEntryId
 * @description 生成聊天调试日志唯一 ID。
 * @returns 调试日志 ID。
 */
function nextChatDebugEntryId(): string {
    const nextId = `ai-chat-debug-${String(chatDebugSequence)}`;
    chatDebugSequence += 1;
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
 * @description 将当前设置与目标 vendor 的字段定义合并，补齐默认值并移除无关字段。
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

    const summary = trimmed.slice(0, firstSeparatorIndex).trim();
    const detail = trimmed.slice(firstSeparatorIndex + 2).trim();

    return {
        summary: summary || trimmed,
        detail: detail || null,
    };
}

/**
 * @function buildConfirmationMessage
 * @description 组合展示给用户的 tool 确认文本。
 * @param payload 当前确认请求。
 * @returns 用于原生确认弹窗的文本。
 */
function buildConfirmationMessage(payload: PendingToolConfirmation): string {
    const sections: string[] = [payload.hint.trim() || i18n.t("aiChatPlugin.confirmationFallbackHint")];

    if (payload.toolName.trim()) {
        sections.push(`${i18n.t("aiChatPlugin.confirmationToolLabel")}: ${payload.toolName}`);
    }

    if (payload.toolArgsJson.trim() && payload.toolArgsJson.trim() !== "{}") {
        sections.push(`${i18n.t("aiChatPlugin.confirmationArgsLabel")}:\n${payload.toolArgsJson}`);
    }

    return sections.join("\n\n");
}

/**
 * @function ChatPanel
 * @description 渲染右侧 AI 聊天面板。
 * @returns 面板 React 节点。
 */
function ChatPanel(): ReactNode {
    const { currentVaultPath } = useVaultState();
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [debugEntries, setDebugEntries] = useState<ChatDebugEntry[]>([]);
    const [activeTab, setActiveTab] = useState<"chat" | "debug">("chat");
    const [draft, setDraft] = useState("");
    const [isStreaming, setIsStreaming] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [settings, setSettings] = useState<AiChatSettings | null>(null);
    const [vendorCatalog, setVendorCatalog] = useState<AiVendorDefinition[]>([]);
    const streamBindingRef = useRef<PendingStreamBinding>({
        streamId: null,
        assistantMessageId: null,
    });
    const threadViewportRef = useRef<HTMLDivElement | null>(null);
    const debugViewportRef = useRef<HTMLDivElement | null>(null);

    /**
     * @function handleToolConfirmation
     * @description 弹出原生确认框，并将用户决定回传到后端继续当前 AI 会话。
     * @param request 待确认的工具调用。
     */
    const handleToolConfirmation = async (request: PendingToolConfirmation): Promise<void> => {
        const approved = await confirm(buildConfirmationMessage(request), {
            title: i18n.t("common.confirm"),
            kind: "warning",
        });

        setError(null);
        setIsStreaming(true);
        streamBindingRef.current = {
            streamId: null,
            assistantMessageId: request.assistantMessageId,
        };

        try {
            const response = await submitAiChatConfirmation({
                confirmationId: request.confirmationId,
                confirmed: approved,
                sessionId: request.sessionId,
            });
            streamBindingRef.current = {
                streamId: response.streamId,
                assistantMessageId: request.assistantMessageId,
            };
        } catch (confirmationError) {
            const message = confirmationError instanceof Error
                ? confirmationError.message
                : String(confirmationError);
            setError(message);
            setIsStreaming(false);
            streamBindingRef.current = {
                streamId: null,
                assistantMessageId: null,
            };
        }
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

    const formattedError = useMemo(() => {
        if (!error) {
            return null;
        }
        return formatAiPanelError(error);
    }, [error]);

    const canSend = Boolean(currentVaultPath && draft.trim() && !isStreaming && isVendorConfigured);

    useEffect(() => {
        let disposed = false;

        const loadPanelSettings = (): void => {
            Promise.all([getAiVendorCatalog(), getAiChatSettings()])
                .then(([catalog, nextSettings]) => {
                    if (disposed) {
                        return;
                    }
                    setVendorCatalog(catalog);
                    setSettings(nextSettings);
                })
                .catch((loadError) => {
                    if (disposed) {
                        return;
                    }
                    const message = loadError instanceof Error ? loadError.message : String(loadError);
                    setError(message);
                });
        };

        if (!currentVaultPath) {
            setSettings(null);
            return;
        }

        loadPanelSettings();

        const handleSettingsUpdated = (): void => {
            loadPanelSettings();
        };

        window.addEventListener(AI_CHAT_SETTINGS_UPDATED_EVENT, handleSettingsUpdated);

        return () => {
            disposed = true;
            window.removeEventListener(AI_CHAT_SETTINGS_UPDATED_EVENT, handleSettingsUpdated);
        };
    }, [currentVaultPath]);

    useEffect(() => {
        let disposed = false;
        let cleanup: (() => void) | undefined;

        void subscribeAiChatStreamEvents((payload: AiChatStreamEventPayload) => {
            if (disposed) {
                return;
            }

            const binding = streamBindingRef.current;
            if (!binding.assistantMessageId) {
                return;
            }

            if (!binding.streamId) {
                binding.streamId = payload.streamId;
            }

            if (binding.streamId !== payload.streamId) {
                return;
            }

            if (payload.eventType === "debug") {
                setDebugEntries((currentEntries) => [
                    ...currentEntries,
                    {
                        id: nextChatDebugEntryId(),
                        streamId: payload.streamId,
                        title: payload.debugTitle ?? i18n.t("aiChatPlugin.debugEntryFallbackTitle"),
                        text: payload.debugText ?? "",
                    },
                ]);
                return;
            }

            if (payload.eventType === "confirmation") {
                const assistantMessageId = binding.assistantMessageId;
                const confirmationText = payload.confirmationHint
                    ?? i18n.t("aiChatPlugin.confirmationFallbackHint");

                setMessages((currentMessages) => currentMessages.map((message) => {
                    if (message.id !== assistantMessageId) {
                        return message;
                    }
                    return {
                        ...message,
                        text: confirmationText,
                    };
                }));

                setIsStreaming(false);
                streamBindingRef.current = {
                    streamId: null,
                    assistantMessageId: null,
                };

                if (!assistantMessageId || !payload.confirmationId || !payload.sessionId) {
                    setError("AI confirmation payload is incomplete");
                    return;
                }

                void handleToolConfirmation({
                    confirmationId: payload.confirmationId,
                    sessionId: payload.sessionId,
                    assistantMessageId,
                    hint: payload.confirmationHint ?? "",
                    toolName: payload.confirmationToolName ?? "",
                    toolArgsJson: payload.confirmationToolArgsJson ?? "{}",
                });
                return;
            }

            if (payload.eventType === "delta" || payload.eventType === "done") {
                setMessages((currentMessages) => currentMessages.map((message) => {
                    if (message.id !== binding.assistantMessageId) {
                        return message;
                    }
                    return {
                        ...message,
                        text: payload.accumulatedText ?? message.text,
                    };
                }));
            }

            if (payload.eventType === "error") {
                setError(payload.error ?? "AI stream failed");
                setIsStreaming(false);
                streamBindingRef.current = {
                    streamId: null,
                    assistantMessageId: null,
                };
                return;
            }

            if (payload.eventType === "done") {
                setIsStreaming(false);
                streamBindingRef.current = {
                    streamId: null,
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
        if (!viewport) {
            return;
        }

        viewport.scrollTop = viewport.scrollHeight;
    }, [isStreaming, messages]);

    useEffect(() => {
        const viewport = debugViewportRef.current;
        if (!viewport) {
            return;
        }

        viewport.scrollTop = viewport.scrollHeight;
    }, [debugEntries]);

    /**
     * @function handleSubmit
     * @description 提交当前输入并启动流式聊天。
     */
    const handleSubmit = async (): Promise<void> => {
        const trimmed = draft.trim();
        if (!trimmed || isStreaming) {
            return;
        }

        const userMessageId = nextChatMessageId();
        const assistantMessageId = nextChatMessageId();

        setError(null);
        setDraft("");
        setIsStreaming(true);
        setActiveTab("chat");
        streamBindingRef.current = {
            streamId: null,
            assistantMessageId,
        };

        setMessages((currentMessages) => [
            ...currentMessages,
            { id: userMessageId, role: "user", text: trimmed },
            { id: assistantMessageId, role: "assistant", text: "" },
        ]);

        try {
            const response = await startAiChatStream({ message: trimmed });
            if (streamBindingRef.current.assistantMessageId === assistantMessageId) {
                streamBindingRef.current = {
                    streamId: response.streamId,
                    assistantMessageId,
                };
            }
        } catch (submitError) {
            const message = submitError instanceof Error ? submitError.message : String(submitError);
            setError(message);
            setIsStreaming(false);
            streamBindingRef.current = {
                streamId: null,
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
                <div className="ai-chat-header-topline">
                    <div className="ai-chat-header-pill">
                        <Sparkles size={12} strokeWidth={2} />
                        <span>{i18n.t("aiChatPlugin.emptyEyebrow")}</span>
                    </div>
                    <div className={`ai-chat-header-status ${!isVendorConfigured ? "warning" : ""}`}>
                        <span className="ai-chat-header-status-dot" />
                        <span>{panelStatusLabel}</span>
                    </div>
                </div>

                <div className="ai-chat-title-row">
                    <div>
                        <div className="ai-chat-title">{i18n.t("aiChatPlugin.title")}</div>
                        <div className="ai-chat-subtitle">{i18n.t("aiChatPlugin.subtitle")}</div>
                    </div>
                    <button type="button" className="ai-chat-header-ghost-button">
                        <SlidersHorizontal size={14} strokeWidth={1.8} />
                        <span className="ai-chat-header-ghost-button-text">{i18n.t("aiChatPlugin.settingsHint")}</span>
                        <span className="ai-chat-header-ghost-button-text-compact">{i18n.t("aiChatPlugin.settingsHintCompact")}</span>
                    </button>
                </div>

                <div className="ai-chat-header-metadata">
                    <div className="ai-chat-vendor-badge">
                        <span>{selectedVendor?.title ?? i18n.t("aiChatPlugin.notConfiguredShort")}</span>
                        <strong>{settings?.model ?? "-"}</strong>
                    </div>
                    <div className="ai-chat-header-meta-chip">
                        {currentVaultPath ? i18n.t("aiChatPlugin.vaultStatus") : i18n.t("aiChatPlugin.noVault")}
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

                {!currentVaultPath ? (
                    <div className="ai-chat-status">{i18n.t("aiChatPlugin.noVault")}</div>
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
                    {messages.length === 0 ? (
                        <div className="ai-chat-welcome-card">
                            <div className="ai-chat-welcome-icon">
                                <Bot size={18} strokeWidth={1.8} />
                            </div>
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
                                            <Sparkles size={14} strokeWidth={1.8} />
                                            <span>{promptText}</span>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    ) : null}

                    <div className="ai-chat-thread-label">{i18n.t("aiChatPlugin.threadLabel")}</div>
                    <div ref={threadViewportRef} className="ai-chat-messages">
                        {messages.map((message) => (
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
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            ) : (
                <div className="ai-chat-debug-shell" role="tabpanel">
                    {debugEntries.length === 0 ? (
                        <div className="ai-chat-debug-empty">
                            <div className="ai-chat-debug-empty-title">{i18n.t("aiChatPlugin.debugEmptyTitle")}</div>
                            <div className="ai-chat-debug-empty-body">{i18n.t("aiChatPlugin.debugEmptyBody")}</div>
                        </div>
                    ) : null}
                    <div ref={debugViewportRef} className="ai-chat-debug-list">
                        {debugEntries.map((entry) => (
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
                    disabled={!currentVaultPath || isStreaming}
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
     * @description 使用当前设置草稿从后端刷新 vendor 模型列表。
     * @param targetSettings 需要用于鉴权的设置草稿。
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
     * @description 切换 vendor 并重建动态字段表单。
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