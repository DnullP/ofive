/**
 * @module plugins/markdown-codemirror/editor/CodeMirrorEditorTab
 * @description 基于 CodeMirror 6 的编辑器 Tab 组件，用于在 workbench 中承载可编辑文本内容。
 * @dependencies
 *  - react
 *  - workbenchContracts
 *  - codemirror
 *  - @codemirror/lang-markdown
 *  - ./codemirrorTheme
 */

import { Component, useEffect, useMemo, useRef, useState, type CSSProperties, type ErrorInfo, type ReactNode } from "react";
import { BookOpen, SquarePen } from "lucide-react";
import { EditorView } from "codemirror";
import { indentLess, indentMore, redo, toggleComment, undo } from "@codemirror/commands";
import { openSearchPanel } from "@codemirror/search";
import { getCM, Vim } from "@replit/codemirror-vim";
import "./CodeMirrorEditorTab.css";
/* KaTeX 样式：LaTeX 数学公式渲染所需的字体和布局样式 */
import "katex/dist/katex.min.css";
import {
    reportArticleContent,
    reportArticleFocus,
    useArticleById,
} from "../../../host/editor/editorContextStore";
import {
    executeCommand,
    type CommandId,
    type EditorNativeCommandId,
} from "../../../host/commands/commandSystem";
import { useShortcutState } from "../../../host/commands/shortcutStore";
import { useVaultState } from "../../../host/vault/vaultStore";
import {
    renameVaultMarkdownFile,
    saveVaultMarkdownFile,
    segmentChineseText,
} from "../../../api/vaultApi";
import { useConfigState, getConfigSnapshot, DEFAULT_EDITOR_FONT_FAMILY } from "../../../host/config/configStore";
import {
    subscribeEditorCommandRequestedEvent,
    subscribeEditorRevealRequestedEvent,
} from "../../../host/events/appEventBus";
import { reportActiveEditor, useActiveEditor } from "../../../host/editor/activeEditorStore";
import i18n from "../../../i18n";
import { createRegisteredLineSyntaxRenderExtension } from "./syntaxRenderRegistry";
import { ensureBuiltinSyntaxRenderersRegistered } from "./registerBuiltinSyntaxRenderers";
import { ensureBuiltinEditPluginsRegistered } from "./registerBuiltinEditPlugins";
import { ensureBuiltinVimHandoffsRegistered } from "./handoff/registerBuiltinVimHandoffs";
import { collectManagedEditorShortcutCandidates } from "./editorShortcutPolicy";
import {
    toggleBold,
    toggleItalic,
    toggleStrikethrough,
    toggleInlineCode,
    toggleHighlight,
    toggleWikiLink,
    insertLink,
    insertTask,
    insertFrontmatter,
    insertTable,
} from "./markdownFormattingCommands";
import {
    canExecuteEditorNativeCommandInMode,
    toggleEditorDisplayMode,
} from "./editorModePolicy";
import { MarkdownReadView } from "./MarkdownReadView";
import {
    updateEditorDisplayMode,
    useEditorDisplayModeState,
    type EditorDisplayMode,
} from "../../../host/editor/editorDisplayModeStore";
import { evaluateReadModeRenderGuard } from "./readModeRenderGuard";
import { describeRenderFeature } from "./renderParityContract";
import {
    setupVimEnhancedMotions,
} from "./vimChineseMotionExtension";
import { openFileInWorkbench } from "../../../host/layout/openFileService";
import {
    resolveMarkdownNoteTitle,
} from "./noteTitleUtils";
import { resolveEditorBodyAnchor, resolveEditorBodySelectionRange } from "./editorBodyAnchor";
import {
    createImeCompositionGuard,
    shouldSubmitPlainEnter,
} from "../../../utils/imeInputGuard";
import { createEditorChineseSegmentationController } from "./editorChineseSegmentation";
import {
    commitEditorTitleRename,
    type TitleSubmitReason,
} from "./editorTitleRenameService";
import { attachEditorKeyboardBridge } from "./editorKeyboardBridge";
import { useCodeMirrorEditorLifecycle } from "./useCodeMirrorEditorLifecycle";
import type { WorkbenchTabProps } from "../../../host/layout/workbenchContracts";

ensureBuiltinSyntaxRenderersRegistered();
ensureBuiltinEditPluginsRegistered();
ensureBuiltinVimHandoffsRegistered();

// 初始化 Vim 增强运动（全局仅一次）
setupVimEnhancedMotions();

const registeredLineSyntaxRenderExtension = createRegisteredLineSyntaxRenderExtension();
const FRONTMATTER_FOCUSABLE_SELECTOR = "[data-frontmatter-field-focusable='true']";
const FRONTMATTER_VIM_NAV_SELECTOR = "[data-frontmatter-vim-nav='true']";
const FRONTMATTER_VIM_ROW_SELECTOR = "[data-frontmatter-vim-nav='true'][data-frontmatter-field-key]";
const MARKDOWN_TABLE_SHELL_SELECTOR = "[data-markdown-table-block-from]";
const MARKDOWN_TABLE_VIM_NAV_SELECTOR = "[data-markdown-table-vim-nav='true']";
const MARKDOWN_TABLE_ENTRY_SELECTOR = `${MARKDOWN_TABLE_VIM_NAV_SELECTOR}[data-markdown-table-entry-anchor='true']`;

/**
 * @function exitVimInsertMode
 * @description 将 Vim 状态强制收回到 normal 模式。
 * @param view 编辑器视图。
 */
function exitVimInsertMode(view: EditorView): void {
    const cm = getCM(view) as ({ state?: { vim?: unknown } } & object) | null;
    if (!cm || !cm.state?.vim) {
        return;
    }

    Vim.exitInsertMode(cm as never);
}

/**
 * @function isWholeDocumentSelected
 * @description 判断当前是否处于整篇文档被非空选区完全覆盖的状态。
 * @param state 编辑器状态。
 * @returns 若任一选区覆盖从 0 到文档末尾，返回 true。
 */
/* ================================================================ */
/*  EditorErrorBoundary                                             */
/* ================================================================ */

/**
 * @interface EditorErrorBoundaryProps
 * @description 编辑器错误边界 Props。
 */
interface EditorErrorBoundaryProps {
    /** 子组件 */
    children: ReactNode;
}

/**
 * @interface EditorErrorBoundaryState
 * @description 编辑器错误边界 State。
 */
interface EditorErrorBoundaryState {
    /** 是否捕获到渲染错误 */
    hasError: boolean;
    /** 错误信息 */
    errorMessage: string | null;
}

/**
 * @class EditorErrorBoundary
 * @description React 错误边界，用于捕获 CodeMirrorEditorTab 渲染/生命周期中的异常，
 *   防止未捕获错误导致整棵组件树卸载（白屏）。
 *   捕获后展示降级 UI 并记录错误日志。
 */
class EditorErrorBoundary extends Component<EditorErrorBoundaryProps, EditorErrorBoundaryState> {
    constructor(props: EditorErrorBoundaryProps) {
        super(props);
        this.state = { hasError: false, errorMessage: null };
    }

    static getDerivedStateFromError(error: Error): EditorErrorBoundaryState {
        return { hasError: true, errorMessage: error.message };
    }

    componentDidCatch(error: Error, info: ErrorInfo): void {
        console.error("[editor] error boundary caught", {
            message: error.message,
            stack: error.stack,
            componentStack: info.componentStack,
        });
    }

    render(): ReactNode {
        if (this.state.hasError) {
            return (
                <div className="cm-tab">
                    <div className="cm-tab-error-fallback">
                        <p>{i18n.t("editor.errorBoundaryTitle")}</p>
                        <p className="cm-tab-error-detail">{this.state.errorMessage}</p>
                        <button
                            type="button"
                            className="cm-tab-error-retry"
                            onClick={() => this.setState({ hasError: false, errorMessage: null })}
                        >
                            {i18n.t("editor.errorBoundaryRetry")}
                        </button>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}

/**
 * @function buildDefaultContent
 * @description 构建编辑器默认内容。
 *   新建空文件应保持真正的空文档，因此这里不再注入示例正文或标题。
 * @param filePath 文件路径。
 * @returns 编辑器默认文本。
 */
function buildDefaultContent(filePath: string): string {
    void filePath;
    return "";
}

/**
 * @function resolveDisplayFilePath
 * @description 解析当前编辑器应使用的 Markdown 路径，优先采用 editor context 中的最新路径。
 * @param articlePath editor context 中记录的路径。
 * @param fallbackPath 打开 tab 时传入的初始路径。
 * @returns 当前有效的 Markdown 相对路径。
 */
function resolveDisplayFilePath(
    articlePath: string | undefined,
    fallbackPath: string,
): string {
    return (articlePath ?? fallbackPath).replace(/\\/g, "/");
}
/**
 * @function CodeMirrorEditorTab
 * @description Workbench Tab 渲染函数，挂载并管理 CodeMirror 实例生命周期。
 * @param props Workbench 面板参数，支持 params.path 与 params.content。
 * @returns 编辑器 Tab 视图。
 */
export function CodeMirrorEditorTab(props: WorkbenchTabProps<Record<string, unknown>>): ReactNode {
    const tabRootRef = useRef<HTMLDivElement | null>(null);
    const hostRef = useRef<HTMLDivElement | null>(null);
    const hasAppliedInitialAutoFocusRef = useRef<boolean>(false);
    const bindingsRef = useRef<Record<CommandId, string>>({
        "tab.closeFocused": "Ctrl+W",
        "app.quit": "Cmd+Q",
        "sidebar.left.toggle": "Cmd+Shift+J",
        "sidebar.right.toggle": "Cmd+Shift+K",
        "file.saveFocused": "Cmd+S",
        "file.deleteFocused": "Cmd+Backspace",
        "file.moveFocusedToDirectory": "",
        "folder.createInFocusedDirectory": "",
        "file.renameFocused": "",
        "note.createNew": "",
        "editor.undo": "Cmd+Z",
        "editor.redo": "Cmd+Shift+Z",
        "editor.selectAll": "Cmd+A",
        "editor.find": "Cmd+F",
        "editor.toggleComment": "Cmd+/",
        "editor.indentMore": "Cmd+]",
        "editor.indentLess": "Cmd+[",
        "editor.toggleBold": "Cmd+B",
        "editor.toggleItalic": "Cmd+I",
        "editor.toggleStrikethrough": "Cmd+Shift+X",
        "editor.toggleInlineCode": "Cmd+E",
        "editor.toggleHighlight": "Cmd+Shift+H",
        "editor.toggleWikiLink": "Cmd+Alt+K",
        "editor.insertLink": "Cmd+K",
        "editor.insertTask": "",
        "editor.insertFrontmatter": "",
        "editor.insertTable": "",
        "fileTree.copySelected": "Cmd+C",
        "fileTree.pasteInDirectory": "Cmd+V",
        "fileTree.deleteSelected": "Cmd+Backspace",
        "quickSwitcher.open": "Cmd+O",
        "commandPalette.open": "Cmd+J",
    });
    const managedEditorShortcutCandidatesRef = useRef<string[]>(
        collectManagedEditorShortcutCandidates(bindingsRef.current),
    );
    const vimModeEnabledRef = useRef<boolean>(false);
    const displayModeRef = useRef<EditorDisplayMode>("edit");
    const currentFilePathRef = useRef<string>(String(props.params.path ?? i18n.t("editor.untitledFile")));
    const executeEditorCommandRef = useRef<(commandId: CommandId) => void>(() => {
        // noop
    });
    const { bindings } = useShortcutState();
    const { currentVaultPath, files } = useVaultState();
    const { featureSettings } = useConfigState();
    const vimModeEnabled = featureSettings.vimModeEnabled;
    const editorFontFamily = featureSettings.editorFontFamily || DEFAULT_EDITOR_FONT_FAMILY;
    const editorFontSize = featureSettings.editorFontSize;
    const editorTabSize = featureSettings.editorTabSize;
    const editorLineWrapping = featureSettings.editorLineWrapping;
    const editorTabRestoreMode = featureSettings.editorTabRestoreMode;
    const editorLineNumbers = featureSettings.editorLineNumbers;
    const sharedTypographyVariables = useMemo(() => ({
        "--cm-editor-font-family": editorFontFamily,
        "--cm-editor-font-size": `${editorFontSize}px`,
    } as CSSProperties), [editorFontFamily, editorFontSize]);
    const currentFilePath = String(props.params.path ?? i18n.t("editor.untitledFile"));
    const initialDoc = useMemo(() => {
        const content = props.params.content;
        if (typeof content === "string") {
            return content;
        }
        return buildDefaultContent(currentFilePath);
    }, [props.params.content, currentFilePath]);
    const [readContent, setReadContent] = useState<string>(initialDoc);

    const articleId = props.api.id;
    const segmentationController = useMemo(
        () => createEditorChineseSegmentationController({
            articleId,
            segmentLine: segmentChineseText,
        }),
        [articleId],
    );
    const {
        clearPendingSegmentation,
        executeSegmentedDeleteBackward,
        getLineTokens,
        prefetchLineSegmentation,
        prefetchSegmentationAtMouseEvent,
        scheduleActiveLineSegmentation,
        trySelectWordAtMouseEvent,
    } = segmentationController;
    const articleSnapshot = useArticleById(articleId);
    const displayFilePath = resolveDisplayFilePath(articleSnapshot?.path, currentFilePath);
    const displayTitle = useMemo(
        () => resolveMarkdownNoteTitle(displayFilePath),
        [displayFilePath],
    );
    // TODO(editor): Extract title interaction controller for draft state,
    // composition/blur guards, and focus handoff around title rename.
    const [titleDraft, setTitleDraft] = useState<string>(displayTitle);
    const [isTitleRenaming, setIsTitleRenaming] = useState<boolean>(false);
    const titleRenameInFlightRef = useRef<boolean>(false);
    const titleImeCompositionGuard = useRef(createImeCompositionGuard()).current;
    const activeEditor = useActiveEditor();
    const { displayMode } = useEditorDisplayModeState();
    const isActiveEditor = activeEditor?.articleId === articleId;
    const readModeGuard = useMemo(
        () => evaluateReadModeRenderGuard(readContent),
        [readContent],
    );
    const effectiveDisplayMode: EditorDisplayMode =
        displayMode === "read" && readModeGuard.canRenderReadMode
            ? "read"
            : "edit";
    const isReadModeGuardBlocked = displayMode === "read" && !readModeGuard.canRenderReadMode;
    const isReadingMode = effectiveDisplayMode === "read";
    const modeToggleLabel = displayMode === "read"
        ? i18n.t("editor.switchToEditMode")
        : i18n.t("editor.switchToReadMode");
    const readModeGuardMessage = isReadModeGuardBlocked
        ? i18n.t("editor.readModeGuardBlocked", {
            features: readModeGuard.unsupportedFeatures
                .map((feature) => describeRenderFeature(feature))
                .join(", "),
        })
        : null;

    useEffect(() => {
        currentFilePathRef.current = displayFilePath;
    }, [displayFilePath]);

    useEffect(() => {
        setTitleDraft(displayTitle);
    }, [displayTitle]);

    /**
     * @function focusEditorBodyStart
     * @description 将编辑器焦点移动到正文首个可编辑位置；若存在 frontmatter，则跳至其后第一行。
     */
    const focusEditorBodyStart = (): void => {
        window.requestAnimationFrame(() => {
            const liveView = viewRef.current;
            if (!liveView) {
                return;
            }

            const anchor = resolveEditorBodyAnchor(liveView.state);
            liveView.dispatch({
                selection: { anchor },
                scrollIntoView: true,
            });
            liveView.focus();
        });
    };

    /**
     * @function focusActiveEditorSurface
     * @description 当编辑器重新成为活跃页签时，确保焦点不落入 frontmatter 隐藏源码，并在 Vim 模式下回到 normal。
     */
    const focusActiveEditorSurface = (): void => {
        const liveView = viewRef.current;
        if (!liveView) {
            return;
        }

        const bodyAnchor = resolveEditorBodyAnchor(liveView.state);
        const currentHead = liveView.state.selection.main.head;
        const shouldMoveToBodyStart = bodyAnchor > 0 && currentHead < bodyAnchor;

        if (vimModeEnabledRef.current) {
            exitVimInsertMode(liveView);
        }

        if (shouldMoveToBodyStart) {
            liveView.dispatch({
                selection: { anchor: bodyAnchor },
                scrollIntoView: true,
            });
        }

        liveView.focus();
    };

    /**
     * @function focusFrontmatterVimNavigationTarget
     * @description 将焦点切入 frontmatter 的 Vim 导航层。
     * @param position 进入时优先聚焦首项或末项。
     * @returns 是否成功切入 frontmatter。
     */
    const focusFrontmatterVimNavigationTarget = (position: "first" | "last"): boolean => {
        const view = viewRef.current;
        if (!view) {
            return false;
        }

        const rowTargets = Array.from(view.dom.querySelectorAll<HTMLElement>(FRONTMATTER_VIM_ROW_SELECTOR));
        const navigationTargets = Array.from(view.dom.querySelectorAll<HTMLElement>(FRONTMATTER_VIM_NAV_SELECTOR));
        const preferredTargets = rowTargets.length > 0 ? rowTargets : navigationTargets;
        const target = position === "first"
            ? preferredTargets[0]
            : preferredTargets[preferredTargets.length - 1];

        if (!target) {
            return false;
        }

        exitVimInsertMode(view);
        target.focus();
        console.info("[editor] frontmatter vim handoff entered", {
            articleId,
            position,
        });
        return true;
    };

    /**
     * @function focusMarkdownTableVimNavigationTarget
     * @description 将焦点切入 Markdown table 的 Vim 导航层。
     * @param request 进入时的目标表格与首尾位置。
     * @returns 是否成功切入 Markdown table 导航层。
     */
    const focusMarkdownTableVimNavigationTarget = (request: {
        blockFrom: number;
        position: "first" | "last";
    }): boolean => {
        const view = viewRef.current;
        if (!view) {
            return false;
        }

        const tableShell = view.dom.querySelector<HTMLElement>(
            `${MARKDOWN_TABLE_SHELL_SELECTOR}[data-markdown-table-block-from='${request.blockFrom}']`,
        );
        if (!tableShell) {
            return false;
        }

        const entryTargets = Array.from(tableShell.querySelectorAll<HTMLElement>(MARKDOWN_TABLE_ENTRY_SELECTOR));
        const navigationTargets = Array.from(tableShell.querySelectorAll<HTMLElement>(MARKDOWN_TABLE_VIM_NAV_SELECTOR));
        const preferredTargets = entryTargets.length > 0 ? entryTargets : navigationTargets;
        const target = request.position === "first"
            ? preferredTargets[0]
            : preferredTargets[preferredTargets.length - 1];

        if (!target) {
            return false;
        }

        exitVimInsertMode(view);
        target.focus();
        console.info("[editor] markdown table vim handoff entered", {
            articleId,
            position: request.position,
            blockFrom: request.blockFrom,
        });
        return true;
    };

    const focusWidgetNavigationTarget = (
        widget: "frontmatter" | "markdown-table",
        position: "first" | "last",
        blockFrom?: number,
    ): boolean => {
        if (widget === "frontmatter") {
            return focusFrontmatterVimNavigationTarget(position);
        }

        if (typeof blockFrom !== "number") {
            return false;
        }

        return focusMarkdownTableVimNavigationTarget({
            blockFrom,
            position,
        });
    };

    /**
     * @function exitFrontmatterVimNavigationToBody
     * @description 从 frontmatter Vim 导航层返回正文起点。
     */
    const exitFrontmatterVimNavigationToBody = (): void => {
        const view = viewRef.current;
        if (!view) {
            return;
        }

        exitVimInsertMode(view);
        focusEditorBodyStart();
        console.info("[editor] frontmatter vim handoff exited", {
            articleId,
        });
    };

    /**
     * @function shouldDeferTitleBlurCommit
     * @description 判断标题输入框 blur 是否应在输入法组合结束附近的短窗口内延后，避免误提交。
     * @returns `true` 表示本次 blur 应跳过自动提交。
     */
    const shouldDeferTitleBlurCommit = (): boolean => {
        return titleImeCompositionGuard.shouldDeferBlurCommit();
    };

    const { viewRef } = useCodeMirrorEditorLifecycle({
        articleId,
        containerApi: props.containerApi,
        tabRootRef,
        hostRef,
        initialDoc,
        displayFilePath,
        readContent,
        currentFilePath,
        currentFilePathRef,
        displayModeRef,
        effectiveDisplayMode,
        vimModeEnabled,
        editorFontFamily,
        editorFontSize,
        editorTabSize,
        editorLineWrapping,
        editorTabRestoreMode,
        editorLineNumbers,
        initialAutoFocus: props.params.autoFocus === true,
        initialCursorOffset: typeof props.params.initialCursorOffset === "number"
            ? props.params.initialCursorOffset
            : null,
        hasAppliedInitialAutoFocusRef,
        articleSnapshot,
        setReadContent,
        registeredLineSyntaxRenderExtension,
        getLineTokens,
        clearPendingSegmentation,
        prefetchLineSegmentation,
        prefetchSegmentationAtMouseEvent,
        scheduleActiveLineSegmentation,
        trySelectWordAtMouseEvent,
        onRequestExitFrontmatterVimNavigation: exitFrontmatterVimNavigationToBody,
        onRequestFocusFrontmatterVimNavigation: focusFrontmatterVimNavigationTarget,
        onRequestFocusMarkdownTableVimNavigation: focusMarkdownTableVimNavigationTarget,
    });

    useEffect(() => {
        displayModeRef.current = effectiveDisplayMode;
    }, [effectiveDisplayMode]);

    useEffect(() => {
        setReadContent(initialDoc);
    }, [initialDoc]);

    useEffect(() => {
        if (effectiveDisplayMode !== "edit" || !isActiveEditor || editorTabRestoreMode === "viewport") {
            return;
        }

        window.requestAnimationFrame(() => {
            focusActiveEditorSurface();
        });
    }, [effectiveDisplayMode, editorTabRestoreMode, isActiveEditor]);

    /* 仅当前活跃 editor 订阅定位请求，避免非活跃 tab 响应外部导航事件 */
    useEffect(() => {
        if (!isActiveEditor) {
            return;
        }

        const unlisten = subscribeEditorRevealRequestedEvent((payload) => {
            if (payload.articleId !== articleId) {
                return;
            }

            const view = viewRef.current;
            if (!view) {
                return;
            }

            const totalLines = view.state.doc.lines;
            const safeLineNumber = Math.min(
                Math.max(1, payload.line),
                Math.max(1, totalLines),
            );
            const targetLine = view.state.doc.line(safeLineNumber);

            view.dispatch({
                selection: { anchor: targetLine.from },
                scrollIntoView: true,
            });
            if (displayModeRef.current === "edit") {
                view.focus();
            }

            console.info("[editor] reveal requested event handled", {
                articleId,
                path: payload.path,
                line: payload.line,
                safeLineNumber,
            });
        });

        return unlisten;
    }, [articleId, isActiveEditor]);

    useEffect(() => {
        bindingsRef.current = bindings;
        managedEditorShortcutCandidatesRef.current = collectManagedEditorShortcutCandidates(bindings);
    }, [bindings]);

    useEffect(() => {
        vimModeEnabledRef.current = vimModeEnabled;
    }, [vimModeEnabled]);

    const executeEditorNativeCommand = (commandId: EditorNativeCommandId): boolean => {
        const view = viewRef.current;
        if (!view) {
            return false;
        }

        if (!canExecuteEditorNativeCommandInMode(displayModeRef.current, commandId)) {
            console.info("[editor] native command skipped in current mode", {
                articleId,
                commandId,
                displayMode: displayModeRef.current,
            });
            return false;
        }

        if (commandId === "editor.undo") {
            return undo(view);
        }

        if (commandId === "editor.redo") {
            return redo(view);
        }

        if (commandId === "editor.selectAll") {
            view.focus();
            const bodySelection = resolveEditorBodySelectionRange(view.state);
            view.dispatch({
                selection: {
                    anchor: bodySelection.anchor,
                    head: bodySelection.head,
                },
                scrollIntoView: true,
            });
            return true;
        }

        if (commandId === "editor.find") {
            return openSearchPanel(view);
        }

        if (commandId === "editor.toggleComment") {
            return toggleComment(view);
        }

        if (commandId === "editor.indentMore") {
            return indentMore(view);
        }

        if (commandId === "editor.indentLess") {
            return indentLess(view);
        }

        if (commandId === "editor.toggleBold") {
            return toggleBold(view);
        }

        if (commandId === "editor.toggleItalic") {
            return toggleItalic(view);
        }

        if (commandId === "editor.toggleStrikethrough") {
            return toggleStrikethrough(view);
        }

        if (commandId === "editor.toggleInlineCode") {
            return toggleInlineCode(view);
        }

        if (commandId === "editor.toggleHighlight") {
            return toggleHighlight(view);
        }

        if (commandId === "editor.toggleWikiLink") {
            return toggleWikiLink(view);
        }

        if (commandId === "editor.insertLink") {
            return insertLink(view);
        }

        if (commandId === "editor.insertTask") {
            return insertTask(view);
        }

        if (commandId === "editor.insertFrontmatter") {
            const snapshot = getConfigSnapshot();
            return insertFrontmatter(view, {
                template: snapshot.featureSettings.frontmatterTemplate,
                filePath: currentFilePathRef.current,
            });
        }

        if (commandId === "editor.insertTable") {
            return insertTable(view);
        }

        return false;
    };

    // TODO(editor): Extract editor command bridge for native command routing,
    // host command dispatch, and command-request event subscription.
    const executeEditorCommand = (commandId: CommandId): void => {
        executeCommand(commandId, {
            activeTabId: props.api.id,
            closeTab: (tabId) => {
                props.containerApi.getPanel(tabId)?.api.close?.();
            },
            openFileTab: (relativePath, content, tabParams) => {
                void openFileInWorkbench({
                    containerApi: props.containerApi,
                    relativePath,
                    contentOverride: content,
                    tabParams,
                });
            },
            getExistingMarkdownPaths: () =>
                files
                    .filter((entry) => !entry.isDir)
                    .filter((entry) => entry.path.endsWith(".md") || entry.path.endsWith(".markdown"))
                    .map((entry) => entry.path),
            executeEditorNativeCommand,
        });
    };

    useEffect(() => {
        const unlisten = subscribeEditorCommandRequestedEvent((payload) => {
            if (payload.articleId !== articleId) {
                return;
            }

            const view = viewRef.current;
            if (!view) {
                return;
            }

            const handled = executeEditorNativeCommand(payload.commandId);
            if (handled && displayModeRef.current === "edit") {
                window.requestAnimationFrame(() => {
                    viewRef.current?.focus();
                });
            }

            console.info("[editor] editor command requested event handled", {
                articleId,
                commandId: payload.commandId,
                handled,
            });
        });

        return unlisten;
    }, [articleId, executeEditorNativeCommand]);

    useEffect(() => {
        executeEditorCommandRef.current = executeEditorCommand;
    }, [executeEditorCommand]);

    useEffect(() => {
        const view = viewRef.current;
        if (!view) {
            return;
        }
        return attachEditorKeyboardBridge({
            articleId,
            view,
            getBindings: () => bindingsRef.current,
            getManagedShortcutCandidates: () => managedEditorShortcutCandidatesRef.current,
            getCurrentVaultPath: () => currentVaultPath,
            getDisplayMode: () => displayModeRef.current,
            isVimModeEnabled: () => vimModeEnabledRef.current,
            executeSegmentedDeleteBackward,
            executeEditorCommand: (commandId) => {
                executeEditorCommandRef.current(commandId);
            },
            focusWidgetNavigationTarget,
            frontmatterSelectors: {
                focusable: FRONTMATTER_FOCUSABLE_SELECTOR,
                navigation: FRONTMATTER_VIM_NAV_SELECTOR,
            },
            markdownTableSelectors: {
                shell: MARKDOWN_TABLE_SHELL_SELECTOR,
            },
        });
    }, [articleId]);


    /**
     * @function commitTitleRename
     * @description 将顶部标题输入栏的值提交为真实文件名，并按触发来源协调后续焦点行为。
     * @param submitReason 触发提交的来源；`enter` 需要在成功后将焦点送回正文编辑区。
     * @returns Promise<void>
     */
    const commitTitleRename = async (submitReason: TitleSubmitReason): Promise<void> => {
        if (titleRenameInFlightRef.current) {
            return;
        }

        titleRenameInFlightRef.current = true;
        setIsTitleRenaming(true);

        try {
            const sourcePath = currentFilePathRef.current;
            const result = await commitEditorTitleRename({
                articleId,
                panelId: articleId,
                containerApi: props.containerApi,
                panelParams: typeof props.params === "object" && props.params
                    ? { ...(props.params as Record<string, unknown>) }
                    : {},
                currentVaultPath,
                sourcePath,
                draftTitle: titleDraft,
                latestContent: viewRef.current?.state.doc.toString()
                    ?? articleSnapshot?.content
                    ?? readContent,
                submitReason,
                displayMode: displayModeRef.current,
                isActiveEditor,
                focusEditorBodyStart,
                dependencies: {
                    renameMarkdownFile: renameVaultMarkdownFile,
                    saveMarkdownFile: saveVaultMarkdownFile,
                    openFile: openFileInWorkbench,
                    reportArticleContent,
                    reportArticleFocus,
                    reportActiveEditor,
                },
            });

            setTitleDraft(result.nextTitleDraft);
            if (result.status === "success") {
                currentFilePathRef.current = result.nextPath;
            }
        } finally {
            titleRenameInFlightRef.current = false;
            setIsTitleRenaming(false);
        }
    };

    return (
        <EditorErrorBoundary>
            <div
                ref={tabRootRef}
                className={`cm-tab ${isReadingMode ? "cm-tab-reading" : "cm-tab-editing"}`}
                style={sharedTypographyVariables}
            >
                <div className="cm-tab-header">
                    <div className="cm-tab-header-inner">
                        <input
                            type="text"
                            className="cm-tab-title-input"
                            aria-label={i18n.t("commands.renameCurrent")}
                            title={displayFilePath}
                            value={titleDraft}
                            spellCheck={false}
                            disabled={isTitleRenaming}
                            onChange={(event) => {
                                setTitleDraft(event.target.value);
                            }}
                            onCompositionStart={() => {
                                titleImeCompositionGuard.handleCompositionStart();
                            }}
                            onCompositionEnd={() => {
                                titleImeCompositionGuard.handleCompositionEnd();
                            }}
                            onBlur={() => {
                                if (shouldDeferTitleBlurCommit()) {
                                    return;
                                }

                                void commitTitleRename("blur");
                            }}
                            onKeyDownCapture={(event) => {
                                event.stopPropagation();

                                if (shouldSubmitPlainEnter({
                                    key: event.key,
                                    nativeEvent: event.nativeEvent,
                                })) {
                                    event.preventDefault();
                                    void commitTitleRename("enter");
                                    return;
                                }

                                if (event.key === "Escape") {
                                    event.preventDefault();
                                    setTitleDraft(displayTitle);
                                    event.currentTarget.blur();
                                }
                            }}
                        />
                        <button
                            type="button"
                            className={`cm-tab-mode-toggle ${displayMode === "read" ? "is-reading" : "is-editing"}`}
                            title={modeToggleLabel}
                            aria-label={modeToggleLabel}
                            aria-pressed={displayMode === "read"}
                            onClick={() => {
                                updateEditorDisplayMode(toggleEditorDisplayMode(displayMode));
                            }}
                        >
                            {displayMode === "read"
                                ? <SquarePen size={16} strokeWidth={1.8} aria-hidden="true" />
                                : <BookOpen size={16} strokeWidth={1.8} aria-hidden="true" />}
                        </button>
                    </div>
                </div>
                {isReadModeGuardBlocked ? (
                    <div className="cm-tab-guard-banner" role="status" aria-live="polite">
                        <div className="cm-tab-guard-title">{i18n.t("editor.readModeGuardTitle")}</div>
                        <div className="cm-tab-guard-detail">{readModeGuardMessage}</div>
                    </div>
                ) : null}
                <div
                    ref={hostRef}
                    className={`cm-tab-editor ${isReadingMode ? "is-hidden" : ""}`}
                    aria-hidden={isReadingMode}
                />
                {isReadingMode ? (
                    <MarkdownReadView
                        content={readContent}
                        currentFilePath={displayFilePath}
                        containerApi={props.containerApi}
                    />
                ) : null}
            </div>
        </EditorErrorBoundary>
    );
}
