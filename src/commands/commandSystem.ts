/**
 * @module commands/commandSystem
 * @description 前端指令系统：统一定义指令对象与执行入口。
 * @dependencies
 *  - ../api/vaultApi
 *  - ../store/editorContextStore
 *
 * @example
 *   executeCommand("tab.closeFocused", { activeTabId: "file:test-resources/notes/guide.md", closeTab: (id) => api.close(id) });
 */

import {
    copyVaultEntry,
    createVaultDirectory,
    createVaultMarkdownFile,
    deleteVaultDirectory,
    deleteVaultMarkdownFile,
    renameVaultMarkdownFile,
    saveVaultMarkdownFile,
} from "../api/vaultApi";
import {
    getArticleSnapshotById,
    getFocusedArticleSnapshot,
} from "../store/editorContextStore";
import type { ShortcutCondition } from "./focusContext";
import {
    getFileTreeClipboardEntry,
    setFileTreeClipboardEntry,
} from "./fileTreeClipboard";

/**
 * @type CommandId
 * @description 指令唯一标识。
 */
export type CommandId =
    | "tab.closeFocused"
    | "app.quit"
    | "sidebar.left.toggle"
    | "sidebar.right.toggle"
    | "file.saveFocused"
    | "file.moveFocusedToDirectory"
    | "folder.createInFocusedDirectory"
    | "file.renameFocused"
    | "note.createNew"
    | "editor.undo"
    | "editor.redo"
    | "editor.selectAll"
    | "editor.find"
    | "editor.toggleComment"
    | "editor.indentMore"
    | "editor.indentLess"
    | "fileTree.copySelected"
    | "fileTree.pasteInDirectory"
    | "fileTree.deleteSelected"
    | "quickSwitcher.open"
    | "commandPalette.open";

/**
 * @type EditorNativeCommandId
 * @description 编辑器原生命令标识。
 */
export type EditorNativeCommandId =
    | "editor.undo"
    | "editor.redo"
    | "editor.selectAll"
    | "editor.find"
    | "editor.toggleComment"
    | "editor.indentMore"
    | "editor.indentLess";

/**
 * @interface CommandShortcutMeta
 * @description 指令快捷键注册元信息。
 */
export interface CommandShortcutMeta {
    /** 默认快捷键 */
    defaultBinding: string;
    /** 是否在设置页暴露可编辑项 */
    editableInSettings: boolean;
}

/**
 * @type CommandScope
 * @description 指令作用域。
 */
export type CommandScope = "global" | "editor";

/**
 * @interface CommandContext
 * @description 指令执行上下文。
 */
export interface CommandContext {
    /** 当前激活 tab id */
    activeTabId: string | null;
    /** 关闭 tab 能力 */
    closeTab: (tabId: string) => void;
    /** 打开文件 tab 能力 */
    openFileTab: (relativePath: string, content: string) => void;
    /** 获取当前文件树中的 Markdown 相对路径列表 */
    getExistingMarkdownPaths: () => string[];
    /** 打开快速切换浮窗 */
    openQuickSwitcher?: () => void;
    /** 打开指令搜索浮窗 */
    openCommandPalette?: () => void;
    /** 打开“移动当前文件到目录”浮窗 */
    openMoveFocusedFileToDirectory?: () => void;
    /** 执行编辑器原生命令 */
    executeEditorNativeCommand?: (commandId: EditorNativeCommandId) => boolean;
    /** 退出应用 */
    quitApplication?: () => void | Promise<void>;
    /** 切换左侧边栏显示/隐藏 */
    toggleLeftSidebarVisibility?: () => void;
    /** 切换右侧边栏显示/隐藏 */
    toggleRightSidebarVisibility?: () => void;
    /** 获取文件树当前选中条目（基于 DOM 焦点元素） */
    getFileTreeSelectedItem?: () => { path: string; isDir: boolean } | null;
    /** 获取文件树粘贴目标目录（基于 DOM 焦点元素） */
    getFileTreePasteTargetDirectory?: () => string;
}

function resolveTargetArticlePath(activeTabId: string | null): string | null {
    const activeArticle = activeTabId ? getArticleSnapshotById(activeTabId) : null;
    const focusedArticle = getFocusedArticleSnapshot();
    return (activeArticle ?? focusedArticle)?.path ?? null;
}

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

function resolveRenamedMarkdownPath(currentPath: string, draftName: string): string | null {
    const normalizedCurrentPath = currentPath.replace(/\\/g, "/");
    const trimmedName = draftName.trim();
    if (!trimmedName) {
        return null;
    }

    const currentFileName = normalizedCurrentPath.split("/").pop() ?? normalizedCurrentPath;
    const hasMarkdownSuffix = /\.(md|markdown)$/i.test(trimmedName);
    const currentSuffixMatch = currentFileName.match(/(\.md|\.markdown)$/i);
    const currentSuffix = currentSuffixMatch?.[0] ?? ".md";
    const nextFileName = hasMarkdownSuffix ? trimmedName : `${trimmedName}${currentSuffix}`;

    const splitIndex = normalizedCurrentPath.lastIndexOf("/");
    if (splitIndex < 0) {
        return nextFileName;
    }

    const parentDirectory = normalizedCurrentPath.slice(0, splitIndex);
    return `${parentDirectory}/${nextFileName}`;
}

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

function resolveCreatedDirectoryPath(directoryPath: string, draftName: string): string | null {
    const trimmedName = draftName.trim().replace(/^\/+|\/+$/g, "");
    if (!trimmedName) {
        return null;
    }

    const normalizedDirectory = directoryPath.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
    return normalizedDirectory ? `${normalizedDirectory}/${trimmedName}` : trimmedName;
}

async function executeCreateFileInFocusedDirectory(context: CommandContext): Promise<void> {
    const targetPath = resolveTargetArticlePath(context.activeTabId);
    const baseDirectory = resolveParentDirectoryByPath(targetPath);
    const draftName = window.prompt("新建文件", "untitled.md");
    if (draftName === null) {
        return;
    }

    const relativePath = resolveCreatedFilePath(baseDirectory, draftName);
    if (!relativePath) {
        return;
    }

    await createVaultMarkdownFile(relativePath, "");
    context.openFileTab(relativePath, "");

    console.info("[command-system] create file command success", {
        baseDirectory,
        relativePath,
    });
}

/**
 * @interface CommandDefinition
 * @description 指令定义结构。
 */
export interface CommandDefinition {
    /** 指令 id */
    id: CommandId;
    /** 指令名称（便于 UI 展示） */
    title: string;
    /** 指令执行函数 */
    execute: (context: CommandContext) => void | Promise<void>;
    /** 指令作用域 */
    scope?: CommandScope;
    /** 指令快捷键元信息（可选） */
    shortcut?: CommandShortcutMeta;
    /** 指令触发条件（可选）；设置后仅当条件满足时快捷键才激活该命令 */
    condition?: ShortcutCondition;
}

/**
 * @constant COMMAND_DEFINITIONS
 * @description 当前系统内置指令集合。
 */
export const COMMAND_DEFINITIONS: Record<CommandId, CommandDefinition> = {
    "tab.closeFocused": {
        id: "tab.closeFocused",
        title: "关闭当前标签页",
        shortcut: {
            defaultBinding: "Ctrl+W",
            editableInSettings: true,
        },
        execute(context) {
            if (!context.activeTabId) {
                console.warn("[command-system] closeFocused skipped: no active tab");
                return;
            }
            context.closeTab(context.activeTabId);
        },
    },
    "app.quit": {
        id: "app.quit",
        title: "退出应用",
        shortcut: {
            defaultBinding: "Cmd+Q",
            editableInSettings: false,
        },
        execute(context) {
            if (!context.quitApplication) {
                console.warn("[command-system] app.quit skipped: quit capability missing");
                return;
            }

            const result = context.quitApplication();
            if (result instanceof Promise) {
                void result.catch((error) => {
                    console.error("[command-system] app.quit failed", {
                        error: error instanceof Error ? error.message : String(error),
                    });
                });
            }
        },
    },
    "sidebar.left.toggle": {
        id: "sidebar.left.toggle",
        title: "显示/隐藏左侧边栏",
        shortcut: {
            defaultBinding: "Cmd+Shift+J",
            editableInSettings: true,
        },
        execute(context) {
            if (!context.toggleLeftSidebarVisibility) {
                console.warn("[command-system] sidebar.left.toggle skipped: toggle capability missing");
                return;
            }

            context.toggleLeftSidebarVisibility();
        },
    },
    "sidebar.right.toggle": {
        id: "sidebar.right.toggle",
        title: "显示/隐藏右侧边栏",
        shortcut: {
            defaultBinding: "Cmd+Shift+K",
            editableInSettings: true,
        },
        execute(context) {
            if (!context.toggleRightSidebarVisibility) {
                console.warn("[command-system] sidebar.right.toggle skipped: toggle capability missing");
                return;
            }

            context.toggleRightSidebarVisibility();
        },
    },
    "file.saveFocused": {
        id: "file.saveFocused",
        title: "保存当前文件",
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
            console.info("[command-system] saveFocused success", {
                articleId: targetArticle.articleId,
                path: targetArticle.path,
                bytes: targetArticle.content.length,
            });
        },
    },
    "note.createNew": {
        id: "note.createNew",
        title: "在当前目录创建文件",
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
        title: "在当前目录创建文件夹",
        shortcut: {
            defaultBinding: "",
            editableInSettings: true,
        },
        async execute(context) {
            const targetPath = resolveTargetArticlePath(context.activeTabId);
            const baseDirectory = resolveParentDirectoryByPath(targetPath);
            const draftName = window.prompt("新建文件夹", "untitled-folder");
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
    "file.renameFocused": {
        id: "file.renameFocused",
        title: "重命名当前文件",
        shortcut: {
            defaultBinding: "",
            editableInSettings: true,
        },
        async execute(context) {
            const activeArticle = context.activeTabId ? getArticleSnapshotById(context.activeTabId) : null;
            const focusedArticle = getFocusedArticleSnapshot();
            const targetArticle = activeArticle ?? focusedArticle;
            const targetPath = targetArticle?.path ?? null;
            if (!targetPath || !targetArticle) {
                console.warn("[command-system] renameFocused skipped: no focused file");
                return;
            }

            const normalizedPath = targetPath.replace(/\\/g, "/");
            const isMarkdownPath =
                normalizedPath.endsWith(".md") || normalizedPath.endsWith(".markdown");
            if (!isMarkdownPath) {
                console.warn("[command-system] renameFocused skipped: focused path is not markdown", {
                    path: normalizedPath,
                });
                return;
            }

            const currentName = normalizedPath.split("/").pop() ?? normalizedPath;
            const draftName = window.prompt("重命名文件", currentName);
            if (draftName === null) {
                return;
            }

            const targetRelativePath = resolveRenamedMarkdownPath(normalizedPath, draftName);
            if (!targetRelativePath || targetRelativePath === normalizedPath) {
                return;
            }

            await renameVaultMarkdownFile(normalizedPath, targetRelativePath);
            context.closeTab(targetArticle.articleId);
            context.openFileTab(targetRelativePath, targetArticle.content);
            console.info("[command-system] renameFocused success", {
                from: normalizedPath,
                to: targetRelativePath,
            });
        },
    },
    "editor.undo": {
        id: "editor.undo",
        title: "撤销",
        scope: "editor",
        condition: "editorFocused",
        shortcut: {
            defaultBinding: "Cmd+Z",
            editableInSettings: true,
        },
        execute(context) {
            context.executeEditorNativeCommand?.("editor.undo");
        },
    },
    "editor.redo": {
        id: "editor.redo",
        title: "重做",
        scope: "editor",
        condition: "editorFocused",
        shortcut: {
            defaultBinding: "Cmd+Shift+Z",
            editableInSettings: true,
        },
        execute(context) {
            context.executeEditorNativeCommand?.("editor.redo");
        },
    },
    "editor.selectAll": {
        id: "editor.selectAll",
        title: "全选",
        scope: "editor",
        condition: "editorFocused",
        shortcut: {
            defaultBinding: "Cmd+A",
            editableInSettings: true,
        },
        execute(context) {
            context.executeEditorNativeCommand?.("editor.selectAll");
        },
    },
    "editor.find": {
        id: "editor.find",
        title: "查找",
        scope: "editor",
        condition: "editorFocused",
        shortcut: {
            defaultBinding: "Cmd+F",
            editableInSettings: true,
        },
        execute(context) {
            context.executeEditorNativeCommand?.("editor.find");
        },
    },
    "editor.toggleComment": {
        id: "editor.toggleComment",
        title: "切换注释",
        scope: "editor",
        condition: "editorFocused",
        shortcut: {
            defaultBinding: "Cmd+/",
            editableInSettings: true,
        },
        execute(context) {
            context.executeEditorNativeCommand?.("editor.toggleComment");
        },
    },
    "editor.indentMore": {
        id: "editor.indentMore",
        title: "增加缩进",
        scope: "editor",
        condition: "editorFocused",
        shortcut: {
            defaultBinding: "Cmd+]",
            editableInSettings: true,
        },
        execute(context) {
            context.executeEditorNativeCommand?.("editor.indentMore");
        },
    },
    "editor.indentLess": {
        id: "editor.indentLess",
        title: "减少缩进",
        scope: "editor",
        condition: "editorFocused",
        shortcut: {
            defaultBinding: "Cmd+[",
            editableInSettings: true,
        },
        execute(context) {
            context.executeEditorNativeCommand?.("editor.indentLess");
        },
    },
    "fileTree.copySelected": {
        id: "fileTree.copySelected",
        title: "复制选中文件",
        condition: "fileTreeFocused",
        shortcut: {
            defaultBinding: "Cmd+C",
            editableInSettings: true,
        },
        execute(context) {
            const selected = context.getFileTreeSelectedItem?.();
            if (!selected) {
                console.warn("[command-system] fileTree.copySelected skipped: no selection");
                return;
            }

            setFileTreeClipboardEntry(selected);
        },
    },
    "fileTree.pasteInDirectory": {
        id: "fileTree.pasteInDirectory",
        title: "粘贴文件到当前目录",
        condition: "fileTreeFocused",
        shortcut: {
            defaultBinding: "Cmd+V",
            editableInSettings: true,
        },
        async execute(context) {
            const entry = getFileTreeClipboardEntry();
            if (!entry) {
                console.warn("[command-system] fileTree.pasteInDirectory skipped: clipboard empty");
                return;
            }

            const targetDirectory = context.getFileTreePasteTargetDirectory?.() ?? "";

            console.info("[command-system] fileTree.pasteInDirectory start", {
                sourcePath: entry.path,
                targetDirectory,
                isDir: entry.isDir,
            });

            try {
                const result = await copyVaultEntry(entry.path, targetDirectory);
                console.info("[command-system] fileTree.pasteInDirectory success", {
                    newPath: result.relativePath,
                    sourcePath: result.sourceRelativePath,
                });
            } catch (error) {
                console.error("[command-system] fileTree.pasteInDirectory failed", {
                    sourcePath: entry.path,
                    targetDirectory,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        },
    },
    "fileTree.deleteSelected": {
        id: "fileTree.deleteSelected",
        title: "删除选中文件",
        condition: "fileTreeFocused",
        shortcut: {
            defaultBinding: "Cmd+Backspace",
            editableInSettings: true,
        },
        async execute(context) {
            const selected = context.getFileTreeSelectedItem?.();
            if (!selected) {
                console.warn("[command-system] fileTree.deleteSelected skipped: no selection");
                return;
            }

            console.info("[command-system] fileTree.deleteSelected start", {
                path: selected.path,
                isDir: selected.isDir,
            });

            try {
                if (selected.isDir) {
                    await deleteVaultDirectory(selected.path);
                } else {
                    await deleteVaultMarkdownFile(selected.path);
                }
                console.info("[command-system] fileTree.deleteSelected success", {
                    path: selected.path,
                    isDir: selected.isDir,
                });
            } catch (error) {
                console.error("[command-system] fileTree.deleteSelected failed", {
                    path: selected.path,
                    isDir: selected.isDir,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        },
    },
    "file.moveFocusedToDirectory": {
        id: "file.moveFocusedToDirectory",
        title: "移动当前文件到目录",
        execute(context) {
            if (!context.openMoveFocusedFileToDirectory) {
                console.warn("[command-system] moveFocusedToDirectory skipped: open capability missing");
                return;
            }

            context.openMoveFocusedFileToDirectory();
            console.info("[command-system] moveFocusedToDirectory opened");
        },
    },
    "quickSwitcher.open": {
        id: "quickSwitcher.open",
        title: "快速切换",
        shortcut: {
            defaultBinding: "Cmd+O",
            editableInSettings: true,
        },
        execute(context) {
            if (!context.openQuickSwitcher) {
                console.warn("[command-system] quickSwitcher skipped: open capability missing");
                return;
            }

            context.openQuickSwitcher();
            console.info("[command-system] quickSwitcher opened");
        },
    },
    "commandPalette.open": {
        id: "commandPalette.open",
        title: "打开指令搜索",
        shortcut: {
            defaultBinding: "Cmd+J",
            editableInSettings: true,
        },
        execute(context) {
            if (!context.openCommandPalette) {
                console.warn("[command-system] commandPalette skipped: open capability missing");
                return;
            }

            context.openCommandPalette();
            console.info("[command-system] commandPalette opened");
        },
    },
};

/**
 * @function executeCommand
 * @description 执行指定指令。
 * @param commandId 指令 id。
 * @param context 指令执行上下文。
 */
export function executeCommand(commandId: CommandId, context: CommandContext): void {
    const command = COMMAND_DEFINITIONS[commandId];
    if (!command) {
        console.warn("[command-system] command not found", { commandId });
        return;
    }

    console.info("[command-system] execute", { commandId });
    const executeResult = command.execute(context);
    if (executeResult instanceof Promise) {
        void executeResult.catch((error) => {
            console.error("[command-system] execute failed", {
                commandId,
                error: error instanceof Error ? error.message : String(error),
            });
        });
    }
}

/**
 * @function getEditableShortcutCommandDefinitions
 * @description 获取可在设置页编辑快捷键的指令定义列表。
 * @returns 指令定义数组。
 */
export function getEditableShortcutCommandDefinitions(): CommandDefinition[] {
    return Object.values(COMMAND_DEFINITIONS)
        .filter((command) => command.shortcut?.editableInSettings === true);
}

/**
 * @function getCommandDefinitions
 * @description 获取系统内全部指令定义。
 * @returns 指令定义数组。
 */
export function getCommandDefinitions(): CommandDefinition[] {
    return Object.values(COMMAND_DEFINITIONS);
}

/**
 * @function isEditorScopedCommand
 * @description 判断是否为编辑器作用域指令。
 * @param commandId 指令 id。
 * @returns 编辑器作用域返回 true。
 */
export function isEditorScopedCommand(commandId: CommandId): boolean {
    return (COMMAND_DEFINITIONS[commandId]?.scope ?? "global") === "editor";
}

/**
 * @function getCommandCondition
 * @description 获取指令的触发条件。
 * @param commandId 指令 id。
 * @returns 条件标识；无条件时返回 undefined。
 */
export function getCommandCondition(commandId: CommandId): ShortcutCondition | undefined {
    return COMMAND_DEFINITIONS[commandId]?.condition;
}
