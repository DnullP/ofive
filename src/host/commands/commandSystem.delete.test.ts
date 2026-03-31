/**
 * @module host/commands/commandSystem.delete.test
 * @description commandSystem 中 file.deleteFocused 命令的回归测试。
 * @dependencies
 *  - bun:test
 *  - ./commandSystem
 *  - ../editor/editorContextStore
 *
 * @example
 *   bun test src/host/commands/commandSystem.delete.test.ts
 */

import { beforeEach, describe, expect, it, mock } from "bun:test";

let deletedMarkdownPath = "";
let deletedCanvasPath = "";

/**
 * @function flushAsyncCommandExecution
 * @description 等待异步命令执行链路完成，避免测试在 Promise 结算前断言。
 * @returns Promise 完成后返回 void。
 */
function flushAsyncCommandExecution(): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, 0);
    });
}

mock.module("../../api/vaultApi", () => ({
    createVaultCanvasFile: async () => ({ relativePath: "", created: false }),
    createVaultDirectory: async () => ({ relativePath: "", created: false }),
    createVaultMarkdownFile: async () => ({ relativePath: "", created: false }),
    deleteVaultBinaryFile: async () => undefined,
    deleteVaultCanvasFile: async (relativePath: string) => {
        deletedCanvasPath = relativePath;
    },
    deleteVaultDirectory: async () => undefined,
    deleteVaultMarkdownFile: async (relativePath: string) => {
        deletedMarkdownPath = relativePath;
    },
    saveVaultMarkdownFile: async () => ({ relativePath: "", created: false }),
    searchVaultMarkdown: async () => [],
    suggestWikiLinkTargets: async () => [],
    resolveWikiLinkTarget: async () => null,
    isSelfTriggeredVaultFsEvent: () => false,
    readVaultMarkdownFile: async () => ({ content: "# latest" }),
    isTauriRuntime: () => false,
    getCurrentVaultConfig: async () => ({
        feature_settings: {},
    }),
    saveCurrentVaultConfig: async () => ({
        feature_settings: {},
    }),
    isSelfTriggeredVaultConfigEvent: () => false,
    subscribeVaultFsEvents: async () => {
        return () => {
            /* noop */
        };
    },
    subscribeVaultConfigEvents: async () => {
        return () => {
            /* noop */
        };
    },
}));

const { executeCommand } = await import("./commandSystem");
const {
    reportArticleFocus,
    resetEditorContext,
} = await import("../editor/editorContextStore");

describe("commandSystem file.deleteFocused", () => {
    beforeEach(() => {
        resetEditorContext();
        deletedMarkdownPath = "";
        deletedCanvasPath = "";
    });

    /**
     * @function should_delete_focused_markdown_file_and_close_tab
     * @description 编辑器聚焦 Markdown 文件时，应删除当前文件并关闭其标签页。
     */
    it("should delete focused markdown file and close tab", async () => {
        reportArticleFocus({
            articleId: "file:notes/demo.md",
            path: "notes/demo.md",
            content: "# Demo",
        });

        let closedTabId = "";

        executeCommand("file.deleteFocused", {
            activeTabId: null,
            closeTab: (tabId) => {
                closedTabId = tabId;
            },
            openFileTab: () => undefined,
            getExistingMarkdownPaths: () => [],
        });

        await flushAsyncCommandExecution();

        expect(deletedMarkdownPath).toBe("notes/demo.md");
        expect(closedTabId).toBe("file:notes/demo.md");
    });

    /**
     * @function should_prefer_active_tab_snapshot_when_deleting_current_file
     * @description 存在活动 tab 时，删除命令应优先删除该 tab 对应的文件。
     */
    it("should prefer active tab snapshot when deleting current file", async () => {
        reportArticleFocus({
            articleId: "file:notes/focused.md",
            path: "notes/focused.md",
            content: "# Focused",
        });
        reportArticleFocus({
            articleId: "file:notes/board.canvas",
            path: "notes/board.canvas",
            content: "{}",
        });

        let closedTabId = "";

        executeCommand("file.deleteFocused", {
            activeTabId: "file:notes/board.canvas",
            closeTab: (tabId) => {
                closedTabId = tabId;
            },
            openFileTab: () => undefined,
            getExistingMarkdownPaths: () => [],
        });

        await flushAsyncCommandExecution();

        expect(deletedCanvasPath).toBe("notes/board.canvas");
        expect(closedTabId).toBe("file:notes/board.canvas");
    });
});