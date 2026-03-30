/**
 * @module host/commands/commandSystem
 * @description 前端指令系统：统一定义指令对象与执行入口。
 * @dependencies
 *  - ../../api/vaultApi
 *  - ../store/editorContextStore
 *
 * @example
 *   executeCommand("tab.closeFocused", { activeTabId: "file:test-resources/notes/guide.md", closeTab: (id) => api.close(id) });
 */

import {
    createVaultCanvasFile,
    createVaultDirectory,
    createVaultMarkdownFile,
    saveVaultMarkdownFile,
} from "../../api/vaultApi";
import i18n from "../../i18n";
import {
    buildCreatedCanvasInitialContent,
    resolveCreatedCanvasPath,
} from "../../utils/canvasFileSpec";
import {
    getArticleSnapshotById,
    getFocusedArticleSnapshot,
} from "../store/editorContextStore";
import { markContentAsSaved } from "../store/autoSaveService";
import { emitFileTreeRenameRequestedEvent } from "../events/appEventBus";
import type { ShortcutCondition } from "../conditions/conditionEvaluator";
import type { CommandRouteClass } from "./shortcutGovernance";
import type { ShortcutBindingPolicy } from "./shortcutPolicies";

/**
 * @type BuiltinCommandId
 * @description 内置指令唯一标识。
 */
type BuiltinCommandId =
    | "tab.closeFocused"
    | "app.quit"
    | "sidebar.left.toggle"
    | "sidebar.right.toggle"
    | "file.saveFocused"
    | "file.moveFocusedToDirectory"
    | "folder.createInFocusedDirectory"
    | "canvas.createInFocusedDirectory"
    | "file.renameFocused"
    | "note.createNew"
    | "editor.undo"
    | "editor.redo"
    | "editor.selectAll"
    | "editor.find"
    | "editor.toggleComment"
    | "editor.indentMore"
    | "editor.indentLess"
    | "editor.toggleBold"
    | "editor.toggleItalic"
    | "editor.toggleStrikethrough"
    | "editor.toggleInlineCode"
    | "editor.toggleHighlight"
    | "editor.insertLink"
    | "editor.insertTask"
    | "editor.insertFrontmatter"
    | "editor.insertTable"
    ;

/**
 * @type CommandId
 * @description 指令唯一标识。
 *   为支持插件扩展，命令 id 对外统一视为 string。
 */
export type CommandId = string;

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
    | "editor.indentLess"
    | "editor.toggleBold"
    | "editor.toggleItalic"
    | "editor.toggleStrikethrough"
    | "editor.toggleInlineCode"
    | "editor.toggleHighlight"
    | "editor.insertLink"
    | "editor.insertTask"
    | "editor.insertFrontmatter"
    | "editor.insertTable";

/**
 * @interface CreateEntryDraftRequest
 * @description 宿主创建输入请求：供命令系统向宿主 UI 请求文件/文件夹名称。
 */
export interface CreateEntryDraftRequest {
    /** 创建类型 */
    kind: "file" | "folder";
    /** 目标目录 */
    baseDirectory: string;
    /** 浮窗标题 */
    title: string;
    /** 输入框占位文案 */
    placeholder: string;
    /** 初始建议名称 */
    initialValue: string;
}

/**
 * @interface CommandShortcutMeta
 * @description 指令快捷键注册元信息。
 */
export interface CommandShortcutMeta {
    /** 默认快捷键 */
    defaultBinding: string;
    /** 是否在设置页暴露可编辑项 */
    editableInSettings: boolean;
    /** 绑定策略 */
    bindingPolicy?: ShortcutBindingPolicy;
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
    openFileTab: (relativePath: string, content: string, tabParams?: Record<string, unknown>) => void;
    /** 打开任意已注册 tab 能力 */
    openTab?: (tab: { id: string; title: string; component: string; params?: Record<string, unknown> }) => void;
    /** 获取当前文件树中的 Markdown 相对路径列表 */
    getExistingMarkdownPaths: () => string[];
    /** 激活侧边栏面板能力 */
    activatePanel?: (panelId: string) => void;
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
    /** 通过宿主 UI 请求用户输入待创建名称 */
    requestCreateEntryDraft?: (request: CreateEntryDraftRequest) => Promise<string | null>;
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
 * @description 解析“新建文件 / 新建文件夹”命令的目标目录。
 *   优先使用文件树当前选中项：
 *   - 选中目录时直接使用该目录
 *   - 选中文件时使用其父目录
 *   若文件树无可用选中项，则回退到当前激活/聚焦文章所在目录。
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
    /** 指令快捷键路由域 */
    routeClass?: CommandRouteClass;
    /** 指令快捷键元信息（可选） */
    shortcut?: CommandShortcutMeta;
    /** 指令触发条件（可选）；设置后仅当条件满足时快捷键才激活该命令 */
    condition?: ShortcutCondition;
    /** 指令触发条件列表（可选）；以 AND 语义与 condition 一并参与评估 */
    conditions?: ShortcutCondition[];
}

/**
 * @constant COMMAND_DEFINITIONS
 * @description 当前系统内置指令集合。
 */
export const COMMAND_DEFINITIONS: Record<BuiltinCommandId, CommandDefinition> = {
    "tab.closeFocused": {
        id: "tab.closeFocused",
        title: "commands.closeCurrentTab",
        routeClass: "frontend-window",
        shortcut: {
            defaultBinding: "Ctrl+W",
            editableInSettings: true,
            bindingPolicy: "prefer-system-reserved",
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
        title: "commands.exitApp",
        routeClass: "native-reserved",
        shortcut: {
            defaultBinding: "Cmd+Q",
            editableInSettings: false,
            bindingPolicy: "system-reserved",
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
        title: "commands.toggleLeftSidebar",
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
        title: "commands.toggleRightSidebar",
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
        /**
         * @description 请求文件树对当前目标文件进入重命名编辑态。
         * 优先使用文件树当前选中项；若文件树未聚焦，则回退到当前活动/聚焦文章路径。
         * @param context 指令执行上下文。
         * @sideEffect 激活 files 面板并发布 fileTree.rename.requested 事件。
         */
        execute(context) {
            const selectedFileTreeItem = context.getFileTreeSelectedItem?.() ?? null;
            const activeArticle = context.activeTabId ? getArticleSnapshotById(context.activeTabId) : null;
            const focusedArticle = getFocusedArticleSnapshot();
            const targetPath = selectedFileTreeItem?.path ?? activeArticle?.path ?? focusedArticle?.path ?? null;
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
    "editor.undo": {
        id: "editor.undo",
        title: "commands.undo",
        scope: "editor",
        routeClass: "frontend-editor",
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
        title: "commands.redo",
        scope: "editor",
        routeClass: "frontend-editor",
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
        title: "commands.selectAll",
        scope: "editor",
        routeClass: "frontend-editor",
        condition: "editorBodyFocused",
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
        title: "commands.find",
        scope: "editor",
        routeClass: "frontend-editor",
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
        title: "commands.toggleComment",
        scope: "editor",
        routeClass: "frontend-editor",
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
        title: "commands.increaseIndent",
        scope: "editor",
        routeClass: "frontend-editor",
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
        title: "commands.decreaseIndent",
        scope: "editor",
        routeClass: "frontend-editor",
        condition: "editorFocused",
        shortcut: {
            defaultBinding: "Cmd+[",
            editableInSettings: true,
        },
        execute(context) {
            context.executeEditorNativeCommand?.("editor.indentLess");
        },
    },
    "editor.toggleBold": {
        id: "editor.toggleBold",
        title: "commands.toggleBold",
        scope: "editor",
        routeClass: "frontend-editor",
        condition: "editorFocused",
        shortcut: {
            defaultBinding: "Cmd+B",
            editableInSettings: true,
        },
        execute(context) {
            context.executeEditorNativeCommand?.("editor.toggleBold");
        },
    },
    "editor.toggleItalic": {
        id: "editor.toggleItalic",
        title: "commands.toggleItalic",
        scope: "editor",
        routeClass: "frontend-editor",
        condition: "editorFocused",
        shortcut: {
            defaultBinding: "Cmd+I",
            editableInSettings: true,
        },
        execute(context) {
            context.executeEditorNativeCommand?.("editor.toggleItalic");
        },
    },
    "editor.toggleStrikethrough": {
        id: "editor.toggleStrikethrough",
        title: "commands.toggleStrikethrough",
        scope: "editor",
        routeClass: "frontend-editor",
        condition: "editorFocused",
        shortcut: {
            defaultBinding: "Cmd+Shift+X",
            editableInSettings: true,
        },
        execute(context) {
            context.executeEditorNativeCommand?.("editor.toggleStrikethrough");
        },
    },
    "editor.toggleInlineCode": {
        id: "editor.toggleInlineCode",
        title: "commands.toggleInlineCode",
        scope: "editor",
        routeClass: "frontend-editor",
        condition: "editorFocused",
        shortcut: {
            defaultBinding: "Cmd+E",
            editableInSettings: true,
        },
        execute(context) {
            context.executeEditorNativeCommand?.("editor.toggleInlineCode");
        },
    },
    "editor.toggleHighlight": {
        id: "editor.toggleHighlight",
        title: "commands.toggleHighlight",
        scope: "editor",
        routeClass: "frontend-editor",
        condition: "editorFocused",
        shortcut: {
            defaultBinding: "Cmd+Shift+H",
            editableInSettings: true,
        },
        execute(context) {
            context.executeEditorNativeCommand?.("editor.toggleHighlight");
        },
    },
    "editor.insertLink": {
        id: "editor.insertLink",
        title: "commands.insertLink",
        scope: "editor",
        routeClass: "frontend-editor",
        condition: "editorFocused",
        shortcut: {
            defaultBinding: "Cmd+K",
            editableInSettings: true,
        },
        execute(context) {
            context.executeEditorNativeCommand?.("editor.insertLink");
        },
    },
    "editor.insertTask": {
        id: "editor.insertTask",
        title: "commands.insertTask",
        scope: "editor",
        routeClass: "frontend-editor",
        condition: "editorFocused",
        shortcut: {
            defaultBinding: "",
            editableInSettings: true,
        },
        execute(context) {
            context.executeEditorNativeCommand?.("editor.insertTask");
        },
    },
    "editor.insertFrontmatter": {
        id: "editor.insertFrontmatter",
        title: "commands.insertFrontmatter",
        scope: "editor",
        routeClass: "frontend-editor",
        condition: "editorFocused",
        shortcut: {
            defaultBinding: "",
            editableInSettings: true,
        },
        execute(context) {
            context.executeEditorNativeCommand?.("editor.insertFrontmatter");
        },
    },
    "editor.insertTable": {
        id: "editor.insertTable",
        title: "commands.insertTable",
        scope: "editor",
        routeClass: "frontend-editor",
        condition: "editorFocused",
        shortcut: {
            defaultBinding: "",
            editableInSettings: true,
        },
        execute(context) {
            context.executeEditorNativeCommand?.("editor.insertTable");
        },
    },
    "file.moveFocusedToDirectory": {
        id: "file.moveFocusedToDirectory",
        title: "commands.moveFileToDir",
        execute(context) {
            if (!context.openMoveFocusedFileToDirectory) {
                console.warn("[command-system] moveFocusedToDirectory skipped: open capability missing");
                return;
            }

            context.openMoveFocusedFileToDirectory();
            console.info("[command-system] moveFocusedToDirectory opened");
        },
    },
};

const commandDefinitionsMap = new Map<string, CommandDefinition>(
    Object.values(COMMAND_DEFINITIONS).map((definition) => [definition.id, definition]),
);
const commandListeners = new Set<() => void>();
let cachedCommandDefinitions = Array.from(commandDefinitionsMap.values());

/**
 * @function emitCommandRegistry
 * @description 广播命令注册表变化。
 */
function emitCommandRegistry(): void {
    cachedCommandDefinitions = Array.from(commandDefinitionsMap.values());
    commandListeners.forEach((listener) => listener());
}

/**
 * @function registerCommand
 * @description 注册单条命令定义；若 id 已存在则覆盖。
 * @param definition 命令定义。
 * @returns 取消注册函数。
 */
export function registerCommand(definition: CommandDefinition): () => void {
    commandDefinitionsMap.set(definition.id, definition);
    console.info("[command-system] registered command", {
        commandId: definition.id,
    });
    emitCommandRegistry();

    return () => {
        unregisterCommand(definition.id);
    };
}

/**
 * @function registerCommands
 * @description 批量注册多条命令定义。
 * @param definitions 命令定义列表。
 * @returns 取消注册函数。
 */
export function registerCommands(definitions: CommandDefinition[]): () => void {
    const cleanupFns = definitions.map((definition) => registerCommand(definition));
    return () => {
        cleanupFns.forEach((cleanup) => cleanup());
    };
}

/**
 * @function unregisterCommand
 * @description 注销指定命令。
 * @param commandId 命令 id。
 */
export function unregisterCommand(commandId: CommandId): void {
    if (commandId in COMMAND_DEFINITIONS) {
        const builtinDefinition = COMMAND_DEFINITIONS[commandId as BuiltinCommandId];
        commandDefinitionsMap.set(commandId, builtinDefinition);
        emitCommandRegistry();
        return;
    }

    if (!commandDefinitionsMap.has(commandId)) {
        return;
    }

    commandDefinitionsMap.delete(commandId);
    console.info("[command-system] unregistered command", { commandId });
    emitCommandRegistry();
}

/**
 * @function subscribeCommands
 * @description 订阅命令注册表变化。
 * @param listener 监听函数。
 * @returns 取消订阅函数。
 */
export function subscribeCommands(listener: () => void): () => void {
    commandListeners.add(listener);
    return () => {
        commandListeners.delete(listener);
    };
}

/**
 * @function getCommandDefinition
 * @description 获取单条命令定义。
 * @param commandId 命令 id。
 * @returns 命令定义；未找到时返回 undefined。
 */
export function getCommandDefinition(commandId: CommandId): CommandDefinition | undefined {
    return commandDefinitionsMap.get(commandId);
}

/**
 * @function executeCommand
 * @description 执行指定指令。
 * @param commandId 指令 id。
 * @param context 指令执行上下文。
 */
export function executeCommand(commandId: CommandId, context: CommandContext): void {
    const command = getCommandDefinition(commandId);
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
    return getCommandDefinitions()
        .filter((command) => command.shortcut?.editableInSettings === true);
}

/**
 * @function getCommandDefinitions
 * @description 获取系统内全部指令定义。
 * @returns 指令定义数组。
 */
export function getCommandDefinitions(): CommandDefinition[] {
    return cachedCommandDefinitions;
}

/**
 * @function isEditorScopedCommand
 * @description 判断是否为编辑器作用域指令。
 * @param commandId 指令 id。
 * @returns 编辑器作用域返回 true。
 */
export function isEditorScopedCommand(commandId: CommandId): boolean {
    return (getCommandDefinition(commandId)?.scope ?? "global") === "editor";
}

/**
 * @function getCommandRouteClass
 * @description 获取命令快捷键路由域。
 * @param commandId 指令 id。
 * @returns 路由域。
 */
export function getCommandRouteClass(commandId: CommandId): CommandRouteClass {
    const definition = getCommandDefinition(commandId);
    if (!definition) {
        return "frontend-window";
    }

    if (definition.routeClass) {
        return definition.routeClass;
    }

    return definition.scope === "editor" ? "frontend-editor" : "frontend-window";
}

/**
 * @function getCommandBindingPolicy
 * @description 获取命令快捷键绑定策略。
 * @param commandId 指令 id。
 * @returns 绑定策略。
 */
export function getCommandBindingPolicy(commandId: CommandId): ShortcutBindingPolicy {
    return getCommandDefinition(commandId)?.shortcut?.bindingPolicy ?? "user-configurable";
}

/**
 * @function getCommandCondition
 * @description 获取指令的触发条件。
 * @param commandId 指令 id。
 * @returns 条件标识；无条件时返回 undefined。
 */
export function getCommandCondition(commandId: CommandId): ShortcutCondition | undefined {
    return getCommandDefinition(commandId)?.condition;
}

/**
 * @function getCommandConditions
 * @description 获取指令全部触发条件。
 *   兼容历史单条件字段，并支持新的复合条件列表。
 * @param commandId 指令 id。
 * @returns 条件数组；无条件时返回空数组。
 */
export function getCommandConditions(commandId: CommandId): ShortcutCondition[] {
    const definition = getCommandDefinition(commandId);
    if (!definition) {
        return [];
    }

    const conditions = [...(definition.conditions ?? [])];
    if (definition.condition) {
        conditions.unshift(definition.condition);
    }

    return [...new Set(conditions)];
}
