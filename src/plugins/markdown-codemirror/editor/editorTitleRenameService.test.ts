/**
 * @module plugins/markdown-codemirror/editor/editorTitleRenameService.test
 * @description editorTitleRenameService 单元测试：验证标题栏改名流程的跳过、成功与回滚语义。
 */

import { describe, expect, mock, test } from "bun:test";

import { commitEditorTitleRename } from "./editorTitleRenameService";

describe("commitEditorTitleRename", () => {
    test("should skip empty title draft and restore original title", async () => {
        const renameMarkdownFile = mock(async () => undefined);
        const focusEditorBodyStart = mock(() => undefined);

        const result = await commitEditorTitleRename({
            articleId: "file:demo",
            panelId: "file:demo",
            containerApi: { getPanel: () => null },
            panelParams: {},
            sourcePath: "notes/demo.md",
            draftTitle: "   ",
            latestContent: "# Demo",
            submitReason: "enter",
            displayMode: "edit",
            isActiveEditor: false,
            focusEditorBodyStart,
            dependencies: {
                renameMarkdownFile,
                saveMarkdownFile: mock(async () => undefined),
                openFile: mock(async () => null),
                reportArticleContent: mock(() => undefined),
                reportArticleFocus: mock(() => undefined),
                reportActiveEditor: mock(() => undefined),
            },
        });

        expect(result).toEqual({
            status: "skipped-empty",
            nextTitleDraft: "demo",
            nextPath: "notes/demo.md",
        });
        expect(renameMarkdownFile).not.toHaveBeenCalled();
        expect(focusEditorBodyStart).toHaveBeenCalledTimes(1);
    });

    test("should rename file and sync active editor context on success", async () => {
        const setTitle = mock(() => undefined);
        const updateParameters = mock(() => undefined);
        const renameMarkdownFile = mock(async () => undefined);
        const saveMarkdownFile = mock(async () => undefined);
        const reportArticleContent = mock(() => undefined);
        const reportArticleFocus = mock(() => undefined);
        const reportActiveEditor = mock(() => undefined);

        const result = await commitEditorTitleRename({
            articleId: "file:demo",
            panelId: "file:demo",
            containerApi: {
                getPanel: () => ({
                    id: "file:demo",
                    params: { path: "notes/demo.md" },
                    api: {
                        setTitle,
                        updateParameters,
                        setActive: mock(() => undefined),
                    },
                }),
            },
            panelParams: { path: "notes/demo.md" },
            currentVaultPath: "/vault",
            sourcePath: "notes/demo.md",
            draftTitle: "renamed note",
            latestContent: "# Renamed",
            submitReason: "blur",
            displayMode: "edit",
            isActiveEditor: true,
            focusEditorBodyStart: mock(() => undefined),
            dependencies: {
                renameMarkdownFile,
                saveMarkdownFile,
                openFile: mock(async () => null),
                reportArticleContent,
                reportArticleFocus,
                reportActiveEditor,
            },
        });

        expect(result).toEqual({
            status: "success",
            nextTitleDraft: "renamed note",
            nextPath: "notes/renamed note.md",
        });
        expect(renameMarkdownFile).toHaveBeenCalledWith("notes/demo.md", "notes/renamed note.md");
        expect(saveMarkdownFile).toHaveBeenCalledWith("notes/renamed note.md", "# Renamed");
        expect(setTitle).toHaveBeenCalledWith("renamed note");
        expect(updateParameters).toHaveBeenCalled();
        expect(reportArticleContent).toHaveBeenCalledWith({
            articleId: "file:demo",
            path: "notes/renamed note.md",
            content: "# Renamed",
        });
        expect(reportActiveEditor).toHaveBeenCalledWith({
            articleId: "file:demo",
            path: "notes/renamed note.md",
        });
        expect(reportArticleFocus).toHaveBeenCalledWith({
            articleId: "file:demo",
            path: "notes/renamed note.md",
            content: "# Renamed",
        });
    });

    test("should revert optimistic panel title when rename fails", async () => {
        const setTitle = mock(() => undefined);
        const updateParameters = mock(() => undefined);

        const result = await commitEditorTitleRename({
            articleId: "file:demo",
            panelId: "file:demo",
            containerApi: {
                getPanel: () => ({
                    id: "file:demo",
                    params: { path: "notes/demo.md" },
                    api: {
                        setTitle,
                        updateParameters,
                        setActive: mock(() => undefined),
                    },
                }),
            },
            panelParams: { path: "notes/demo.md" },
            sourcePath: "notes/demo.md",
            draftTitle: "renamed note",
            latestContent: "# Renamed",
            submitReason: "blur",
            displayMode: "edit",
            isActiveEditor: false,
            focusEditorBodyStart: mock(() => undefined),
            dependencies: {
                renameMarkdownFile: mock(async () => {
                    throw new Error("rename failed");
                }),
                saveMarkdownFile: mock(async () => undefined),
                openFile: mock(async () => null),
                reportArticleContent: mock(() => undefined),
                reportArticleFocus: mock(() => undefined),
                reportActiveEditor: mock(() => undefined),
            },
        });

        expect(result.status).toBe("failed");
        expect(result.nextTitleDraft).toBe("demo");
        expect(result.nextPath).toBe("notes/demo.md");
        expect(setTitle).toHaveBeenNthCalledWith(1, "renamed note");
        expect(setTitle).toHaveBeenNthCalledWith(2, "demo");
        expect(updateParameters).toHaveBeenCalledTimes(2);
    });
});