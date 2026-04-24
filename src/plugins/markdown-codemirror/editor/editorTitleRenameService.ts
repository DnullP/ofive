/**
 * @module plugins/markdown-codemirror/editor/editorTitleRenameService
 * @description 编辑器标题重命名服务：封装顶部标题栏改名的 optimistic panel 更新、文件重命名与上下文同步。
 * @dependencies
 *  - ./noteTitleUtils
 *  - ./editorModePolicy
 *
 * @example
 *   const result = await commitEditorTitleRename({
 *     articleId: "file:demo",
 *     panelId: "file:demo",
 *     sourcePath: "notes/demo.md",
 *     draftTitle: "Demo 2",
 *     latestContent: "# Demo 2",
 *     submitReason: "enter",
 *     displayMode: "edit",
 *     containerApi,
 *     panelParams: {},
 *     dependencies,
 *     focusEditorBodyStart: () => {},
 *   });
 *
 * @exports
 *  - TitleSubmitReason: 标题提交来源
 *  - commitEditorTitleRename: 执行标题重命名流程
 */

import type { EditorDisplayMode } from "../../../host/editor/editorDisplayModeStore";
import { resolveMarkdownNoteTitle, resolveRenamedMarkdownPath } from "./noteTitleUtils";

/**
 * @description 标题提交来源。
 */
export type TitleSubmitReason = "blur" | "enter";

/**
 * @interface EditorTitleRenamePanelApi
 * @description 标题重命名流程需要的 panel API 能力。
 */
interface EditorTitleRenamePanelApi {
    /** 更新面板标题。 */
    setTitle?(title: string): void;
    /** 更新面板参数。 */
    updateParameters?(params: Record<string, unknown>): void;
    /** 激活面板。 */
    setActive(): void;
}

/**
 * @interface EditorTitleRenamePanelLike
 * @description 重命名流程需要访问的最小 panel 结构。
 */
interface EditorTitleRenamePanelLike {
    /** 面板 id。 */
    id: string;
    /** 面板参数。 */
    params?: Record<string, unknown>;
    /** 面板 API。 */
    api: EditorTitleRenamePanelApi;
}

/**
 * @interface EditorTitleRenameContainerLike
 * @description 重命名流程需要的最小 Dockview 容器能力。
 */
export interface EditorTitleRenameContainerLike {
    /** 通过 id 获取 panel。 */
    getPanel(panelId: string): EditorTitleRenamePanelLike | undefined | null;
}

/**
 * @interface EditorTitleRenameDependencies
 * @description 标题重命名服务依赖的外部副作用。
 */
export interface EditorTitleRenameDependencies {
    /** 调用后端重命名 Markdown 文件。 */
    renameMarkdownFile(sourcePath: string, targetPath: string): Promise<unknown>;
    /** 将最新内容写回重命名后的文件。 */
    saveMarkdownFile(path: string, content: string): Promise<unknown>;
    /** 在没有当前 panel 时打开目标文件。 */
    openFile(options: {
        containerApi: EditorTitleRenameContainerLike;
        currentVaultPath?: string;
        relativePath: string;
        contentOverride?: string;
        tabParams?: Record<string, unknown>;
    }): Promise<unknown>;
    /** 上报文章内容快照。 */
    reportArticleContent(payload: { articleId: string; path: string; content: string }): void;
    /** 上报文章聚焦。 */
    reportArticleFocus(payload: { articleId: string; path: string; content: string }): void;
    /** 上报当前活跃编辑器。 */
    reportActiveEditor(payload: { articleId: string; path: string }): void;
}

/**
 * @interface CommitEditorTitleRenameOptions
 * @description 执行标题重命名所需的上下文参数。
 */
export interface CommitEditorTitleRenameOptions {
    /** 文章 id。 */
    articleId: string;
    /** 当前 panel id。 */
    panelId: string;
    /** Dockview 容器。 */
    containerApi: EditorTitleRenameContainerLike;
    /** 打开 tab 时的原始参数。 */
    panelParams: Record<string, unknown>;
    /** 当前 vault 路径。 */
    currentVaultPath?: string | null;
    /** 当前文件路径。 */
    sourcePath: string;
    /** 用户输入的标题草稿。 */
    draftTitle: string;
    /** 当前应写回目标文件的最新内容。 */
    latestContent: string;
    /** 提交来源。 */
    submitReason: TitleSubmitReason;
    /** 当前展示模式。 */
    displayMode: EditorDisplayMode;
    /** 当前是否为活跃编辑器。 */
    isActiveEditor: boolean;
    /** 提交成功后回送焦点到正文。 */
    focusEditorBodyStart(): void;
    /** 外部依赖集合。 */
    dependencies: EditorTitleRenameDependencies;
}

/**
 * @interface CommitEditorTitleRenameResult
 * @description 标题重命名流程的结果。
 */
export interface CommitEditorTitleRenameResult {
    /** 执行结果状态。 */
    status: "skipped-empty" | "skipped-invalid" | "unchanged" | "success" | "failed";
    /** 应回填到标题输入框中的展示值。 */
    nextTitleDraft: string;
    /** 重命名后应使用的路径；失败或跳过时通常为原路径。 */
    nextPath: string;
    /** 失败时附带原始错误。 */
    error?: unknown;
}

/**
 * @function commitEditorTitleRename
 * @description 执行标题重命名流程，并负责 optimistic panel 更新、文件改名、上下文同步与失败回滚。
 * @param options 重命名参数。
 * @returns 流程结果。
 */
export async function commitEditorTitleRename(
    options: CommitEditorTitleRenameOptions,
): Promise<CommitEditorTitleRenameResult> {
    const sourceTitle = resolveMarkdownNoteTitle(options.sourcePath);
    const trimmedDraft = options.draftTitle.trim();

    if (!trimmedDraft) {
        console.warn("[editor] rename title skipped: empty draft", {
            articleId: options.articleId,
            path: options.sourcePath,
            submitReason: options.submitReason,
        });
        if (options.submitReason === "enter" && options.displayMode === "edit") {
            options.focusEditorBodyStart();
        }
        return {
            status: "skipped-empty",
            nextTitleDraft: sourceTitle,
            nextPath: options.sourcePath,
        };
    }

    const targetPath = resolveRenamedMarkdownPath(options.sourcePath, trimmedDraft);
    if (!targetPath) {
        if (options.submitReason === "enter" && options.displayMode === "edit") {
            options.focusEditorBodyStart();
        }
        return {
            status: "skipped-invalid",
            nextTitleDraft: sourceTitle,
            nextPath: options.sourcePath,
        };
    }

    if (targetPath === options.sourcePath) {
        const nextTitleDraft = resolveMarkdownNoteTitle(targetPath);
        if (options.submitReason === "enter" && options.displayMode === "edit") {
            options.focusEditorBodyStart();
        }
        return {
            status: "unchanged",
            nextTitleDraft,
            nextPath: targetPath,
        };
    }

    const currentPanel = options.containerApi.getPanel(options.panelId);
    const panelApi = currentPanel?.api;
    const nextPanelParams = {
        ...options.panelParams,
        path: targetPath,
        content: options.latestContent,
    };
    const previousPanelParams = currentPanel?.params && typeof currentPanel.params === "object"
        ? { ...currentPanel.params }
        : null;
    const previousPanelTitle = resolveMarkdownNoteTitle(options.sourcePath);
    const nextPanelTitle = resolveMarkdownNoteTitle(targetPath);

    console.info("[editor] rename title requested", {
        articleId: options.articleId,
        from: options.sourcePath,
        to: targetPath,
        submitReason: options.submitReason,
    });

    if (currentPanel && panelApi) {
        panelApi.setTitle?.(nextPanelTitle);
        if (currentPanel.params && typeof currentPanel.params === "object") {
            Object.assign(currentPanel.params, nextPanelParams);
        }
        panelApi.updateParameters?.(nextPanelParams);

        console.info("[editor] rename title applied optimistic panel path", {
            articleId: options.articleId,
            from: options.sourcePath,
            to: targetPath,
            submitReason: options.submitReason,
        });
    }

    try {
        await options.dependencies.renameMarkdownFile(options.sourcePath, targetPath);
        await options.dependencies.saveMarkdownFile(targetPath, options.latestContent);

        options.dependencies.reportArticleContent({
            articleId: options.articleId,
            path: targetPath,
            content: options.latestContent,
        });

        if (options.isActiveEditor) {
            options.dependencies.reportActiveEditor({
                articleId: options.articleId,
                path: targetPath,
            });
            options.dependencies.reportArticleFocus({
                articleId: options.articleId,
                path: targetPath,
                content: options.latestContent,
            });
        }

        if (currentPanel && panelApi) {
            panelApi.setTitle?.(nextPanelTitle);
            panelApi.updateParameters?.(nextPanelParams);
        } else {
            await options.dependencies.openFile({
                containerApi: options.containerApi,
                currentVaultPath: options.currentVaultPath ?? undefined,
                relativePath: targetPath,
                contentOverride: options.latestContent,
                tabParams: {
                    autoFocus: options.submitReason === "enter",
                },
            });
        }

        if (options.submitReason === "enter" && options.displayMode === "edit") {
            options.focusEditorBodyStart();
        }

        console.info("[editor] rename title success", {
            articleId: options.articleId,
            from: options.sourcePath,
            to: targetPath,
            submitReason: options.submitReason,
        });

        return {
            status: "success",
            nextTitleDraft: nextPanelTitle,
            nextPath: targetPath,
        };
    } catch (error) {
        if (currentPanel && panelApi) {
            panelApi.setTitle?.(previousPanelTitle);
            if (currentPanel.params && typeof currentPanel.params === "object" && previousPanelParams) {
                Object.assign(currentPanel.params, previousPanelParams);
            }
            if (previousPanelParams) {
                panelApi.updateParameters?.(previousPanelParams);
            }
        }

        console.error("[editor] rename title failed", {
            articleId: options.articleId,
            from: options.sourcePath,
            to: targetPath,
            submitReason: options.submitReason,
            message: error instanceof Error ? error.message : String(error),
        });

        return {
            status: "failed",
            nextTitleDraft: sourceTitle,
            nextPath: options.sourcePath,
            error,
        };
    }
}