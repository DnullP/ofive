/**
 * @module host/commands/commandSystem.rename.test
 * @description commandSystem 中 file.renameFocused 命令的回归测试。
 * @dependencies
 *  - bun:test
 *  - ./commandSystem
 *  - ../events/appEventBus
 *  - ../editor/editorContextStore
 *
 * @example
 *   bun test src/host/commands/commandSystem.rename.test.ts
 */

import { beforeEach, describe, expect, it, mock } from "bun:test";
import { createMockVaultApi } from "../../test-support/mockVaultApi";

mock.module("../../api/vaultApi", () => createMockVaultApi({
    createVaultCanvasFile: async () => ({ relativePath: "", created: false }),
    createVaultDirectory: async () => ({ relativePath: "", created: false }),
    createVaultMarkdownFile: async () => ({ relativePath: "", created: false }),
    saveVaultMarkdownFile: async () => ({ relativePath: "", created: false }),
    searchVaultMarkdown: async () => [],
    suggestWikiLinkTargets: async () => [],
    resolveWikiLinkTarget: async () => null,
    readVaultMarkdownFile: async () => ({ content: "# latest" }),
    getCurrentVaultConfig: async () => ({
        feature_settings: {},
    }),
    saveCurrentVaultConfig: async () => ({
        feature_settings: {},
    }),
}));

const { executeCommand } = await import("./commandSystem");
const {
    subscribeFileTreeRenameRequestedEvent,
} = await import("../events/appEventBus");
const {
    reportArticleFocus,
    resetEditorContext,
} = await import("../editor/editorContextStore");

describe("commandSystem file.renameFocused", () => {
    beforeEach(() => {
        resetEditorContext();
    });

    /**
     * @function should_route_rename_command_to_file_tree_for_focused_article
     * @description 编辑器聚焦时触发重命名命令，应激活文件树面板并请求文件树对当前文章路径进入重命名态。
     */
    it("should route rename command to file tree for focused article", () => {
        reportArticleFocus({
            articleId: "file:notes/demo.md",
            path: "notes/demo.md",
            content: "# Demo",
        });

        let activatedPanelId = "";
        let requestedPath = "";

        const unlisten = subscribeFileTreeRenameRequestedEvent((payload) => {
            requestedPath = payload.path;
        });

        executeCommand("file.renameFocused", {
            activeTabId: null,
            closeTab: () => undefined,
            openFileTab: () => undefined,
            getExistingMarkdownPaths: () => [],
            activatePanel: (panelId) => {
                activatedPanelId = panelId;
            },
        });

        unlisten();

        expect(activatedPanelId).toBe("files");
        expect(requestedPath).toBe("notes/demo.md");
    });

    /**
     * @function should_prefer_file_tree_selection_for_rename_request
     * @description 文件树已选中目录时，重命名命令应优先使用该选中项，而不是当前文章路径。
     */
    it("should prefer file tree selection for rename request", () => {
        reportArticleFocus({
            articleId: "file:notes/demo.md",
            path: "notes/demo.md",
            content: "# Demo",
        });

        let requestedPath = "";

        const unlisten = subscribeFileTreeRenameRequestedEvent((payload) => {
            requestedPath = payload.path;
        });

        executeCommand("file.renameFocused", {
            activeTabId: null,
            closeTab: () => undefined,
            openFileTab: () => undefined,
            getExistingMarkdownPaths: () => [],
            activatePanel: () => undefined,
            getFileTreeSelectedItem: () => ({
                path: "notes/archive",
                isDir: true,
            }),
        });

        unlisten();

        expect(requestedPath).toBe("notes/archive");
    });
});
