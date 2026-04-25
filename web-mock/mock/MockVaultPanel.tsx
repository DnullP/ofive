/**
 * @module web-mock/mock/MockVaultPanel
 * @description 前端 Mock 资源管理器面板：不依赖后端接口，使用内置样例文件列表与内容。
 * @dependencies
 *  - react
 *  - ../../src/plugins/file-tree/panel/FileTree
 *  - ../../src/host/layout/DockviewLayout
 *  - ../../src/plugins/file-tree/panel/VaultPanel.css
 */

import { useEffect, useMemo, type ReactNode } from "react";
import { FileTree, type FileTreeItem } from "../../src/plugins/file-tree/panel/FileTree";
import type { TabInstanceDefinition } from "../../src/host/layout/DockviewLayout";
import { loadBrowserMockMarkdownContents } from "../../src/api/vaultBrowserMockFixtures";
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

const CANVAS_SAMPLE = `{
    "nodes": [
        {
            "id": "group-1",
            "type": "group",
            "x": 40,
            "y": 48,
            "width": 820,
            "height": 420,
            "label": "Glass QA Cluster",
            "color": "var(--accent-primary)",
            "background": "color-mix(in srgb, var(--content-material-bg) 74%, transparent)"
        },
        {
            "id": "text-1",
            "type": "text",
            "x": 96,
            "y": 96,
            "width": 280,
            "height": 180,
            "label": "Canvas Glass Check",
            "color": "var(--accent-primary)",
            "text": "1. 切换 light / dark / kraft。\\n2. 切换 glass 开关与 blur。\\n3. 检查背景、节点、toolbar、inspector 是否都跟随宿主材质变化。"
        },
        {
            "id": "file-1",
            "type": "file",
            "x": 442,
            "y": 122,
            "width": 240,
            "height": 152,
            "label": "guide.md",
            "color": "var(--text-link-color)",
            "file": "test-resources/notes/guide.md"
        },
        {
            "id": "text-2",
            "type": "text",
            "x": 240,
            "y": 316,
            "width": 320,
            "height": 120,
            "label": "Expected Result",
            "text": "Canvas 不应该维持一块独立的纯深色面板。开启 glass 后，背景层和悬浮面板都应呈现半透明和模糊。"
        }
    ],
    "edges": [
        {
            "id": "edge-1",
            "fromNode": "text-1",
            "toNode": "file-1",
            "label": "Open linked note",
            "color": "var(--text-link-color)"
        },
        {
            "id": "edge-2",
            "fromNode": "text-1",
            "toNode": "text-2",
            "label": "Visual target",
            "color": "var(--accent-primary)"
        }
    ]
}
`;

const TABLE_EDITOR_SAMPLE = `# Markdown Table Playground

该页面用于验证可视化表格编辑 widget。

| Feature | Status |
| --- | --- |
| **Bold** | [[guide]] |
| \`inline code\` | ==highlight== |
`;

const TABLE_VIM_BOUNDARY_SAMPLE = `# Markdown Table Vim Boundary

该页面用于验证表格内部 Vim 导航在三列表格中的边界切换。

| 层级 | 作用 | 典型对象 |
| --- | --- | --- |
| 布局骨架层 | 决定区域如何切分和嵌套 | \`SectionNode\`, section tree |
| 工作台部件层 | 决定不同区域里展示什么容器 | \`ActivityBar\`, \`PanelSection\`, \`TabSection\` |
| 宿主集成层 | 把业务数据投影到布局引擎 | \`VSCodeWorkbench\`, \`Workbench*Definition\`, host adapters |
`;

const SCROLL_REGRESSION_SAMPLE = [
    "# Scroll Regression Demo",
    "",
    "该页面用于验证编辑器在 tab 切换与侧栏交互后是否保留阅读位置。",
    "",
    ...Array.from({ length: 220 }, (_, index) => {
        const lineNumber = String(index + 1).padStart(3, "0");
        return `${lineNumber}. Scroll regression checkpoint line ${lineNumber}.`;
    }),
].join("\n");

const SCROLL_REGRESSION_ALT_SAMPLE = [
    "# Scroll Regression Alt Demo",
    "",
    "该页面用于验证切走再切回后，第一次点击 editor 不会把滚动位置拉回顶部。",
    "",
    ...Array.from({ length: 220 }, (_, index) => {
        const lineNumber = String(index + 1).padStart(3, "0");
        return `${lineNumber}. Alternate scroll regression line ${lineNumber}.`;
    }),
].join("\n");

const BULK_EDITOR_PERF_FILE_COUNT = 32;

/**
 * @function createBulkEditorPerfSample
 * @description 生成 editor split 性能测试专用的大量 Markdown 样例内容。
 * @param index 样例文件序号，从 1 开始。
 * @returns Markdown 文件内容。
 */
function createBulkEditorPerfSample(index: number): string {
    const paddedIndex = String(index).padStart(3, "0");
    return [
        `# Editor Split Perf ${paddedIndex}`,
        "",
        "该文件用于验证大量 editor tab 打开后 split 的挂载与交互性能。",
        "",
        ...Array.from({ length: 96 }, (_, lineIndex) => {
            const lineNumber = String(lineIndex + 1).padStart(3, "0");
            return `${lineNumber}. Perf editor ${paddedIndex} checkpoint ${lineNumber}: [[guide]] \`inline code\` **bold** ==mark==.`;
        }),
    ].join("\n");
}

/**
 * @function createBulkEditorPerfFileContents
 * @description 生成 mock 页面中按需开启的大量 editor tab 性能测试文件集合。
 * @returns 以 mock vault 相对路径为 key 的 Markdown 内容映射。
 */
function createBulkEditorPerfFileContents(): Record<string, string> {
    return Object.fromEntries(
        Array.from({ length: BULK_EDITOR_PERF_FILE_COUNT }, (_, index) => {
            const fileIndex = index + 1;
            const paddedIndex = String(fileIndex).padStart(3, "0");
            return [
                `test-resources/notes/perf-editor-${paddedIndex}.md`,
                createBulkEditorPerfSample(fileIndex),
            ];
        }),
    );
}

/**
 * @function resolveShouldIncludeBulkEditorPerfFiles
 * @description 根据 URL 查询参数判断是否启用大量 editor tab 性能 fixture。
 * @returns true 表示在 mock 文件树中加入 perf-editor-* 文件。
 */
function resolveShouldIncludeBulkEditorPerfFiles(): boolean {
    if (typeof window === "undefined") {
        return false;
    }

    return new URLSearchParams(window.location.search).get("bulkEditorPerf") === "1";
}

const MOCK_FILE_CONTENTS: Record<string, string> = {
    "test-resources/notes/network-segment.md": NETWORK_SEGMENT_SAMPLE,
    "test-resources/notes/latex-test.md": LATEX_TEST_SAMPLE,
    "test-resources/notes/scroll-regression.md": SCROLL_REGRESSION_SAMPLE,
    "test-resources/notes/scroll-regression-alt.md": SCROLL_REGRESSION_ALT_SAMPLE,
    "test-resources/notes/table-editor.md": TABLE_EDITOR_SAMPLE,
    "test-resources/notes/table-vim-boundary.md": TABLE_VIM_BOUNDARY_SAMPLE,
    "test-resources/notes/guide.md": "# Guide\n\n- 系统代理对一般应用程序生效\n- 终端无代理, 需要在`./zshrc`中配置, 或者直接`export \"HTTP_PROXY\"`\n- docker本身不走系统代理和终端代[[Cron1234]]理中的任何一个, 需要单独配置\n\nDocker本身是通过[[Daemon (linux)]]进程启动的, 而deamon默认是没有代理的, 需要在systemd的配置中进行设置.\n",
    "test-resources/notes/glass-validation.canvas": CANVAS_SAMPLE,
};

const BULK_EDITOR_PERF_FILE_CONTENTS = createBulkEditorPerfFileContents();

/**
 * @function createCurrentMockFileContents
 * @description 构建当前 mock 页面需要暴露的文件内容集合；默认保持精简，性能测试通过 query 参数按需扩展。
 * @returns 当前页面可见的 mock vault 文件内容映射。
 */
function createCurrentMockFileContents(): Record<string, string> {
    if (!resolveShouldIncludeBulkEditorPerfFiles()) {
        return MOCK_FILE_CONTENTS;
    }

    return {
        ...MOCK_FILE_CONTENTS,
        ...BULK_EDITOR_PERF_FILE_CONTENTS,
    };
}

interface MockVaultPanelProps {
    openTab: (tab: TabInstanceDefinition) => void;
}

function createFileTab(item: FileTreeItem, content: string): TabInstanceDefinition {
    const fileName = item.path.split("/").pop() ?? item.path;
    return {
        id: `file:${item.path}`,
        title: fileName,
        component: item.path.toLowerCase().endsWith(".canvas") ? "canvas" : "codemirror",
        params: {
            path: item.path,
            content,
        },
    };
}

/**
 * @function primeBrowserMockContents
 * @description 将 mock 文件树中的样例内容注入浏览器侧 vault fixture，保证 Canvas reload/save 在 web mock 中可用。
 * @returns Promise，在内容注入完成后 resolve。
 */
async function primeBrowserMockContents(fileContents: Record<string, string>): Promise<void> {
    const browserMockContents = await loadBrowserMockMarkdownContents();
    Object.entries(fileContents).forEach(([relativePath, content]) => {
        browserMockContents[relativePath] = content;
    });
}

export function MockVaultPanel(props: MockVaultPanelProps): ReactNode {
    const { openTab } = props;
    const fileContents = useMemo(() => createCurrentMockFileContents(), []);

    useEffect(() => {
        void primeBrowserMockContents(fileContents);
    }, [fileContents]);

    const files = useMemo<FileTreeItem[]>(
        () =>
            Object.keys(fileContents)
                .sort((left, right) => left.localeCompare(right))
                .map((path) => ({ id: path, path })),
        [fileContents],
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
                    const content = fileContents[item.path] ?? `# ${item.path}`;
                    openTab(createFileTab(item, content));
                }}
            />
        </div>
    );
}