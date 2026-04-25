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
 *   放入 src/plugins/ 后由插件运行时自动发现并激活。
 *
 * @exports
 *   - activatePlugin 注册并返回清理函数
 */

import { readVaultMarkdownFile } from "../../api/vaultApi";
import { CodeMirrorEditorTab } from "./editor/CodeMirrorEditorTab";
import { registerCodeMirrorSettingsSection } from "./settings/codeMirrorSettingsRegistrar";
import { buildFileTabId, normalizeRelativePath } from "../../host/layout/openFileService";
import { registerFileOpener } from "../../host/registry/fileOpenerRegistry";
import { registerTabComponent } from "../../host/registry/tabComponentRegistry";

function isMarkdownPath(relativePath: string): boolean {
    const normalizedPath = relativePath.toLowerCase();
    return normalizedPath.endsWith(".md") || normalizedPath.endsWith(".markdown");
}

/**
 * @function activatePlugin
 * @description 注册 Markdown CodeMirror opener 与对应 Tab 组件。
 * @returns 插件清理函数。
 */
export function activatePlugin(): () => void {
    const unregisterSettingsSection = registerCodeMirrorSettingsSection();

    const unregisterTabComponent = registerTabComponent({
        id: "codemirror",
        component: CodeMirrorEditorTab as any,
        lifecycleScope: "vault",
        deferPresentationUntilReady: true,
    });

    const unregisterFileOpener = registerFileOpener({
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

    console.info("[codemirrorOpenerPlugin] registered markdown opener plugin");

    return () => {
        unregisterFileOpener();
        unregisterTabComponent();
        unregisterSettingsSection();
        console.info("[codemirrorOpenerPlugin] unregistered markdown opener plugin");
    };
}