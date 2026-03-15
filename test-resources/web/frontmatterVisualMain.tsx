/**
 * @module test-resources/web/frontmatterVisualMain
 * @description Frontmatter 可视化编辑器的浏览器调试入口：先在 Web 环境验证交互，再接入 Tauri。
 * @dependencies
 *  - react
 *  - react-dom
 *  - ../../src/plugins/markdown-codemirror/editor/components/FrontmatterYamlVisualEditor
 *
 * @example
 *   访问 /test-resources/web/frontmatter-visual-test.html
 */

import React from "react";
import ReactDOM from "react-dom/client";
import { FrontmatterYamlVisualEditor } from "../../src/plugins/markdown-codemirror/editor/components/FrontmatterYamlVisualEditor";
import "../../src/App.css";

/**
 * @constant SAMPLE_FRONTMATTER
 * @description 浏览器调试用 frontmatter 示例文本。
 */
const SAMPLE_FRONTMATTER = `title: Network Segment
category:
  - Data-Link-Layer
date: 2024-11-25 22:46:42
tags: [Entry, Computer-Science, Network]
dg-publish: true
aliases:
  - 网段`;

/**
 * @function FrontmatterVisualTestApp
 * @description 渲染 frontmatter 可视化调试页面。
 * @returns React 节点。
 */
function FrontmatterVisualTestApp(): React.ReactNode {
    return (
        <main style={{ padding: "20px", maxWidth: "1080px", margin: "0 auto" }}>
            <h2 style={{ color: "var(--text-primary)", marginTop: 0 }}>Frontmatter Visual Editor (Web Debug)</h2>
            <p style={{ color: "var(--text-secondary)", marginTop: 0 }}>
                该页面用于 mock Tauri 自动保存行为：编辑后会自动触发保存回调（仅日志输出）。
            </p>
            <FrontmatterYamlVisualEditor
                initialYamlText={SAMPLE_FRONTMATTER}
                onCommitYaml={(yamlText) => {
                    console.info("[frontmatter-visual-test] commit payload", {
                        yamlText,
                    });
                    return {
                        success: true,
                        message: "已同步到文档（Web mock）。",
                    };
                }}
            />
        </main>
    );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
        <FrontmatterVisualTestApp />
    </React.StrictMode>,
);
