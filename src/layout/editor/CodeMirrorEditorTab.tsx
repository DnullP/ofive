/**
 * @module layout/editor/CodeMirrorEditorTab
 * @description 基于 CodeMirror 6 的编辑器 Tab 组件，用于在 Dockview 中承载可编辑文本内容。
 * @dependencies
 *  - react
 *  - dockview
 *  - codemirror
 *  - @codemirror/lang-markdown
 *  - ./codemirrorTheme
 */

import { Component, useEffect, useMemo, useRef, useState, type ErrorInfo, type ReactNode } from "react";
import type { IDockviewPanelProps } from "dockview";
import { EditorView } from "codemirror";
import { Compartment, EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { basicSetup } from "codemirror";
import { indentLess, indentMore, indentWithTab, redo, selectAll, toggleComment, undo } from "@codemirror/commands";
import { openSearchPanel } from "@codemirror/search";
import { keymap } from "@codemirror/view";
import { vim } from "@replit/codemirror-vim";
import "./CodeMirrorEditorTab.css";
/* KaTeX 样式：LaTeX 数学公式渲染所需的字体和布局样式 */
import "katex/dist/katex.min.css";
import {
    reportArticleContent,
    reportArticleFocus,
    useArticleById,
} from "../../store/editorContextStore";
import {
    executeCommand,
    getCommandCondition,
    type CommandId,
    type EditorNativeCommandId,
} from "../../commands/commandSystem";
import { isConditionSatisfied } from "../../commands/focusContext";
import {
    notifyCommandPaletteOpenRequested,
    notifyQuickSwitcherOpenRequested,
    notifyTabCloseShortcutTriggered,
} from "../../commands/shortcutEvents";
import { matchShortcut, useShortcutState } from "../../store/shortcutStore";
import { resolveSystemShortcutCommand } from "../../commands/systemShortcutSubsystem";
import { useVaultState } from "../../store/vaultStore";
import {
    createVaultBinaryFile,
    renameVaultMarkdownFile,
    segmentChineseText,
    type ChineseSegmentToken,
} from "../../api/vaultApi";
import { useConfigState } from "../../store/configStore";
import { subscribeEditorRenameRequestedEvent } from "../../events/appEventBus";
import i18n from "../../i18n";
import { createRegisteredLineSyntaxRenderExtension } from "./syntaxRenderRegistry";
import { ensureBuiltinSyntaxRenderersRegistered } from "./registerBuiltinSyntaxRenderers";
import { ensureBuiltinEditPluginsRegistered } from "./registerBuiltinEditPlugins";
import { getRegisteredEditPluginExtensions } from "./editPluginRegistry";
import { createWikiLinkNavigationExtension } from "./syntaxPlugins/wikiLinkSyntaxRenderer";
import { createImageEmbedSyntaxExtension } from "./syntaxPlugins/imageEmbedSyntaxExtension";
import { createFrontmatterSyntaxExtension } from "./syntaxPlugins/frontmatterSyntaxExtension.ts";
import { createCodeBlockHighlightExtension } from "./syntaxPlugins/codeBlockHighlightExtension";
import { createLatexSyntaxExtension } from "./syntaxPlugins/latexSyntaxExtension";
import { resolveParentDirectory } from "./pathUtils";
import { createCodeMirrorThemeExtension } from "./codemirrorTheme";
import { collectManagedEditorShortcutCandidates } from "./editorShortcutPolicy";
import { attachPasteImageHandler } from "./editorPasteImageHandler";
import { createRelativeLineNumbersExtension } from "./relativeLineNumbersExtension";
import {
    toggleBold,
    toggleItalic,
    toggleStrikethrough,
    toggleInlineCode,
    toggleHighlight,
    insertLink,
} from "./markdownFormattingCommands";
import {
    containsChineseCharacter,
    resolveChinesePreviousWordBoundary,
    resolveEnglishPreviousWordBoundary,
} from "./editorWordBoundaries";
import {
    registerVimTokenProvider,
    unregisterVimTokenProvider,
    setupVimEnhancedMotions,
} from "./vimChineseMotionExtension";
import { flushAutoSaveByPath } from "../../store/autoSaveService";

ensureBuiltinSyntaxRenderersRegistered();
ensureBuiltinEditPluginsRegistered();

// 初始化 Vim 增强运动（全局仅一次）
setupVimEnhancedMotions();

const registeredLineSyntaxRenderExtension = createRegisteredLineSyntaxRenderExtension();

/**
 * @function buildLineNumbersExtension
 * @description 根据行号模式构建 CM6 行号相关扩展。
 *   - "off"：通过 theme 隐藏 gutter
 *   - "absolute"：空扩展（CM6 basicSetup 自带默认行号）
 *   - "relative"：替换为相对行号扩展
 *
 * @param mode 行号显示模式
 * @returns CM6 Extension 或 Extension[]
 */
function buildLineNumbersExtension(
    mode: "off" | "absolute" | "relative",
): import("@codemirror/state").Extension {
    switch (mode) {
        case "off":
            return EditorView.theme({
                ".cm-gutters": { display: "none !important" },
            });
        case "relative":
            return createRelativeLineNumbersExtension();
        case "absolute":
        default:
            /* basicSetup 已包含默认 lineNumbers()，无需额外配置 */
            return [];
    }
}

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
                        <p>编辑器渲染出错</p>
                        <p className="cm-tab-error-detail">{this.state.errorMessage}</p>
                        <button
                            type="button"
                            className="cm-tab-error-retry"
                            onClick={() => this.setState({ hasError: false, errorMessage: null })}
                        >
                            重试
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
 * @function buildDefaultContent
 * @description 根据文件路径构建默认内容。
 * @param filePath 文件路径。
 * @returns 编辑器默认文本。
 */
function buildDefaultContent(filePath: string): string {
    return `# ${filePath.split("/").pop() ?? filePath}\n\n> ${i18n.t("editor.defaultContent")}`;
}

/**
 * @function CodeMirrorEditorTab
 * @description Dockview Tab 渲染函数，挂载并管理 CodeMirror 实例生命周期。
 * @param props Dockview 面板参数，支持 params.path 与 params.content。
 * @returns 编辑器 Tab 视图。
 */
export function CodeMirrorEditorTab(props: IDockviewPanelProps<Record<string, unknown>>): ReactNode {
    const hostRef = useRef<HTMLDivElement | null>(null);
    const viewRef = useRef<EditorView | null>(null);
    const bindingsRef = useRef<Record<CommandId, string>>({
        "tab.closeFocused": "Ctrl+W",
        "app.quit": "Cmd+Q",
        "sidebar.left.toggle": "Cmd+Shift+J",
        "sidebar.right.toggle": "Cmd+Shift+K",
        "file.saveFocused": "Cmd+S",
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
    const currentFilePathRef = useRef<string>(String(props.params.path ?? i18n.t("editor.untitledFile")));
    const fileNameInputRef = useRef<HTMLInputElement | null>(null);
    const segmentationCacheRef = useRef<Map<number, SegmentationCacheItem>>(new Map());
    const segmentationTimerRef = useRef<number | null>(null);
    const vimModeCompartmentRef = useRef<Compartment>(new Compartment());
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
    const { files } = useVaultState();
    const { featureSettings } = useConfigState();
    const vimModeEnabled = featureSettings.vimModeEnabled;
    const editorFontSize = featureSettings.editorFontSize;
    const editorTabSize = featureSettings.editorTabSize;
    const editorLineWrapping = featureSettings.editorLineWrapping;
    const editorLineNumbers = featureSettings.editorLineNumbers;

    const [currentFilePath, setCurrentFilePath] = useState<string>(
        String(props.params.path ?? i18n.t("editor.untitledFile")),
    );
    const [isEditingFileName, setIsEditingFileName] = useState<boolean>(false);
    const [fileNameDraft, setFileNameDraft] = useState<string>(
        String(props.params.path ?? i18n.t("editor.untitledFile")).split("/").pop() ?? i18n.t("editor.untitledFile"),
    );
    const [renameError, setRenameError] = useState<string | null>(null);
    const articleId = props.api.id;
    const articleSnapshot = useArticleById(articleId);

    useEffect(() => {
        currentFilePathRef.current = currentFilePath;
    }, [currentFilePath]);

    useEffect(() => {
        if (!isEditingFileName) {
            return;
        }

        const inputElement = fileNameInputRef.current;
        if (!inputElement) {
            return;
        }

        inputElement.focus();
        const extensionMatch = inputElement.value.match(/\.(md|markdown)$/i);
        const selectEnd = extensionMatch
            ? inputElement.value.length - extensionMatch[0].length
            : inputElement.value.length;
        inputElement.setSelectionRange(0, Math.max(0, selectEnd));
    }, [isEditingFileName]);

    /* 订阅事件总线的重命名请求，当 articleId 匹配时进入文件名内联编辑模式 */
    useEffect(() => {
        const unlisten = subscribeEditorRenameRequestedEvent((payload) => {
            if (payload.articleId !== articleId) {
                return;
            }
            const fileName = currentFilePathRef.current.split("/").pop() ?? currentFilePathRef.current;
            setFileNameDraft(fileName);
            setIsEditingFileName(true);
            setRenameError(null);
            console.info("[editor] rename mode activated by command", { articleId });
        });

        return unlisten;
    }, [articleId]);

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

        if (commandId === "editor.undo") {
            return undo(view);
        }

        if (commandId === "editor.redo") {
            return redo(view);
        }

        if (commandId === "editor.selectAll") {
            return selectAll(view);
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

        return false;
    };

    const executeEditorCommand = (commandId: CommandId): void => {
        executeCommand(commandId, {
            activeTabId: props.api.id,
            closeTab: (tabId) => {
                props.containerApi.getPanel(tabId)?.api.close();
            },
            openQuickSwitcher: () => {
                notifyQuickSwitcherOpenRequested();
            },
            openCommandPalette: () => {
                notifyCommandPaletteOpenRequested();
            },
            openFileTab: (relativePath, content) => {
                const normalizedPath = relativePath.replace(/\\/g, "/");
                const fileName = normalizedPath.split("/").pop() ?? "untitled.md";
                props.containerApi.addPanel({
                    id: `file:${normalizedPath}`,
                    title: fileName,
                    component: "codemirror",
                    params: {
                        path: normalizedPath,
                        content,
                    },
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
        executeEditorCommandRef.current = executeEditorCommand;
    }, [executeEditorCommand]);

    const requestSegmentationForLine = (lineNumber: number, lineText: string): void => {
        if (!containsChineseCharacter(lineText)) {
            return;
        }

        const currentCache = segmentationCacheRef.current.get(lineNumber);
        if (currentCache && currentCache.text === lineText) {
            return;
        }

        void segmentChineseText(lineText)
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
            })
            .catch((error) => {
                console.warn("[editor] segment line failed", {
                    articleId,
                    lineNumber,
                    message: error instanceof Error ? error.message : String(error),
                });
            });
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
        const cacheItem = segmentationCacheRef.current.get(lineNumber);
        if (cacheItem && cacheItem.text === lineText) {
            return cacheItem.tokens;
        }

        requestSegmentationForLine(lineNumber, lineText);
        return null;
    };

    const getOrRequestLineTokens = async (
        lineNumber: number,
        lineText: string,
    ): Promise<ChineseSegmentToken[] | null> => {
        const cacheItem = segmentationCacheRef.current.get(lineNumber);
        if (cacheItem && cacheItem.text === lineText) {
            return cacheItem.tokens;
        }

        if (!containsChineseCharacter(lineText)) {
            return null;
        }

        try {
            const tokens = await segmentChineseText(lineText);
            segmentationCacheRef.current.set(lineNumber, {
                text: lineText,
                tokens,
            });
            return tokens;
        } catch (error) {
            console.warn("[editor] segment line for cmd+backspace failed", {
                articleId,
                lineNumber,
                message: error instanceof Error ? error.message : String(error),
            });
            return null;
        }
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

    const initialDoc = useMemo(() => {
        const content = props.params.content;
        if (typeof content === "string" && content.length > 0) {
            return content;
        }
        return buildDefaultContent(currentFilePath);
    }, [props.params.content, currentFilePath]);

    useEffect(() => {
        if (!hostRef.current || viewRef.current) {
            return;
        }

        const state = EditorState.create({
            doc: initialDoc,
            extensions: [
                vimModeCompartmentRef.current.of(vimModeEnabled ? vim() : []),
                basicSetup,
                markdown(),
                createCodeMirrorThemeExtension(),
                /* 字体大小 Compartment：通过 theme 扩展动态控制 .cm-content 字号 */
                fontSizeCompartmentRef.current.of(
                    EditorView.theme({ ".cm-content": { fontSize: `${editorFontSize}px` } }),
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
                createFrontmatterSyntaxExtension(),
                createCodeBlockHighlightExtension(),
                ...createLatexSyntaxExtension(),
                /* 行级语法渲染：依赖排斥区域跳过块级结构内的行 */
                registeredLineSyntaxRenderExtension,
                createImageEmbedSyntaxExtension(() => currentFilePathRef.current),
                createWikiLinkNavigationExtension(
                    props.containerApi,
                    () => currentFilePathRef.current,
                ),
                ...getRegisteredEditPluginExtensions({
                    getCurrentFilePath: () => currentFilePathRef.current,
                }),
                EditorView.updateListener.of((update) => {
                    if (update.docChanged) {
                        reportArticleContent({
                            articleId,
                            path: currentFilePathRef.current,
                            content: update.state.doc.toString(),
                        });
                    }

                    if ((update.docChanged || update.selectionSet) && vimModeEnabledRef.current) {
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

        // 注册 Vim 分词 token 提供器，让增强运动能获取当前行的分词缓存
        registerVimTokenProvider(viewRef.current, getLineTokens);

        // 绑定粘贴图片处理器，拦截剪贴板图片并创建嵌入
        const cleanupPasteHandler = attachPasteImageHandler(
            viewRef.current,
            {
                getCurrentFilePath: () => currentFilePathRef.current,
                createBinaryFile: createVaultBinaryFile,
            },
        );

        reportArticleContent({
            articleId,
            path: currentFilePathRef.current,
            content: state.doc.toString(),
        });

        if (vimModeEnabledRef.current) {
            const activeLine = state.doc.lineAt(state.selection.main.head);
            requestSegmentationForLine(activeLine.number, activeLine.text);
        }

        return () => {
            if (segmentationTimerRef.current !== null) {
                window.clearTimeout(segmentationTimerRef.current);
                segmentationTimerRef.current = null;
            }
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

            const isCmdBackspace =
                event.key === "Backspace" &&
                event.metaKey &&
                !event.ctrlKey &&
                !event.altKey &&
                !event.shiftKey;
            if (isCmdBackspace) {
                event.preventDefault();
                event.stopPropagation();
                void executeSegmentedDeleteBackward(view);
                return;
            }

            const systemShortcutResolution = resolveSystemShortcutCommand(event, bindingsRef.current);
            if (systemShortcutResolution) {
                event.preventDefault();
                event.stopPropagation();

                if (systemShortcutResolution.commandId === "tab.closeFocused") {
                    notifyTabCloseShortcutTriggered();
                }

                executeEditorCommandRef.current(systemShortcutResolution.commandId);
                return;
            }

            // 仅匹配条件满足当前编辑器上下文的命令，跳过其他组件条件的命令
            // (如 fileTreeFocused 的命令不在编辑器中执行)
            const commandId = (Object.entries(bindingsRef.current).find(([id, shortcut]) => {
                if (!matchShortcut(event, shortcut)) return false;
                const condition = getCommandCondition(id as CommandId);
                return isConditionSatisfied(condition, "tab:codemirror");
            })?.[0] ?? null) as CommandId | null;

            if (!commandId) {
                const shouldBlockNativeShortcut = managedEditorShortcutCandidatesRef.current.some((shortcut) =>
                    matchShortcut(event, shortcut),
                );

                if (shouldBlockNativeShortcut) {
                    event.preventDefault();
                    event.stopPropagation();
                }

                return;
            }

            event.preventDefault();
            event.stopPropagation();

            if (commandId === "tab.closeFocused") {
                notifyTabCloseShortcutTriggered();
            }

            executeEditorCommandRef.current(commandId);
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

    /* 编辑器字体大小动态重配置 */
    useEffect(() => {
        const view = viewRef.current;
        if (!view) {
            return;
        }

        view.dispatch({
            effects: fontSizeCompartmentRef.current.reconfigure(
                EditorView.theme({ ".cm-content": { fontSize: `${editorFontSize}px` } }),
            ),
        });

        console.info("[editor] font size changed", { articleId, editorFontSize });
    }, [editorFontSize, articleId]);

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

    const currentFileName = currentFilePath.split("/").pop() ?? currentFilePath;

    const commitFileRename = async (): Promise<void> => {
        const trimmedName = fileNameDraft.trim();
        if (!trimmedName) {
            setRenameError(i18n.t("editor.fileNameEmpty"));
            return;
        }

        const safeFileName =
            trimmedName.endsWith(".md") || trimmedName.endsWith(".markdown")
                ? trimmedName
                : `${trimmedName}.md`;
        const parentDirectory = resolveParentDirectory(currentFilePath);
        const nextRelativePath = parentDirectory
            ? `${parentDirectory}/${safeFileName}`
            : safeFileName;

        if (nextRelativePath === currentFilePath) {
            setIsEditingFileName(false);
            setRenameError(null);
            return;
        }

        try {
            await renameVaultMarkdownFile(currentFilePath, nextRelativePath);
            setCurrentFilePath(nextRelativePath);
            currentFilePathRef.current = nextRelativePath;
            props.api.setTitle(safeFileName);

            const currentDoc = viewRef.current?.state.doc.toString() ?? "";
            reportArticleContent({
                articleId,
                path: nextRelativePath,
                content: currentDoc,
            });
            reportArticleFocus({
                articleId,
                path: nextRelativePath,
                content: currentDoc,
            });

            setIsEditingFileName(false);
            setRenameError(null);
            console.info("[editor] rename file success", {
                articleId,
                from: currentFilePath,
                to: nextRelativePath,
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : i18n.t("editor.renameFailed");
            setRenameError(message);
            console.error("[editor] rename file failed", {
                articleId,
                from: currentFilePath,
                to: nextRelativePath,
                message,
            });
        }
    };

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

        console.info("[editor] synced content from editor context state", {
            articleId,
            path: articleSnapshot.path,
            updatedAt: articleSnapshot.updatedAt,
        });
    }, [articleSnapshot?.updatedAt, articleSnapshot?.content, articleSnapshot?.path, articleId]);

    return (
        <EditorErrorBoundary>
            <div className="cm-tab">
                <div className="cm-tab-header" onClick={() => {
                    setFileNameDraft(currentFileName);
                    setIsEditingFileName(true);
                    setRenameError(null);
                }}>
                    {isEditingFileName ? (
                        <input
                            ref={fileNameInputRef}
                            className="cm-tab-header-input"
                            value={fileNameDraft}
                            onChange={(event) => {
                                setFileNameDraft(event.target.value);
                            }}
                            onClick={(event) => {
                                event.stopPropagation();
                            }}
                            onBlur={() => {
                                void commitFileRename();
                            }}
                            onKeyDown={(event) => {
                                const nativeEvent = event.nativeEvent;
                                const isComposing =
                                    nativeEvent.isComposing ||
                                    nativeEvent.keyCode === 229;
                                if (isComposing) {
                                    return;
                                }

                                if (event.key === "Enter") {
                                    event.preventDefault();
                                    void commitFileRename();
                                    return;
                                }

                                if (event.key === "Escape") {
                                    event.preventDefault();
                                    setIsEditingFileName(false);
                                    setRenameError(null);
                                }
                            }}
                        />
                    ) : (
                        currentFilePath
                    )}
                </div>
                {renameError ? <div className="cm-tab-header-error">{renameError}</div> : null}
                <div ref={hostRef} className="cm-tab-editor" />
            </div>
        </EditorErrorBoundary>
    );
}
