/**
 * @module test-resources/web/mock/MockVaultPanel
 * @description 前端 Mock 资源管理器面板：不依赖后端接口，使用内置样例文件列表与内容。
 * @dependencies
 *  - react
 *  - ../../../src/layout/FileTree
 *  - ../../../src/layout/DockviewLayout
 *  - ../../../src/layout/VaultPanel.css
 */

import { useMemo, type ReactNode } from "react";
import { FileTree, type FileTreeItem } from "../../../src/layout/FileTree";
import type { TabInstanceDefinition } from "../../../src/layout/DockviewLayout";
import "../../../src/layout/VaultPanel.css";

/**
 * @constant MOCK_VAULT_PATH
 * @description Mock 页面显示用的仓库路径。
 */
const MOCK_VAULT_PATH = "/mock/notes";

/**
 * @constant NETWORK_SEGMENT_SAMPLE
 * @description 用户提供的测试文本，用于验证 Header/Bold 折叠效果。
 */
const NETWORK_SEGMENT_SAMPLE = `---
title: Network Segment
category:
  - Data-Link-Layer
date: 2024-11-25 22:46:42
tags: [Entry,Computer-Science,Network]
dg-publish: true
dg-home:
aliases:
  - 网段
---
# Description

A **network segment** is a portion of a **computer network** . The nature and extent of a segment depends on the nature of the network and the device or devices used to interconnect end stations.`;

/**
 * @constant MOCK_FILE_CONTENTS
 * @description Mock 文件内容映射。
 */
const MOCK_FILE_CONTENTS: Record<string, string> = {
    "test-resources/notes/network-segment.md": NETWORK_SEGMENT_SAMPLE,
    "test-resources/notes/guide.md": "# Guide\n\nThis is a mock markdown document.",
};

/**
 * @interface MockVaultPanelProps
 * @description Mock 资源管理器参数。
 */
interface MockVaultPanelProps {
    openTab: (tab: TabInstanceDefinition) => void;
}

/**
 * @function createFileTab
 * @description 根据文件路径与内容创建编辑器 tab。
 * @param item 文件项。
 * @param content 文件内容。
 * @returns Tab 定义。
 */
function createFileTab(item: FileTreeItem, content: string): TabInstanceDefinition {
    const fileName = item.path.split("/").pop() ?? item.path;
    return {
        id: `file:${item.path}`,
        title: fileName,
        component: "codemirror",
        params: {
            path: item.path,
            content,
        },
    };
}

/**
 * @function MockVaultPanel
 * @description 渲染 Mock 资源管理器面板。
 * @param props 面板参数。
 * @returns React 节点。
 */
export function MockVaultPanel(props: MockVaultPanelProps): ReactNode {
    const { openTab } = props;

    const files = useMemo<FileTreeItem[]>(
        () =>
            Object.keys(MOCK_FILE_CONTENTS)
                .sort((left, right) => left.localeCompare(right))
                .map((path) => ({ id: path, path })),
        [],
    );

    return (
        <div>
            <div className="vault-toolbar">
                <div className="vault-toolbar-path" title={MOCK_VAULT_PATH}>
                    <span className="vault-toolbar-label">当前目录：</span>
                    <span className="vault-toolbar-value">{MOCK_VAULT_PATH}</span>
                </div>
                <button type="button" className="vault-toolbar-open-button" disabled>
                    Mock 模式
                </button>
            </div>

            <FileTree
                items={files}
                onOpenFile={(item) => {
                    const content = MOCK_FILE_CONTENTS[item.path] ?? `# ${item.path}`;
                    openTab(createFileTab(item, content));
                }}
            />
        </div>
    );
}
