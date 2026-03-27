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
import { Bot, Compass, FolderOpen, Link2, Plus } from "lucide-react";
import {
    DockviewLayout,
    type TabInstanceDefinition,
} from "../../src/host/layout";
import { buildGlassRuntimeStyle } from "../../src/host/layout/glassRuntimeStyle";
import { CodeMirrorEditorTab } from "../../src/plugins/markdown-codemirror/editor/CodeMirrorEditorTab";
import { SettingsTab } from "../../src/host/layout/SettingsTab";
import { useConfigSync } from "../../src/host/store/configStore";
import { registerActivity } from "../../src/host/registry/activityRegistry";
import { registerPanel } from "../../src/host/registry/panelRegistry";
import { registerTabComponent } from "../../src/host/registry/tabComponentRegistry";
import { MockVaultPanel } from "./MockVaultPanel";
import "../../src/plugins/ai-chat/aiChatPlugin.css";
import "../../src/plugins/backlinks/backlinksPlugin.css";
import "../../src/plugins/outline/outlinePlugin.css";
import "../../src/App.css";

const MOCK_VAULT_PATH = "/mock/notes";

function resolveMockVaultPath(): string {
    if (typeof window === "undefined") {
        return MOCK_VAULT_PATH;
    }

    const params = new URLSearchParams(window.location.search);
    return params.get("mockVaultPath") || MOCK_VAULT_PATH;
}

type MockPlatform = "windows" | "macos";
type MockThemeMode = "dark" | "light" | "kraft";

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

let mockRegistered = false;

function ensureMockComponentsRegistered(): void {
    if (mockRegistered) return;
    mockRegistered = true;

    const filesIcon = React.createElement(FolderOpen, { size: 18, strokeWidth: 1.8 });
    const outlineIcon = React.createElement(Compass, { size: 18, strokeWidth: 1.8 });
    const backlinksIcon = React.createElement(Link2, { size: 18, strokeWidth: 1.8 });
    const aiChatIcon = React.createElement(Bot, { size: 18, strokeWidth: 1.8 });

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
        type: "panel-container",
        id: "ai-chat-mock",
        title: () => "AI 对话",
        icon: aiChatIcon,
        defaultSection: "top",
        defaultBar: "right",
        defaultOrder: 3,
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
        id: "ai-chat-mock",
        title: () => "AI 对话",
        activityId: "ai-chat-mock",
        defaultPosition: "right",
        defaultOrder: 1,
        render: () => React.createElement(MockAiChatPanel),
    });

    registerTabComponent({ id: "home", component: MockHomeTab as never });
    registerTabComponent({ id: "codemirror", component: CodeMirrorEditorTab as never });
    registerTabComponent({ id: "settings", component: SettingsTab as never });

    console.info("[MockApp] mock components registered");
}

export function MockApp(): ReactNode {
    const mockVaultPath = useMemo(() => resolveMockVaultPath(), []);
    const showControls = useMemo(() => resolveShouldShowControls(), []);
    const [platform, setPlatform] = useState<MockPlatform>(() => resolveInitialMockPlatform());
    const [themeMode, setThemeMode] = useState<MockThemeMode>(() => resolveInitialThemeMode());
    const [glassEnabled, setGlassEnabled] = useState<boolean>(() => resolveInitialBooleanFlag("glass", true));
    const [inactive, setInactive] = useState<boolean>(() => resolveInitialBooleanFlag("inactive", false));
    const [glassTintOpacity, setGlassTintOpacity] = useState<number>(() => resolveInitialNumberFlag("tint", 0.06));
    const [glassSurfaceOpacity, setGlassSurfaceOpacity] = useState<number>(() => resolveInitialNumberFlag("surface", 0.18));
    const [glassInactiveSurfaceOpacity, setGlassInactiveSurfaceOpacity] = useState<number>(() => resolveInitialNumberFlag("inactiveSurface", 0.12));
    const [glassBlurRadius, setGlassBlurRadius] = useState<number>(() => resolveInitialNumberFlag("blur", 16));

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
                </div>
            ) : null}
            <div className="app-content">
                <DockviewLayout
                    initialTabs={initialTabs}
                    initialActivePanelId="files"
                />
            </div>
        </div>
    );
}