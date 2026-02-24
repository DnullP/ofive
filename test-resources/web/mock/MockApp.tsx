/**
 * @module test-resources/web/mock/MockApp
 * @description 前端 Mock 测试页：复用主应用布局和编辑器，不依赖 Tauri 后端。
 * @dependencies
 *  - react
 *  - lucide-react
 *  - ../../../src/layout
 *  - ../../../src/layout/CodeMirrorEditorTab
 *  - ./MockVaultPanel
 */

import { useMemo, type ReactNode } from "react";
import { Compass, FolderOpen } from "lucide-react";
import {
    DockviewLayout,
    OutlinePanel,
    type PanelDefinition,
    type TabComponentDefinition,
    type TabInstanceDefinition,
} from "../../../src/layout";
import { CodeMirrorEditorTab } from "../../../src/layout/editor/CodeMirrorEditorTab";
import { SettingsTab } from "../../../src/layout/SettingsTab";
import { useConfigSync } from "../../../src/store/configStore";
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
            <p>请打开 test-resources/notes/network-segment.md 验证 Header/Bold 折叠效果。</p>
        </div>
    );
}

/**
 * @function MockApp
 * @description 渲染类 Tauri 主界面测试页面。
 * @returns React 节点。
 */
export function MockApp(): ReactNode {
    useConfigSync(MOCK_VAULT_PATH, true);

    const filesIcon = <FolderOpen size={18} strokeWidth={1.8} />;
    const outlineIcon = <Compass size={18} strokeWidth={1.8} />;

    const panels = useMemo<PanelDefinition[]>(
        () => [
            {
                id: "files",
                title: "资源管理器",
                icon: filesIcon,
                position: "left",
                order: 1,
                activityId: "files",
                activityTitle: "资源管理器",
                activityIcon: filesIcon,
                activitySection: "top",
                render: ({ openTab }) => <MockVaultPanel openTab={openTab} />,
            },
            {
                id: "outline",
                title: "大纲",
                icon: outlineIcon,
                position: "right",
                order: 1,
                render: () => <OutlinePanel />,
            },
        ],
        [filesIcon, outlineIcon],
    );

    const tabComponents = useMemo<TabComponentDefinition[]>(
        () => [
            { key: "home", component: MockHomeTab },
            { key: "codemirror", component: CodeMirrorEditorTab },
            { key: "settings", component: SettingsTab },
        ],
        [],
    );

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
            panels={panels}
            tabComponents={tabComponents}
            initialTabs={initialTabs}
            initialActivePanelId="files"
        />
    );
}
