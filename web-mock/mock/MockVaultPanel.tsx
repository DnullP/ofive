/**
 * @module web-mock/mock/MockVaultPanel
 * @description 前端 Mock 资源管理器面板：不依赖后端接口，使用内置样例文件列表与内容。
 * @dependencies
 *  - react
 *  - ../../src/plugins/file-tree/panel/FileTree
 *  - ../../src/host/layout/DockviewLayout
 *  - ../../src/plugins/file-tree/panel/VaultPanel.css
 */

import { useMemo, type ReactNode } from "react";
import { FileTree, type FileTreeItem } from "../../src/plugins/file-tree/panel/FileTree";
import type { TabInstanceDefinition } from "../../src/host/layout/DockviewLayout";
import "../../src/plugins/file-tree/panel/VaultPanel.css";

const MOCK_VAULT_PATH = "/mock/notes";

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

const LATEX_TEST_SAMPLE = `# LaTeX 渲染测试

## 1. 行内公式

爱因斯坦质能方程：$E = mc^2$，这是物理学中最著名的公式之一。

欧拉公式 $e^{i\\pi} + 1 = 0$ 被誉为"最美的数学公式"。

二次方程求根公式为 $x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}$，其中 $a \\neq 0$。

向量点积 $\\vec{a} \\cdot \\vec{b} = |\\vec{a}||\\vec{b}|\\cos\\theta$。

## 2. 单行块级公式

$$\\int_0^\\infty e^{-x^2} dx = \\frac{\\sqrt{\\pi}}{2}$$

$$\\sum_{n=1}^{\\infty} \\frac{1}{n^2} = \\frac{\\pi^2}{6}$$

## 3. 多行块级公式

$$
\\begin{aligned}
\\nabla \\times \\vec{E} &= -\\frac{\\partial \\vec{B}}{\\partial t} \\\\
\\nabla \\times \\vec{B} &= \\mu_0 \\vec{J} + \\mu_0 \\epsilon_0 \\frac{\\partial \\vec{E}}{\\partial t}
\\end{aligned}
$$

$$
\\mathcal{L} = \\int \\left( \\frac{1}{2} \\partial_\\mu \\phi \\partial^\\mu \\phi - V(\\phi) \\right) d^4x
$$

## 4. 矩阵

$$
A = \\begin{pmatrix}
a_{11} & a_{12} & a_{13} \\\\
a_{21} & a_{22} & a_{23} \\\\
a_{31} & a_{32} & a_{33}
\\end{pmatrix}
$$

## 5. 边界情况

多个行内公式在一行中：$\\alpha$ 和 $\\beta$ 和 $\\gamma$ 是希腊字母。

## 6. 错误公式测试

错误的 LaTeX：$\\invalidcommand{test}$
`;

const MOCK_FILE_CONTENTS: Record<string, string> = {
    "test-resources/notes/network-segment.md": NETWORK_SEGMENT_SAMPLE,
    "test-resources/notes/latex-test.md": LATEX_TEST_SAMPLE,
    "test-resources/notes/guide.md": "# Guide\n\n- 系统代理对一般应用程序生效\n- 终端无代理, 需要在`./zshrc`中配置, 或者直接`export \"HTTP_PROXY\"`\n- docker本身不走系统代理和终端代[[Cron1234]]理中的任何一个, 需要单独配置\n\nDocker本身是通过[[Daemon (linux)]]进程启动的, 而deamon默认是没有代理的, 需要在systemd的配置中进行设置.\n",
};

interface MockVaultPanelProps {
    openTab: (tab: TabInstanceDefinition) => void;
}

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