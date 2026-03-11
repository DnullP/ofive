/**
 * @module test-resources/web/mock/MockApp
 * @description 前端 Mock 测试页：复用主应用布局和编辑器，不依赖 Tauri 后端。
 * @dependencies
 *  - react
 *  - lucide-react
 *  - ../../../src/layout
 *  - ../../../src/registry
 *  - ./MockVaultPanel
 */

import React, { useMemo, useEffect, type ReactNode } from "react";
import { Compass, FolderOpen, Link2 } from "lucide-react";
import {
    DockviewLayout,
    type TabInstanceDefinition,
} from "../../../src/layout";
import { CodeMirrorEditorTab } from "../../../src/layout/editor/CodeMirrorEditorTab";
import { SettingsTab } from "../../../src/layout/SettingsTab";
import { useConfigSync } from "../../../src/store/configStore";
import { registerActivity } from "../../../src/registry/activityRegistry";
import { registerPanel } from "../../../src/registry/panelRegistry";
import { registerTabComponent } from "../../../src/registry/tabComponentRegistry";
import { MockVaultPanel } from "./MockVaultPanel";
import "../../../src/App.css";

/**
 * @constant MOCK_VAULT_PATH
 * @description Mock 页面用于配置加载的虚拟仓库路径。
 */
const MOCK_VAULT_PATH = "/mock/notes";

/**
 * @function MockHomeTab
 * @description Mock 页面首页 tab。
 * @returns React 节点。
 */
function MockHomeTab(): ReactNode {
    return (
        <div className="editor-tab-view">
            <h2>ofive Mock Workspace</h2>
            <p>该页面不依赖后端，左侧文件与内容均为前端 mock 数据。</p>
            <p>请测试面板拖拽：将右侧 "反向链接" 拖到左侧，再拖回右侧，观察是否消失。</p>
        </div>
    );
}

/**
 * @function MockOutlinePanel
 * @description Mock 大纲面板，用于测试布局拖拽。不依赖后端。
 */
function MockOutlinePanel(): ReactNode {
    return (
        <div style={{ padding: 12, color: "var(--text-secondary)", fontSize: 12 }}>
            <strong>Mock Outline Panel</strong>
            <p>大纲插件已迁移为自注册插件，此处为测试 mock。</p>
        </div>
    );
}

/**
 * @function MockBacklinksPanel
 * @description Mock 反向链接面板，用于复现拖拽 bug。
 */
function MockBacklinksPanel(): ReactNode {
    return (
        <div style={{ padding: 12, color: "var(--text-secondary)", fontSize: 12 }}>
            <strong>Mock Backlinks Panel</strong>
            <p>将此面板拖到左侧栏，再拖回右侧栏，验证是否消失。</p>
        </div>
    );
}

/* 静态标记：确保注册只执行一次 */
let mockRegistered = false;

/**
 * @function ensureMockComponentsRegistered
 * @description 注册 mock 测试所需的内置组件（幂等）。
 */
function ensureMockComponentsRegistered(): void {
    if (mockRegistered) return;
    mockRegistered = true;

    const filesIcon = React.createElement(FolderOpen, { size: 18, strokeWidth: 1.8 });
    const outlineIcon = React.createElement(Compass, { size: 18, strokeWidth: 1.8 });
    const backlinksIcon = React.createElement(Link2, { size: 18, strokeWidth: 1.8 });

    /* 活动图标 */
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

    /* 面板 */
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

    /* Tab 组件 */
    registerTabComponent({ id: "home", component: MockHomeTab as any });
    registerTabComponent({ id: "codemirror", component: CodeMirrorEditorTab as any });
    registerTabComponent({ id: "settings", component: SettingsTab as any });

    console.info("[MockApp] mock components registered");
}

/**
 * @function MockApp
 * @description 渲染类 Tauri 主界面测试页面。
 * @returns React 节点。
 */
export function MockApp(): ReactNode {
    useConfigSync(MOCK_VAULT_PATH, true);
    ensureMockComponentsRegistered();

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
        <DockviewLayout
            initialTabs={initialTabs}
            initialActivePanelId="files"
        />
    );
}
