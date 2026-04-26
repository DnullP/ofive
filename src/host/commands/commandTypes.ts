/**
 * @module host/commands/commandTypes
 * @description 前端指令系统共享类型：定义命令标识、上下文与注册结构。
 * @dependencies
 *  - ../conditions/conditionEvaluator
 *  - ./shortcutGovernance
 *  - ./shortcutPolicies
 *
 * @example
 *   const definition: CommandDefinition = {
 *       id: "editor.undo",
 *       title: "commands.undo",
 *       execute: (context) => {
 *           context.executeEditorNativeCommand?.("editor.undo");
 *       },
 *   };
 *
 * @exports
 *   - BuiltinCommandId 内置命令标识联合类型
 *   - CommandId 通用命令标识
 *   - EditorNativeCommandId 编辑器原生命令标识
 *   - CreateEntryDraftRequest 创建输入请求结构
 *   - CommandShortcutMeta 快捷键元数据
 *   - CommandScope 命令作用域
 *   - CommandContext 命令执行上下文
 *   - CommandDefinition 命令定义结构
 */

import type { ShortcutCondition } from "../conditions/conditionEvaluator";
import type { CommandRouteClass } from "./shortcutGovernance";
import type { ShortcutBindingPolicy } from "./shortcutPolicies";

/**
 * @type BuiltinCommandId
 * @description 内置指令唯一标识。
 */
export type BuiltinCommandId =
    | "tab.closeFocused"
    | "app.quit"
    | "sidebar.left.toggle"
    | "sidebar.right.toggle"
    | "file.saveFocused"
    | "file.deleteFocused"
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
    | "editor.toggleWikiLink"
    | "editor.insertLink"
    | "editor.insertTask"
    | "editor.insertFrontmatter"
    | "editor.insertTable"
    | "editor.segmentedDeleteBackward";

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
    | "editor.toggleWikiLink"
    | "editor.insertLink"
    | "editor.insertTask"
    | "editor.insertFrontmatter"
    | "editor.insertTable"
    | "editor.segmentedDeleteBackward";

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
 * @interface DeleteConfirmationRequest
 * @description 删除前确认请求：供命令系统在执行破坏性删除前向宿主 UI 请求确认。
 */
export interface DeleteConfirmationRequest {
    /** 目标条目相对路径 */
    relativePath: string;
    /** 是否为目录 */
    isDir: boolean;
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
    openFileTab: (
        relativePath: string,
        content: string,
        tabParams?: Record<string, unknown>,
    ) => void;
    /** 打开任意已注册 tab 能力 */
    openTab?: (tab: {
        id: string;
        title: string;
        component: string;
        params?: Record<string, unknown>;
    }) => void;
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
    /** 通过宿主 UI 请求删除前确认 */
    requestDeleteConfirmation?: (request: DeleteConfirmationRequest) => Promise<boolean>;
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
