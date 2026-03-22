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

import React, { useEffect, useMemo, type ReactNode } from "react";
import { Bot, Compass, FolderOpen, Link2 } from "lucide-react";
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
import "../../src/plugins/aiChatPlugin.css";
import "../../src/plugins/backlinksPlugin.css";
import "../../src/plugins/outlinePlugin.css";
import "../../src/App.css";

const MOCK_VAULT_PATH = "/mock/notes";

function resolveMockVaultPath(): string {
    if (typeof window === "undefined") {
        return MOCK_VAULT_PATH;
    }

    const params = new URLSearchParams(window.location.search);
    return params.get("mockVaultPath") || MOCK_VAULT_PATH;
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
                <div className="ai-chat-header-topline">
                    <span className="ai-chat-header-pill">Mock AI</span>
                    <span className="ai-chat-header-status">
                        <span className="ai-chat-header-status-dot" />
                        Ready
                    </span>
                </div>
                <div className="ai-chat-title-row">
                    <div>
                        <div className="ai-chat-title">AI Chat</div>
                        <div className="ai-chat-subtitle">Mock sidebar panel for glass validation.</div>
                    </div>
                    <button type="button" className="ai-chat-header-ghost-button">Settings</button>
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

    useConfigSync(mockVaultPath, true);
    ensureMockComponentsRegistered();

    useEffect(() => {
        const runtimeStyle = buildGlassRuntimeStyle({
            glassTintOpacity: 0.05,
            glassSurfaceOpacity: 0.16,
            glassInactiveSurfaceOpacity: 0.1,
            glassBlurRadius: 14,
        });

        document.documentElement.classList.add("app-runtime--tauri", "app-platform--windows", "app-effect--glass");
        Object.entries(runtimeStyle.cssVariables).forEach(([name, value]) => {
            document.documentElement.style.setProperty(name, value);
        });

        return () => {
            document.documentElement.classList.remove("app-runtime--tauri", "app-platform--windows", "app-effect--glass", "app-window--inactive");
        };
    }, []);

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
            <div className="app-content">
                <DockviewLayout
                    initialTabs={initialTabs}
                    initialActivePanelId="files"
                />
            </div>
        </div>
    );
}