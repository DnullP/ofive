/**
 * @module host/commands/builtins/fileCommands
 * @description 内置文件命令：保存、创建、重命名与移动当前文件。
 * @dependencies
 *  - ../../../api/vaultApi
 *  - ../../../i18n
 *  - ../../../utils/canvasFileSpec
 *  - ../../events/appEventBus
 *  - ../../editor/autoSaveService
 *  - ../../editor/editorContextStore
 *  - ../commandTypes
 *
 * @example
 *   FILE_COMMAND_DEFINITIONS["file.saveFocused"].execute(context);
 *
 * @exports
 *   - FILE_COMMAND_DEFINITIONS 文件域内置命令集合
 */

import {
    createVaultCanvasFile,
    createVaultDirectory,
    createVaultMarkdownFile,
    deleteVaultBinaryFile,
    deleteVaultCanvasFile,
    deleteVaultDirectory,
    deleteVaultMarkdownFile,
    saveVaultMarkdownFile,
} from "../../../api/vaultApi";
import i18n from "../../../i18n";
import {
    buildCreatedCanvasInitialContent,
    resolveCreatedCanvasPath,
} from "../../../utils/canvasFileSpec";
import { emitFileTreeRenameRequestedEvent } from "../../events/appEventBus";
import { markContentAsSaved } from "../../editor/autoSaveService";
import {
    getArticleSnapshotById,
    getFocusedArticleSnapshot,
} from "../../editor/editorContextStore";
import type { CommandContext, CommandDefinition } from "../commandTypes";

interface TargetArticleSnapshot {
    articleId: string;
    path: string;
    content: string;
}

/**
 * @function resolveTargetArticle
 * @description 解析当前命令目标文章，优先活动 tab，其次编辑器聚焦文章。
 * @param activeTabId 当前激活 tab id。
 * @returns 目标文章快照；不存在时返回 null。
 */
function resolveTargetArticle(activeTabId: string | null): TargetArticleSnapshot | null {
    const activeArticle = activeTabId ? getArticleSnapshotById(activeTabId) : null;
    const focusedArticle = getFocusedArticleSnapshot();
    return (activeArticle ?? focusedArticle) ?? null;
}

/**
 * @function resolveTargetArticlePath
 * @description 解析当前命令目标文章路径，优先活动 tab，其次编辑器聚焦文章。
 * @param activeTabId 当前激活 tab id。
 * @returns 目标相对路径；不存在时返回 null。
 */
function resolveTargetArticlePath(activeTabId: string | null): string | null {
    return resolveTargetArticle(activeTabId)?.path ?? null;
}

/**
 * @function deleteVaultEntryByPath
 * @description 按路径类型删除 vault 条目。
 * @param relativePath 目标条目相对路径。
 * @returns Promise 完成后返回 void。
 */
async function deleteVaultEntryByPath(relativePath: string): Promise<void> {
    if (relativePath.endsWith(".md") || relativePath.endsWith(".markdown")) {
        await deleteVaultMarkdownFile(relativePath);
        return;
    }

    if (relativePath.endsWith(".canvas")) {
        await deleteVaultCanvasFile(relativePath);
        return;
    }

    if (!relativePath.includes(".")) {
        await deleteVaultDirectory(relativePath);
        return;
    }

    await deleteVaultBinaryFile(relativePath);
}

/**
 * @function resolveParentDirectoryByPath
 * @description 根据文件路径解析父目录。
 * @param path 文件或目录路径。
 * @returns 父目录相对路径；位于根目录时返回空字符串。
 */
function resolveParentDirectoryByPath(path: string | null): string {
    if (!path) {
        return "";
    }

    const normalizedPath = path.replace(/\\/g, "/");
    const splitIndex = normalizedPath.lastIndexOf("/");
    if (splitIndex < 0) {
        return "";
    }

    return normalizedPath.slice(0, splitIndex);
}

/**
 * @function resolveCreatedFilePath
 * @description 将用户输入的文件草稿名解析为 Markdown 相对路径。
 * @param directoryPath 目标目录。
 * @param draftName 用户输入名称。
 * @returns 规范化后的相对路径；名称无效时返回 null。
 */
function resolveCreatedFilePath(directoryPath: string, draftName: string): string | null {
    const trimmedName = draftName.trim();
    if (!trimmedName) {
        return null;
    }

    const hasSuffix = /\.(md|markdown)$/i.test(trimmedName);
    const fileName = hasSuffix ? trimmedName : `${trimmedName}.md`;
    const normalizedDirectory = directoryPath.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
    return normalizedDirectory ? `${normalizedDirectory}/${fileName}` : fileName;
}

/**
 * @function resolveCreatedDirectoryPath
 * @description 将用户输入的文件夹名称解析为目标目录路径。
 * @param directoryPath 基础目录。
 * @param draftName 用户输入名称。
 * @returns 规范化后的目录路径；名称无效时返回 null。
 */
function resolveCreatedDirectoryPath(directoryPath: string, draftName: string): string | null {
    const trimmedName = draftName.trim().replace(/^\/+|\/+$/g, "");
    if (!trimmedName) {
        return null;
    }

    const normalizedDirectory = directoryPath.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
    return normalizedDirectory ? `${normalizedDirectory}/${trimmedName}` : trimmedName;
}

/**
 * @function buildCreatedMarkdownInitialContent
 * @description 为新建 Markdown 文件生成初始正文，仅保留去后缀的一级标题。
 * @param relativePath 新文件相对路径。
 * @returns 初始正文。
 */
function buildCreatedMarkdownInitialContent(relativePath: string): string {
    const fileName = relativePath.split("/").pop() ?? relativePath;
    const title = fileName.replace(/\.(md|markdown)$/i, "");
    return `# ${title}\n`;
}

/**
 * @function resolveBaseDirectoryForCreateCommand
 * @description 解析创建命令目标目录，优先文件树选中项，其次当前文章目录。
 * @param context 命令执行上下文。
 * @returns 目标目录相对路径；仓库根目录返回空字符串。
 */
function resolveBaseDirectoryForCreateCommand(context: CommandContext): string {
    const selectedFileTreeItem = context.getFileTreeSelectedItem?.();
    if (selectedFileTreeItem) {
        return selectedFileTreeItem.isDir
            ? selectedFileTreeItem.path.replace(/\\/g, "/")
            : resolveParentDirectoryByPath(selectedFileTreeItem.path);
    }

    const targetPath = resolveTargetArticlePath(context.activeTabId);
    return resolveParentDirectoryByPath(targetPath);
}

/**
 * @function executeCreateFileInFocusedDirectory
 * @description 在解析后的目标目录中创建 Markdown 文件并立即打开。
 * @param context 命令执行上下文。
 * @returns Promise 完成后返回 void。
 */
async function executeCreateFileInFocusedDirectory(context: CommandContext): Promise<void> {
    const baseDirectory = resolveBaseDirectoryForCreateCommand(context);
    if (!context.requestCreateEntryDraft) {
        console.warn("[command-system] create file command skipped: requestCreateEntryDraft missing");
        return;
    }

    const draftName = await context.requestCreateEntryDraft({
        kind: "file",
        baseDirectory,
        title: i18n.t("commands.newFilePrompt"),
        placeholder: i18n.t("fileTree.newFilePlaceholder"),
        initialValue: "untitled",
    });
    if (draftName === null) {
        return;
    }

    const relativePath = resolveCreatedFilePath(baseDirectory, draftName);
    if (!relativePath) {
        return;
    }

    const initialContent = buildCreatedMarkdownInitialContent(relativePath);

    await createVaultMarkdownFile(relativePath, initialContent);
    context.openFileTab(relativePath, initialContent, {
        autoFocus: true,
        initialCursorOffset: initialContent.length,
    });

    console.info("[command-system] create file command success", {
        baseDirectory,
        relativePath,
    });
}

/**
 * @function executeCreateCanvasInFocusedDirectory
 * @description 在解析后的目标目录中创建 Canvas 文件并立即打开。
 * @param context 命令执行上下文。
 * @returns Promise 完成后返回 void。
 */
async function executeCreateCanvasInFocusedDirectory(context: CommandContext): Promise<void> {
    const baseDirectory = resolveBaseDirectoryForCreateCommand(context);
    if (!context.requestCreateEntryDraft) {
        console.warn("[command-system] create canvas command skipped: requestCreateEntryDraft missing");
        return;
    }

    const draftName = await context.requestCreateEntryDraft({
        kind: "file",
        baseDirectory,
        title: i18n.t("commands.newCanvasPrompt"),
        placeholder: i18n.t("fileTree.newCanvasPlaceholder"),
        initialValue: "untitled-canvas",
    });
    if (draftName === null) {
        return;
    }

    const relativePath = resolveCreatedCanvasPath(baseDirectory, draftName);
    if (!relativePath) {
        return;
    }

    const initialContent = buildCreatedCanvasInitialContent(relativePath);

    await createVaultCanvasFile(relativePath, initialContent);
    context.openFileTab(relativePath, initialContent, {
        autoFocus: true,
    });

    console.info("[command-system] create canvas command success", {
        baseDirectory,
        relativePath,
    });
}

/**
 * @constant FILE_COMMAND_DEFINITIONS
 * @description 文件域内置命令集合。
 */
export const FILE_COMMAND_DEFINITIONS = {
    "file.saveFocused": {
        id: "file.saveFocused",
        title: "commands.saveCurrentFile",
        shortcut: {
            defaultBinding: "Cmd+S",
            editableInSettings: true,
        },
        async execute(context) {
            const activeTabId = context.activeTabId;
            if (!activeTabId) {
                console.warn("[command-system] saveFocused skipped: no active tab");
                return;
            }

            const activeArticle = getArticleSnapshotById(activeTabId);
            const focusedArticle = getFocusedArticleSnapshot();
            const targetArticle = activeArticle ?? focusedArticle;

            if (!targetArticle) {
                console.warn("[command-system] saveFocused skipped: no article snapshot", {
                    activeTabId,
                });
                return;
            }

            await saveVaultMarkdownFile(targetArticle.path, targetArticle.content);
            markContentAsSaved(targetArticle.path, targetArticle.content);
            console.info("[command-system] saveFocused success", {
                articleId: targetArticle.articleId,
                path: targetArticle.path,
                bytes: targetArticle.content.length,
            });
        },
    },
    "file.deleteFocused": {
        id: "file.deleteFocused",
        title: "commands.deleteCurrentFile",
        condition: "editorFocused",
        shortcut: {
            defaultBinding: "Cmd+Backspace",
            editableInSettings: true,
        },
        async execute(context) {
            const targetArticle = resolveTargetArticle(context.activeTabId);
            if (!targetArticle) {
                console.warn("[command-system] deleteFocused skipped: no article snapshot", {
                    activeTabId: context.activeTabId,
                });
                return;
            }

            console.info("[command-system] deleteFocused start", {
                articleId: targetArticle.articleId,
                path: targetArticle.path,
            });

            await deleteVaultEntryByPath(targetArticle.path);
            context.closeTab(targetArticle.articleId);

            console.info("[command-system] deleteFocused success", {
                articleId: targetArticle.articleId,
                path: targetArticle.path,
            });
        },
    },
    "note.createNew": {
        id: "note.createNew",
        title: "commands.createFileInDir",
        shortcut: {
            defaultBinding: "",
            editableInSettings: true,
        },
        async execute(context) {
            await executeCreateFileInFocusedDirectory(context);
        },
    },
    "folder.createInFocusedDirectory": {
        id: "folder.createInFocusedDirectory",
        title: "commands.createFolderInDir",
        shortcut: {
            defaultBinding: "",
            editableInSettings: true,
        },
        async execute(context) {
            const baseDirectory = resolveBaseDirectoryForCreateCommand(context);
            if (!context.requestCreateEntryDraft) {
                console.warn("[command-system] create folder command skipped: requestCreateEntryDraft missing");
                return;
            }

            const draftName = await context.requestCreateEntryDraft({
                kind: "folder",
                baseDirectory,
                title: i18n.t("commands.newFolderPrompt"),
                placeholder: i18n.t("fileTree.newFolderPlaceholder"),
                initialValue: "untitled-folder",
            });
            if (draftName === null) {
                return;
            }

            const relativeDirectoryPath = resolveCreatedDirectoryPath(baseDirectory, draftName);
            if (!relativeDirectoryPath) {
                return;
            }

            await createVaultDirectory(relativeDirectoryPath);
            console.info("[command-system] create folder command success", {
                baseDirectory,
                relativeDirectoryPath,
            });
        },
    },
    "canvas.createInFocusedDirectory": {
        id: "canvas.createInFocusedDirectory",
        title: "commands.createCanvasInDir",
        shortcut: {
            defaultBinding: "",
            editableInSettings: true,
        },
        async execute(context) {
            await executeCreateCanvasInFocusedDirectory(context);
        },
    },
    "file.renameFocused": {
        id: "file.renameFocused",
        title: "commands.renameCurrent",
        shortcut: {
            defaultBinding: "",
            editableInSettings: true,
        },
        execute(context) {
            const selectedFileTreeItem = context.getFileTreeSelectedItem?.() ?? null;
            const activeArticle = context.activeTabId ? getArticleSnapshotById(context.activeTabId) : null;
            const focusedArticle = getFocusedArticleSnapshot();
            const targetPath =
                selectedFileTreeItem?.path ?? activeArticle?.path ?? focusedArticle?.path ?? null;
            if (!targetPath) {
                console.warn("[command-system] renameFocused skipped: no focused file");
                return;
            }

            const normalizedPath = targetPath.replace(/\\/g, "/");
            const isRenamablePath =
                normalizedPath.endsWith(".md") ||
                normalizedPath.endsWith(".markdown") ||
                normalizedPath.endsWith(".canvas") ||
                selectedFileTreeItem?.isDir === true;
            if (!isRenamablePath) {
                console.warn("[command-system] renameFocused skipped: focused path is not renamable", {
                    path: normalizedPath,
                });
                return;
            }

            context.activatePanel?.("files");
            emitFileTreeRenameRequestedEvent({ path: normalizedPath });
            console.info("[command-system] renameFocused: emitted rename request", {
                path: normalizedPath,
            });
        },
    },
    "file.moveFocusedToDirectory": {
        id: "file.moveFocusedToDirectory",
        title: "commands.moveFileToDir",
        execute(context) {
            if (!context.openMoveFocusedFileToDirectory) {
                console.warn(
                    "[command-system] moveFocusedToDirectory skipped: open capability missing",
                );
                return;
            }

            context.openMoveFocusedFileToDirectory();
            console.info("[command-system] moveFocusedToDirectory opened");
        },
    },
} satisfies Record<string, CommandDefinition>;