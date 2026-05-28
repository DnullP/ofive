/**
 * @module plugins/ai-chat/aiChatPlugin
 * @description AI 聊天插件：注册右侧聊天面板，并通过插件拥有的 settings store 向 host 贡献 AI 设置选栏。
 */

import React, {
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type ChangeEvent,
    type KeyboardEvent,
    type ReactNode,
} from "react";
import type {
    PanelRenderContext,
    WorkbenchContainerApi,
    WorkbenchTabProps,
} from "../../host/layout/workbenchContracts";
import { ArrowUp, Bot, Check, ChevronDown, Copy, History, Pencil, Plus, RotateCcw, Sparkles, Timer, X } from "lucide-react";
import {
    getAiChatHistory,
    getAiToolCatalog,
    getAiVendorCatalog,
    getAiVendorModels,
    saveAiChatHistory,
    restoreAiChatRollbackCheckpoint as restoreAiChatRollbackCheckpointInBackend,
    stopAiChatStream,
    startAiChatStream,
    submitAiChatConfirmation,
    type AiChatConversationRecord,
    type AiChatHistoryContentBlock,
    type AiChatHistoryMessage,
    type AiChatHistoryState,
    type AiChatProviderConfig,
    type AiChatSettings,
    type AiToolApprovalMode,
    type AiToolDescriptor,
    type AiVendorDefinition,
    type AiVendorModelDefinition,
} from "../../api/aiApi";
import { listProjectReaderProjects } from "../../api/projectReaderApi";
import {
    ensureAiChatSettingsLoaded,
    getAiChatSettingsSnapshot,
    resetAiChatSettingsStore,
    saveAiChatSettingsToStore,
    subscribeAiChatSettingsSnapshot,
} from "./aiChatSettingsStore";
import {
    buildAiChatRuntimeContextSnapshot,
    buildPersistableHistory,
    createProviderForVendor,
    createConversationSessionId,
    createConversationRecord,
    deriveConversationTitle,
    ensureSettingsProviderList,
    ensureHistoryState,
    filterConversations,
    formatAiChatDuration,
    formatAiPanelError,
    formatConversationTime,
    mergeProviderForVendor,
    resolveActiveProvider,
    resolveVendor,
    serializeAiChatRuntimeContextSnapshot,
    sortConversations,
    withActiveProvider,
    type AiChatRuntimeOpenTabSnapshot,
} from "./aiChatShared";
import { resolveParentDirectory } from "../markdown-codemirror/editor/pathUtils";
import {
    readVaultCanvasFile,
    readVaultMarkdownFile,
    resolveWikiLinkTarget,
} from "../../api/vaultApi";
import { openFileInWorkbench } from "../../host/layout/openFileService";
import {
    openProjectReaderWikiLinkTarget,
    resolveProjectReaderWikiLinkTabDefinition,
} from "../project-reader/projectReaderLinks";
import {
    UiButton,
    UiDropdownMenu,
    UiDropdownMenuItem,
    UiField,
    UiModal,
    UiSelect,
    UiNumberInput,
    UiTextInput,
} from "../../host/ui";
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
import {
    buildBudgetedAiChatHistory,
    normalizeAiChatContextBudgetSettings,
} from "./aiChatContextBudget";
import {
    getAiChatRuntimeSnapshot,
    resetAiChatRuntimeSnapshot,
    updateAiChatRuntimeSnapshot,
} from "./aiChatRuntimeStore";
import {
    startAiChatStreamEventHub,
    stopAiChatStreamEventHub,
    subscribeAiChatStreamEventHub,
} from "./aiChatStreamEventHub";
import {
    groupAiChatToolCallRecords,
    reduceAiChatToolCallDebugEntry,
    type AiChatToolCallRecord,
    type AiChatToolCallRecordGroup,
} from "./aiChatToolCallRecords";
import {
    captureAiChatRollbackCheckpoint,
    restoreAiChatRollbackCheckpoint,
    type AiChatRollbackCheckpoint,
} from "./aiChatRollback";
import { registerAiChatRuntimeManagedStore } from "./aiChatRuntimeManagedStoreRegistration";
import { registerAiChatSettingsManagedStore } from "./aiChatSettingsManagedStoreRegistration";
import { registerActivity } from "../../host/registry/activityRegistry";
import { registerPanel } from "../../host/registry/panelRegistry";
import { registerTabComponent } from "../../host/registry/tabComponentRegistry";
import {
    buildConvertibleViewTabParams,
    registerConvertibleView,
} from "../../host/registry";
import { registerSettingsItem, registerSettingsSection } from "../../host/settings/settingsRegistry";
import { useVaultState } from "../../host/vault/vaultStore";
import { deletePersistedCanvasFile, deletePersistedMarkdownFile } from "../../host/vault/vaultMutationService";
import { useActiveEditor } from "../../host/editor/activeEditorStore";
import {
    notifyPersistedContentSaved,
    savePersistedCanvasContent,
    savePersistedMarkdownContent,
} from "../../host/editor/persistedMarkdownContentSync";
import i18n from "../../i18n";
import "./aiChatPlugin.css";

const AI_CHAT_PANEL_ID = "ai-chat";
const AI_CHAT_TAB_COMPONENT_ID = "ai-chat-tab";
const AI_CHAT_TAB_ID = "ai-chat-tab-instance";
const AI_CHAT_CONVERTIBLE_ID = "ai-chat";
const AI_CHAT_SETTINGS_TAB_ID = "settings";
const AI_CHAT_SETTINGS_COMPONENT_ID = "settings";
const AI_CHAT_PROVIDER_SETTINGS_ITEM_ID = "ai-chat-provider-settings-panel";
const AI_CHAT_TOOL_APPROVAL_SETTINGS_ITEM_ID = "ai-chat-tool-approval-settings-panel";
const AI_CHAT_SETTINGS_API_KEY_FOCUS_TARGET = "ai-chat-api-key";

interface QuickPromptDefinition {
    id: string;
    translationKey: string;
}

let chatMessageSequence = 1;
let chatDebugSequence = 1;
let chatToolCallSequence = 1;
let chatRollbackCheckpointSequence = 1;
const AI_CHAT_CONFIRMATION_TOOL_NAME = "adk_request_confirmation";

const QUICK_PROMPTS: QuickPromptDefinition[] = [
    { id: "summarize", translationKey: "aiChatPlugin.quickPromptSummarize" },
    { id: "refine", translationKey: "aiChatPlugin.quickPromptRefine" },
    { id: "plan", translationKey: "aiChatPlugin.quickPromptPlan" },
];

type ConfirmationApprovalScope = "once" | "conversation" | "operation";

interface AiChatViewProps {
    panelContext?: PanelRenderContext | null;
    tabContainerApi?: WorkbenchContainerApi | null;
}

interface BeginAiChatTurnInput {
    conversation: AiChatConversationRecord;
    messageText: string;
    sessionId: string;
    visibleMessagesBeforeTurn: AiChatHistoryMessage[];
    protocolMessagesBeforeTurn: AiChatHistoryMessage[];
    checkpoint: AiChatRollbackCheckpoint;
    userMessage?: AiChatHistoryMessage;
}

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
 * @function nextChatToolCallRecordId
 * @description 生成工具调用记录 ID。
 * @returns 记录 ID。
 */
function nextChatToolCallRecordId(): string {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return `ai-chat-tool-call-${crypto.randomUUID()}`;
    }

    const nextId = `ai-chat-tool-call-${Date.now()}-${String(chatToolCallSequence)}`;
    chatToolCallSequence += 1;
    return nextId;
}

function nextChatRollbackCheckpointId(): string {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
        return `ai-chat-rollback-${crypto.randomUUID()}`;
    }

    const nextId = `ai-chat-rollback-${Date.now()}-${String(chatRollbackCheckpointSequence)}`;
    chatRollbackCheckpointSequence += 1;
    return nextId;
}

function createEmptyRollbackCheckpoint(checkpointId: string): AiChatRollbackCheckpoint {
    return {
        id: checkpointId,
        createdAtUnixMs: Date.now(),
        files: [],
    };
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
 * @function isVendorSettingsComplete
 * @description 判断指定 vendor 的必填字段是否已经完成。
 * @param settings AI 设置。
 * @param vendor vendor schema。
 * @returns 是否可用于请求模型或聊天。
 */
function isVendorSettingsComplete(
    settings: AiChatSettings | null,
    vendor: AiVendorDefinition | null,
): boolean {
    if (!settings || !vendor) {
        return false;
    }

    const provider = resolveActiveProvider(settings);
    return vendor.fields
        .filter((field) => field.required)
        .every((field) => (provider.fieldValues[field.key] ?? "").trim().length > 0);
}

/**
 * @function resolvePanelParamString
 * @description 从 workbench panel params 中读取字符串字段。
 * @param params panel 参数。
 * @param keys 候选字段名。
 * @returns 字符串或 null。
 */
function resolvePanelParamString(
    params: Record<string, unknown> | undefined,
    keys: string[],
): string | null {
    if (!params) {
        return null;
    }

    for (const key of keys) {
        const value = params[key];
        if (typeof value === "string" && value.trim().length > 0) {
            return value;
        }
    }

    return null;
}

/**
 * @function buildOpenTabsSnapshot
 * @description 从 workbench API 中提取打开 tab 的最小上下文。
 * @param context 面板渲染上下文。
 * @returns 打开 tab 快照。
 */
function buildOpenTabsSnapshot(
    context: Pick<PanelRenderContext, "activeTabId" | "workbenchApi"> | null | undefined,
): AiChatRuntimeOpenTabSnapshot[] {
    const panels = context?.workbenchApi?.panels ?? [];
    return panels.map((panel) => ({
        id: panel.id,
        path: resolvePanelParamString(panel.params, ["path", "relativePath", "absolutePath"]),
        title: resolvePanelParamString(panel.params, ["title", "name"]) ?? panel.id,
        component: resolvePanelParamString(panel.params, ["component", "openerId", "type"]),
        active: panel.id === context?.activeTabId,
        projectId: resolvePanelParamString(panel.params, ["projectId"]),
        projectName: resolvePanelParamString(panel.params, ["projectName"]),
        rootPath: resolvePanelParamString(panel.params, ["rootPath"]),
        relativePath: resolvePanelParamString(panel.params, ["relativePath"]),
    }));
}

function buildAiChatSettingsTabParams(): Record<string, unknown> {
    return {
        sectionId: AI_CHAT_PANEL_ID,
        itemId: AI_CHAT_PROVIDER_SETTINGS_ITEM_ID,
        focusTarget: AI_CHAT_SETTINGS_API_KEY_FOCUS_TARGET,
        focusRequestId: `ai-chat-api-key-${Date.now()}`,
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

function resolveConfirmationCapabilityId(
    toolName: string,
    tools: AiToolDescriptor[],
): string | null {
    const normalizedToolName = toolName.trim();
    if (!normalizedToolName) {
        return null;
    }

    const matchingTool = tools.find((tool) => {
        return tool.capabilityId === normalizedToolName || tool.name === normalizedToolName;
    });
    return matchingTool?.capabilityId ?? normalizedToolName;
}

function buildAutoApprovalSettings(
    settings: AiChatSettings,
    capabilityId: string,
): AiChatSettings {
    return {
        ...settings,
        toolApprovalPolicy: {
            ...(settings.toolApprovalPolicy ?? {}),
            [capabilityId]: "auto",
        },
    };
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

interface AiChatToolCallRecordsViewProps {
    records: AiChatToolCallRecord[];
}

/**
 * @function AiChatToolCallRecordsView
 * @description 渲染助手消息下方的工具调用状态与可展开详情。
 * @param props 工具调用记录。
 * @returns React 节点。
 */
function AiChatToolCallRecordsView(props: AiChatToolCallRecordsViewProps): ReactNode {
    if (props.records.length === 0) {
        return null;
    }

    const groups = groupAiChatToolCallRecords(props.records);

    return (
        <div className="ai-chat-tool-call-list">
            {groups.map((group) => (
                <AiChatToolCallGroupView
                    key={group.capabilityId}
                    group={group}
                />
            ))}
        </div>
    );
}

interface AiChatToolCallGroupViewProps {
    group: AiChatToolCallRecordGroup;
}

function AiChatToolCallGroupView(props: AiChatToolCallGroupViewProps): ReactNode {
    const { group } = props;

    return (
        <details
            className={`ai-chat-tool-call-group status-${group.status}`}
        >
            <summary className="ai-chat-tool-call-summary">
                <span className="ai-chat-tool-call-name">{group.capabilityId}</span>
                <span className="ai-chat-tool-call-count">
                    {i18n.t("aiChatPlugin.toolCallCount", { count: group.records.length })}
                </span>
                <span className={`ai-chat-tool-call-status status-${group.status}`}>
                    {i18n.t(`aiChatPlugin.toolCall${group.status.charAt(0).toUpperCase()}${group.status.slice(1)}`)}
                </span>
            </summary>
            <div className="ai-chat-tool-call-group-details">
                {group.records.map((record, index) => (
                    <AiChatToolCallRecordView
                        key={record.id}
                        record={record}
                        index={index}
                    />
                ))}
            </div>
        </details>
    );
}

interface AiChatToolCallRecordViewProps {
    record: AiChatToolCallRecord;
    index: number;
}

function AiChatToolCallRecordView(props: AiChatToolCallRecordViewProps): ReactNode {
    const { record, index } = props;

    return (
        <div className={`ai-chat-tool-call status-${record.status}`}>
            <div className="ai-chat-tool-call-instance-heading">
                <span>{i18n.t("aiChatPlugin.toolCallInstance", { index: index + 1 })}</span>
                <span className={`ai-chat-tool-call-status status-${record.status}`}>
                    {i18n.t(`aiChatPlugin.toolCall${record.status.charAt(0).toUpperCase()}${record.status.slice(1)}`)}
                </span>
            </div>
            <div className="ai-chat-tool-call-details">
                {record.inputText ? (
                    <div className="ai-chat-tool-call-detail-block">
                        <div className="ai-chat-tool-call-detail-label">{i18n.t("aiChatPlugin.toolCallInput")}</div>
                        <pre>{record.inputText}</pre>
                    </div>
                ) : null}
                {record.outputText ? (
                    <div className="ai-chat-tool-call-detail-block">
                        <div className="ai-chat-tool-call-detail-label">{i18n.t("aiChatPlugin.toolCallOutput")}</div>
                        <pre>{record.outputText}</pre>
                    </div>
                ) : null}
                {record.errorText ? (
                    <div className="ai-chat-tool-call-detail-block">
                        <div className="ai-chat-tool-call-detail-label">{i18n.t("aiChatPlugin.toolCallError")}</div>
                        <pre>{record.errorText}</pre>
                    </div>
                ) : null}
            </div>
        </div>
    );
}

/**
 * @function AiChatView
 * @description 渲染可在 pane 和 tab 之间复用的 AI 聊天视图。
 * @returns React 节点。
 */
function AiChatView(props: AiChatViewProps = {}): ReactNode {
    const { currentVaultPath, backendReady, files } = useVaultState();
    const activeEditor = useActiveEditor();
    const initialRuntimeSnapshot = getAiChatRuntimeSnapshot();
    const canUseInitialRuntimeSnapshot = initialRuntimeSnapshot.vaultPath === currentVaultPath
        && initialRuntimeSnapshot.historyLoaded;
    const [historyState, setHistoryState] = useState<AiChatHistoryState | null>(
        canUseInitialRuntimeSnapshot
            ? initialRuntimeSnapshot.historyState
            : null,
    );
    const [bindingsByConversation, setBindingsByConversation] = useState<Record<string, PendingStreamBinding>>(
        canUseInitialRuntimeSnapshot
            ? initialRuntimeSnapshot.bindingsByConversation
            : {},
    );
    const [smoothedMessagesById, setSmoothedMessagesById] = useState<Record<string, AiChatSmoothedMessageState>>(
        canUseInitialRuntimeSnapshot
            ? initialRuntimeSnapshot.smoothedMessagesById
            : {},
    );
    const [debugEntriesByConversation, setDebugEntriesByConversation] = useState<Record<string, ChatDebugEntry[]>>(
        canUseInitialRuntimeSnapshot
            ? initialRuntimeSnapshot.debugEntriesByConversation
            : {},
    );
    const [pendingConfirmations, setPendingConfirmations] = useState<Record<string, PendingToolConfirmation>>(
        canUseInitialRuntimeSnapshot
            ? initialRuntimeSnapshot.pendingConfirmations
            : {},
    );
    const [toolCallRecordsByMessageId, setToolCallRecordsByMessageId] = useState<Record<string, AiChatToolCallRecord[]>>(
        canUseInitialRuntimeSnapshot
            ? initialRuntimeSnapshot.toolCallRecordsByMessageId
            : {},
    );
    const [activeTab, setActiveTab] = useState<"history" | "chat" | "debug">(
        canUseInitialRuntimeSnapshot
            ? initialRuntimeSnapshot.activeTab
            : "chat",
    );
    const [debugFilter, setDebugFilter] = useState<ChatDebugFilterValue>(
        canUseInitialRuntimeSnapshot
            ? initialRuntimeSnapshot.debugFilter
            : "all",
    );
    const [debugCopyState, setDebugCopyState] = useState<"idle" | "copied" | "error">(
        canUseInitialRuntimeSnapshot
            ? initialRuntimeSnapshot.debugCopyState
            : "idle",
    );
    const [copiedMessageFeedback, setCopiedMessageFeedback] = useState<{
        messageId: string;
        updatedAtUnixMs: number;
    } | null>(null);
    const [conversationQuery, setConversationQuery] = useState(
        canUseInitialRuntimeSnapshot
            ? initialRuntimeSnapshot.conversationQuery
            : "",
    );
    const [draft, setDraft] = useState(
        canUseInitialRuntimeSnapshot
            ? initialRuntimeSnapshot.draft
            : "",
    );
    const [error, setError] = useState<string | null>(
        canUseInitialRuntimeSnapshot
            ? initialRuntimeSnapshot.error
            : null,
    );
    const [settings, setSettings] = useState<AiChatSettings | null>(null);
    const [vendorCatalog, setVendorCatalog] = useState<AiVendorDefinition[]>([]);
    const [toolCatalog, setToolCatalog] = useState<AiToolDescriptor[]>([]);
    const [modelSwitcherOpen, setModelSwitcherOpen] = useState(false);
    const [modelSwitcherModels, setModelSwitcherModels] = useState<AiVendorModelDefinition[]>([]);
    const [isModelSwitcherLoading, setIsModelSwitcherLoading] = useState(false);
    const [isModelSwitcherSaving, setIsModelSwitcherSaving] = useState(false);
    const [modelSwitcherFeedback, setModelSwitcherFeedback] = useState<string | null>(null);
    const [modelSwitcherFeedbackIsError, setModelSwitcherFeedbackIsError] = useState(false);
    const [editingUserMessage, setEditingUserMessage] = useState<{
        conversationId: string;
        messageId: string;
        draft: string;
    } | null>(
        canUseInitialRuntimeSnapshot
            ? initialRuntimeSnapshot.editingUserMessage
            : null,
    );
    const [isConversationReplaying, setIsConversationReplaying] = useState(
        canUseInitialRuntimeSnapshot
            ? initialRuntimeSnapshot.isConversationReplaying
            : false,
    );
    const bindingsRef = useRef<Record<string, PendingStreamBinding>>(bindingsByConversation);
    const smoothedMessagesRef = useRef<Record<string, AiChatSmoothedMessageState>>(smoothedMessagesById);
    const rollbackCheckpointsRef = useRef<Record<string, AiChatRollbackCheckpoint>>({});
    const historyLoadedRef = useRef(
        canUseInitialRuntimeSnapshot
            ? initialRuntimeSnapshot.historyLoaded
            : false,
    );
    const loadedRuntimeVaultPathRef = useRef<string | null>(
        canUseInitialRuntimeSnapshot ? currentVaultPath : null,
    );
    const historySaveTimerRef = useRef<number | null>(null);
    const threadViewportRef = useRef<HTMLDivElement | null>(null);
    const debugViewportRef = useRef<HTMLDivElement | null>(null);
    const smoothingFrameRef = useRef<number | null>(null);
    const smoothingLastFrameAtRef = useRef<number | null>(null);
    const modelSwitcherRef = useRef<HTMLDivElement | null>(null);
    const composerInputRef = useRef<HTMLTextAreaElement | null>(null);
    const modelSwitcherLoadKeyRef = useRef<string | null>(null);
    const modelSwitcherLoadRequestRef = useRef(0);
    const vendorCatalogRef = useRef<AiVendorDefinition[]>([]);
    const conversationAutoApprovalRef = useRef<Set<string>>(new Set());

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
        const nextBindings = updater(bindingsRef.current);
        bindingsRef.current = nextBindings;
        setBindingsByConversation(nextBindings);
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
     * @function updateToolCallRecordsFromDebugEntry
     * @description 从 capability debug 日志更新助手消息下方的可见工具调用记录。
     * @param assistantMessageId 助手消息 ID。
     * @param entry 调试日志。
     */
    const updateToolCallRecordsFromDebugEntry = (
        assistantMessageId: string,
        entry: ChatDebugEntry,
    ): void => {
        setToolCallRecordsByMessageId((current) => {
            const transition = reduceAiChatToolCallDebugEntry({
                assistantMessageId,
                records: current[assistantMessageId] ?? [],
                entry,
                recordId: nextChatToolCallRecordId(),
                nowUnixMs: Date.now(),
            });

            if (!transition.changed) {
                return current;
            }

            return {
                ...current,
                [assistantMessageId]: transition.records,
            };
        });
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
        const nextMessages = updater(smoothedMessagesRef.current);
        smoothedMessagesRef.current = nextMessages;
        setSmoothedMessagesById(nextMessages);
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
        return resolveVendor(vendorCatalog, resolveActiveProvider(settings).vendorId);
    }, [settings, vendorCatalog]);

    const isVendorConfigured = useMemo(() => {
        return isVendorSettingsComplete(settings, selectedVendor);
    }, [selectedVendor, settings]);

    const canLoadModelSwitcherModels = useMemo(() => {
        return isVendorSettingsComplete(settings, selectedVendor);
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
        const configuredModel = settings ? resolveActiveProvider(settings).model.trim() : "";
        if (configuredModel) {
            return configuredModel;
        }
        if (!currentVaultPath || !isVendorConfigured) {
            return i18n.t("aiChatPlugin.composerHintMissing");
        }
        return "-";
    }, [currentVaultPath, isVendorConfigured, settings]);

    const composerHint = useMemo(() => {
        if (isActiveConversationStreaming) {
            return draft.trim()
                ? i18n.t("aiChatPlugin.queuedDraftHint")
                : i18n.t("aiChatPlugin.generatingHint");
        }
        return "";
    }, [draft, isActiveConversationStreaming]);

    useEffect(() => {
        vendorCatalogRef.current = vendorCatalog;
    }, [vendorCatalog]);

    useEffect(() => {
        if (!currentVaultPath || loadedRuntimeVaultPathRef.current !== currentVaultPath) {
            return;
        }

        updateAiChatRuntimeSnapshot({
            activeTab,
            bindingsByConversation,
            conversationQuery,
            debugCopyState,
            debugEntriesByConversation,
            debugFilter,
            draft,
            editingUserMessage,
            error,
            historyLoaded: historyLoadedRef.current,
            historyState,
            isConversationReplaying,
            pendingConfirmations,
            smoothedMessagesById,
            toolCallRecordsByMessageId,
            vaultPath: currentVaultPath,
        });
    }, [
        activeTab,
        bindingsByConversation,
        conversationQuery,
        currentVaultPath,
        debugCopyState,
        debugEntriesByConversation,
        debugFilter,
        draft,
        editingUserMessage,
        error,
        historyState,
        isConversationReplaying,
        pendingConfirmations,
        smoothedMessagesById,
        toolCallRecordsByMessageId,
    ]);

    const canSend = Boolean(
        currentVaultPath
        && activeConversation
        && draft.trim()
        && !isActiveConversationStreaming
        && !isConversationReplaying
        && isVendorConfigured,
    );

    const handleOpenWikiLinkTarget = async (target: string): Promise<void> => {
        if (props.tabContainerApi && await openProjectReaderWikiLinkTarget(props.tabContainerApi, target)) {
            return;
        }

        if (props.panelContext) {
            const projectTab = await resolveProjectReaderWikiLinkTabDefinition(target);
            if (projectTab) {
                props.panelContext.openTab(projectTab);
                return;
            }
        }

        const currentDirectory = resolveParentDirectory(activeEditor?.path ?? "");
        const resolved = await resolveWikiLinkTarget(currentDirectory, target);
        if (!resolved) {
            console.warn("[aiChatPlugin] wikilink target not found", {
                currentDirectory,
                target,
            });
            return;
        }

        const openFile = props.panelContext?.openFile;
        if (openFile) {
            await openFile({
                relativePath: resolved.relativePath,
            });
            return;
        }

        if (props.tabContainerApi) {
            await openFileInWorkbench({
                containerApi: props.tabContainerApi,
                relativePath: resolved.relativePath,
                currentVaultPath: currentVaultPath ?? undefined,
            });
        }
    };

    const handleOpenAiSettingsApiKey = (): void => {
        const params = buildAiChatSettingsTabParams();
        const settingsTab = props.tabContainerApi?.getPanel(AI_CHAT_SETTINGS_TAB_ID)
            ?? props.panelContext?.workbenchApi?.getPanel(AI_CHAT_SETTINGS_TAB_ID)
            ?? null;

        if (settingsTab) {
            settingsTab.api.updateParameters?.({
                ...(settingsTab.params ?? {}),
                ...params,
            });
            settingsTab.api.setActive();
            return;
        }

        const tab = {
            id: AI_CHAT_SETTINGS_TAB_ID,
            title: i18n.t("workbenchLayout.settingsTooltip"),
            component: AI_CHAT_SETTINGS_COMPONENT_ID,
            params,
        };

        if (props.panelContext) {
            props.panelContext.openTab(tab);
            return;
        }

        props.tabContainerApi?.addPanel(tab);
    };

    useEffect(() => {
        if (!currentVaultPath) {
            return;
        }

        const cachedRuntimeSnapshot = getAiChatRuntimeSnapshot();
        if (
            cachedRuntimeSnapshot.vaultPath === currentVaultPath
            || loadedRuntimeVaultPathRef.current === currentVaultPath
        ) {
            return;
        }

        loadedRuntimeVaultPathRef.current = null;
        historyLoadedRef.current = false;
        resetAiChatRuntimeSnapshot(currentVaultPath);
        setHistoryState(null);
        setBindingsByConversation({});
        bindingsRef.current = {};
        setSmoothedMessagesById({});
        smoothedMessagesRef.current = {};
        setDebugEntriesByConversation({});
        setPendingConfirmations({});
        setToolCallRecordsByMessageId({});
        setActiveTab("chat");
        setDebugFilter("all");
        setDebugCopyState("idle");
        setConversationQuery("");
        setDraft("");
        setError(null);
        setEditingUserMessage(null);
        setIsConversationReplaying(false);
        rollbackCheckpointsRef.current = {};
        conversationAutoApprovalRef.current = new Set();
    }, [currentVaultPath]);

    useEffect(() => {
        let disposed = false;

        if (!currentVaultPath) {
            loadedRuntimeVaultPathRef.current = null;
            resetAiChatRuntimeSnapshot(null);
            setHistoryState(null);
            setBindingsByConversation({});
            bindingsRef.current = {};
            setSmoothedMessagesById({});
            smoothedMessagesRef.current = {};
            setDebugEntriesByConversation({});
            setPendingConfirmations({});
            setToolCallRecordsByMessageId({});
            setSettings(null);
            setToolCatalog([]);
            setEditingUserMessage(null);
            setIsConversationReplaying(false);
            rollbackCheckpointsRef.current = {};
            conversationAutoApprovalRef.current = new Set();
            historyLoadedRef.current = false;
            resetAiChatSettingsStore();
            return;
        }

        // Wait for backend to be ready (set_current_vault completed)
        // before loading vault-scoped data.
        if (!backendReady) {
            return;
        }

        const cachedRuntimeSnapshot = getAiChatRuntimeSnapshot();
        const canReuseRuntimeSnapshot = cachedRuntimeSnapshot.vaultPath === currentVaultPath
            && cachedRuntimeSnapshot.historyLoaded
            && cachedRuntimeSnapshot.historyState !== null;

        if (canReuseRuntimeSnapshot) {
            loadedRuntimeVaultPathRef.current = currentVaultPath;
            setHistoryState(cachedRuntimeSnapshot.historyState);
            setBindingsByConversation(cachedRuntimeSnapshot.bindingsByConversation);
            bindingsRef.current = cachedRuntimeSnapshot.bindingsByConversation;
            setSmoothedMessagesById(cachedRuntimeSnapshot.smoothedMessagesById);
            smoothedMessagesRef.current = cachedRuntimeSnapshot.smoothedMessagesById;
            setDebugEntriesByConversation(cachedRuntimeSnapshot.debugEntriesByConversation);
            setPendingConfirmations(cachedRuntimeSnapshot.pendingConfirmations);
            setToolCallRecordsByMessageId(cachedRuntimeSnapshot.toolCallRecordsByMessageId);
            setActiveTab(cachedRuntimeSnapshot.activeTab);
            setDebugFilter(cachedRuntimeSnapshot.debugFilter);
            setDebugCopyState(cachedRuntimeSnapshot.debugCopyState);
            setConversationQuery(cachedRuntimeSnapshot.conversationQuery);
            setDraft(cachedRuntimeSnapshot.draft);
            setError(cachedRuntimeSnapshot.error);
            setEditingUserMessage(cachedRuntimeSnapshot.editingUserMessage);
            setIsConversationReplaying(cachedRuntimeSnapshot.isConversationReplaying);
            historyLoadedRef.current = true;
            console.info("[aiChatPlugin] reused runtime snapshot", {
                vaultPath: currentVaultPath,
                activeBindings: Object.keys(cachedRuntimeSnapshot.bindingsByConversation).length,
            });
        }

        Promise.all([
            getAiVendorCatalog(),
            getAiToolCatalog(),
            ensureAiChatSettingsLoaded(currentVaultPath),
            canReuseRuntimeSnapshot ? Promise.resolve(cachedRuntimeSnapshot.historyState!) : getAiChatHistory(),
        ])
            .then(([catalog, tools, nextSettings, history]) => {
                if (disposed) {
                    return;
                }
                vendorCatalogRef.current = catalog;
                setVendorCatalog(catalog);
                setToolCatalog(tools);
                setSettings(nextSettings);
                if (!canReuseRuntimeSnapshot) {
                    const nextHistoryState = ensureHistoryState(history);
                    setHistoryState(nextHistoryState);
                    setBindingsByConversation({});
                    bindingsRef.current = {};
                    setSmoothedMessagesById({});
                    smoothedMessagesRef.current = {};
                    setDebugEntriesByConversation({});
                    setPendingConfirmations({});
                    setToolCallRecordsByMessageId({});
                    setEditingUserMessage(null);
                    setIsConversationReplaying(false);
                    rollbackCheckpointsRef.current = {};
                    conversationAutoApprovalRef.current = new Set();
                    setDebugFilter("all");
                    setDebugCopyState("idle");
                    historyLoadedRef.current = true;
                    loadedRuntimeVaultPathRef.current = currentVaultPath;
                    updateAiChatRuntimeSnapshot({
                        historyState: nextHistoryState,
                        historyLoaded: true,
                        vaultPath: currentVaultPath,
                    });
                }
                if (canReuseRuntimeSnapshot) {
                    historyLoadedRef.current = true;
                    loadedRuntimeVaultPathRef.current = currentVaultPath;
                    updateAiChatRuntimeSnapshot({
                        historyLoaded: true,
                        vaultPath: currentVaultPath,
                    });
                }
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

            setSettings(snapshot.settings ? ensureSettingsProviderList(snapshot.settings, vendorCatalogRef.current) : null);
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
        const cleanup = subscribeAiChatStreamEventHub((payload) => {
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

            const wasBindingStreamless = !binding.streamId;
            bindingsRef.current = {
                ...bindingsRef.current,
                [binding.conversationId!]: transition.nextBinding,
            };
            if (!binding.streamId && transition.nextBinding.streamId === payload.streamId) {
                console.info("[aiChatPlugin] stream bound", {
                    streamId: payload.streamId,
                    conversationId: binding.conversationId,
                    sessionId: binding.sessionId,
                });
            }

            setConversationBinding(binding.conversationId!, transition.nextBinding);
            if (
                wasBindingStreamless
                && transition.nextBinding.streamId === payload.streamId
                && transition.nextBinding.stopRequested
            ) {
                void stopAiChatStream(payload.streamId).catch((stopError) => {
                    setError(stopError instanceof Error ? stopError.message : String(stopError));
                    updateConversationBinding(binding.conversationId!, (currentBinding) => ({
                        ...currentBinding,
                        stopRequested: false,
                    }));
                });
            }

            if (transition.nextDebugEntry) {
                console.debug("[aiChatPlugin] stream debug chunk", {
                    streamId: payload.streamId,
                    title: transition.nextDebugEntry.title,
                });
                appendDebugEntry(binding.conversationId!, transition.nextDebugEntry);
                updateToolCallRecordsFromDebugEntry(
                    binding.assistantMessageId!,
                    transition.nextDebugEntry,
                );
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
                const completedAt = Date.now();
                updateConversation(binding.conversationId!, (conversation) => ({
                    ...conversation,
                    updatedAtUnixMs: completedAt,
                    messages: conversation.messages.map((message) => {
                        if (message.id !== binding.assistantMessageId) {
                            return message;
                        }

                        return {
                            ...message,
                            interruptedByUser: true,
                            completedAtUnixMs: completedAt,
                            durationMs: Math.max(0, completedAt - (message.startedAtUnixMs ?? message.createdAtUnixMs)),
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
                const completedAt = Date.now();
                updateConversation(binding.conversationId!, (conversation) => {
                    let completedAssistantMessage: AiChatHistoryMessage | null = null;
                    const messages = conversation.messages.map((message) => {
                        if (message.id !== binding.assistantMessageId) {
                            return message;
                        }

                        completedAssistantMessage = {
                            ...message,
                            completedAtUnixMs: completedAt,
                            durationMs: Math.max(0, completedAt - (message.startedAtUnixMs ?? message.createdAtUnixMs)),
                        };
                        return completedAssistantMessage;
                    });
                    const protocolMessage = completedAssistantMessage
                        ? createProtocolAssistantMessage(completedAssistantMessage, payload)
                        : null;

                    return protocolMessage ? {
                        ...conversation,
                        updatedAtUnixMs: completedAt,
                        messages,
                        protocolMessages: [
                            ...(conversation.protocolMessages ?? []),
                            protocolMessage,
                        ],
                    } : {
                        ...conversation,
                        updatedAtUnixMs: completedAt,
                        messages,
                    };
                });
                console.info("[aiChatPlugin] stream completed", {
                    streamId: payload.streamId,
                    conversationId: binding.conversationId,
                });
            }
        });

        return () => {
            cleanup();
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

    useEffect(() => {
        if (!copiedMessageFeedback) {
            return;
        }

        const timer = window.setTimeout(() => {
            setCopiedMessageFeedback((current) => {
                return current?.updatedAtUnixMs === copiedMessageFeedback.updatedAtUnixMs
                    ? null
                    : current;
            });
        }, 1600);

        return () => {
            window.clearTimeout(timer);
        };
    }, [copiedMessageFeedback]);

    useEffect(() => {
        if (!modelSwitcherOpen) {
            return;
        }

        const handlePointerDown = (event: PointerEvent): void => {
            const target = event.target as Node | null;
            if (!target || modelSwitcherRef.current?.contains(target)) {
                return;
            }
            setModelSwitcherOpen(false);
        };

        window.addEventListener("pointerdown", handlePointerDown, { capture: true });
        return () => {
            window.removeEventListener("pointerdown", handlePointerDown, { capture: true });
        };
    }, [modelSwitcherOpen]);

    useEffect(() => {
        if (modelSwitcherOpen) {
            return;
        }

        setModelSwitcherFeedback(null);
        setModelSwitcherFeedbackIsError(false);
    }, [modelSwitcherOpen]);

    useLayoutEffect(() => {
        const input = composerInputRef.current;
        if (!input) {
            return;
        }

        input.style.height = "auto";
        input.style.height = `${Math.min(input.scrollHeight, 150)}px`;
    }, [draft]);

    useEffect(() => {
        if (!settings || !canLoadModelSwitcherModels) {
            modelSwitcherLoadKeyRef.current = null;
            modelSwitcherLoadRequestRef.current += 1;
            setModelSwitcherModels([]);
            setModelSwitcherFeedback(null);
            setModelSwitcherFeedbackIsError(false);
            return;
        }

        const loadKey = JSON.stringify({
            providerId: settings.activeProviderId ?? null,
            vendorId: resolveActiveProvider(settings).vendorId,
            fieldValues: resolveActiveProvider(settings).fieldValues,
        });
        if (modelSwitcherLoadKeyRef.current === loadKey) {
            return;
        }

        modelSwitcherLoadKeyRef.current = loadKey;
        void loadModelSwitcherModels(settings);
    }, [canLoadModelSwitcherModels, settings]);

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
        setEditingUserMessage(null);
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
        setEditingUserMessage(null);
        setError(null);
    };

    const isConfirmationAllowedForConversation = (
        confirmation: PendingToolConfirmation,
    ): boolean => {
        return conversationAutoApprovalRef.current.has(confirmation.conversationId);
    };

    const allowConfirmationForConversation = (
        confirmation: PendingToolConfirmation,
    ): void => {
        conversationAutoApprovalRef.current = new Set([
            ...conversationAutoApprovalRef.current,
            confirmation.conversationId,
        ]);
    };

    const allowConfirmationOperationAlways = async (
        confirmation: PendingToolConfirmation,
    ): Promise<void> => {
        if (!settings || !currentVaultPath) {
            throw new Error(i18n.t("aiChatPlugin.confirmAllowOperationUnavailable"));
        }

        const capabilityId = resolveConfirmationCapabilityId(confirmation.toolName, toolCatalog);
        if (!capabilityId) {
            throw new Error(i18n.t("aiChatPlugin.confirmAllowOperationUnavailable"));
        }

        const nextSettings = buildAutoApprovalSettings(settings, capabilityId);
        const savedSettings = await saveAiChatSettingsToStore(currentVaultPath, nextSettings);
        setSettings(savedSettings);
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
        scope: ConfirmationApprovalScope = "once",
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
            if (approved && scope === "conversation") {
                allowConfirmationForConversation(confirmation);
            }
            if (approved && scope === "operation") {
                await allowConfirmationOperationAlways(confirmation);
            }

            const response = await submitAiChatConfirmation({
                confirmationId: confirmation.confirmationId,
                confirmed: approved,
                sessionId: confirmation.sessionId,
                rollbackCheckpointId: historyState?.conversations
                    .find((conversation) => conversation.id === confirmation.conversationId)
                    ?.messages.find((message) => message.id === confirmation.assistantMessageId)
                    ?.rollbackCheckpointId,
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

    useEffect(() => {
        const autoApprovedConfirmation = Object.values(pendingConfirmations).find((confirmation) => {
            return !confirmation.isSubmitting && isConfirmationAllowedForConversation(confirmation);
        });
        if (!autoApprovedConfirmation) {
            return;
        }

        void handleToolDecision(autoApprovedConfirmation, true);
    }, [pendingConfirmations, toolCatalog]);

    /**
     * @function loadModelSwitcherModels
     * @description 在 composer 模型切换菜单中加载当前 provider 的可用模型。
     * @param targetSettings 当前设置。
     */
    const loadModelSwitcherModels = async (targetSettings: AiChatSettings): Promise<void> => {
        const requestId = modelSwitcherLoadRequestRef.current + 1;
        modelSwitcherLoadRequestRef.current = requestId;
        setIsModelSwitcherLoading(true);
        setModelSwitcherFeedback(null);
        setModelSwitcherFeedbackIsError(false);

        try {
            const models = await getAiVendorModels(targetSettings);
            if (modelSwitcherLoadRequestRef.current !== requestId) {
                return;
            }
            setModelSwitcherModels(models);
            setModelSwitcherFeedback(models.length === 0 ? i18n.t("aiChatPlugin.modelSwitcherEmpty") : null);
        } catch (loadError) {
            if (modelSwitcherLoadRequestRef.current !== requestId) {
                return;
            }
            setModelSwitcherModels([]);
            setModelSwitcherFeedback(loadError instanceof Error ? loadError.message : String(loadError));
            setModelSwitcherFeedbackIsError(true);
        } finally {
            if (modelSwitcherLoadRequestRef.current === requestId) {
                setIsModelSwitcherLoading(false);
            }
        }
    };

    /**
     * @function handleModelSwitcherToggle
     * @description 打开或关闭 composer 模型切换菜单。
     */
    const handleModelSwitcherToggle = (): void => {
        const nextOpen = !modelSwitcherOpen;
        setModelSwitcherOpen(nextOpen);
        setModelSwitcherFeedback(null);
        setModelSwitcherFeedbackIsError(false);
    };

    /**
     * @function handleModelSwitcherSelectModel
     * @description 选择 composer 菜单中的模型并立即保存。
     * @param modelId 模型 ID。
     */
    const handleModelSwitcherSelectModel = async (modelId: string): Promise<void> => {
        if (!settings || !currentVaultPath || isModelSwitcherSaving) {
            return;
        }

        const activeProvider = resolveActiveProvider(settings);
        if (modelId === activeProvider.model) {
            setModelSwitcherOpen(false);
            return;
        }

        setIsModelSwitcherSaving(true);
        setModelSwitcherFeedback(null);
        setModelSwitcherFeedbackIsError(false);
        try {
            const savedSettings = await saveAiChatSettingsToStore(
                currentVaultPath,
                withActiveProvider(settings, {
                    ...activeProvider,
                    model: modelId,
                }),
            );
            const nextSettings = ensureSettingsProviderList(savedSettings, vendorCatalog);
            setSettings(nextSettings);
            setModelSwitcherOpen(false);
        } catch (saveError) {
            setModelSwitcherFeedback(saveError instanceof Error ? saveError.message : String(saveError));
            setModelSwitcherFeedbackIsError(true);
        } finally {
            setIsModelSwitcherSaving(false);
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

    const captureCurrentRollbackCheckpoint = async (): Promise<AiChatRollbackCheckpoint> => {
        return captureAiChatRollbackCheckpoint({
            files,
            readMarkdownFile: readVaultMarkdownFile,
            readCanvasFile: readVaultCanvasFile,
            checkpointId: nextChatRollbackCheckpointId(),
            nowUnixMs: Date.now(),
        });
    };

    const restoreRollbackCheckpoint = async (
        checkpointId: string | undefined,
    ): Promise<void> => {
        const normalizedCheckpointId = checkpointId?.trim();
        if (!normalizedCheckpointId) {
            throw new Error(i18n.t("aiChatPlugin.rollbackUnavailable"));
        }

        let result: { deletedPaths: string[]; restoredPaths: string[]; skippedPaths?: string[] };
        let restoredThroughBackend = true;
        try {
            result = await restoreAiChatRollbackCheckpointInBackend(normalizedCheckpointId);
        } catch (backendError) {
            restoredThroughBackend = false;
            const checkpoint = rollbackCheckpointsRef.current[normalizedCheckpointId];
            const canUseLocalFallback = Boolean(checkpoint)
                && !(window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
            if (!checkpoint || !canUseLocalFallback) {
                throw backendError instanceof Error
                    ? backendError
                    : new Error(String(backendError));
            }
            result = await restoreAiChatRollbackCheckpoint(checkpoint, {
                files,
                saveMarkdownFile: (relativePath, content) => savePersistedMarkdownContent({
                    relativePath,
                    content,
                }),
                saveCanvasFile: (relativePath, content) => savePersistedCanvasContent({
                    relativePath,
                    content,
                }),
                deleteMarkdownFile: deletePersistedMarkdownFile,
                deleteCanvasFile: deletePersistedCanvasFile,
            });
        }

        if (result.skippedPaths?.length) {
            throw new Error(i18n.t("aiChatPlugin.rollbackIncomplete", {
                paths: result.skippedPaths.join(", "),
            }));
        }

        const pathsToNotify = restoredThroughBackend
            ? [...result.deletedPaths, ...result.restoredPaths]
            : result.deletedPaths;
        pathsToNotify.forEach((relativePath) => {
            notifyPersistedContentSaved(relativePath);
        });
    };

    const clearMessageRuntimeState = (messageIds: string[]): void => {
        if (messageIds.length === 0) {
            return;
        }

        const messageIdSet = new Set(messageIds);
        setPendingConfirmations((current) => {
            const next = { ...current };
            messageIdSet.forEach((messageId) => {
                delete next[messageId];
            });
            return next;
        });
        setToolCallRecordsByMessageId((current) => {
            const next = { ...current };
            messageIdSet.forEach((messageId) => {
                delete next[messageId];
            });
            return next;
        });
        commitSmoothedMessages((current) => {
            let changed = false;
            const next = { ...current };
            messageIdSet.forEach((messageId) => {
                if (messageId in next) {
                    changed = true;
                    delete next[messageId];
                }
            });
            return changed ? next : current;
        });
    };

    const resolveProtocolMessagesBeforeUserMessage = (
        conversation: AiChatConversationRecord,
        userMessageId: string,
        visibleMessagesBeforeTurn: AiChatHistoryMessage[],
    ): AiChatHistoryMessage[] => {
        const protocolMessages = conversation.protocolMessages ?? [];
        const userProtocolIndex = protocolMessages.findIndex((message) => {
            return message.id === userMessageId;
        });

        if (userProtocolIndex >= 0) {
            return protocolMessages.slice(0, userProtocolIndex);
        }

        return visibleMessagesBeforeTurn;
    };

    const buildContextSnapshotJson = async (): Promise<string> => {
        const openTabs = buildOpenTabsSnapshot(props.panelContext);
        const projectReaderProjects = await listProjectReaderProjects()
            .then((response) => response.projects.map((project) => ({
                id: project.id,
                name: project.name,
                rootPath: project.rootPath,
            })))
            .catch(() => []);

        return serializeAiChatRuntimeContextSnapshot(
            buildAiChatRuntimeContextSnapshot({
                vaultPath: currentVaultPath,
                activeFile: activeEditor,
                openTabs,
                files,
                projectReaderProjects,
                settings,
            }),
        );
    };

    const beginAiChatTurn = async (input: BeginAiChatTurnInput): Promise<void> => {
        const trimmed = input.messageText.trim();
        if (!trimmed || !currentVaultPath || !isVendorConfigured) {
            return;
        }

        const contextSnapshotJson = await buildContextSnapshotJson();
        const startedAt = Date.now();
        const userMessage: AiChatHistoryMessage = input.userMessage
            ? {
                ...input.userMessage,
                text: trimmed,
                createdAtUnixMs: startedAt,
                rollbackCheckpointId: input.checkpoint.id,
            }
            : {
                id: nextChatMessageId(),
                role: "user",
                text: trimmed,
                createdAtUnixMs: startedAt,
                rollbackCheckpointId: input.checkpoint.id,
            };
        const assistantMessage: AiChatHistoryMessage = {
            id: nextChatMessageId(),
            role: "assistant",
            text: "",
            createdAtUnixMs: startedAt,
            startedAtUnixMs: startedAt,
            rollbackCheckpointId: input.checkpoint.id,
        };
        const history = input.protocolMessagesBeforeTurn.length
            ? input.protocolMessagesBeforeTurn
            : input.visibleMessagesBeforeTurn;
        const budgetedHistory = buildBudgetedAiChatHistory(history, settings);

        rollbackCheckpointsRef.current = {
            ...rollbackCheckpointsRef.current,
            [input.checkpoint.id]: input.checkpoint,
        };

        console.info("[aiChatPlugin] submit message", {
            conversationId: input.conversation.id,
            sessionId: input.sessionId,
            messageLength: trimmed.length,
            activeFilePath: activeEditor?.path ?? null,
            historyMessages: history.length,
            requestHistoryMessages: budgetedHistory.history.length,
            estimatedContextTokensBefore: budgetedHistory.estimatedTokensBefore,
            estimatedContextTokensAfter: budgetedHistory.estimatedTokensAfter,
            compressedMessageCount: budgetedHistory.compressedMessageCount,
        });

        setError(null);
        setActiveTab("chat");
        updateConversation(input.conversation.id, (conversation) => ({
            ...conversation,
            sessionId: input.sessionId,
            updatedAtUnixMs: Date.now(),
            messages: [
                ...input.visibleMessagesBeforeTurn,
                userMessage,
                assistantMessage,
            ],
            protocolMessages: [
                ...input.protocolMessagesBeforeTurn,
                createProtocolUserTextMessage(userMessage),
            ],
        }));

        setConversationBinding(input.conversation.id, createPendingStreamBinding(
            input.conversation.id,
            input.sessionId,
            assistantMessage.id,
        ));

        try {
            const response = await startAiChatStream({
                message: trimmed,
                sessionId: input.sessionId,
                history: budgetedHistory.history,
                contextSnapshotJson,
                rollbackCheckpointId: input.checkpoint.id,
            });
            const currentBinding = bindingsRef.current[input.conversation.id];
            if (currentBinding && !currentBinding.streamId) {
                const nextBinding = {
                    ...currentBinding,
                    streamId: response.streamId,
                };
                setConversationBinding(input.conversation.id, nextBinding);
                if (nextBinding.stopRequested) {
                    void stopAiChatStream(response.streamId).catch((stopError) => {
                        setError(stopError instanceof Error ? stopError.message : String(stopError));
                        updateConversationBinding(input.conversation.id, (binding) => ({
                            ...binding,
                            stopRequested: false,
                        }));
                    });
                }
            }
        } catch (submitError) {
            setError(submitError instanceof Error ? submitError.message : String(submitError));
            setConversationBinding(input.conversation.id, createEmptyPendingStreamBinding());
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
        if (
            !trimmed
            || isActiveConversationStreaming
            || isConversationReplaying
            || !currentVaultPath
            || !isVendorConfigured
        ) {
            return;
        }

        try {
            const checkpoint = await captureCurrentRollbackCheckpoint();
            setDraft("");
            await beginAiChatTurn({
                conversation: activeConversation,
                messageText: trimmed,
                sessionId: activeConversation.sessionId,
                visibleMessagesBeforeTurn: activeConversation.messages,
                protocolMessagesBeforeTurn: activeConversation.protocolMessages ?? [],
                checkpoint,
            });
        } catch (submitError) {
            setError(submitError instanceof Error ? submitError.message : String(submitError));
        }
    };

    const handleCopyMessage = async (message: AiChatHistoryMessage): Promise<void> => {
        const text = message.text.trim();
        if (!text) {
            return;
        }

        try {
            await navigator.clipboard.writeText(text);
            setCopiedMessageFeedback({
                messageId: message.id,
                updatedAtUnixMs: Date.now(),
            });
        } catch (copyError) {
            setError(i18n.t("aiChatPlugin.copyMessageFailed"));
            setCopiedMessageFeedback((current) => {
                return current?.messageId === message.id ? null : current;
            });
            console.error("[ai-chat] copy message failed", {
                messageId: message.id,
                error: copyError,
            });
        }
    };

    const handleRetryAssistantMessage = async (
        assistantMessage: AiChatHistoryMessage,
    ): Promise<void> => {
        if (!activeConversation || isActiveConversationStreaming || isConversationReplaying) {
            return;
        }

        const assistantIndex = activeConversation.messages.findIndex((message) => {
            return message.id === assistantMessage.id;
        });
        if (assistantIndex <= 0) {
            return;
        }

        const userIndex = assistantIndex - 1;
        const userMessage = activeConversation.messages[userIndex];
        if (!userMessage || userMessage.role !== "user") {
            return;
        }

        setIsConversationReplaying(true);
        try {
            const rollbackCheckpointId = assistantMessage.rollbackCheckpointId ?? userMessage.rollbackCheckpointId;
            await restoreRollbackCheckpoint(rollbackCheckpointId);
            const visibleMessagesBeforeTurn = activeConversation.messages.slice(0, userIndex);
            const protocolMessagesBeforeTurn = resolveProtocolMessagesBeforeUserMessage(
                activeConversation,
                userMessage.id,
                visibleMessagesBeforeTurn,
            );
            clearMessageRuntimeState(activeConversation.messages.slice(userIndex + 1).map((message) => message.id));
            if (!rollbackCheckpointId) {
                throw new Error(i18n.t("aiChatPlugin.rollbackUnavailable"));
            }
            const checkpoint = rollbackCheckpointsRef.current[rollbackCheckpointId]
                ?? createEmptyRollbackCheckpoint(rollbackCheckpointId);
            await beginAiChatTurn({
                conversation: activeConversation,
                messageText: userMessage.text,
                sessionId: createConversationSessionId(activeConversation.id),
                visibleMessagesBeforeTurn,
                protocolMessagesBeforeTurn,
                userMessage,
                checkpoint,
            });
        } catch (retryError) {
            setError(retryError instanceof Error ? retryError.message : String(retryError));
        } finally {
            setIsConversationReplaying(false);
        }
    };

    const handleStartEditUserMessage = (message: AiChatHistoryMessage): void => {
        if (!activeConversation || isActiveConversationStreaming || isConversationReplaying) {
            return;
        }

        setEditingUserMessage({
            conversationId: activeConversation.id,
            messageId: message.id,
            draft: message.text,
        });
    };

    const handleCancelEditUserMessage = (): void => {
        setEditingUserMessage(null);
    };

    const handleSubmitEditedUserMessage = async (): Promise<void> => {
        if (!activeConversation || !editingUserMessage || isActiveConversationStreaming || isConversationReplaying) {
            return;
        }

        const editedText = editingUserMessage.draft.trim();
        if (!editedText) {
            return;
        }

        const userIndex = activeConversation.messages.findIndex((message) => {
            return message.id === editingUserMessage.messageId;
        });
        const userMessage = activeConversation.messages[userIndex];
        if (userIndex < 0 || !userMessage || userMessage.role !== "user") {
            return;
        }

        setIsConversationReplaying(true);
        try {
            const rollbackCheckpointId = userMessage.rollbackCheckpointId;
            await restoreRollbackCheckpoint(rollbackCheckpointId);
            const visibleMessagesBeforeTurn = activeConversation.messages.slice(0, userIndex);
            const protocolMessagesBeforeTurn = resolveProtocolMessagesBeforeUserMessage(
                activeConversation,
                userMessage.id,
                visibleMessagesBeforeTurn,
            );
            clearMessageRuntimeState(activeConversation.messages.slice(userIndex).map((message) => message.id));
            if (!rollbackCheckpointId) {
                throw new Error(i18n.t("aiChatPlugin.rollbackUnavailable"));
            }
            const checkpoint = rollbackCheckpointsRef.current[rollbackCheckpointId]
                ?? createEmptyRollbackCheckpoint(rollbackCheckpointId);
            setEditingUserMessage(null);
            await beginAiChatTurn({
                conversation: activeConversation,
                messageText: editedText,
                sessionId: createConversationSessionId(activeConversation.id),
                visibleMessagesBeforeTurn,
                protocolMessagesBeforeTurn,
                userMessage,
                checkpoint,
            });
        } catch (editError) {
            setError(editError instanceof Error ? editError.message : String(editError));
        } finally {
            setIsConversationReplaying(false);
        }
    };

    const handleEditMessageKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
        if (!shouldSubmitAiChatComposer({
            key: event.key,
            shiftKey: event.shiftKey,
            nativeEvent: event.nativeEvent,
        })) {
            return;
        }

        event.preventDefault();
        void handleSubmitEditedUserMessage();
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

        if (isActiveConversationStreaming) {
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

    const renderConfirmationApproveMenu = (
        confirmation: PendingToolConfirmation,
    ): ReactNode => (
        <div className="ai-chat-confirm-approve-menu">
            <button
                type="button"
                className="ai-chat-confirm-menu-item"
                disabled={confirmation.isSubmitting}
                onClick={() => {
                    void handleToolDecision(confirmation, true, "conversation");
                }}
            >
                {i18n.t("aiChatPlugin.confirmAllowConversation")}
            </button>
            <button
                type="button"
                className="ai-chat-confirm-menu-item"
                disabled={confirmation.isSubmitting}
                onClick={() => {
                    void handleToolDecision(confirmation, true, "operation");
                }}
            >
                {i18n.t("aiChatPlugin.confirmAllowOperation")}
            </button>
        </div>
    );

    return (
        <div className="ai-chat-panel">
            <div className="ai-chat-topbar">
                <button
                    type="button"
                    className={`ai-chat-conversation-manager-button${activeTab === "history" ? " active" : ""}`}
                    aria-label={i18n.t("aiChatPlugin.conversationManager")}
                    aria-pressed={activeTab === "history"}
                    title={i18n.t("aiChatPlugin.conversationManagerHint")}
                    disabled={!historyState}
                    onClick={() => {
                        setActiveTab("history");
                    }}
                >
                    <History size={13} strokeWidth={1.9} />
                    <span className="ai-chat-conversation-manager-label">
                        {i18n.t("aiChatPlugin.conversationManager")}
                    </span>
                </button>
            </div>

            {formattedError ? (
                <div className="ai-chat-header">
                    <div className="ai-chat-status error" title={error ?? undefined}>
                        <div className="ai-chat-status-title">{formattedError.summary}</div>
                        {formattedError.detail ? (
                            <div className="ai-chat-status-detail">{formattedError.detail}</div>
                        ) : null}
                    </div>
                </div>
            ) : null}

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
                            const toolCallRecords = toolCallRecordsByMessageId[message.id] ?? [];
                            const isStreamingMessage = message.role === "assistant"
                                && Boolean(
                                    smoothedMessage
                                    && (smoothedMessage.active || !isAiChatSmoothedMessageSettled(smoothedMessage)),
                                );
                            const durationLabel = message.role === "assistant"
                                ? formatAiChatDuration(message.durationMs)
                                : null;
                            const isEditingThisUserMessage = message.role === "user"
                                && editingUserMessage?.conversationId === activeConversation.id
                                && editingUserMessage.messageId === message.id;
                            const messageActionsDisabled = isActiveConversationStreaming || isConversationReplaying;
                            const isCopyFeedbackVisible = copiedMessageFeedback?.messageId === message.id;

                            return (
                                <div key={message.id} className={`ai-chat-message ${message.role}`}>
                                    <div className="ai-chat-message-content">
                                        <div className="ai-chat-message-heading-row">
                                            <div className="ai-chat-message-avatar">
                                                {message.role === "assistant"
                                                    ? <Bot size={13} strokeWidth={1.9} />
                                                    : <ArrowUp size={13} strokeWidth={1.9} />}
                                            </div>
                                            <div className="ai-chat-message-role">
                                                {message.role === "assistant"
                                                    ? i18n.t("aiChatPlugin.assistant")
                                                    : i18n.t("aiChatPlugin.user")}
                                            </div>
                                            {durationLabel ? (
                                                <div className="ai-chat-message-meta">
                                                    <span className="ai-chat-message-duration">
                                                        <Timer size={11} strokeWidth={1.8} />
                                                        <span>{durationLabel}</span>
                                                    </span>
                                                </div>
                                            ) : null}
                                        </div>
                                        {isEditingThisUserMessage ? (
                                            <form
                                                className="ai-chat-message-edit-form"
                                                onSubmit={(event) => {
                                                    event.preventDefault();
                                                    void handleSubmitEditedUserMessage();
                                                }}
                                            >
                                                <textarea
                                                    className="ai-chat-message-edit-input"
                                                    value={editingUserMessage.draft}
                                                    disabled={messageActionsDisabled}
                                                    onKeyDown={handleEditMessageKeyDown}
                                                    onChange={(event) => {
                                                        setEditingUserMessage((current) => current
                                                            && current.messageId === message.id
                                                            ? { ...current, draft: event.target.value }
                                                            : current);
                                                    }}
                                                />
                                                <div className="ai-chat-message-edit-actions">
                                                    <button
                                                        type="submit"
                                                        className="ai-chat-message-action-button"
                                                        disabled={messageActionsDisabled || !editingUserMessage.draft.trim()}
                                                        aria-label={i18n.t("aiChatPlugin.submitEditedMessage")}
                                                        title={i18n.t("aiChatPlugin.submitEditedMessage")}
                                                    >
                                                        <Check size={13} strokeWidth={2} />
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className="ai-chat-message-action-button"
                                                        disabled={messageActionsDisabled}
                                                        aria-label={i18n.t("aiChatPlugin.cancelEditMessage")}
                                                        title={i18n.t("aiChatPlugin.cancelEditMessage")}
                                                        onClick={handleCancelEditUserMessage}
                                                    >
                                                        <X size={13} strokeWidth={2} />
                                                    </button>
                                                </div>
                                            </form>
                                        ) : (
                                            <div className="ai-chat-message-bubble">
                                                <AiChatMessageMarkdown
                                                    content={renderedMessageText}
                                                    reasoningContent={renderedReasoningText}
                                                    role={message.role}
                                                    streaming={isStreamingMessage}
                                                    onOpenWikiLinkTarget={(target) => {
                                                        void handleOpenWikiLinkTarget(target);
                                                    }}
                                                />
                                            </div>
                                        )}
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
                                                    <div className="ai-chat-confirm-approve-split">
                                                        <button
                                                            type="button"
                                                            className="ai-chat-confirm-button approve primary"
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
                                                        <button
                                                            type="button"
                                                            className="ai-chat-confirm-button approve menu-trigger"
                                                            disabled={confirmation.isSubmitting}
                                                            aria-label={i18n.t("aiChatPlugin.confirmApproveMore")}
                                                            title={i18n.t("aiChatPlugin.confirmApproveMore")}
                                                        >
                                                            <ChevronDown size={13} strokeWidth={2} />
                                                        </button>
                                                        {renderConfirmationApproveMenu(confirmation)}
                                                    </div>
                                                </div>
                                            </div>
                                        ) : null}
                                        {message.role === "assistant" ? (
                                            <AiChatToolCallRecordsView records={toolCallRecords} />
                                        ) : null}
                                        <div className="ai-chat-message-actions">
                                            {message.role === "assistant" ? (
                                                <>
                                                    <button
                                                        type="button"
                                                        className={`ai-chat-message-action-button${isCopyFeedbackVisible ? " state-copied" : ""}`}
                                                        disabled={!message.text.trim()}
                                                        aria-label={i18n.t(isCopyFeedbackVisible
                                                            ? "aiChatPlugin.copyMessageCopied"
                                                            : "aiChatPlugin.copyMessage")}
                                                        title={i18n.t(isCopyFeedbackVisible
                                                            ? "aiChatPlugin.copyMessageCopied"
                                                            : "aiChatPlugin.copyMessage")}
                                                        onClick={() => {
                                                            void handleCopyMessage(message);
                                                        }}
                                                    >
                                                        {isCopyFeedbackVisible ? (
                                                            <Check size={13} strokeWidth={2.1} />
                                                        ) : (
                                                            <Copy size={13} strokeWidth={1.9} />
                                                        )}
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className="ai-chat-message-action-button"
                                                        disabled={messageActionsDisabled || isStreamingMessage}
                                                        aria-label={i18n.t("aiChatPlugin.retryMessage")}
                                                        title={i18n.t("aiChatPlugin.retryMessage")}
                                                        onClick={() => {
                                                            void handleRetryAssistantMessage(message);
                                                        }}
                                                    >
                                                        <RotateCcw size={13} strokeWidth={1.9} />
                                                    </button>
                                                </>
                                            ) : (
                                                <button
                                                    type="button"
                                                    className="ai-chat-message-action-button"
                                                    disabled={messageActionsDisabled || isEditingThisUserMessage}
                                                    aria-label={i18n.t("aiChatPlugin.editMessage")}
                                                    title={i18n.t("aiChatPlugin.editMessage")}
                                                    onClick={() => {
                                                        handleStartEditUserMessage(message);
                                                    }}
                                                >
                                                    <Pencil size={13} strokeWidth={1.9} />
                                                </button>
                                            )}
                                        </div>
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
                    <button
                        type="button"
                        className="ai-chat-status ai-chat-status-action"
                        onClick={handleOpenAiSettingsApiKey}
                    >
                        {i18n.t("aiChatPlugin.vendorMissing")}
                    </button>
                ) : null}

                <textarea
                    ref={composerInputRef}
                    className="ai-chat-input"
                    value={draft}
                    placeholder={i18n.t("aiChatPlugin.draftPlaceholder")}
                    disabled={!currentVaultPath || !activeConversation || isConversationReplaying}
                    onKeyDown={handleInputKeyDown}
                    onChange={(event) => {
                        setDraft(event.target.value);
                    }}
                />
                <div className="ai-chat-composer-row">
                    <div className="ai-chat-composer-meta">
                        <div ref={modelSwitcherRef} className="ai-chat-model-switcher">
                            <button
                                type="button"
                                className="ai-chat-model-button"
                                aria-expanded={modelSwitcherOpen}
                                disabled={!currentVaultPath || !settings || !isVendorConfigured}
                                onClick={handleModelSwitcherToggle}
                                title={composerModelLabel}
                            >
                                <span>{composerModelLabel}</span>
                                <ChevronDown size={13} strokeWidth={1.9} />
                            </button>
                            {modelSwitcherOpen ? (
                                <UiDropdownMenu className="ai-chat-model-menu" role="listbox" aria-label={i18n.t("aiChatPlugin.modelSwitcherTitle")}>
                                    {isModelSwitcherLoading ? (
                                        <div className="ai-chat-model-menu-status">{i18n.t("aiChatPlugin.refreshingModels")}</div>
                                    ) : modelSwitcherModels.map((model) => {
                                        const selected = settings ? model.id === resolveActiveProvider(settings).model : false;
                                        return (
                                            <UiDropdownMenuItem
                                                key={model.id}
                                                className={`ai-chat-model-option ${selected ? "selected" : ""}`}
                                                role="option"
                                                aria-selected={selected}
                                                selected={selected}
                                                disabled={isModelSwitcherSaving}
                                                onClick={() => {
                                                    void handleModelSwitcherSelectModel(model.id);
                                                }}
                                            >
                                                <span>{model.id}</span>
                                                {selected ? <Check size={14} strokeWidth={2} /> : null}
                                            </UiDropdownMenuItem>
                                        );
                                    })}
                                    {isModelSwitcherSaving ? (
                                        <div className="ai-chat-model-menu-status">{i18n.t("aiChatPlugin.modelSwitcherSaving")}</div>
                                    ) : null}
                                    {modelSwitcherFeedback ? (
                                        <div className={`ai-chat-model-feedback ${modelSwitcherFeedbackIsError ? "error" : ""}`}>
                                            {modelSwitcherFeedback}
                                        </div>
                                    ) : null}
                                </UiDropdownMenu>
                            ) : null}
                        </div>
                        {composerHint ? (
                            <div className="ai-chat-composer-hint">
                                {composerHint}
                            </div>
                        ) : null}
                    </div>
                    <div className="ai-chat-composer-actions">
                        <button
                            type="button"
                            className="ai-chat-new-button"
                            aria-label={i18n.t("aiChatPlugin.newConversation")}
                            title={i18n.t("aiChatPlugin.newConversation")}
                            disabled={!currentVaultPath}
                            onClick={handleCreateConversation}
                        >
                            <Plus size={15} strokeWidth={2.1} />
                        </button>
                        <button
                            type="button"
                            className="ai-chat-send-button"
                            aria-busy={isActiveConversationStopping}
                            disabled={isConversationReplaying || (isActiveConversationStreaming ? isActiveConversationStopping : !canSend)}
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
        </div>
    );
}

/**
 * @function AiChatTab
 * @description 渲染主区域中的 AI 聊天标签页。
 * @param _props Dockview 面板属性；当前实现不依赖额外参数。
 * @returns React 节点。
 */
function AiChatTab(props: WorkbenchTabProps<Record<string, unknown>>): ReactNode {
    return <AiChatView tabContainerApi={props.containerApi} />;
}

function AiChatSettingsSection(props: { pane: "provider" | "tool-approval" }): ReactNode {
    const { currentVaultPath, backendReady } = useVaultState();
    const [vendorCatalog, setVendorCatalog] = useState<AiVendorDefinition[]>([]);
    const [toolCatalog, setToolCatalog] = useState<AiToolDescriptor[]>([]);
    const [settings, setSettings] = useState<AiChatSettings | null>(null);
    const [availableModels, setAvailableModels] = useState<AiVendorModelDefinition[]>([]);
    const [isLoadingModels, setIsLoadingModels] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [feedback, setFeedback] = useState<string | null>(null);
    const [feedbackIsError, setFeedbackIsError] = useState(false);
    const [providerModalOpen, setProviderModalOpen] = useState(false);
    const [providerDraftTitle, setProviderDraftTitle] = useState("");
    const [providerDraftVendorId, setProviderDraftVendorId] = useState("");

    const selectedVendor = useMemo(() => {
        if (!settings) {
            return null;
        }
        return resolveVendor(vendorCatalog, resolveActiveProvider(settings).vendorId);
    }, [settings, vendorCatalog]);

    const activeProvider = useMemo(() => {
        return settings ? resolveActiveProvider(settings) : null;
    }, [settings]);

    const canLoadVendorModels = useMemo(() => {
        return isVendorSettingsComplete(settings, selectedVendor);
    }, [selectedVendor, settings]);

    useEffect(() => {
        let disposed = false;

        if (!currentVaultPath) {
            setSettings(null);
            setVendorCatalog([]);
            setToolCatalog([]);
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
            getAiToolCatalog(),
            ensureAiChatSettingsLoaded(currentVaultPath),
        ])
            .then(([catalog, tools, currentSettings]) => {
                if (disposed) {
                    return;
                }
                setVendorCatalog(catalog);
                setToolCatalog(tools);
                setSettings(ensureSettingsProviderList(currentSettings, catalog));
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

            setSettings(ensureSettingsProviderList(snapshot.settings, vendorCatalog));
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

            const targetProvider = resolveActiveProvider(targetSettings);
            if (models.length > 0 && !models.some((model) => model.id === targetProvider.model)) {
                const nextModel = models[0].id;
                setSettings((currentSettings) => currentSettings
                    ? withActiveProvider(currentSettings, {
                        ...resolveActiveProvider(currentSettings),
                        model: nextModel,
                    })
                    : currentSettings);
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
    }, [canLoadVendorModels, selectedVendor?.id, activeProvider?.id]);

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
            const provider = resolveActiveProvider(currentSettings);
            return withActiveProvider(currentSettings, {
                ...provider,
                fieldValues: {
                    ...provider.fieldValues,
                    [fieldKey]: value,
                },
            });
        });
    };

    const updateActiveProvider = (updater: (provider: AiChatProviderConfig) => AiChatProviderConfig): void => {
        setSettings((currentSettings) => {
            if (!currentSettings) {
                return currentSettings;
            }
            return withActiveProvider(currentSettings, updater(resolveActiveProvider(currentSettings)));
        });
    };

    /**
     * @function updateToolApprovalMode
     * @description 更新单个工具的审批策略。
     * @param capabilityId 工具 capability id。
     * @param mode 审批模式。
     */
    const updateToolApprovalMode = (capabilityId: string, mode: AiToolApprovalMode): void => {
        setSettings((currentSettings) => {
            if (!currentSettings) {
                return currentSettings;
            }

            const nextPolicy = {
                ...(currentSettings.toolApprovalPolicy ?? {}),
            };
            if (mode === "default") {
                delete nextPolicy[capabilityId];
            } else {
                nextPolicy[capabilityId] = mode;
            }

            return {
                ...currentSettings,
                toolApprovalPolicy: nextPolicy,
            };
        });
    };

    /**
     * @function updateAutoCompressContext
     * @description 更新自动上下文压缩开关。
     * @param enabled 是否启用。
     */
    const updateAutoCompressContext = (enabled: boolean): void => {
        setSettings((currentSettings) => currentSettings
            ? {
                ...currentSettings,
                autoCompressContext: enabled,
            }
            : currentSettings);
    };

    /**
     * @function updateContextLimitTokens
     * @description 更新 AI 请求上下文预算上限。
     * @param nextLimitTokens 新的估算 token 上限。
     */
    const updateContextLimitTokens = (nextLimitTokens: number): void => {
        setSettings((currentSettings) => currentSettings
            ? {
                ...currentSettings,
                contextLimitTokens: normalizeAiChatContextBudgetSettings({
                    ...currentSettings,
                    contextLimitTokens: nextLimitTokens,
                }).contextLimitTokens,
            }
            : currentSettings);
    };

    /**
     * @function handleProviderChange
     * @description 切换当前使用的 provider 实例。
     */
    const handleProviderSelect = (providerId: string): void => {
        if (!settings) {
            return;
        }

        setAvailableModels([]);
        const nextProvider = settings.providers?.find((provider) => provider.id === providerId);
        if (!nextProvider) {
            return;
        }
        const vendor = resolveVendor(vendorCatalog, nextProvider.vendorId);
        const mergedProvider = vendor ? mergeProviderForVendor(nextProvider, vendor) : nextProvider;
        setSettings(withActiveProvider(settings, mergedProvider));
    };

    const handleProviderTypeChange = (event: ChangeEvent<HTMLSelectElement>): void => {
        const nextVendor = resolveVendor(vendorCatalog, event.target.value);
        if (!nextVendor) {
            return;
        }

        setAvailableModels([]);
        updateActiveProvider((provider) => mergeProviderForVendor({
            ...provider,
            vendorId: nextVendor.id,
            model: provider.vendorId === nextVendor.id ? provider.model : nextVendor.defaultModel,
            fieldValues: provider.vendorId === nextVendor.id ? provider.fieldValues : {},
        }, nextVendor));
    };

    const handleAddProvider = (): void => {
        const vendor = selectedVendor ?? vendorCatalog[0] ?? null;
        if (!settings || !vendor) {
            return;
        }

        setProviderDraftTitle("");
        setProviderDraftVendorId(vendor.id);
        setProviderModalOpen(true);
    };

    const handleConfirmAddProvider = (event: React.FormEvent<HTMLFormElement>): void => {
        event.preventDefault();
        const vendor = resolveVendor(vendorCatalog, providerDraftVendorId) ?? vendorCatalog[0] ?? null;
        if (!settings || !vendor) {
            return;
        }

        setAvailableModels([]);
        const nextProvider = createProviderForVendor(vendor, settings.providers ?? []);
        const titledProvider = providerDraftTitle.trim().length > 0
            ? {
                ...nextProvider,
                title: providerDraftTitle.trim(),
            }
            : nextProvider;
        setSettings(withActiveProvider(settings, titledProvider));
        setProviderModalOpen(false);
        setProviderDraftTitle("");
    };

    const handleRemoveProvider = (): void => {
        if (!settings || !activeProvider) {
            return;
        }

        const providers = settings.providers ?? [];
        if (providers.length <= 1) {
            setFeedback(i18n.t("aiChatPlugin.providerRemoveLast"));
            setFeedbackIsError(true);
            return;
        }

        const nextProviders = providers.filter((provider) => provider.id !== activeProvider.id);
        const nextProvider = nextProviders[0];
        if (!nextProvider) {
            return;
        }
        setAvailableModels([]);
        setSettings({
            ...withActiveProvider({
                ...settings,
                providers: nextProviders,
            }, nextProvider),
            providers: nextProviders,
        });
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
            const nextSettings = ensureSettingsProviderList(savedSettings, vendorCatalog);
            const nextProvider = resolveActiveProvider(nextSettings);
            const vendor = resolveVendor(vendorCatalog, nextProvider.vendorId);
            setSettings(nextSettings);

            if (vendor) {
                const canRefreshModels = isVendorSettingsComplete(nextSettings, vendor);
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

    const toolPolicyRows = toolCatalog.length > 0
        ? toolCatalog
        : [];

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

    const activeProviderVendorTitle = selectedVendor?.title ?? activeProvider?.vendorId ?? "-";
    const contextBudgetSettings = normalizeAiChatContextBudgetSettings(settings);

    const providerSettingsPanel = (
        <div className="settings-item-group ai-chat-settings-form ai-chat-provider-settings-form">

            <div className="ai-chat-settings-provider-layout">
                <div className="ai-chat-settings-provider-list-pane">
                    <div className="ai-chat-settings-provider-list-header">
                        <div>
                            <div className="ai-chat-settings-label">{i18n.t("aiChatPlugin.providerLabel")}</div>
                            <div className="ai-chat-settings-desc">{i18n.t("aiChatPlugin.providerDescription")}</div>
                        </div>
                    </div>
                    <div className="ai-chat-settings-provider-list" role="listbox" aria-label={i18n.t("aiChatPlugin.providerLabel")}>
                        {(settings.providers ?? []).map((provider) => {
                            const vendor = resolveVendor(vendorCatalog, provider.vendorId);
                            const isSelected = provider.id === activeProvider?.id;
                            return (
                                <button
                                    key={provider.id}
                                    type="button"
                                    className={`ai-chat-settings-provider-item${isSelected ? " active" : ""}`}
                                    role="option"
                                    aria-selected={isSelected}
                                    onClick={() => {
                                        handleProviderSelect(provider.id);
                                    }}
                                >
                                    <span className="ai-chat-settings-provider-title">{provider.title}</span>
                                    <span className="ai-chat-settings-provider-meta">{vendor?.title ?? provider.vendorId} · {provider.model || "-"}</span>
                                </button>
                            );
                        })}
                    </div>
                    <div className="ai-chat-settings-provider-actions">
                        <UiButton
                            className="ai-chat-settings-mini-button"
                            controlSize="compact"
                            onClick={handleAddProvider}
                        >
                            <Plus size={13} strokeWidth={2} />
                            <span>{i18n.t("aiChatPlugin.providerAdd")}</span>
                        </UiButton>
                    </div>
                </div>

                <div className="ai-chat-settings-provider-detail-pane">
                    <div className="ai-chat-settings-provider-detail-header">
                        <div>
                            <div className="ai-chat-settings-provider-detail-title">{activeProvider?.title ?? "-"}</div>
                            <div className="ai-chat-settings-provider-meta">{activeProviderVendorTitle}</div>
                        </div>
                        <UiButton
                            className="ai-chat-settings-mini-button danger"
                            controlSize="compact"
                            variant="danger"
                            onClick={handleRemoveProvider}
                        >
                            <X size={13} strokeWidth={2} />
                            <span>{i18n.t("aiChatPlugin.providerRemove")}</span>
                        </UiButton>
                    </div>

                    <div className="ai-chat-settings-row">
                        <div className="ai-chat-settings-label">{i18n.t("aiChatPlugin.providerNameLabel")}</div>
                        <div className="ai-chat-settings-desc">{i18n.t("aiChatPlugin.providerNameDescription")}</div>
                        <UiTextInput
                            className="ai-chat-settings-input"
                            controlSize="compact"
                            variant="settings"
                            type="text"
                            value={activeProvider?.title ?? ""}
                            onChange={(event) => {
                                updateActiveProvider((provider) => ({
                                    ...provider,
                                    title: event.target.value,
                                }));
                            }}
                        />
                    </div>

                    <div className="ai-chat-settings-row">
                        <div className="ai-chat-settings-label">{i18n.t("aiChatPlugin.vendorLabel")}</div>
                        <div className="ai-chat-settings-desc">{i18n.t("aiChatPlugin.vendorDescription")}</div>
                        <UiSelect
                            value={activeProvider?.vendorId ?? ""}
                            onChange={handleProviderTypeChange}
                        >
                            {vendorCatalog.map((vendor) => (
                                <option key={vendor.id} value={vendor.id}>{vendor.title}</option>
                            ))}
                        </UiSelect>
                    </div>

                    <div className="ai-chat-settings-row">
                        <div className="ai-chat-settings-label">{i18n.t("aiChatPlugin.modelLabel")}</div>
                        <div className="ai-chat-settings-desc">{i18n.t("aiChatPlugin.modelDescription")}</div>
                        <UiSelect
                            className="ai-chat-settings-model-select"
                            value={activeProvider?.model ?? ""}
                            disabled={isLoadingModels}
                            onChange={(event) => {
                                updateActiveProvider((provider) => ({
                                    ...provider,
                                    model: event.target.value,
                                }));
                            }}
                        >
                            {availableModels.length === 0 ? (
                                <option value={activeProvider?.model ?? ""}>{activeProvider?.model || "-"}</option>
                            ) : availableModels.map((model) => (
                                <option key={model.id} value={model.id}>{model.id}</option>
                            ))}
                        </UiSelect>
                        <div className="ai-chat-settings-desc">{i18n.t("aiChatPlugin.modelLoadHint")}</div>
                        <UiTextInput
                            className="ai-chat-settings-input"
                            controlSize="compact"
                            variant="settings"
                            type="text"
                            value={activeProvider?.model ?? ""}
                            onChange={(event) => {
                                updateActiveProvider((provider) => ({
                                    ...provider,
                                    model: event.target.value,
                                }));
                            }}
                        />
                    </div>

                    {selectedVendor?.fields.map((field) => (
                        <div
                            key={field.key}
                            className="ai-chat-settings-row"
                            data-ai-chat-settings-field={field.key}
                            data-settings-focus-target={field.key === "apiKey" ? AI_CHAT_SETTINGS_API_KEY_FOCUS_TARGET : undefined}
                        >
                            <div className="ai-chat-settings-label">{field.label}</div>
                            <div className="ai-chat-settings-desc">{field.description}</div>
                            <UiTextInput
                                className="ai-chat-settings-input"
                                controlSize="compact"
                                variant="settings"
                                type={field.fieldType}
                                required={field.required}
                                placeholder={field.placeholder ?? undefined}
                                value={activeProvider?.fieldValues[field.key] ?? ""}
                                onChange={(event) => {
                                    updateFieldValue(field.key, event.target.value);
                                }}
                            />
                        </div>
                    ))}

                    <div className="ai-chat-settings-row">
                        <div className="ai-chat-settings-label">{i18n.t("aiChatPlugin.contextBudgetTitle")}</div>
                        <div className="ai-chat-settings-desc">{i18n.t("aiChatPlugin.contextBudgetDescription")}</div>
                        <label className="ai-chat-settings-checkbox-row">
                            <input
                                type="checkbox"
                                checked={contextBudgetSettings.autoCompressContext}
                                onChange={(event) => {
                                    updateAutoCompressContext(event.target.checked);
                                }}
                            />
                            <span>{i18n.t("aiChatPlugin.autoCompressContextLabel")}</span>
                        </label>
                        <UiNumberInput
                            className="ai-chat-settings-input"
                            controlSize="compact"
                            variant="settings"
                            min={1000}
                            max={1000000}
                            step={1000}
                            value={contextBudgetSettings.contextLimitTokens}
                            onValueChange={(nextValue) => {
                                updateContextLimitTokens(nextValue);
                            }}
                        />
                        <div className="ai-chat-settings-desc">{i18n.t("aiChatPlugin.contextBudgetHint")}</div>
                    </div>

                    <div className="ai-chat-settings-actions">
                        <div className={`ai-chat-settings-feedback ${feedbackIsError ? "error" : ""}`}>
                            {feedback ?? `${i18n.t("aiChatPlugin.configuredVendor")}: ${activeProvider?.title ?? selectedVendor?.title ?? "-"}`}
                        </div>
                        <UiButton
                            className="ai-chat-settings-save"
                            variant="primary"
                            disabled={isSaving}
                            onClick={() => {
                                void handleSave();
                            }}
                        >
                            {isSaving ? i18n.t("aiChatPlugin.sending") : i18n.t("aiChatPlugin.save")}
                        </UiButton>
                    </div>
                </div>
            </div>
        </div>
    );

    const settingsPanel = props.pane === "tool-approval" ? (
        <div className="settings-item-group ai-chat-settings-form ai-chat-tool-approval-section">
            <div className="ai-chat-settings-row ai-chat-settings-tool-policy-header">
                <div className="ai-chat-settings-label">{i18n.t("aiChatPlugin.toolApprovalTitle")}</div>
                <div className="ai-chat-settings-desc">{i18n.t("aiChatPlugin.toolApprovalDescription")}</div>
            </div>

            <div className="ai-chat-settings-tool-policy-list">
                {toolPolicyRows.map((tool) => {
                    const policy = settings.toolApprovalPolicy?.[tool.capabilityId];
                    const selectedMode: AiToolApprovalMode = policy === "require"
                        ? "require"
                        : policy === "auto"
                            ? "auto"
                            : "default";

                    return (
                        <div key={tool.capabilityId} className="ai-chat-settings-tool-policy-row">
                            <div className="ai-chat-settings-tool-policy-meta">
                                <div className="ai-chat-settings-tool-policy-name">
                                    {tool.capabilityId}
                                </div>
                                <div className="ai-chat-settings-tool-policy-desc">
                                    {tool.description}
                                </div>
                            </div>
                            <UiSelect
                                className="ai-chat-settings-tool-policy-select"
                                value={selectedMode}
                                onChange={(event) => {
                                    updateToolApprovalMode(tool.capabilityId, event.target.value as AiToolApprovalMode);
                                }}
                            >
                                <option value="default">{i18n.t("aiChatPlugin.toolApprovalDefault")}</option>
                                <option value="require">{i18n.t("aiChatPlugin.toolApprovalRequire")}</option>
                                <option value="auto">{i18n.t("aiChatPlugin.toolApprovalAuto")}</option>
                            </UiSelect>
                        </div>
                    );
                })}
            </div>
            <div className="ai-chat-settings-actions">
                <div className={`ai-chat-settings-feedback ${feedbackIsError ? "error" : ""}`}>
                    {feedback ?? i18n.t("aiChatPlugin.toolApprovalDescription")}
                </div>
                <UiButton
                    className="ai-chat-settings-save"
                    variant="primary"
                    disabled={isSaving}
                    onClick={() => {
                        void handleSave();
                    }}
                >
                    {isSaving ? i18n.t("aiChatPlugin.sending") : i18n.t("aiChatPlugin.save")}
                </UiButton>
            </div>
        </div>
    ) : providerSettingsPanel;

    return (
        <>
        {settingsPanel}
        <UiModal
            ariaLabel={i18n.t("aiChatPlugin.providerAdd")}
            className="ai-chat-provider-modal-backdrop"
            closeLabel={i18n.t("common.cancel")}
            description={i18n.t("aiChatPlugin.providerDescription")}
            footer={(
                <>
                    <UiButton
                        className="ai-chat-settings-mini-button"
                        controlSize="compact"
                        onClick={() => {
                            setProviderModalOpen(false);
                        }}
                    >
                        {i18n.t("common.cancel")}
                    </UiButton>
                    <UiButton className="ai-chat-settings-save" type="submit" variant="primary">
                        {i18n.t("aiChatPlugin.providerAdd")}
                    </UiButton>
                </>
            )}
            isOpen={providerModalOpen}
            onClose={() => {
                setProviderModalOpen(false);
            }}
            onSubmit={handleConfirmAddProvider}
            panelClassName="ai-chat-provider-modal"
            size="sm"
            title={i18n.t("aiChatPlugin.providerAdd")}
        >
            <UiField label={i18n.t("aiChatPlugin.providerNameLabel")}>
                <UiTextInput
                    className="ai-chat-settings-input"
                    controlSize="compact"
                    variant="settings"
                    type="text"
                    value={providerDraftTitle}
                    placeholder={selectedVendor?.title ?? i18n.t("aiChatPlugin.providerLabel")}
                    onChange={(event) => {
                        setProviderDraftTitle(event.target.value);
                    }}
                />
            </UiField>

            <UiField label={i18n.t("aiChatPlugin.vendorLabel")}>
                <UiSelect
                    value={providerDraftVendorId}
                    onChange={(event) => {
                        setProviderDraftVendorId(event.target.value);
                    }}
                >
                    {vendorCatalog.map((vendor) => (
                        <option key={vendor.id} value={vendor.id}>{vendor.title}</option>
                    ))}
                </UiSelect>
            </UiField>
        </UiModal>
        </>
    );
}

function registerAiChatSettingsSection(): () => void {
    const unregisterSection = registerSettingsSection({
        id: AI_CHAT_PANEL_ID,
        title: "settings.aiSection",
        order: 45,
        exposeItemsInNavigation: true,
    });

    const unregisterItems = [
        registerSettingsItem({
            id: AI_CHAT_PROVIDER_SETTINGS_ITEM_ID, sectionId: AI_CHAT_PANEL_ID, order: 10, kind: "custom",
            title: "aiChatPlugin.providerLabel", description: "aiChatPlugin.providerDescription",
            searchTerms: ["provider", "model", "vendor", "api key", "base url", "ai", "模型", "供应商", "密钥"],
            render: () => <AiChatSettingsSection pane="provider" />,
        }),
        registerSettingsItem({
            id: AI_CHAT_TOOL_APPROVAL_SETTINGS_ITEM_ID, sectionId: AI_CHAT_PANEL_ID, order: 30, kind: "custom",
            title: "aiChatPlugin.toolApprovalTitle", description: "aiChatPlugin.toolApprovalDescription",
            searchTerms: ["tool", "approval", "permission", "capability", "ai", "工具", "审批", "权限"],
            render: () => <AiChatSettingsSection pane="tool-approval" />,
        }),
    ];

    return () => {
        unregisterItems.forEach((unregister) => unregister());
        unregisterSection();
    };
}

/**
 * @function activatePlugin
 * @description 注册 AI 聊天 panel、activity 图标，以及 AI chat 插件拥有的 settings store。
 * @returns 插件清理函数。
 */
export function activatePlugin(): () => void {
    startAiChatStreamEventHub();

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
        render: (context) => <AiChatView panelContext={context} />,
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

    const unregisterAiChatSettingsStore = registerAiChatSettingsManagedStore({
        registerSettingsSection: () => registerAiChatSettingsSection(),
    });
    const unregisterAiChatRuntimeStore = registerAiChatRuntimeManagedStore();

    console.info("[aiChatPlugin] registered ai chat plugin");

    return () => {
        stopAiChatStreamEventHub();
        unregisterAiChatRuntimeStore();
        unregisterAiChatSettingsStore();
        unregisterConvertibleView();
        unregisterPanel();
        unregisterActivity();
        unregisterTabComponent();
        console.info("[aiChatPlugin] unregistered ai chat plugin");
    };
}
