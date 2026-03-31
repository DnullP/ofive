/**
 * @module plugins/markdown-codemirror/editor/CodeMirrorEditorTab
 * @description 基于 CodeMirror 6 的编辑器 Tab 组件，用于在 Dockview 中承载可编辑文本内容。
 * @dependencies
 *  - react
 *  - dockview
 *  - codemirror
 *  - @codemirror/lang-markdown
 *  - ./codemirrorTheme
 */

import { Component, useEffect, useMemo, useRef, useState, type CSSProperties, type ErrorInfo, type ReactNode } from "react";
import { BookOpen, SquarePen } from "lucide-react";
import type { IDockviewPanelProps } from "dockview";
import { EditorView } from "codemirror";
import { Compartment, EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { indentLess, indentMore, indentWithTab, redo, toggleComment, undo } from "@codemirror/commands";
import { openSearchPanel } from "@codemirror/search";
import { keymap } from "@codemirror/view";
import { getCM, Vim, vim } from "@replit/codemirror-vim";
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
import {
    notifyTabCloseShortcutTriggered,
} from "../../../host/commands/shortcutEvents";
import { useShortcutState } from "../../../host/commands/shortcutStore";
import { dispatchShortcut } from "../../../host/commands/shortcutDispatcher";
import { createConditionContext } from "../../../host/conditions/conditionEvaluator";
import { useVaultState } from "../../../host/vault/vaultStore";
import {
    createVaultBinaryFile,
    renameVaultMarkdownFile,
    saveVaultMarkdownFile,
    segmentChineseText,
    type ChineseSegmentToken,
} from "../../../api/vaultApi";
import { useConfigState, DEFAULT_EDITOR_FONT_FAMILY } from "../../../host/config/configStore";
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
import { getRegisteredEditPluginExtensions } from "./editPluginRegistry";
import { createWikiLinkNavigationExtension } from "./syntaxPlugins/wikiLinkSyntaxRenderer";
import { createImageEmbedSyntaxExtension } from "./syntaxPlugins/imageEmbedSyntaxExtension";
import { createFrontmatterSyntaxExtension } from "./syntaxPlugins/frontmatterSyntaxExtension.ts";
import { createCodeBlockHighlightExtension } from "./syntaxPlugins/codeBlockHighlightExtension";
import { createLatexSyntaxExtension } from "./syntaxPlugins/latexSyntaxExtension";
import { createTaskCheckboxToggleExtension } from "./syntaxPlugins/listSyntaxRenderer";
import { createCodeMirrorThemeExtension } from "./codemirrorTheme";
import { collectManagedEditorShortcutCandidates } from "./editorShortcutPolicy";
import { attachPasteImageHandler } from "./editorPasteImageHandler";
import { editorBaseSetup } from "./editorBaseSetup";
import { buildLineNumbersExtension } from "./lineNumbersModeExtension";
import {
    toggleBold,
    toggleItalic,
    toggleStrikethrough,
    toggleInlineCode,
    toggleHighlight,
    insertLink,
    insertTask,
    insertFrontmatter,
    insertTable,
} from "./markdownFormattingCommands";
import { createMarkdownTableSyntaxExtension } from "./syntaxPlugins/markdownTableSyntaxExtension";
import {
    containsChineseCharacter,
    resolveChinesePreviousWordBoundary,
    resolveEnglishPreviousWordBoundary,
    getWordObjectRange,
} from "./editorWordBoundaries";
import {
    canExecuteEditorNativeCommandInMode,
    canMutateEditorDocument,
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
    registerVimTokenProvider,
    unregisterVimTokenProvider,
    setupVimEnhancedMotions,
} from "./vimChineseMotionExtension";
import { flushAutoSaveByPath } from "../../../host/editor/autoSaveService";
import { openFileInDockview } from "../../../host/layout/openFileService";
import {
    flushFocusedMarkdownTableEditor,
    isMarkdownTableEditorFocused,
} from "./markdownTableWidgetRegistry";
import {
    resolveMarkdownNoteTitle,
    resolveRenamedMarkdownPath,
} from "./noteTitleUtils";
import { resolveEditorBodyAnchor, resolveEditorBodySelectionRange } from "./editorBodyAnchor";
import {
    resolveRegisteredVimHandoff,
    type VimHandoffResult,
} from "./handoff/vimHandoffRegistry";
import {
    shouldDeferBlurCommitAfterComposition,
    shouldSubmitPlainEnter,
} from "../../../utils/imeInputGuard";

ensureBuiltinSyntaxRenderersRegistered();
ensureBuiltinEditPluginsRegistered();
ensureBuiltinVimHandoffsRegistered();

// 初始化 Vim 增强运动（全局仅一次）
setupVimEnhancedMotions();

const registeredLineSyntaxRenderExtension = createRegisteredLineSyntaxRenderExtension();
const FRONTMATTER_FOCUSABLE_SELECTOR = "[data-frontmatter-field-focusable='true']";
const FRONTMATTER_VIM_NAV_SELECTOR = "[data-frontmatter-vim-nav='true']";
const FRONTMATTER_VIM_ROW_SELECTOR = "[data-frontmatter-vim-nav='true'][data-frontmatter-field-key]";

/**
 * @function isVimNormalMode
 * @description 判断指定 EditorView 当前是否处于 Vim normal 模式。
 * @param view 编辑器视图。
 * @returns 是否处于 normal 模式。
 */
function isVimNormalMode(view: EditorView): boolean {
    const cm = getCM(view) as { state?: { vim?: { insertMode?: boolean; visualMode?: boolean } } } | null;
    const vimState = cm?.state?.vim;
    if (!vimState) {
        return false;
    }

    return !vimState.insertMode && !vimState.visualMode;
}

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
 * @function applyResolvedVimHandoff
 * @description 执行 Vim handoff 解析结果。
 *   所有 handoff 结果的副作用统一收敛在宿主层，避免 handler 直接操作 EditorView/DOM。
 * @param view 编辑器视图。
 * @param result handoff 解析结果。
 * @param focusFrontmatterNavigationTarget 聚焦 frontmatter 导航层的回调。
 * @returns `true` 表示已执行并消费事件。
 */
function applyResolvedVimHandoff(
    view: EditorView,
    result: VimHandoffResult,
    focusFrontmatterNavigationTarget: (position: "first" | "last") => boolean,
): boolean {
    if (result.kind === "move-selection") {
        const targetLine = view.state.doc.line(result.targetLineNumber);
        view.dispatch({
            selection: { anchor: targetLine.from },
            scrollIntoView: true,
        });
        return true;
    }

    if (result.kind === "focus-frontmatter-navigation") {
        return focusFrontmatterNavigationTarget(result.position);
    }

    return false;
}
const SHARED_EDITOR_FONT_FAMILY_CSS_VALUE = "var(--cm-editor-font-family)";
const SHARED_EDITOR_FONT_SIZE_CSS_VALUE = "var(--cm-editor-font-size)";

/**
 * @function resolveEditorShortcutFocusedComponent
 * @description 根据事件目标解析编辑器快捷键应使用的焦点上下文。
 * @param target 键盘事件目标。
 * @returns 正文或 frontmatter 的焦点组件标识。
 */
function resolveEditorShortcutFocusedComponent(target: EventTarget | null): string {
    if (target instanceof HTMLElement && target.closest(FRONTMATTER_FOCUSABLE_SELECTOR)) {
        return "tab:codemirror-frontmatter";
    }

    return "tab:codemirror";
}

/**
 * @function isWholeDocumentSelected
 * @description 判断当前是否处于整篇文档被非空选区完全覆盖的状态。
 * @param state 编辑器状态。
 * @returns 若任一选区覆盖从 0 到文档末尾，返回 true。
 */
/**
 * @function safeDestroyEditorView
 * @description 安全销毁 EditorView 实例。
 *   调用 view.destroy() 后，在实例上覆盖 requestMeasure / measure / dispatch
 *   为空操作，防止任何残留的异步回调（document.fonts.ready Promise、
 *   ResizeObserver、queueMicrotask 等）在已销毁的视图上重新触发 measure 循环，
 *   从而避免 "this.docView.coordsAt" TypeError。
 *
 *   该问题在 React StrictMode 的 mount→unmount→remount 周期中稳定复现：
 *   第一个 EditorView 被 destroy 后，其内部 cursorLayer 的 requestMeasure
 *   仍可能通过未取消的 Promise/Observer 回调被重新调度。
 *
 * @param view 要销毁的 EditorView 实例。
 */
function safeDestroyEditorView(view: EditorView): void {
    view.destroy();
    neutralizeEditorView(view);
    console.debug("[editor] EditorView safely destroyed and patched");
}

/**
 * @function neutralizeEditorView
 * @description 在 EditorView 实例上覆盖所有可能触发 measure 循环的方法为空操作。
 *   同时取消已调度的 requestAnimationFrame，防止 zombie 视图的 RAF 回调
 *   在 docView 未初始化或已销毁的状态下执行 coordsAtPos。
 *
 *   适用于两种场景：
 *   1. 正常 destroy 后的残留异步回调守卫
 *   2. 构造函数抛出异常后的 zombie 视图（docView 未赋值）清理
 *
 * @param view 要中和的 EditorView 实例。
 */
function neutralizeEditorView(view: EditorView): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const v = view as any;
    const noop = (): void => { /* neutralized – no-op */ };

    // 取消已调度的 requestAnimationFrame（构造函数中 plugin 初始化可能已调度）
    if (typeof v.measureScheduled === "number" && v.measureScheduled > -1) {
        cancelAnimationFrame(v.measureScheduled);
        v.measureScheduled = -1;
    }

    v.requestMeasure = noop;
    v.measure = noop;
    v.dispatch = noop;
    v.update = noop;
    // 标记为已销毁，使 CM6 内部守卫（如 measure 入口检查）也能生效
    v.destroyed = true;
}

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
 * @interface SegmentationCacheItem
 * @description 行分词缓存条目。
 */
interface SegmentationCacheItem {
    text: string;
    tokens: ChineseSegmentToken[];
}

/**
 * @interface SegmentationPendingItem
 * @description 行分词中的请求条目，用于去重并复用同一行的分词请求。
 */
interface SegmentationPendingItem {
    text: string;
    promise: Promise<ChineseSegmentToken[] | null>;
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

type TitleSubmitReason = "blur" | "enter";

/**
 * @function CodeMirrorEditorTab
 * @description Dockview Tab 渲染函数，挂载并管理 CodeMirror 实例生命周期。
 * @param props Dockview 面板参数，支持 params.path 与 params.content。
 * @returns 编辑器 Tab 视图。
 */
export function CodeMirrorEditorTab(props: IDockviewPanelProps<Record<string, unknown>>): ReactNode {
    const tabRootRef = useRef<HTMLDivElement | null>(null);
    const hostRef = useRef<HTMLDivElement | null>(null);
    const viewRef = useRef<EditorView | null>(null);
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
    const segmentationCacheRef = useRef<Map<number, SegmentationCacheItem>>(new Map());
    const segmentationPendingRef = useRef<Map<number, SegmentationPendingItem>>(new Map());
    const segmentationTimerRef = useRef<number | null>(null);
    const vimModeCompartmentRef = useRef<Compartment>(new Compartment());
    /** 编辑器字体族 Compartment：通过 EditorView.theme 动态控制 .cm-content 字体族 */
    const fontFamilyCompartmentRef = useRef<Compartment>(new Compartment());
    /** 编辑器字体大小 Compartment */
    const fontSizeCompartmentRef = useRef<Compartment>(new Compartment());
    /** Tab 缩进宽度 Compartment */
    const tabSizeCompartmentRef = useRef<Compartment>(new Compartment());
    /** 自动换行 Compartment */
    const lineWrappingCompartmentRef = useRef<Compartment>(new Compartment());
    /** 行号模式 Compartment（off/absolute/relative） */
    const lineNumbersCompartmentRef = useRef<Compartment>(new Compartment());
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
    const articleSnapshot = useArticleById(articleId);
    const displayFilePath = resolveDisplayFilePath(articleSnapshot?.path, currentFilePath);
    const displayTitle = useMemo(
        () => resolveMarkdownNoteTitle(displayFilePath),
        [displayFilePath],
    );
    const [titleDraft, setTitleDraft] = useState<string>(displayTitle);
    const [isTitleRenaming, setIsTitleRenaming] = useState<boolean>(false);
    const titleRenameInFlightRef = useRef<boolean>(false);
    const isTitleInputComposingRef = useRef<boolean>(false);
    const lastTitleInputCompositionEndAtRef = useRef<number>(0);
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
     * @function syncTitleOffsetWithEditorGutter
     * @description 将标题输入的文本起点与编辑器正文首列对齐。
     *   CodeMirror 的正文会受到 gutter 宽度影响，而标题栏不在同一布局流内，
     *   因此需要把实时 gutter 宽度同步到 CSS 变量，供标题输入补偿使用。
     */
    const syncTitleOffsetWithEditorGutter = (): void => {
        const tabRoot = tabRootRef.current;
        const view = viewRef.current;

        if (!tabRoot || !view || effectiveDisplayMode !== "edit") {
            tabRoot?.style.setProperty("--cm-tab-gutter-width", "0px");
            return;
        }

        const gutterElement = view.dom.querySelector(".cm-gutters");
        const gutterWidth = gutterElement instanceof HTMLElement
            ? gutterElement.getBoundingClientRect().width
            : 0;

        tabRoot.style.setProperty(
            "--cm-tab-gutter-width",
            `${gutterWidth.toFixed(2)}px`,
        );
    };

    useEffect(() => {
        syncTitleOffsetWithEditorGutter();
    }, [displayFilePath, editorLineNumbers, effectiveDisplayMode, readContent]);

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
        return shouldDeferBlurCommitAfterComposition({
            isComposing: isTitleInputComposingRef.current,
            lastCompositionEndAt: lastTitleInputCompositionEndAtRef.current,
            now: performance.now(),
        });
    };

    useEffect(() => {
        displayModeRef.current = effectiveDisplayMode;
    }, [effectiveDisplayMode]);

    useEffect(() => {
        setReadContent(initialDoc);
    }, [initialDoc]);

    useEffect(() => {
        if (effectiveDisplayMode !== "edit" || !isActiveEditor) {
            return;
        }

        window.requestAnimationFrame(() => {
            viewRef.current?.focus();
        });
    }, [effectiveDisplayMode, isActiveEditor]);

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

        if (commandId === "editor.insertLink") {
            return insertLink(view);
        }

        if (commandId === "editor.insertTask") {
            return insertTask(view);
        }

        if (commandId === "editor.insertFrontmatter") {
            return insertFrontmatter(view);
        }

        if (commandId === "editor.insertTable") {
            return insertTable(view);
        }

        return false;
    };

    const executeEditorCommand = (commandId: CommandId): void => {
        executeCommand(commandId, {
            activeTabId: props.api.id,
            closeTab: (tabId) => {
                props.containerApi.getPanel(tabId)?.api.close();
            },
            openFileTab: (relativePath, content, tabParams) => {
                void openFileInDockview({
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

    const readCachedLineTokens = (
        lineNumber: number,
        lineText: string,
    ): ChineseSegmentToken[] | null => {
        const cacheItem = segmentationCacheRef.current.get(lineNumber);
        if (cacheItem && cacheItem.text === lineText) {
            return cacheItem.tokens;
        }

        return null;
    };

    const requestSegmentationForLine = (
        lineNumber: number,
        lineText: string,
    ): Promise<ChineseSegmentToken[] | null> => {
        if (!containsChineseCharacter(lineText)) {
            return Promise.resolve(null);
        }

        const cachedTokens = readCachedLineTokens(lineNumber, lineText);
        if (cachedTokens) {
            return Promise.resolve(cachedTokens);
        }

        const pendingItem = segmentationPendingRef.current.get(lineNumber);
        if (pendingItem && pendingItem.text === lineText) {
            return pendingItem.promise;
        }

        let requestPromise: Promise<ChineseSegmentToken[] | null>;
        requestPromise = segmentChineseText(lineText)
            .then((tokens) => {
                segmentationCacheRef.current.set(lineNumber, {
                    text: lineText,
                    tokens,
                });
                console.debug("[editor] segmented line", {
                    articleId,
                    lineNumber,
                    tokenCount: tokens.length,
                });
                return tokens;
            })
            .catch((error) => {
                console.warn("[editor] segment line failed", {
                    articleId,
                    lineNumber,
                    message: error instanceof Error ? error.message : String(error),
                });
                return null;
            })
            .finally(() => {
                const latestPendingItem = segmentationPendingRef.current.get(lineNumber);
                if (latestPendingItem?.promise === requestPromise) {
                    segmentationPendingRef.current.delete(lineNumber);
                }
            });

        segmentationPendingRef.current.set(lineNumber, {
            text: lineText,
            promise: requestPromise,
        });

        return requestPromise;
    };

    const scheduleActiveLineSegmentation = (state: EditorState): void => {
        if (segmentationTimerRef.current !== null) {
            window.clearTimeout(segmentationTimerRef.current);
        }

        segmentationTimerRef.current = window.setTimeout(() => {
            const activeLine = state.doc.lineAt(state.selection.main.head);
            requestSegmentationForLine(activeLine.number, activeLine.text);
        }, 120);
    };

    const getLineTokens = (lineNumber: number, lineText: string): ChineseSegmentToken[] | null => {
        const cachedTokens = readCachedLineTokens(lineNumber, lineText);
        if (cachedTokens) {
            return cachedTokens;
        }

        void requestSegmentationForLine(lineNumber, lineText);
        return null;
    };

    const getOrRequestLineTokens = async (
        lineNumber: number,
        lineText: string,
    ): Promise<ChineseSegmentToken[] | null> => {
        const cachedTokens = readCachedLineTokens(lineNumber, lineText);
        if (cachedTokens) {
            return cachedTokens;
        }

        if (!containsChineseCharacter(lineText)) {
            return null;
        }

        return requestSegmentationForLine(lineNumber, lineText);
    };

    const resolveLineAtMouseEvent = (
        view: EditorView,
        event: MouseEvent,
    ): { lineNumber: number; lineText: string; lineFrom: number; lineOffset: number } | null => {
        const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
        if (pos === null) {
            return null;
        }

        const line = view.state.doc.lineAt(pos);
        return {
            lineNumber: line.number,
            lineText: line.text,
            lineFrom: line.from,
            lineOffset: pos - line.from,
        };
    };

    const prefetchSegmentationAtMouseEvent = (view: EditorView, event: MouseEvent): void => {
        const lineInfo = resolveLineAtMouseEvent(view, event);
        if (!lineInfo) {
            return;
        }

        void requestSegmentationForLine(lineInfo.lineNumber, lineInfo.lineText);
    };

    const trySelectWordAtMouseEvent = (view: EditorView, event: MouseEvent): boolean => {
        const lineInfo = resolveLineAtMouseEvent(view, event);
        if (!lineInfo) {
            return false;
        }

        const tokens = readCachedLineTokens(lineInfo.lineNumber, lineInfo.lineText);
        const range = getWordObjectRange(
            lineInfo.lineText,
            lineInfo.lineOffset,
            tokens,
            false,
        );
        if (!range) {
            return false;
        }

        view.dispatch({
            selection: {
                anchor: lineInfo.lineFrom + range.start,
                head: lineInfo.lineFrom + range.end,
            },
            scrollIntoView: true,
        });
        return true;
    };

    const executeSegmentedDeleteBackward = async (view: EditorView): Promise<void> => {
        const selection = view.state.selection.main;

        if (!selection.empty) {
            view.dispatch({
                changes: {
                    from: selection.from,
                    to: selection.to,
                    insert: "",
                },
                selection: {
                    anchor: selection.from,
                },
            });
            return;
        }

        const cursor = selection.head;
        if (cursor <= 0) {
            return;
        }

        const line = view.state.doc.lineAt(cursor);
        const lineOffset = cursor - line.from;
        if (lineOffset <= 0) {
            view.dispatch({
                changes: {
                    from: cursor - 1,
                    to: cursor,
                    insert: "",
                },
                selection: {
                    anchor: cursor - 1,
                },
            });
            return;
        }

        const previousChar = line.text.charAt(lineOffset - 1);
        const lineTokens = containsChineseCharacter(previousChar)
            ? await getOrRequestLineTokens(line.number, line.text)
            : null;

        const deleteFromOffset = containsChineseCharacter(previousChar)
            ? resolveChinesePreviousWordBoundary(line.text, lineOffset, lineTokens)
            : resolveEnglishPreviousWordBoundary(line.text, lineOffset);

        const safeFromOffset = Math.max(0, Math.min(deleteFromOffset, lineOffset));
        if (safeFromOffset === lineOffset) {
            return;
        }

        const deleteFrom = line.from + safeFromOffset;
        view.dispatch({
            changes: {
                from: deleteFrom,
                to: cursor,
                insert: "",
            },
            selection: {
                anchor: deleteFrom,
            },
        });
    };

    useEffect(() => {
        if (!hostRef.current || viewRef.current) {
            return;
        }

        const state = EditorState.create({
            doc: initialDoc,
            extensions: [
                vimModeCompartmentRef.current.of(vimModeEnabled ? vim() : []),
                editorBaseSetup,
                markdown(),
                createCodeMirrorThemeExtension(),
                /* 字体族 Compartment：通过 theme 扩展动态控制 .cm-content 字体族 */
                fontFamilyCompartmentRef.current.of(
                    /* theme-guard-ignore-next-line: 这里是实例级字体配置，不属于静态主题定义。 */
                    EditorView.theme({ ".cm-content": { fontFamily: SHARED_EDITOR_FONT_FAMILY_CSS_VALUE } }),
                ),
                /* 字体大小 Compartment：通过 theme 扩展动态控制 .cm-content 字号 */
                fontSizeCompartmentRef.current.of(
                    /* theme-guard-ignore-next-line: 这里是实例级字号配置，不属于静态主题定义。 */
                    EditorView.theme({ ".cm-content": { fontSize: SHARED_EDITOR_FONT_SIZE_CSS_VALUE } }),
                ),
                /* Tab 缩进宽度 Compartment */
                tabSizeCompartmentRef.current.of(EditorState.tabSize.of(editorTabSize)),
                /* 自动换行 Compartment */
                lineWrappingCompartmentRef.current.of(
                    editorLineWrapping ? EditorView.lineWrapping : [],
                ),
                /* 行号模式 Compartment：off/absolute/relative */
                lineNumbersCompartmentRef.current.of(
                    buildLineNumbersExtension(editorLineNumbers),
                ),
                /* Tab 键缩进：拦截 Tab/Shift-Tab 使其执行缩进而非焦点切换 */
                keymap.of([indentWithTab]),
                /* 块级插件优先注册，确保排斥区域在行级渲染器之前声明 */
                createFrontmatterSyntaxExtension({
                    onRequestExitVimNavigation: () => {
                        exitFrontmatterVimNavigationToBody();
                    },
                }),
                createCodeBlockHighlightExtension(),
                ...createLatexSyntaxExtension(),
                createMarkdownTableSyntaxExtension(
                    props.containerApi,
                    () => currentFilePathRef.current,
                ),
                /* 行级语法渲染：依赖排斥区域跳过块级结构内的行 */
                registeredLineSyntaxRenderExtension,
                createTaskCheckboxToggleExtension(),
                createImageEmbedSyntaxExtension(() => currentFilePathRef.current),
                createWikiLinkNavigationExtension(
                    props.containerApi,
                    () => currentFilePathRef.current,
                ),
                // 双击选择：在第二次按下时抢先接管，避免先出现原生选区再被分词选区覆盖。
                EditorView.domEventHandlers({
                    mousedown(event, view) {
                        try {
                            if (event.button !== 0) {
                                return false;
                            }

                            prefetchSegmentationAtMouseEvent(view, event);

                            if (event.detail !== 2) {
                                return false;
                            }

                            const handled = trySelectWordAtMouseEvent(view, event);
                            if (!handled) {
                                return false;
                            }

                            event.preventDefault();
                            return true;
                        } catch (_error) {
                            // fallback to default behavior
                            return false;
                        }
                    },
                }),
                ...getRegisteredEditPluginExtensions({
                    getCurrentFilePath: () => currentFilePathRef.current,
                }),
                EditorView.updateListener.of((update) => {
                    if (update.docChanged) {
                        const nextContent = update.state.doc.toString();
                        setReadContent(nextContent);
                        reportArticleContent({
                            articleId,
                            path: currentFilePathRef.current,
                            content: nextContent,
                        });
                    }

                    if (update.docChanged || update.selectionSet) {
                        scheduleActiveLineSegmentation(update.state);
                    }

                    if (update.focusChanged && update.view.hasFocus) {
                        reportArticleFocus({
                            articleId,
                            path: currentFilePathRef.current,
                            content: update.state.doc.toString(),
                        });
                    }

                    // 编辑器失焦时立即 flush 自动保存，确保内容及时持久化
                    if (update.focusChanged && !update.view.hasFocus) {
                        void flushAutoSaveByPath(currentFilePathRef.current);
                    }
                }),
            ],
        });

        // EditorView 构造函数中 plugin 初始化会调度 requestAnimationFrame，
        // 若构造中途抛出异常（如 frontmatter widget 的 React 渲染失败），
        // docView 未赋值但 RAF 已调度，导致后续 measure 循环访问 undefined docView。
        // 用 try-catch 包裹，在失败时中和 zombie 视图的 RAF。
        try {
            viewRef.current = new EditorView({
                state,
                parent: hostRef.current,
            });
        } catch (constructionError) {
            console.error("[editor] EditorView construction failed", {
                articleId,
                filePath: currentFilePathRef.current,
                message: constructionError instanceof Error ? constructionError.message : String(constructionError),
            });
            // hostRef.current 可能已被 appendChild(view.dom)，需要清理
            if (hostRef.current) {
                hostRef.current.innerHTML = "";
            }
            return;
        }

        syncTitleOffsetWithEditorGutter();

        const gutterResizeObserver = typeof ResizeObserver !== "undefined"
            ? new ResizeObserver(() => {
                syncTitleOffsetWithEditorGutter();
            })
            : null;
        const gutterMutationObserver = typeof MutationObserver !== "undefined"
            ? new MutationObserver(() => {
                syncTitleOffsetWithEditorGutter();
            })
            : null;

        gutterResizeObserver?.observe(viewRef.current.dom);
        const initialGutterElement = viewRef.current.dom.querySelector(".cm-gutters");
        if (initialGutterElement instanceof HTMLElement) {
            gutterResizeObserver?.observe(initialGutterElement);
        }
        gutterMutationObserver?.observe(viewRef.current.dom, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ["class", "style"],
        });

        window.requestAnimationFrame(() => {
            syncTitleOffsetWithEditorGutter();
        });

        // 注册 Vim 分词 token 提供器，让增强运动能获取当前行的分词缓存
        registerVimTokenProvider(viewRef.current, getLineTokens);

        // 绑定粘贴图片处理器，拦截剪贴板图片并创建嵌入
        const cleanupPasteHandler = attachPasteImageHandler(
            viewRef.current,
            {
                getCurrentFilePath: () => currentFilePathRef.current,
                createBinaryFile: createVaultBinaryFile,
                canMutateDocument: () => canMutateEditorDocument(displayModeRef.current),
            },
        );

        reportArticleContent({
            articleId,
            path: currentFilePathRef.current,
            content: state.doc.toString(),
        });

        const shouldAutoFocus = props.params.autoFocus === true;
        const initialCursorOffset = typeof props.params.initialCursorOffset === "number"
            ? props.params.initialCursorOffset
            : null;

        if (viewRef.current && shouldAutoFocus && !hasAppliedInitialAutoFocusRef.current) {
            hasAppliedInitialAutoFocusRef.current = true;
            const targetOffset = Math.max(0, Math.min(initialCursorOffset ?? state.doc.length, state.doc.length));
            window.requestAnimationFrame(() => {
                const liveView = viewRef.current;
                if (!liveView) {
                    return;
                }

                liveView.dispatch({
                    selection: {
                        anchor: targetOffset,
                    },
                    scrollIntoView: true,
                });
                liveView.focus();
            });
        }

        const activeLine = state.doc.lineAt(state.selection.main.head);
        void requestSegmentationForLine(activeLine.number, activeLine.text);

        return () => {
            if (segmentationTimerRef.current !== null) {
                window.clearTimeout(segmentationTimerRef.current);
                segmentationTimerRef.current = null;
            }
            segmentationPendingRef.current.clear();
            gutterResizeObserver?.disconnect();
            gutterMutationObserver?.disconnect();
            cleanupPasteHandler();
            if (viewRef.current) {
                unregisterVimTokenProvider(viewRef.current);
                safeDestroyEditorView(viewRef.current);
            }
            viewRef.current = null;
        };
    }, [initialDoc, articleId, props.containerApi]);

    useEffect(() => {
        const view = viewRef.current;
        if (!view) {
            return;
        }

        const handleKeydown = (event: KeyboardEvent): void => {
            const isComposing =
                event.isComposing ||
                event.keyCode === 229;
            if (isComposing) {
                return;
            }

            const eventTarget = event.target instanceof HTMLElement ? event.target : null;
            const isFrontmatterNavigationTarget = !!eventTarget?.closest(FRONTMATTER_VIM_NAV_SELECTOR);
            const isFrontmatterFieldTarget = !!eventTarget?.closest(FRONTMATTER_FOCUSABLE_SELECTOR);

            if (vimModeEnabledRef.current && !isFrontmatterNavigationTarget && !isFrontmatterFieldTarget) {
                const selection = view.state.selection.main;
                const bodyAnchor = resolveEditorBodyAnchor(view.state);
                const firstBodyLineNumber = view.state.doc.lineAt(bodyAnchor).number;
                const currentLineNumber = view.state.doc.lineAt(selection.head).number;

                const handoffResult = resolveRegisteredVimHandoff({
                    surface: "editor-body",
                    key: event.key,
                    markdown: view.state.doc.toString(),
                    currentLineNumber,
                    selectionHead: selection.head,
                    hasFrontmatter: bodyAnchor > 0,
                    firstBodyLineNumber,
                    isVimEnabled: vimModeEnabledRef.current,
                    isVimNormalMode: isVimNormalMode(view),
                });

                if (handoffResult) {
                    const handled = applyResolvedVimHandoff(
                        view,
                        handoffResult,
                        focusFrontmatterVimNavigationTarget,
                    );
                    if (handled) {
                        event.preventDefault();
                        event.stopPropagation();
                        return;
                    }
                }
            }

            const isCmdBackspace =
                event.key === "Backspace" &&
                event.metaKey &&
                !event.ctrlKey &&
                !event.altKey &&
                !event.shiftKey;
            if (isCmdBackspace) {
                if (!canMutateEditorDocument(displayModeRef.current)) {
                    return;
                }
                event.preventDefault();
                event.stopPropagation();
                void executeSegmentedDeleteBackward(view);
                return;
            }

            const resolution = dispatchShortcut({
                event,
                bindings: bindingsRef.current,
                source: "editor",
                conditionContext: createConditionContext({
                    focusedComponent: resolveEditorShortcutFocusedComponent(event.target),
                    activeTabId: articleId,
                    activeEditorArticleId: articleId,
                    currentVaultPath,
                }),
                managedShortcutCandidates: managedEditorShortcutCandidatesRef.current,
            });

            if (isMarkdownTableEditorFocused()) {
                if (resolution.shouldPreventDefault) {
                    event.preventDefault();
                }
                if (resolution.shouldStopPropagation) {
                    event.stopPropagation();
                }

                if (resolution.kind === "block-native") {
                    return;
                }

                if (resolution.commandId?.startsWith("editor.")) {
                    return;
                }

                if (resolution.kind === "execute") {
                    flushFocusedMarkdownTableEditor();
                }
            }

            if (resolution.kind === "none") {
                return;
            }

            if (resolution.shouldPreventDefault) {
                event.preventDefault();
            }
            if (resolution.shouldStopPropagation) {
                event.stopPropagation();
            }

            if (resolution.notifyTabClose) {
                notifyTabCloseShortcutTriggered();
            }

            if (resolution.kind === "block-native" || !resolution.commandId) {
                return;
            }

            executeEditorCommandRef.current(resolution.commandId);
        };

        view.dom.addEventListener("keydown", handleKeydown, true);
        return () => {
            view.dom.removeEventListener("keydown", handleKeydown, true);
        };
    }, [articleId]);

    useEffect(() => {
        const view = viewRef.current;
        if (!view) {
            return;
        }

        view.dispatch({
            effects: vimModeCompartmentRef.current.reconfigure(vimModeEnabled ? vim() : []),
        });

        console.info("[editor] vim mode changed", {
            articleId,
            filePath: currentFilePath,
            vimModeEnabled,
        });
    }, [vimModeEnabled, articleId, currentFilePath]);

    /* 编辑器排版变量变化日志：编辑态与阅读态共用同一套字体配置。 */
    useEffect(() => {
        console.info("[editor] shared typography changed", {
            articleId,
            editorFontFamily,
            editorFontSize,
        });
    }, [editorFontFamily, editorFontSize, articleId]);

    /* Tab 缩进宽度动态重配置 */
    useEffect(() => {
        const view = viewRef.current;
        if (!view) {
            return;
        }

        view.dispatch({
            effects: tabSizeCompartmentRef.current.reconfigure(
                EditorState.tabSize.of(editorTabSize),
            ),
        });

        console.info("[editor] tab size changed", { articleId, editorTabSize });
    }, [editorTabSize, articleId]);

    /* 自动换行动态重配置 */
    useEffect(() => {
        const view = viewRef.current;
        if (!view) {
            return;
        }

        view.dispatch({
            effects: lineWrappingCompartmentRef.current.reconfigure(
                editorLineWrapping ? EditorView.lineWrapping : [],
            ),
        });

        console.info("[editor] line wrapping changed", { articleId, editorLineWrapping });
    }, [editorLineWrapping, articleId]);

    /* 行号模式动态重配置（off/absolute/relative） */
    useEffect(() => {
        const view = viewRef.current;
        if (!view) {
            return;
        }

        view.dispatch({
            effects: lineNumbersCompartmentRef.current.reconfigure(
                buildLineNumbersExtension(editorLineNumbers),
            ),
        });

        console.info("[editor] line numbers mode changed", { articleId, editorLineNumbers });
    }, [editorLineNumbers, articleId]);

    useEffect(() => {
        const view = viewRef.current;
        if (!view) {
            return;
        }

        const currentDoc = view.state.doc.toString();
        if (currentDoc === initialDoc) {
            return;
        }

        view.dispatch({
            changes: {
                from: 0,
                to: view.state.doc.length,
                insert: initialDoc,
            },
        });
        setReadContent(initialDoc);
    }, [initialDoc]);

    useEffect(() => {
        const view = viewRef.current;
        if (!view || !articleSnapshot) {
            return;
        }

        if (!articleSnapshot.hasContentSnapshot) {
            return;
        }

        if (articleSnapshot.path !== currentFilePathRef.current) {
            return;
        }

        const currentDoc = view.state.doc.toString();
        if (currentDoc === articleSnapshot.content) {
            return;
        }

        view.dispatch({
            changes: {
                from: 0,
                to: view.state.doc.length,
                insert: articleSnapshot.content,
            },
        });
        setReadContent(articleSnapshot.content);

        console.info("[editor] synced content from editor context state", {
            articleId,
            path: articleSnapshot.path,
            updatedAt: articleSnapshot.updatedAt,
        });
    }, [articleSnapshot?.updatedAt, articleSnapshot?.content, articleSnapshot?.path, articleId]);

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

        const sourcePath = currentFilePathRef.current;
        const sourceTitle = resolveMarkdownNoteTitle(sourcePath);
        const trimmedDraft = titleDraft.trim();

        if (!trimmedDraft) {
            console.warn("[editor] rename title skipped: empty draft", {
                articleId,
                path: sourcePath,
                submitReason,
            });
            setTitleDraft(sourceTitle);
            if (submitReason === "enter" && displayModeRef.current === "edit") {
                focusEditorBodyStart();
            }
            return;
        }

        const targetPath = resolveRenamedMarkdownPath(sourcePath, trimmedDraft);
        if (!targetPath) {
            setTitleDraft(sourceTitle);
            if (submitReason === "enter" && displayModeRef.current === "edit") {
                focusEditorBodyStart();
            }
            return;
        }

        if (targetPath === sourcePath) {
            setTitleDraft(resolveMarkdownNoteTitle(targetPath));
            if (submitReason === "enter" && displayModeRef.current === "edit") {
                focusEditorBodyStart();
            }
            return;
        }

        const latestContent = viewRef.current?.state.doc.toString()
            ?? articleSnapshot?.content
            ?? readContent;
        const currentPanel = props.containerApi.getPanel(articleId);
        const panelApi = currentPanel?.api as {
            setTitle(title: string): void;
            updateParameters?: (params: Record<string, unknown>) => void;
            setActive(): void;
        } | undefined;
        const nextPanelParams = {
            ...(props.params ?? {}),
            path: targetPath,
            content: latestContent,
        };
        const previousPanelParams = currentPanel?.params && typeof currentPanel.params === "object"
            ? { ...(currentPanel.params as Record<string, unknown>) }
            : null;
        const previousPanelTitle = resolveMarkdownNoteTitle(sourcePath);
        const nextPanelTitle = resolveMarkdownNoteTitle(targetPath);

        titleRenameInFlightRef.current = true;
        setIsTitleRenaming(true);

        console.info("[editor] rename title requested", {
            articleId,
            from: sourcePath,
            to: targetPath,
            submitReason,
        });

        if (currentPanel && panelApi) {
            panelApi.setTitle(nextPanelTitle);
            if (currentPanel.params && typeof currentPanel.params === "object") {
                Object.assign(currentPanel.params as Record<string, unknown>, nextPanelParams);
            }
            panelApi.updateParameters?.(nextPanelParams);

            console.info("[editor] rename title applied optimistic panel path", {
                articleId,
                from: sourcePath,
                to: targetPath,
                submitReason,
            });
        }

        try {
            await renameVaultMarkdownFile(sourcePath, targetPath);
            await saveVaultMarkdownFile(targetPath, latestContent);

            currentFilePathRef.current = targetPath;
            setTitleDraft(resolveMarkdownNoteTitle(targetPath));
            reportArticleContent({
                articleId,
                path: targetPath,
                content: latestContent,
            });

            if (isActiveEditor) {
                reportActiveEditor({
                    articleId,
                    path: targetPath,
                });
                reportArticleFocus({
                    articleId,
                    path: targetPath,
                    content: latestContent,
                });
            }

            if (currentPanel && panelApi) {
                panelApi.setTitle(nextPanelTitle);
                panelApi.updateParameters?.(nextPanelParams);
            } else {
                await openFileInDockview({
                    containerApi: props.containerApi,
                    currentVaultPath,
                    relativePath: targetPath,
                    contentOverride: latestContent,
                    tabParams: {
                        autoFocus: submitReason === "enter",
                    },
                });
            }

            if (submitReason === "enter" && displayModeRef.current === "edit") {
                focusEditorBodyStart();
            }

            console.info("[editor] rename title success", {
                articleId,
                from: sourcePath,
                to: targetPath,
                submitReason,
            });
        } catch (error) {
            if (currentPanel && panelApi) {
                panelApi.setTitle(previousPanelTitle);
                if (currentPanel.params && typeof currentPanel.params === "object" && previousPanelParams) {
                    Object.assign(currentPanel.params as Record<string, unknown>, previousPanelParams);
                }
                if (previousPanelParams) {
                    panelApi.updateParameters?.(previousPanelParams);
                }
            }

            setTitleDraft(sourceTitle);
            console.error("[editor] rename title failed", {
                articleId,
                from: sourcePath,
                to: targetPath,
                submitReason,
                message: error instanceof Error ? error.message : String(error),
            });
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
                                isTitleInputComposingRef.current = true;
                            }}
                            onCompositionEnd={() => {
                                isTitleInputComposingRef.current = false;
                                lastTitleInputCompositionEndAtRef.current = performance.now();
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
