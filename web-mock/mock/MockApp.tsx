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

import React, { useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { Bot, CalendarDays, CheckSquare, Compass, FolderOpen, Hand, Link2, Orbit, Plus, Search, Workflow } from "lucide-react";
import {
    WorkbenchLayoutHost,
    type TabInstanceDefinition,
} from "../../src/host/layout";
import type {
    DockviewLayoutAnimationObservation,
    DockviewLayoutDebugApi,
    DockviewLayoutSnapshot,
    DockviewLayoutTimelineEntry,
} from "../../src/host/layout/dockviewLayoutDebugContract";
import { buildGlassRuntimeStyle } from "../../src/host/layout/glassRuntimeStyle";
import { readWorkbenchLayoutMode } from "../../src/host/layout/workbenchLayoutMode";
import { CodeMirrorEditorTab } from "../../src/plugins/markdown-codemirror/editor/CodeMirrorEditorTab";
import { KnowledgeGraphTab } from "../../src/plugins/knowledge-graph/tab/KnowledgeGraphTab";
import { CanvasTab } from "../../src/plugins/canvas/CanvasTab";
import { activatePlugin as activateCommandPalettePlugin } from "../../src/plugins/command-palette/commandPalettePlugin";
import { SettingsTab } from "../../src/host/layout/SettingsTab";
import { useConfigSync } from "../../src/host/config/configStore";
import { registerActivity } from "../../src/host/registry/activityRegistry";
import { registerFileOpener } from "../../src/host/registry/fileOpenerRegistry";
import { registerPanel } from "../../src/host/registry/panelRegistry";
import { registerTabComponent } from "../../src/host/registry/tabComponentRegistry";
import { buildFileTabId, normalizeRelativePath } from "../../src/host/layout/openFileService";
import { publishNotification } from "../../src/host/notifications/notificationCenter";
import { readVaultMarkdownFile, setCurrentVault } from "../../src/api/vaultApi";
import { MockVaultPanel } from "./MockVaultPanel";
import "../../src/plugins/ai-chat/aiChatPlugin.css";
import "../../src/plugins/backlinks/backlinksPlugin.css";
import "../../src/plugins/outline/outlinePlugin.css";
import "../../src/App.css";

const MOCK_VAULT_PATH = "/mock/notes";
const MOCK_SPLIT_DEMO_COMPONENT_ID = "split-demo";
const MOCK_SPLIT_DEMO_TAB_ID = "split-demo";
const SEARCH_SURFACE_ID = "search";
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

function resolveMockVaultPath(): string {
    if (typeof window === "undefined") {
        return MOCK_VAULT_PATH;
    }

    const params = new URLSearchParams(window.location.search);
    return params.get("mockVaultPath") || MOCK_VAULT_PATH;
}

type MockPlatform = "windows" | "macos";
type MockThemeMode = "dark" | "light" | "kraft";

interface MockDockviewWindowApi {
    openSplitTab: (options?: {
        id?: string;
        title?: string;
        component?: string;
        position?: "top" | "bottom" | "left" | "right";
    }) => void;
    closeTab: (tabId: string) => void;
    activateTab: (tabId: string) => void;
    hasTab: (tabId: string) => boolean;
    getAnimationObservations: () => DockviewLayoutAnimationObservation[];
    clearAnimationObservations: () => void;
    getTimelineEntries: () => DockviewLayoutTimelineEntry[];
    clearTimelineEntries: () => void;
    getLayoutSnapshot: () => DockviewLayoutSnapshot;
}

declare global {
    interface Window {
        __OFIVE_MOCK_DOCKVIEW__?: MockDockviewWindowApi;
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

function MockHomeTab(): ReactNode {
    return (
        <div className="editor-tab-view">
            <h2>ofive Mock Workspace</h2>
            <p>该页面不依赖后端，左侧文件与内容均为前端 mock 数据。</p>
            <p>请测试面板拖拽：将右侧 "反向链接" 拖到左侧，再拖回右侧，观察是否消失。</p>
        </div>
    );
}

function MockSplitDemoTab(): ReactNode {
    return (
        <div
            data-testid="mock-split-demo-tab"
            style={{
                display: "grid",
                gap: 14,
                height: "100%",
                padding: 20,
                background: "linear-gradient(135deg, rgba(84, 152, 255, 0.16), rgba(108, 236, 190, 0.12) 52%, rgba(255, 196, 120, 0.14))",
            }}
        >
            <div style={{ fontSize: 24, fontWeight: 700 }}>Split Demo</div>
            <div style={{ fontSize: 13, lineHeight: 1.6, color: "var(--text-secondary)" }}>
                这个 tab 用来验证 Dockview 主区的 split reflow 动画是否足够明显。
            </div>
            <div
                style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                    gap: 10,
                    alignSelf: "start",
                }}
            >
                {[
                    "capture old rect",
                    "reflow existing group",
                    "fade new area",
                ].map((label) => (
                    <div
                        key={label}
                        style={{
                            minHeight: 84,
                            padding: 12,
                            borderRadius: 14,
                            background: "rgba(15, 23, 42, 0.2)",
                            border: "1px solid rgba(255, 255, 255, 0.14)",
                            boxShadow: "inset 0 1px 0 rgba(255, 255, 255, 0.08)",
                            fontSize: 12,
                            fontWeight: 600,
                            textTransform: "uppercase",
                            letterSpacing: "0.08em",
                        }}
                    >
                        {label}
                    </div>
                ))}
            </div>
        </div>
    );
}

function MockOutlinePanel(): ReactNode {
    return (
        <div className="outline-panel">
            <div className="outline-panel-header">
                mock/article.md
                <span className="outline-persisted-hint">Mock</span>
            </div>
            <ul className="outline-list">
                <li>
                    <button type="button" className="outline-item"># Section One</button>
                </li>
                <li>
                    <button type="button" className="outline-item">## Section Two</button>
                </li>
            </ul>
        </div>
    );
}

function MockBacklinksPanel(): ReactNode {
    return (
        <div className="backlinks-panel">
            <div className="backlinks-panel-header">
                mock/article.md
                <span className="backlinks-count">2 backlinks</span>
            </div>
            <ul className="backlinks-list">
                <li>
                    <button type="button" className="backlinks-item">
                        <span className="backlinks-item-title">mock/ref-a.md</span>
                        <span className="backlinks-item-weight">1</span>
                    </button>
                </li>
                <li>
                    <button type="button" className="backlinks-item">
                        <span className="backlinks-item-title">mock/ref-b.md</span>
                        <span className="backlinks-item-weight">3</span>
                    </button>
                </li>
            </ul>
        </div>
    );
}

function MockAiChatPanel(): ReactNode {
    return (
        <div className="ai-chat-panel">
            <div className="ai-chat-header">
                <div className="ai-chat-header-main">
                    <div className="ai-chat-title">AI Chat</div>
                    <div className="ai-chat-header-badges">
                        <span className="ai-chat-vendor-badge">
                            Mock Vendor
                            <strong>Glass QA</strong>
                        </span>
                        <span className="ai-chat-status-chip">Ready</span>
                    </div>
                </div>

                <div className="ai-chat-conversation-bar">
                    <div className="ai-chat-conversation-bar-header">
                        <span className="ai-chat-section-label">Conversations</span>
                        <button type="button" className="ai-chat-conversation-create">
                            <Plus size={13} strokeWidth={2} />
                            <span>New</span>
                        </button>
                    </div>
                    <div className="ai-chat-conversation-list">
                        <button type="button" className="ai-chat-conversation-item active">
                            <span className="ai-chat-conversation-title">Glass validation</span>
                            <span className="ai-chat-conversation-time">09:41</span>
                        </button>
                        <button type="button" className="ai-chat-conversation-item">
                            <span className="ai-chat-conversation-title">Theme comparison</span>
                            <span className="ai-chat-conversation-time">Yesterday</span>
                        </button>
                    </div>
                </div>
            </div>
            <div className="ai-chat-thread-shell">
                <div className="ai-chat-welcome-card">
                    <div className="ai-chat-welcome-title">Glass validation card</div>
                    <div className="ai-chat-welcome-body">This card should stay translucent instead of becoming a solid dark block.</div>
                </div>
                <div className="ai-chat-status">
                    <span className="ai-chat-status-title">Mock status</span>
                    <div className="ai-chat-status-detail">Sidebar plugin surfaces should inherit the frosted shell instead of covering it.</div>
                </div>
            </div>
        </div>
    );
}

function MockSearchPanel(): ReactNode {
    return (
        <div className="outline-panel">
            <div className="outline-panel-header">
                全局搜索
                <span className="outline-persisted-hint">Mock</span>
            </div>
            <div style={{ padding: 12, display: "grid", gap: 10 }}>
                <input
                    type="search"
                    value="scroll state"
                    readOnly
                    aria-label="Mock search query"
                    style={{
                        width: "100%",
                        borderRadius: 10,
                        border: "1px solid rgba(255, 255, 255, 0.14)",
                        background: "rgba(15, 23, 42, 0.28)",
                        color: "var(--text-primary)",
                        padding: "10px 12px",
                    }}
                />
                <ul className="backlinks-list">
                    <li>
                        <button type="button" className="backlinks-item">
                            <span className="backlinks-item-title">test-resources/notes/scroll-regression.md</span>
                            <span className="backlinks-item-weight">3</span>
                        </button>
                    </li>
                    <li>
                        <button type="button" className="backlinks-item">
                            <span className="backlinks-item-title">docs/testing-handbook.md</span>
                            <span className="backlinks-item-weight">1</span>
                        </button>
                    </li>
                </ul>
            </div>
        </div>
    );
}

function MockCalendarPanel(): ReactNode {
    return (
        <div className="outline-panel">
            <div className="outline-panel-header">
                日历
                <span className="outline-persisted-hint">Panel</span>
            </div>
            <ul className="outline-list">
                <li>
                    <button type="button" className="outline-item">04-23 今天: 2 篇笔记</button>
                </li>
                <li>
                    <button type="button" className="outline-item">04-24 明天: 1 个计划项</button>
                </li>
                <li>
                    <button type="button" className="outline-item">04-28 下周一: 周回顾</button>
                </li>
            </ul>
        </div>
    );
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

function MockCalendarTab(): ReactNode {
    return (
        <MockWorkbenchPlaceholder
            title="日历"
            description="mock 现在保留和 Tauri 一致的日历入口，方便在同一套 workbench 壳上看布局与拖拽行为。"
            points={[
                "今天: Daily note / 会议纪要 / 周计划",
                "月底: 项目复盘与归档",
                "入口结构与右侧 panel 的 activityId 对齐为 calendar",
            ]}
        />
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

function MockTaskBoardTab(): ReactNode {
    return (
        <MockWorkbenchPlaceholder
            title="任务看板"
            description="任务看板在 mock 中先占位到和 Tauri 相同的入口位置，避免 web-mock 和真实工作台结构分叉。"
            points={[
                "In Progress: 对齐 mock 与 Tauri workbench 壳",
                "Review: editor view-state regression coverage",
                "Done: layout-v2 keep-mounted tab cards",
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

let mockRegistered = false;
const MOCK_KNOWLEDGE_GRAPH_COMPONENT_ID = "knowledgegraph";
const MOCK_KNOWLEDGE_GRAPH_ACTIVITY_ID = "knowledge-graph";

function ensureMockComponentsRegistered(): void {
    if (mockRegistered) return;
    mockRegistered = true;

    activateCommandPalettePlugin();

    const filesIcon = React.createElement(FolderOpen, { size: 18, strokeWidth: 1.8 });
    const searchIcon = React.createElement(Search, { size: 18, strokeWidth: 1.8 });
    const outlineIcon = React.createElement(Compass, { size: 18, strokeWidth: 1.8 });
    const aiChatIcon = React.createElement(Bot, { size: 18, strokeWidth: 1.8 });
    const knowledgeGraphIcon = React.createElement(Orbit, { size: 18, strokeWidth: 1.8 });
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
        id: SEARCH_SURFACE_ID,
        title: () => "搜索",
        icon: searchIcon,
        defaultSection: "top",
        defaultBar: "left",
        defaultOrder: 2,
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
        type: "panel-container",
        id: "ai-chat-mock",
        title: () => "AI 对话",
        icon: aiChatIcon,
        defaultSection: "top",
        defaultBar: "right",
        defaultOrder: 3,
    });
    registerActivity({
        type: "callback",
        id: MOCK_KNOWLEDGE_GRAPH_ACTIVITY_ID,
        title: () => "知识图谱",
        icon: knowledgeGraphIcon,
        defaultSection: "top",
        defaultBar: "left",
        defaultOrder: 3,
        onActivate: (context) => {
            context.openTab({
                id: MOCK_KNOWLEDGE_GRAPH_ACTIVITY_ID,
                title: "知识图谱",
                component: MOCK_KNOWLEDGE_GRAPH_COMPONENT_ID,
            });
        },
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
        render: (ctx) => React.createElement(MockVaultPanel, { openTab: ctx.openTab }),
    });
    registerPanel({
        id: SEARCH_SURFACE_ID,
        title: () => "搜索",
        activityId: SEARCH_SURFACE_ID,
        defaultPosition: "left",
        defaultOrder: 2,
        render: () => React.createElement(MockSearchPanel),
    });
    registerPanel({
        id: "outline",
        title: () => "大纲",
        activityId: "outline",
        defaultPosition: "right",
        defaultOrder: 1,
        render: () => React.createElement(MockOutlinePanel),
    });
    registerPanel({
        id: "backlinks",
        title: () => "反向链接",
        activityId: "outline",
        defaultPosition: "right",
        defaultOrder: 2,
        render: () => React.createElement(MockBacklinksPanel),
    });
    registerPanel({
        id: CALENDAR_PANEL_ID,
        title: () => "日历",
        activityId: CALENDAR_ACTIVITY_ID,
        defaultPosition: "right",
        defaultOrder: 2,
        render: () => React.createElement(MockCalendarPanel),
    });
    registerPanel({
        id: "ai-chat-mock",
        title: () => "AI 对话",
        activityId: "ai-chat-mock",
        defaultPosition: "right",
        defaultOrder: 1,
        render: () => React.createElement(MockAiChatPanel),
    });

    registerTabComponent({ id: "home", component: MockHomeTab as never });
    registerTabComponent({ id: MOCK_SPLIT_DEMO_COMPONENT_ID, component: MockSplitDemoTab as never });
    registerTabComponent({ id: "codemirror", component: CodeMirrorEditorTab as never });
    registerTabComponent({ id: "canvas", component: CanvasTab as never });
    registerTabComponent({ id: MOCK_KNOWLEDGE_GRAPH_COMPONENT_ID, component: KnowledgeGraphTab as never });
    registerTabComponent({ id: MOCK_CALENDAR_TAB_COMPONENT_ID, component: MockCalendarTab as never });
    registerTabComponent({ id: MOCK_ARCHITECTURE_COMPONENT_ID, component: MockArchitectureDevtoolsTab as never });
    registerTabComponent({ id: MOCK_TASK_BOARD_COMPONENT_ID, component: MockTaskBoardTab as never });
    registerTabComponent({ id: "settings", component: SettingsTab as never });
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

    console.info("[MockApp] mock components registered");
}

export function MockApp(): ReactNode {
    const mockVaultPath = useMemo(() => resolveMockVaultPath(), []);
    const showControls = useMemo(() => resolveShouldShowControls(), []);
    const workbenchLayoutMode = useMemo(() => readWorkbenchLayoutMode(), []);
    const dockviewDebugApiRef = useRef<DockviewLayoutDebugApi | null>(null);
    const [platform, setPlatform] = useState<MockPlatform>(() => resolveInitialMockPlatform());
    const [themeMode, setThemeMode] = useState<MockThemeMode>(() => resolveInitialThemeMode());
    const [glassEnabled, setGlassEnabled] = useState<boolean>(() => resolveInitialBooleanFlag("glass", true));
    const [inactive, setInactive] = useState<boolean>(() => resolveInitialBooleanFlag("inactive", false));
    const [glassTintOpacity, setGlassTintOpacity] = useState<number>(() => resolveInitialNumberFlag("tint", 0.06));
    const [glassSurfaceOpacity, setGlassSurfaceOpacity] = useState<number>(() => resolveInitialNumberFlag("surface", 0.18));
    const [glassInactiveSurfaceOpacity, setGlassInactiveSurfaceOpacity] = useState<number>(() => resolveInitialNumberFlag("inactiveSurface", 0.12));
    const [glassBlurRadius, setGlassBlurRadius] = useState<number>(() => resolveInitialNumberFlag("blur", 16));
    const [isSplitReplayRunning, setIsSplitReplayRunning] = useState(false);

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
        window.__OFIVE_MOCK_DOCKVIEW__ = {
            openSplitTab: (options) => {
                dockviewDebugApiRef.current?.openSplitTab({
                    id: options?.id ?? MOCK_SPLIT_DEMO_TAB_ID,
                    title: options?.title ?? "Split Demo",
                    component: options?.component ?? MOCK_SPLIT_DEMO_COMPONENT_ID,
                }, options?.position ?? "right");
            },
            closeTab: (tabId) => {
                dockviewDebugApiRef.current?.closeTab(tabId);
            },
            activateTab: (tabId) => {
                dockviewDebugApiRef.current?.activateTab(tabId);
            },
            hasTab: (tabId) => {
                return dockviewDebugApiRef.current?.hasTab(tabId) ?? false;
            },
            getAnimationObservations: () => {
                return dockviewDebugApiRef.current?.getAnimationObservations() ?? [];
            },
            clearAnimationObservations: () => {
                dockviewDebugApiRef.current?.clearAnimationObservations();
            },
            getTimelineEntries: () => {
                return dockviewDebugApiRef.current?.getTimelineEntries() ?? [];
            },
            clearTimelineEntries: () => {
                dockviewDebugApiRef.current?.clearTimelineEntries();
            },
            getLayoutSnapshot: () => {
                return dockviewDebugApiRef.current?.getLayoutSnapshot() ?? { groups: [] };
            },
        };

        return () => {
            delete window.__OFIVE_MOCK_DOCKVIEW__;
        };
    }, []);

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

    const initialTabs = useMemo<TabInstanceDefinition[]>(
        () => [
            {
                id: "home",
                title: "首页",
                component: "home",
            },
        ],
        [],
    );

    const openSplitDemo = (): void => {
        dockviewDebugApiRef.current?.openSplitTab({
            id: MOCK_SPLIT_DEMO_TAB_ID,
            title: "Split Demo",
            component: MOCK_SPLIT_DEMO_COMPONENT_ID,
        }, "right");
    };

    const closeSplitDemo = (): void => {
        dockviewDebugApiRef.current?.closeTab(MOCK_SPLIT_DEMO_TAB_ID);
    };

    const replaySplitDemo = async (): Promise<void> => {
        if (isSplitReplayRunning) {
            return;
        }

        setIsSplitReplayRunning(true);
        try {
            if (dockviewDebugApiRef.current?.hasTab(MOCK_SPLIT_DEMO_TAB_ID)) {
                closeSplitDemo();
                await new Promise((resolve) => window.setTimeout(resolve, 420));
            }

            openSplitDemo();
            await new Promise((resolve) => window.setTimeout(resolve, 900));
            closeSplitDemo();
        } finally {
            window.setTimeout(() => {
                setIsSplitReplayRunning(false);
            }, 380);
        }
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
                    <div style={{ display: "grid", gap: 6, fontSize: 12 }}>
                        <span>Split Motion Demo</span>
                        <div style={{ color: "rgba(245, 247, 251, 0.72)", lineHeight: 1.5 }}>
                            当前布局引擎：{workbenchLayoutMode}
                        </div>
                        {workbenchLayoutMode === "dockview" ? (
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 6 }}>
                            <button
                                type="button"
                                data-testid="mock-control-split-open"
                                onClick={openSplitDemo}
                                disabled={isSplitReplayRunning}
                            >
                                Split Right
                            </button>
                            <button
                                type="button"
                                data-testid="mock-control-split-close"
                                onClick={closeSplitDemo}
                                disabled={isSplitReplayRunning}
                            >
                                Close Split
                            </button>
                        </div>
                        ) : null}
                        {workbenchLayoutMode === "dockview" ? (
                        <button
                            type="button"
                            data-testid="mock-control-split-replay"
                            onClick={() => { void replaySplitDemo(); }}
                            disabled={isSplitReplayRunning}
                        >
                            {isSplitReplayRunning ? "Replaying..." : "Replay Split Motion"}
                        </button>
                        ) : null}
                        <div style={{ color: "rgba(245, 247, 251, 0.72)", lineHeight: 1.5 }}>
                            {workbenchLayoutMode === "dockview"
                                ? "使用这组按钮可以稳定复现 Dockview split 创建与回收动画，不必依赖拖拽操作。"
                                : "layout-v2 模式下这里保留 mock 控件面板，但不再暴露 Dockview 专属 split 调试按钮。"}
                        </div>
                    </div>
                </div>
            ) : null}
            <div className="app-content">
                <WorkbenchLayoutHost
                    initialTabs={initialTabs}
                    initialActivePanelId="files"
                    debugApiRef={workbenchLayoutMode === "dockview" ? dockviewDebugApiRef : undefined}
                />
            </div>
        </div>
    );
}