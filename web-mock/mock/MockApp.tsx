/**
 * @module web-mock/mock/MockApp
 * @description 前端 Mock 测试页：复用主应用布局和编辑器，不依赖 Tauri 后端。
 * @dependencies
 *  - react
 *  - lucide-react
 *  - ../../src/host/layout
 *  - ../../src/host/registry
 *  - ./MockVaultPanel
 */

import React, { useEffect, useMemo, useState, type ChangeEvent, type ReactNode } from "react";
import { CalendarDays, CheckSquare, Compass, FolderOpen, Hand, Plus, Workflow } from "lucide-react";
import { WorkbenchLayoutHost } from "../../src/host/layout";
import { buildGlassRuntimeStyle } from "../../src/host/layout/glassRuntimeStyle";
import { CodeMirrorEditorTab } from "../../src/plugins/markdown-codemirror/editor/CodeMirrorEditorTab";
import { CanvasTab } from "../../src/plugins/canvas/CanvasTab";
import { ImageViewerTab } from "../../src/plugins/image-viewer/tab/ImageViewerTab";
import { CalendarPanel } from "../../src/plugins/calendar/CalendarPanel";
import { CalendarTab } from "../../src/plugins/calendar/CalendarTab";
import { TaskBoardTab } from "../../src/plugins/tasks/task-board/TaskBoardTab";
import { activatePlugin as activateCommandPalettePlugin } from "../../src/plugins/command-palette/commandPalettePlugin";
import { activatePlugin as activateQuickSwitcherPlugin } from "../../src/plugins/quick-switcher/quickSwitcherPlugin";
import { activatePlugin as activateSearchPlugin } from "../../src/plugins/search/searchPlugin";
import { activatePlugin as activateAiChatPlugin } from "../../src/plugins/ai-chat/aiChatPlugin";
import { activatePlugin as activateProjectReaderPlugin } from "../../src/plugins/project-reader/projectReaderPlugin";
import { activatePlugin as activateAgentSkillsPlugin } from "../../src/plugins/agent-skills/agentSkillsPlugin";
import { activatePlugin as activateBacklinksPlugin } from "../../src/plugins/backlinks/backlinksPlugin";
import { activatePlugin as activateKnowledgeGraphPlugin } from "../../src/plugins/knowledge-graph/knowledgeGraphPlugin";
import { OutlinePanelPlugin } from "../../src/plugins/outline/outlinePlugin";
import { SettingsTab } from "../../src/host/layout/SettingsTab";
import { useConfigSync } from "../../src/host/config/configStore";
import { useVaultTreeSync } from "../../src/host/vault/vaultStore";
import { useAutoSaveLifecycle } from "../../src/host/editor/autoSaveService";
import { registerCommands } from "../../src/host/commands/commandSystem";
import { registerActivity } from "../../src/host/registry/activityRegistry";
import { registerFileOpener } from "../../src/host/registry/fileOpenerRegistry";
import { registerPanel } from "../../src/host/registry/panelRegistry";
import { registerTabComponent } from "../../src/host/registry/tabComponentRegistry";
import { buildFileTabId, joinVaultAbsolutePath, normalizeRelativePath } from "../../src/host/layout/openFileService";
import { publishNotification } from "../../src/host/notifications/notificationCenter";
import { readVaultCanvasFile, readVaultMarkdownFile, setCurrentVault, type VaultConfig } from "../../src/api/vaultApi";
import type {
    AiChatHistoryState,
    AiChatSettings,
    AiChatStreamEventPayload,
    AiToolDescriptor,
    AiVendorDefinition,
    BrowserMockAiRuntime,
    StartAiChatStreamOptions,
} from "../../src/api/aiApi";
import { MockVaultPanel } from "./MockVaultPanel";
import "../../src/plugins/ai-chat/aiChatPlugin.css";
import "../../src/plugins/backlinks/backlinksPlugin.css";
import "../../src/plugins/outline/outlinePlugin.css";
import "../../src/App.css";

const MOCK_VAULT_PATH = "/mock/notes";
const CALENDAR_ACTIVITY_ID = "calendar";
const CALENDAR_PANEL_ID = "calendar-panel";
const MOCK_CALENDAR_TAB_COMPONENT_ID = "calendar-tab";
const MOCK_ARCHITECTURE_COMPONENT_ID = "architecture-devtools";
const TASK_BOARD_ACTIVITY_ID = "task-board";
const MOCK_TASK_BOARD_COMPONENT_ID = "task-board-tab";
const LOG_NOTIFICATION_TEST_ACTIVITY_ID = "log-notification-test-activity";

/**
 * @function isMockMarkdownPath
 * @description 判断 mock 工作区文件是否应交由 CodeMirror Markdown opener 打开。
 * @param relativePath 工作区相对路径。
 * @returns 是否为 Markdown 文件。
 */
function isMockMarkdownPath(relativePath: string): boolean {
    const normalizedPath = relativePath.toLowerCase();
    return normalizedPath.endsWith(".md") || normalizedPath.endsWith(".markdown");
}

function isMockCanvasPath(relativePath: string): boolean {
    return relativePath.toLowerCase().endsWith(".canvas");
}

function isMockImagePath(relativePath: string): boolean {
    return /\.(png|jpg|jpeg|gif|webp|bmp|svg|ico)$/i.test(relativePath);
}

function resolveMockVaultPath(): string {
    if (typeof window === "undefined") {
        return MOCK_VAULT_PATH;
    }

    const params = new URLSearchParams(window.location.search);
    const queryVaultPath = params.get("mockVaultPath")?.trim();
    if (queryVaultPath) {
        return queryVaultPath;
    }

    const persistedVaultPath = window.localStorage.getItem("ofive:last-vault-path")?.trim();
    return persistedVaultPath || MOCK_VAULT_PATH;
}

type MockPlatform = "windows" | "macos";
type MockThemeMode = "dark" | "light" | "kraft";

declare global {
    interface Window {
        __OFIVE_BROWSER_MOCK_AI__?: BrowserMockAiRuntime;
    }
}

/**
 * @function readSearchParam
 * @description 读取 mock 页面 query 参数。
 * @param key 参数名。
 * @returns 参数值。
 */
function readSearchParam(key: string): string | null {
    if (typeof window === "undefined") {
        return null;
    }

    return new URLSearchParams(window.location.search).get(key);
}

/**
 * @function resolveInitialMockPlatform
 * @description 解析 mock 页面初始平台。
 * @returns 平台标识。
 */
function resolveInitialMockPlatform(): MockPlatform {
    return readSearchParam("platform") === "windows" ? "windows" : "macos";
}

/**
 * @function resolveInitialThemeMode
 * @description 解析 mock 页面初始主题。
 * @returns 主题标识。
 */
function resolveInitialThemeMode(): MockThemeMode {
    const raw = readSearchParam("theme");
    if (raw === "light" || raw === "kraft") {
        return raw;
    }
    return "dark";
}

/**
 * @function resolveInitialBooleanFlag
 * @description 解析 mock 页面布尔型 query 参数。
 * @param key 参数名。
 * @param fallback 默认值。
 * @returns 布尔结果。
 */
function resolveInitialBooleanFlag(key: string, fallback: boolean): boolean {
    const raw = readSearchParam(key);
    if (raw === null) {
        return fallback;
    }

    return raw === "1" || raw === "true";
}

/**
 * @function resolveInitialNumberFlag
 * @description 解析 mock 页面数值型 query 参数。
 * @param key 参数名。
 * @param fallback 默认值。
 * @returns 数值结果。
 */
function resolveInitialNumberFlag(key: string, fallback: number): number {
    const rawValue = readSearchParam(key);
    if (rawValue === null) {
        return fallback;
    }

    const raw = Number(rawValue);
    if (!Number.isFinite(raw)) {
        return fallback;
    }

    return raw;
}

/**
 * @function resolveShouldShowControls
 * @description 解析是否展示 mock 调参控制面板。
 *   自动化环境下默认隐藏，避免遮挡右侧活动栏和面板交互。
 *   如需手动调试，可通过 `?showControls=1` 强制显示。
 * @returns 是否展示控制面板。
 */
function resolveShouldShowControls(): boolean {
    const raw = readSearchParam("showControls");
    if (raw !== null) {
        return raw === "1" || raw === "true";
    }

    if (typeof navigator !== "undefined" && navigator.webdriver) {
        return false;
    }

    return true;
}

function MockWorkbenchPlaceholder(props: {
    title: string;
    description: string;
    points: string[];
}): ReactNode {
    return (
        <div
            style={{
                display: "grid",
                gap: 18,
                height: "100%",
                padding: 24,
                background: "linear-gradient(180deg, rgba(20, 34, 60, 0.32), rgba(6, 12, 24, 0.08))",
            }}
        >
            <div>
                <h2 style={{ margin: 0, fontSize: 24 }}>{props.title}</h2>
                <p style={{ margin: "8px 0 0", color: "var(--text-secondary)", lineHeight: 1.6 }}>
                    {props.description}
                </p>
            </div>
            <div
                style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                    gap: 12,
                    alignSelf: "start",
                }}
            >
                {props.points.map((point) => (
                    <div
                        key={point}
                        style={{
                            minHeight: 96,
                            padding: 14,
                            borderRadius: 14,
                            border: "1px solid rgba(255, 255, 255, 0.12)",
                            background: "rgba(15, 23, 42, 0.2)",
                            boxShadow: "inset 0 1px 0 rgba(255, 255, 255, 0.08)",
                            lineHeight: 1.5,
                        }}
                    >
                        {point}
                    </div>
                ))}
            </div>
        </div>
    );
}

function MockArchitectureDevtoolsTab(): ReactNode {
    return (
        <MockWorkbenchPlaceholder
            title="Architecture Devtools"
            description="这里保留真实 Tauri 左侧入口的位置和图标，用来验证活动栏密度、拖拽和主区切换。"
            points={[
                "Plugin inventory",
                "Event dependency graph",
                "Workbench host contract inspection",
            ]}
        />
    );
}

function emitMockGreetingNotification(): void {
    publishNotification({
        level: "info",
        title: "Test Message",
        message: "greet",
        source: "module",
    });
}

const MOCK_AI_VENDOR: AiVendorDefinition = {
    id: "browser-mock",
    title: "Browser Mock",
    description: "Mock AI vendor for web interaction tests.",
    defaultModel: "mock-fast",
    fields: [
        {
            key: "token",
            label: "Token",
            description: "Mock token.",
            fieldType: "password",
            required: false,
            placeholder: null,
            defaultValue: "mock-token",
        },
    ],
};

const MOCK_ANTHROPIC_VENDOR: AiVendorDefinition = {
    id: "anthropic-compatible",
    title: "Anthropic Compatible",
    description: "Mock Anthropic-compatible provider for settings tests.",
    defaultModel: "claude-sonnet-4-5",
    fields: [
        {
            key: "apiKey",
            label: "API Key",
            description: "Mock Anthropic-compatible API key.",
            fieldType: "password",
            required: true,
            placeholder: "mock-anthropic-key",
            defaultValue: null,
        },
        {
            key: "endpoint",
            label: "Endpoint",
            description: "Mock Anthropic-compatible endpoint.",
            fieldType: "text",
            required: false,
            placeholder: "https://api.anthropic.com",
            defaultValue: "https://api.anthropic.com",
        },
        {
            key: "anthropicVersion",
            label: "Anthropic Version",
            description: "Mock anthropic-version header.",
            fieldType: "text",
            required: false,
            placeholder: "2023-06-01",
            defaultValue: "2023-06-01",
        },
    ],
};

const MOCK_OPENAI_VENDOR: AiVendorDefinition = {
    id: "openai-compatible",
    title: "OpenAI Compatible",
    description: "Mock OpenAI-compatible provider for settings tests.",
    defaultModel: "gpt-4.1",
    fields: [
        {
            key: "apiKey",
            label: "API Key",
            description: "Mock OpenAI-compatible API key.",
            fieldType: "password",
            required: true,
            placeholder: "mock-openai-key",
            defaultValue: null,
        },
        {
            key: "baseUrl",
            label: "Base URL",
            description: "Mock OpenAI-compatible base URL.",
            fieldType: "text",
            required: false,
            placeholder: "https://api.openai.com/v1",
            defaultValue: "https://api.openai.com/v1",
        },
    ],
};

const MOCK_AI_TOOLS: AiToolDescriptor[] = [
    {
        capabilityId: "vault.read_markdown_file",
        apiVersion: "v1",
        name: "vault_read_markdown_file",
        description: "Read a markdown file from the active vault.",
        inputSchema: {},
        outputSchema: {},
        riskLevel: "low",
        requiresConfirmation: false,
    },
    {
        capabilityId: "vault.apply_markdown_patch",
        apiVersion: "v1",
        name: "vault_apply_markdown_patch",
        description: "Apply a markdown patch to the active vault.",
        inputSchema: {},
        outputSchema: {},
        riskLevel: "medium",
        requiresConfirmation: true,
    },
    {
        capabilityId: "project_reader.list_projects",
        apiVersion: "v1",
        name: "project_reader_list_projects",
        description: "List imported external projects.",
        inputSchema: {},
        outputSchema: {},
        riskLevel: "low",
        requiresConfirmation: false,
    },
    {
        capabilityId: "project_reader.get_project_tree",
        apiVersion: "v1",
        name: "project_reader_get_project_tree",
        description: "Read the cached file tree for an imported project.",
        inputSchema: {},
        outputSchema: {},
        riskLevel: "low",
        requiresConfirmation: false,
    },
    {
        capabilityId: "project_reader.read_project_file",
        apiVersion: "v1",
        name: "project_reader_read_project_file",
        description: "Read a file from an imported project.",
        inputSchema: {},
        outputSchema: {},
        riskLevel: "low",
        requiresConfirmation: false,
    },
    {
        capabilityId: "project_reader.resolve_symbol",
        apiVersion: "v1",
        name: "project_reader_resolve_symbol",
        description: "Resolve a symbol inside an imported project.",
        inputSchema: {},
        outputSchema: {},
        riskLevel: "low",
        requiresConfirmation: false,
    },
];

function createInitialMockAiSettings(): AiChatSettings {
    if (resolveInitialBooleanFlag("mockAiMissingApiKey", false)) {
        return {
            vendorId: MOCK_OPENAI_VENDOR.id,
            model: MOCK_OPENAI_VENDOR.defaultModel,
            fieldValues: {
                baseUrl: "https://api.openai.com/v1",
            },
            activeProviderId: "mock-provider-openai-missing-key",
            providers: [{
                id: "mock-provider-openai-missing-key",
                vendorId: MOCK_OPENAI_VENDOR.id,
                title: MOCK_OPENAI_VENDOR.title,
                model: MOCK_OPENAI_VENDOR.defaultModel,
                fieldValues: {
                    baseUrl: "https://api.openai.com/v1",
                },
            }],
            toolApprovalPolicy: {},
        };
    }

    return {
        vendorId: MOCK_AI_VENDOR.id,
        model: MOCK_AI_VENDOR.defaultModel,
        fieldValues: {
            token: "mock-token",
        },
        activeProviderId: "mock-provider-default",
        providers: [{
            id: "mock-provider-default",
            vendorId: MOCK_AI_VENDOR.id,
            title: MOCK_AI_VENDOR.title,
            model: MOCK_AI_VENDOR.defaultModel,
            fieldValues: {
                token: "mock-token",
            },
        }],
        toolApprovalPolicy: {},
    };
}

function createMockAiRuntime(): BrowserMockAiRuntime {
    let settings: AiChatSettings = createInitialMockAiSettings();
    let history: AiChatHistoryState = {
        activeConversationId: null,
        conversations: [],
    };
    const listeners = new Set<(payload: AiChatStreamEventPayload) => void>();
    const timersByStreamId = new Map<string, number[]>();
    let streamSequence = 1;

    const emit = (payload: AiChatStreamEventPayload): void => {
        listeners.forEach((listener) => {
            listener(payload);
        });
    };

    const schedule = (streamId: string, callback: () => void, delayMs: number): void => {
        const timer = window.setTimeout(callback, delayMs);
        timersByStreamId.set(streamId, [...(timersByStreamId.get(streamId) ?? []), timer]);
    };

    return {
        getAiVendorCatalog: () => [MOCK_AI_VENDOR, MOCK_ANTHROPIC_VENDOR, MOCK_OPENAI_VENDOR],
        getAiToolCatalog: () => MOCK_AI_TOOLS,
        getAiChatSettings: () => settings,
        getAiChatHistory: () => history,
        getAiVendorModels: (targetSettings) => {
            const activeProvider = targetSettings.providers?.find((provider) => provider.id === targetSettings.activeProviderId)
                ?? targetSettings.providers?.[0]
                ?? null;
            const vendorId = activeProvider?.vendorId ?? targetSettings.vendorId;
            if (vendorId === "openai-compatible") {
                return [
                    { id: "gpt-4.1", object: "model", ownedBy: "openai", created: null },
                    { id: "gpt-4o", object: "model", ownedBy: "openai", created: null },
                ];
            }
            if (vendorId === "anthropic-compatible") {
                return [
                    { id: "claude-sonnet-4-5", object: "model", ownedBy: "anthropic", created: null },
                    { id: "claude-opus-4-1", object: "model", ownedBy: "anthropic", created: null },
                ];
            }
            return [
                { id: "mock-fast", object: "model", ownedBy: "ofive", created: null },
                { id: "mock-deep", object: "model", ownedBy: "ofive", created: null },
            ];
        },
        saveAiChatSettings: (nextSettings) => {
            settings = nextSettings;
            return settings;
        },
        saveAiChatHistory: (nextHistory) => {
            history = nextHistory;
            return history;
        },
        startAiChatStream: async (options: StartAiChatStreamOptions) => {
            const streamId = `mock-ai-stream-${streamSequence++}`;
            const sessionId = options.sessionId ?? "mock-session";
            const reply = `Mock response for: ${options.message}`;
            const normalizedMessage = options.message.toLowerCase();
            const context = options.contextSnapshotJson
                ? JSON.parse(options.contextSnapshotJson) as { openTabs?: unknown[]; activeFile?: { path?: string } | null }
                : null;
            const contextText = context
                ? `\nContext active: ${context.activeFile?.path ?? "none"} tabs=${context.openTabs?.length ?? 0}`
                : "";
            const accumulatedText = `${reply}${contextText}`;
            const shouldEmitToolRecord = normalizedMessage.includes("tool record");
            const shouldEmitConfirmation = normalizedMessage.includes("approval menu");

            await new Promise((resolve) => window.setTimeout(resolve, 40));

            if (shouldEmitConfirmation) {
                schedule(streamId, () => {
                    emit({
                        streamId,
                        eventType: "confirmation",
                        sessionId,
                        agentName: "browser-mock-ai",
                        deltaText: null,
                        accumulatedText: null,
                        reasoningDeltaText: null,
                        reasoningAccumulatedText: "Waiting for approval.",
                        historyContentBlocksJson: null,
                        debugTitle: null,
                        debugLevel: null,
                        debugText: null,
                        confirmationId: `confirm-${streamId}`,
                        confirmationHint: "Approve mock markdown patch?",
                        confirmationToolName: "vault.apply_markdown_patch",
                        confirmationToolArgsJson: JSON.stringify({
                            relativePath: "mock/article.md",
                            unifiedDiff: [
                                "--- a/mock/article.md",
                                "+++ b/mock/article.md",
                                "@@ -1,1 +1,1 @@",
                                "-old",
                                "+new",
                            ].join("\n"),
                        }),
                        error: null,
                        done: false,
                    });
                    timersByStreamId.delete(streamId);
                }, 90);
                return { streamId };
            }

            if (shouldEmitToolRecord) {
                schedule(streamId, () => {
                    emit({
                        streamId,
                        eventType: "debug",
                        sessionId,
                        agentName: "browser-mock-ai",
                        deltaText: null,
                        accumulatedText: null,
                        reasoningDeltaText: null,
                        reasoningAccumulatedText: null,
                        historyContentBlocksJson: null,
                        debugTitle: "Capability call started",
                        debugLevel: "info",
                        debugText: "capability=vault.read_markdown_file input={\"relativePath\":\"mock/article.md\"}",
                        confirmationId: null,
                        confirmationHint: null,
                        confirmationToolName: null,
                        confirmationToolArgsJson: null,
                        error: null,
                        done: false,
                    });
                }, 90);

                schedule(streamId, () => {
                    emit({
                        streamId,
                        eventType: "debug",
                        sessionId,
                        agentName: "browser-mock-ai",
                        deltaText: null,
                        accumulatedText: null,
                        reasoningDeltaText: null,
                        reasoningAccumulatedText: null,
                        historyContentBlocksJson: null,
                        debugTitle: "Capability call completed",
                        debugLevel: "info",
                        debugText: "capability=vault.read_markdown_file output={\"content\":\"mock content\"}",
                        confirmationId: null,
                        confirmationHint: null,
                        confirmationToolName: null,
                        confirmationToolArgsJson: null,
                        error: null,
                        done: false,
                    });
                }, 300);

                schedule(streamId, () => {
                    emit({
                        streamId,
                        eventType: "debug",
                        sessionId,
                        agentName: "browser-mock-ai",
                        deltaText: null,
                        accumulatedText: null,
                        reasoningDeltaText: null,
                        reasoningAccumulatedText: null,
                        historyContentBlocksJson: null,
                        debugTitle: "Capability call started",
                        debugLevel: "info",
                        debugText: "capability=vault.read_markdown_file input={\"relativePath\":\"mock/second.md\"}",
                        confirmationId: null,
                        confirmationHint: null,
                        confirmationToolName: null,
                        confirmationToolArgsJson: null,
                        error: null,
                        done: false,
                    });
                }, 340);

                schedule(streamId, () => {
                    emit({
                        streamId,
                        eventType: "debug",
                        sessionId,
                        agentName: "browser-mock-ai",
                        deltaText: null,
                        accumulatedText: null,
                        reasoningDeltaText: null,
                        reasoningAccumulatedText: null,
                        historyContentBlocksJson: null,
                        debugTitle: "Capability call completed",
                        debugLevel: "info",
                        debugText: "capability=vault.read_markdown_file output={\"content\":\"second mock content\"}",
                        confirmationId: null,
                        confirmationHint: null,
                        confirmationToolName: null,
                        confirmationToolArgsJson: null,
                        error: null,
                        done: false,
                    });
                }, 430);
            }

            schedule(streamId, () => {
                emit({
                    streamId,
                    eventType: "delta",
                    sessionId,
                    agentName: "browser-mock-ai",
                    deltaText: reply,
                    accumulatedText: reply,
                    reasoningDeltaText: "Inspecting mock context.",
                    reasoningAccumulatedText: "Inspecting mock context.",
                    historyContentBlocksJson: null,
                    debugTitle: null,
                    debugLevel: null,
                    debugText: null,
                    confirmationId: null,
                    confirmationHint: null,
                    confirmationToolName: null,
                    confirmationToolArgsJson: null,
                    error: null,
                    done: false,
                });
            }, 160);

            schedule(streamId, () => {
                emit({
                    streamId,
                    eventType: "done",
                    sessionId,
                    agentName: "browser-mock-ai",
                    deltaText: null,
                    accumulatedText,
                    reasoningDeltaText: null,
                    reasoningAccumulatedText: "Inspecting mock context.",
                    historyContentBlocksJson: JSON.stringify([
                        { kind: "thinking", text: "Inspecting mock context." },
                        { kind: "text", text: accumulatedText },
                    ]),
                    debugTitle: null,
                    debugLevel: null,
                    debugText: null,
                    confirmationId: null,
                    confirmationHint: null,
                    confirmationToolName: null,
                    confirmationToolArgsJson: null,
                    error: null,
                    done: true,
                });
                timersByStreamId.delete(streamId);
            }, 640);

            return { streamId };
        },
        stopAiChatStream: (streamId) => {
            for (const timer of timersByStreamId.get(streamId) ?? []) {
                window.clearTimeout(timer);
            }
            timersByStreamId.delete(streamId);
            emit({
                streamId,
                eventType: "stopped",
                sessionId: "mock-session",
                agentName: "browser-mock-ai",
                deltaText: null,
                accumulatedText: null,
                reasoningDeltaText: null,
                reasoningAccumulatedText: null,
                historyContentBlocksJson: null,
                debugTitle: null,
                debugLevel: null,
                debugText: null,
                confirmationId: null,
                confirmationHint: null,
                confirmationToolName: null,
                confirmationToolArgsJson: null,
                error: null,
                done: true,
            });
            return true;
        },
        submitAiChatConfirmation: (options) => {
            const streamId = `mock-ai-stream-${streamSequence++}`;
            const sessionId = options.sessionId ?? "mock-session";
            schedule(streamId, () => {
                emit({
                    streamId,
                    eventType: "done",
                    sessionId,
                    agentName: "browser-mock-ai",
                    deltaText: null,
                    accumulatedText: `Mock confirmation ${options.confirmed ? "approved" : "rejected"}.`,
                    reasoningDeltaText: null,
                    reasoningAccumulatedText: null,
                    historyContentBlocksJson: JSON.stringify([
                        { kind: "text", text: `Mock confirmation ${options.confirmed ? "approved" : "rejected"}.` },
                    ]),
                    debugTitle: null,
                    debugLevel: null,
                    debugText: null,
                    confirmationId: null,
                    confirmationHint: null,
                    confirmationToolName: null,
                    confirmationToolArgsJson: null,
                    error: null,
                    done: true,
                });
                timersByStreamId.delete(streamId);
            }, 80);
            return { streamId };
        },
        subscribeAiChatStreamEvents: (handler) => {
            listeners.add(handler);
            return () => {
                listeners.delete(handler);
            };
        },
    };
}

function seedMockVaultConfig(mockVaultPath: string): void {
    const storageKey = `ofive:browser-fallback:vault-config:${mockVaultPath}`;
    const existing = window.localStorage.getItem(storageKey);
    if (existing) {
        return;
    }

    const config: VaultConfig = {
        schemaVersion: 1,
        entries: {
            sidebarLayout: {
                version: 1,
                left: {
                    width: 260,
                    visible: true,
                    activeActivityId: "files",
                    activePanelId: "files",
                },
                right: {
                    width: 320,
                    visible: true,
                    activeActivityId: "ai-chat",
                    activePanelId: "ai-chat",
                },
            },
            featureSettings: {
                restoreWorkspaceLayout: false,
            },
        },
    };
    window.localStorage.setItem(storageKey, JSON.stringify(config));
}

let mockRegistered = false;
function ensureMockComponentsRegistered(): void {
    if (mockRegistered) return;
    mockRegistered = true;

    activateCommandPalettePlugin();
    activateQuickSwitcherPlugin();
    activateSearchPlugin();
    activateAiChatPlugin();
    activateProjectReaderPlugin();
    activateAgentSkillsPlugin();
    activateBacklinksPlugin();
    activateKnowledgeGraphPlugin();
    registerCommands([
        {
            id: "fileTree.deleteSelected",
            title: "commands.deleteSelectedFile",
            condition: "fileTreeFocused",
            shortcut: {
                defaultBinding: "Cmd+Backspace",
                editableInSettings: true,
            },
            async execute(context) {
                const selectedItem = context.getFileTreeSelectedItem?.() ?? null;
                if (!selectedItem) {
                    console.warn("[MockApp] fileTree.deleteSelected skipped: no selection");
                    return;
                }

                const confirmed = await context.requestDeleteConfirmation?.({
                    relativePath: selectedItem.path,
                    isDir: selectedItem.isDir,
                });
                if (!confirmed) {
                    console.info("[MockApp] fileTree.deleteSelected cancelled", selectedItem);
                    return;
                }

                console.info("[MockApp] fileTree.deleteSelected", selectedItem);
            },
        },
    ]);

    const filesIcon = React.createElement(FolderOpen, { size: 18, strokeWidth: 1.8 });
    const outlineIcon = React.createElement(Compass, { size: 18, strokeWidth: 1.8 });
    const calendarIcon = React.createElement(CalendarDays, { size: 18, strokeWidth: 1.8 });
    const architectureIcon = React.createElement(Workflow, { size: 18, strokeWidth: 1.8 });
    const taskBoardIcon = React.createElement(CheckSquare, { size: 18, strokeWidth: 1.8 });
    const logNotificationIcon = React.createElement(Hand, { size: 18, strokeWidth: 1.8 });

    registerActivity({
        type: "panel-container",
        id: "files",
        title: () => "资源管理器",
        icon: filesIcon,
        defaultSection: "top",
        defaultBar: "left",
        defaultOrder: 1,
    });
    registerActivity({
        type: "panel-container",
        id: "outline",
        title: () => "大纲",
        icon: outlineIcon,
        defaultSection: "top",
        defaultBar: "right",
        defaultOrder: 2,
    });
    registerActivity({
        type: "callback",
        id: CALENDAR_ACTIVITY_ID,
        title: () => "日历",
        icon: calendarIcon,
        defaultSection: "top",
        defaultBar: "left",
        defaultOrder: 4,
        onActivate: (context) => {
            context.openTab({
                id: CALENDAR_ACTIVITY_ID,
                title: "日历",
                component: MOCK_CALENDAR_TAB_COMPONENT_ID,
            });
        },
    });
    registerActivity({
        type: "callback",
        id: MOCK_ARCHITECTURE_COMPONENT_ID,
        title: () => "Architecture Devtools",
        icon: architectureIcon,
        defaultSection: "top",
        defaultBar: "left",
        defaultOrder: 5,
        onActivate: (context) => {
            context.openTab({
                id: MOCK_ARCHITECTURE_COMPONENT_ID,
                title: "Architecture Devtools",
                component: MOCK_ARCHITECTURE_COMPONENT_ID,
            });
        },
    });
    registerActivity({
        type: "callback",
        id: TASK_BOARD_ACTIVITY_ID,
        title: () => "任务看板",
        icon: taskBoardIcon,
        defaultSection: "top",
        defaultBar: "left",
        defaultOrder: 6,
        onActivate: (context) => {
            context.openTab({
                id: TASK_BOARD_ACTIVITY_ID,
                title: "任务看板",
                component: MOCK_TASK_BOARD_COMPONENT_ID,
            });
        },
    });
    registerActivity({
        type: "callback",
        id: LOG_NOTIFICATION_TEST_ACTIVITY_ID,
        title: () => "Test Message",
        icon: logNotificationIcon,
        defaultSection: "bottom",
        defaultBar: "left",
        defaultOrder: 999,
        onActivate: () => {
            emitMockGreetingNotification();
        },
    });

    registerPanel({
        id: "files",
        title: () => "资源管理器",
        activityId: "files",
        defaultPosition: "left",
        defaultOrder: 1,
        render: (ctx) => React.createElement(MockVaultPanel, { openFile: ctx.openFile, openTab: ctx.openTab }),
    });
    registerPanel({
        id: "outline",
        title: () => "大纲",
        activityId: "outline",
        defaultPosition: "right",
        defaultOrder: 1,
        render: () => React.createElement(OutlinePanelPlugin),
    });
    registerPanel({
        id: CALENDAR_PANEL_ID,
        title: () => "日历",
        activityId: CALENDAR_ACTIVITY_ID,
        defaultPosition: "right",
        defaultOrder: 2,
        render: (context) => React.createElement(CalendarPanel, context),
    });
    registerTabComponent({
        id: "codemirror",
        component: CodeMirrorEditorTab as never,
        lifecycleScope: "vault",
        deferPresentationUntilReady: true,
        showNavigationControls: true,
    });
    registerTabComponent({ id: "canvas", component: CanvasTab as never, lifecycleScope: "vault" });
    registerTabComponent({ id: "imageviewer", component: ImageViewerTab as never, lifecycleScope: "vault" });
    registerTabComponent({ id: MOCK_CALENDAR_TAB_COMPONENT_ID, component: CalendarTab as never, lifecycleScope: "vault" });
    registerTabComponent({ id: MOCK_ARCHITECTURE_COMPONENT_ID, component: MockArchitectureDevtoolsTab as never, lifecycleScope: "global" });
    registerTabComponent({ id: MOCK_TASK_BOARD_COMPONENT_ID, component: TaskBoardTab as never, lifecycleScope: "vault" });
    registerTabComponent({ id: "settings", component: SettingsTab as never, lifecycleScope: "global" });
    registerFileOpener({
        id: "mock.markdown.codemirror",
        label: "Mock CodeMirror Markdown Editor",
        kind: "markdown",
        priority: 100,
        matches: ({ relativePath }) => isMockMarkdownPath(relativePath),
        async resolveTab({ relativePath, contentOverride }) {
            const normalizedPath = normalizeRelativePath(relativePath);
            const content = typeof contentOverride === "string"
                ? contentOverride
                : await readVaultMarkdownFile(normalizedPath).then((result) => result.content);

            return {
                id: buildFileTabId(normalizedPath),
                title: normalizedPath.split("/").pop() ?? normalizedPath,
                component: "codemirror",
                params: {
                    path: normalizedPath,
                    content,
                },
            };
        },
    });
    registerFileOpener({
        id: "mock.canvas.default-viewer",
        label: "Mock Canvas",
        kind: "canvas",
        priority: 100,
        matches: ({ relativePath }) => isMockCanvasPath(relativePath),
        async resolveTab({ relativePath, contentOverride }) {
            const normalizedPath = normalizeRelativePath(relativePath);
            const content = typeof contentOverride === "string"
                ? contentOverride
                : await readVaultCanvasFile(normalizedPath).then((result) => result.content);

            return {
                id: buildFileTabId(normalizedPath),
                title: normalizedPath.split("/").pop() ?? normalizedPath,
                component: "canvas",
                params: {
                    path: normalizedPath,
                    content,
                },
            };
        },
    });
    registerFileOpener({
        id: "mock.image.default-viewer",
        label: "Mock Image Viewer",
        kind: "image",
        priority: 100,
        matches: ({ relativePath }) => isMockImagePath(relativePath),
        async resolveTab({ relativePath, currentVaultPath }) {
            const normalizedPath = normalizeRelativePath(relativePath);
            return {
                id: buildFileTabId(normalizedPath),
                title: normalizedPath.split("/").pop() ?? normalizedPath,
                component: "imageviewer",
                params: {
                    path: normalizedPath,
                    absolutePath: joinVaultAbsolutePath(currentVaultPath, normalizedPath),
                },
            };
        },
    });

    console.info("[MockApp] mock components registered");
}

export function MockApp(): ReactNode {
    const mockVaultPath = useMemo(() => resolveMockVaultPath(), []);
    const mockAiRuntime = useMemo(() => createMockAiRuntime(), []);
    const showControls = useMemo(() => resolveShouldShowControls(), []);
    const [platform, setPlatform] = useState<MockPlatform>(() => resolveInitialMockPlatform());
    const [themeMode, setThemeMode] = useState<MockThemeMode>(() => resolveInitialThemeMode());
    const [glassEnabled, setGlassEnabled] = useState<boolean>(() => resolveInitialBooleanFlag("glass", true));
    const [inactive, setInactive] = useState<boolean>(() => resolveInitialBooleanFlag("inactive", false));
    const [glassTintOpacity, setGlassTintOpacity] = useState<number>(() => resolveInitialNumberFlag("tint", 0.06));
    const [glassSurfaceOpacity, setGlassSurfaceOpacity] = useState<number>(() => resolveInitialNumberFlag("surface", 0.18));
    const [glassInactiveSurfaceOpacity, setGlassInactiveSurfaceOpacity] = useState<number>(() => resolveInitialNumberFlag("inactiveSurface", 0.12));
    const [glassBlurRadius, setGlassBlurRadius] = useState<number>(() => resolveInitialNumberFlag("blur", 16));

    seedMockVaultConfig(mockVaultPath);
    window.__OFIVE_BROWSER_MOCK_AI__ = mockAiRuntime;
    useVaultTreeSync();
    useAutoSaveLifecycle();

    useEffect(() => {
        let cancelled = false;
        console.info("[MockApp] set current mock vault", { mockVaultPath });
        void setCurrentVault(mockVaultPath)
            .then(() => {
                if (!cancelled) {
                    console.info("[MockApp] current mock vault ready", { mockVaultPath });
                }
            })
            .catch((error) => {
                console.error("[MockApp] failed to set current mock vault", {
                    mockVaultPath,
                    message: error instanceof Error ? error.message : String(error),
                });
            });

        return () => {
            cancelled = true;
        };
    }, [mockVaultPath]);

    useConfigSync(mockVaultPath, true);
    ensureMockComponentsRegistered();

    useEffect(() => {
        const runtimeStyle = buildGlassRuntimeStyle({
            glassTintOpacity,
            glassSurfaceOpacity,
            glassInactiveSurfaceOpacity,
            glassBlurRadius,
        });

        document.documentElement.classList.add("app-runtime--tauri");
        document.documentElement.classList.toggle("app-platform--windows", platform === "windows");
        document.documentElement.classList.toggle("app-platform--macos", platform === "macos");
        document.documentElement.classList.toggle("app-effect--glass", glassEnabled);
        document.documentElement.classList.toggle("app-window--inactive", inactive);
        document.documentElement.setAttribute("data-theme", themeMode);

        Object.entries(runtimeStyle.cssVariables).forEach(([name, value]) => {
            document.documentElement.style.setProperty(name, value);
        });

        return () => {
            document.documentElement.classList.remove(
                "app-runtime--tauri",
                "app-platform--windows",
                "app-platform--macos",
                "app-effect--glass",
                "app-window--inactive",
            );
        };
    }, [glassBlurRadius, glassEnabled, glassInactiveSurfaceOpacity, glassSurfaceOpacity, glassTintOpacity, inactive, platform, themeMode]);

    const handleNumberInput = (
        updater: (nextValue: number) => void,
        min: number,
        max: number,
    ) => {
        return (event: ChangeEvent<HTMLInputElement>): void => {
            const raw = Number(event.target.value);
            if (!Number.isFinite(raw)) {
                return;
            }
            updater(Math.max(min, Math.min(max, raw)));
        };
    };

    return (
        <div className="app-shell">
            {showControls ? (
                <div
                    style={{
                        position: "fixed",
                        top: 12,
                        right: 12,
                        zIndex: 1000,
                        display: "grid",
                        gap: 8,
                        width: 280,
                        padding: 12,
                        borderRadius: 14,
                        border: "1px solid rgba(255,255,255,0.16)",
                        background: "rgba(20, 24, 32, 0.62)",
                        backdropFilter: "blur(18px) saturate(1.08)",
                        color: "#f5f7fb",
                    }}
                >
                    <strong style={{ fontSize: 13 }}>Glass Mock Controls</strong>
                    <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
                        <span>Platform</span>
                        <select value={platform} onChange={(event) => { setPlatform(event.target.value as MockPlatform); }}>
                            <option value="macos">macOS</option>
                            <option value="windows">Windows</option>
                        </select>
                    </label>
                    <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
                        <span>Theme</span>
                        <select value={themeMode} onChange={(event) => { setThemeMode(event.target.value as MockThemeMode); }}>
                            <option value="dark">Dark</option>
                            <option value="light">Light</option>
                            <option value="kraft">Kraft</option>
                        </select>
                    </label>
                    <label style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                        <span>Glass enabled</span>
                        <input type="checkbox" checked={glassEnabled} onChange={(event) => { setGlassEnabled(event.target.checked); }} />
                    </label>
                    <label style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                        <span>Inactive state</span>
                        <input type="checkbox" checked={inactive} onChange={(event) => { setInactive(event.target.checked); }} />
                    </label>
                    <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
                        <span>Tint opacity: {glassTintOpacity.toFixed(2)}</span>
                        <input type="range" min="0.02" max="0.24" step="0.01" value={glassTintOpacity} onChange={handleNumberInput(setGlassTintOpacity, 0.02, 0.24)} />
                    </label>
                    <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
                        <span>Surface opacity: {glassSurfaceOpacity.toFixed(2)}</span>
                        <input type="range" min="0.08" max="0.40" step="0.01" value={glassSurfaceOpacity} onChange={handleNumberInput(setGlassSurfaceOpacity, 0.08, 0.4)} />
                    </label>
                    <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
                        <span>Inactive opacity: {glassInactiveSurfaceOpacity.toFixed(2)}</span>
                        <input type="range" min="0.04" max="0.40" step="0.01" value={glassInactiveSurfaceOpacity} onChange={handleNumberInput(setGlassInactiveSurfaceOpacity, 0.04, 0.4)} />
                    </label>
                    <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
                        <span>Blur radius: {glassBlurRadius}px</span>
                        <input type="range" min="4" max="24" step="1" value={glassBlurRadius} onChange={handleNumberInput(setGlassBlurRadius, 4, 24)} />
                    </label>
                    <div style={{ color: "rgba(245, 247, 251, 0.72)", fontSize: 12, lineHeight: 1.5 }}>
                        Layout engine: layout-v2
                    </div>
                </div>
            ) : null}
            <div className="app-content">
                <WorkbenchLayoutHost
                    initialActivePanelId="files"
                />
            </div>
        </div>
    );
}
