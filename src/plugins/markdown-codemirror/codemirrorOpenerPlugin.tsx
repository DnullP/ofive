/**
 * @module plugins/codemirrorOpenerPlugin
 * @description CodeMirror 文件 opener 插件：注册 Markdown opener 与对应的 Tab 组件。
 *
 *   该插件将 Markdown 文件打开能力从宿主内置逻辑迁移为可替换 opener：
 *   - Tab 组件 id: codemirror
 *   - opener id: markdown.codemirror
 *   - kind: markdown
 *
 * @dependencies
 *   - ./editor/CodeMirrorEditorTab
 *   - ../../api/vaultApi
 *   - ../../host/layout/openFileService
 *   - ../../host/registry/fileOpenerRegistry
 *   - ../../host/registry/tabComponentRegistry
 *
 * @example
 *   放入 src/plugins/ 后由 main.tsx 自动发现。
 */

import { readVaultMarkdownFile } from "../../api/vaultApi";
import { CodeMirrorEditorTab } from "./editor/CodeMirrorEditorTab";
import { buildFileTabId, normalizeRelativePath } from "../../host/layout/openFileService";
import { registerFileOpener } from "../../host/registry/fileOpenerRegistry";
import { registerTabComponent } from "../../host/registry/tabComponentRegistry";

function isMarkdownPath(relativePath: string): boolean {
    const normalizedPath = relativePath.toLowerCase();
    return normalizedPath.endsWith(".md") || normalizedPath.endsWith(".markdown");
}

registerTabComponent({
    id: "codemirror",
    component: CodeMirrorEditorTab as any,
});

registerFileOpener({
    id: "markdown.codemirror",
    label: "CodeMirror Markdown Editor",
    kind: "markdown",
    priority: 100,
    matches: ({ relativePath }) => isMarkdownPath(relativePath),
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