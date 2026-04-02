/**
 * @module plugins/markdown-codemirror/editor/useCodeMirrorEditorLifecycle
 * @description CodeMirror 编辑器生命周期 Hook：负责 EditorView 创建、扩展装配、gutter 对齐、动态 compartment 重配置与销毁清理。
 * @dependencies
 *  - react
 *  - dockview
 *  - codemirror
 *  - @codemirror/state
 *  - @codemirror/lang-markdown
 *  - @replit/codemirror-vim
 *  - ../../../api/vaultApi
 *  - ../../../host/editor/editorContextStore
 *  - ./syntaxPlugins/*
 *  - ./editorBaseSetup
 *  - ./editorPasteImageHandler
 *  - ./lineNumbersModeExtension
 *  - ./vimChineseMotionExtension
 *
 * @example
 *   const { viewRef } = useCodeMirrorEditorLifecycle({
 *     articleId,
 *     containerApi: props.containerApi,
 *     hostRef,
 *     tabRootRef,
 *     initialDoc,
 *     displayFilePath,
 *     readContent,
 *     currentFilePath,
 *     currentFilePathRef,
 *     displayModeRef,
 *     effectiveDisplayMode,
 *     vimModeEnabled,
 *     editorTabSize,
 *     editorLineWrapping,
 *     editorLineNumbers,
 *     initialAutoFocus: props.params.autoFocus === true,
 *     initialCursorOffset: typeof props.params.initialCursorOffset === "number"
 *       ? props.params.initialCursorOffset
 *       : null,
 *     hasAppliedInitialAutoFocusRef,
 *     articleSnapshot,
 *     setReadContent,
 *     registeredLineSyntaxRenderExtension,
 *     getLineTokens,
 *     clearPendingSegmentation,
 *     prefetchLineSegmentation,
 *     prefetchSegmentationAtMouseEvent,
 *     scheduleActiveLineSegmentation,
 *     trySelectWordAtMouseEvent,
 *     onRequestExitFrontmatterVimNavigation: exitFrontmatterVimNavigationToBody,
 *   });
 *
 * @exports
 *  - syncEditorTabGutterWidth: 同步标题栏 gutter 宽度补偿
 *  - safeDestroyEditorView: 安全销毁 EditorView
 *  - useCodeMirrorEditorLifecycle: 管理编辑器实例生命周期
 */

import { useEffect, useRef, type MutableRefObject } from "react";
import type { IDockviewPanelProps } from "dockview";
import { EditorView } from "codemirror";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { indentWithTab } from "@codemirror/commands";
import { keymap } from "@codemirror/view";
import { vim } from "@replit/codemirror-vim";
import {
    createVaultBinaryFile,
} from "../../../api/vaultApi";
import {
    reportArticleContent,
    reportArticleFocus,
    type ArticleState,
} from "../../../host/editor/editorContextStore";
import type { EditorDisplayMode } from "../../../host/editor/editorDisplayModeStore";
import { flushAutoSaveByPath } from "../../../host/editor/autoSaveService";
import {
    createCodeMirrorThemeExtension,
    createCodeMirrorTypographyThemeExtension,
} from "./codemirrorTheme";
import { getRegisteredEditPluginExtensions } from "./editPluginRegistry";
import { editorBaseSetup } from "./editorBaseSetup";
import type { EditorChineseSegmentationController } from "./editorChineseSegmentation";
import { attachPasteImageHandler } from "./editorPasteImageHandler";
import { buildLineNumbersExtension } from "./lineNumbersModeExtension";
import { canMutateEditorDocument } from "./editorModePolicy";
import { createCodeBlockHighlightExtension } from "./syntaxPlugins/codeBlockHighlightExtension";
import { createFrontmatterSyntaxExtension } from "./syntaxPlugins/frontmatterSyntaxExtension.ts";
import { createImageEmbedSyntaxExtension } from "./syntaxPlugins/imageEmbedSyntaxExtension";
import { createLatexSyntaxExtension } from "./syntaxPlugins/latexSyntaxExtension";
import { createMarkdownTableSyntaxExtension } from "./syntaxPlugins/markdownTableSyntaxExtension";
import { createTaskCheckboxToggleExtension } from "./syntaxPlugins/listSyntaxRenderer";
import { createWikiLinkNavigationExtension } from "./syntaxPlugins/wikiLinkSyntaxRenderer";
import { createWikiLinkPreviewExtension } from "./syntaxPlugins/wikiLinkPreviewExtension";
import {
    registerVimTokenProvider,
    unregisterVimTokenProvider,
} from "./vimChineseMotionExtension";

const SHARED_EDITOR_FONT_FAMILY_CSS_VALUE = "var(--cm-editor-font-family)";
const SHARED_EDITOR_FONT_SIZE_CSS_VALUE = "var(--cm-editor-font-size)";

/**
 * @interface SyncEditorTabGutterWidthOptions
 * @description 同步标题 gutter 补偿所需的最小上下文。
 */
export interface SyncEditorTabGutterWidthOptions {
    /** 编辑器 tab 根节点。 */
    tabRoot: HTMLDivElement | null;
    /** 当前编辑器视图。 */
    view: EditorView | null;
    /** 当前显示模式。 */
    displayMode: EditorDisplayMode;
}

/**
 * @interface UseCodeMirrorEditorLifecycleOptions
 * @description 生命周期 Hook 依赖的外部上下文。
 */
export interface UseCodeMirrorEditorLifecycleOptions {
    /** 当前文章 id。 */
    articleId: string;
    /** Dockview 容器 API。 */
    containerApi: IDockviewPanelProps<Record<string, unknown>>["containerApi"];
    /** tab 根节点引用。 */
    tabRootRef: MutableRefObject<HTMLDivElement | null>;
    /** CodeMirror 宿主节点引用。 */
    hostRef: MutableRefObject<HTMLDivElement | null>;
    /** 初始文档内容。 */
    initialDoc: string;
    /** 当前展示路径。 */
    displayFilePath: string;
    /** 当前阅读态内容快照。 */
    readContent: string;
    /** 当前文件路径。 */
    currentFilePath: string;
    /** 当前文件路径引用。 */
    currentFilePathRef: MutableRefObject<string>;
    /** 当前显示模式引用。 */
    displayModeRef: MutableRefObject<EditorDisplayMode>;
    /** 当前生效的显示模式。 */
    effectiveDisplayMode: EditorDisplayMode;
    /** 当前 Vim 开关。 */
    vimModeEnabled: boolean;
    /** 编辑器字体族。 */
    editorFontFamily: string;
    /** 编辑器字号。 */
    editorFontSize: number;
    /** Tab 宽度。 */
    editorTabSize: number;
    /** 是否自动换行。 */
    editorLineWrapping: boolean;
    /** 行号模式。 */
    editorLineNumbers: Parameters<typeof buildLineNumbersExtension>[0];
    /** 是否初次自动聚焦。 */
    initialAutoFocus: boolean;
    /** 初始光标偏移。 */
    initialCursorOffset: number | null;
    /** 初次自动聚焦守卫。 */
    hasAppliedInitialAutoFocusRef: MutableRefObject<boolean>;
    /** 编辑器上下文快照。 */
    articleSnapshot: ArticleState | null;
    /** 阅读态内容写回器。 */
    setReadContent(content: string): void;
    /** 已注册的行级语法扩展。 */
    registeredLineSyntaxRenderExtension: Extension;
    /** 读取 Vim 分词缓存。 */
    getLineTokens: EditorChineseSegmentationController["getLineTokens"];
    /** 清理分词定时器与 pending。 */
    clearPendingSegmentation: EditorChineseSegmentationController["clearPendingSegmentation"];
    /** 预取行分词。 */
    prefetchLineSegmentation: EditorChineseSegmentationController["prefetchLineSegmentation"];
    /** 鼠标悬停预取分词。 */
    prefetchSegmentationAtMouseEvent: EditorChineseSegmentationController["prefetchSegmentationAtMouseEvent"];
    /** 调度当前行分词。 */
    scheduleActiveLineSegmentation: EditorChineseSegmentationController["scheduleActiveLineSegmentation"];
    /** 双击按词选中。 */
    trySelectWordAtMouseEvent: EditorChineseSegmentationController["trySelectWordAtMouseEvent"];
    /** 退出 frontmatter Vim 导航层。 */
    onRequestExitFrontmatterVimNavigation(): void;
}

/**
 * @function syncEditorTabGutterWidth
 * @description 将标题输入的起点与编辑器正文首列对齐；阅读态或视图缺失时清零补偿。
 * @param options gutter 同步参数。
 * @returns void
 */
export function syncEditorTabGutterWidth(options: SyncEditorTabGutterWidthOptions): void {
    if (!options.tabRoot || !options.view || options.displayMode !== "edit") {
        options.tabRoot?.style.setProperty("--cm-tab-gutter-width", "0px");
        return;
    }

    const gutterElement = options.view.dom.querySelector(".cm-gutters");
    const gutterWidth = isWidthMeasurableElement(gutterElement)
        ? gutterElement.getBoundingClientRect().width
        : 0;

    options.tabRoot.style.setProperty(
        "--cm-tab-gutter-width",
        `${gutterWidth.toFixed(2)}px`,
    );
}

/**
 * @function isWidthMeasurableElement
 * @description 判断对象是否提供可读取宽度的 `getBoundingClientRect`，兼容测试桩与真实 DOM 元素。
 * @param value 待判断对象。
 * @returns 是否可安全读取布局宽度。
 */
function isWidthMeasurableElement(value: unknown): value is { getBoundingClientRect(): { width: number } } {
    return typeof value === "object"
        && value !== null
        && "getBoundingClientRect" in value
        && typeof value.getBoundingClientRect === "function";
}

/**
 * @function safeDestroyEditorView
 * @description 安全销毁 EditorView，并中和残留的 measure/dispatch 回调与已调度 RAF。
 * @param view 要销毁的 EditorView 实例。
 * @returns void
 */
export function safeDestroyEditorView(view: EditorView): void {
    view.destroy();
    neutralizeEditorView(view);
    console.debug("[editor] EditorView safely destroyed and patched");
}

/**
 * @function neutralizeEditorView
 * @description 在已销毁或构造失败的 EditorView 上覆盖潜在回调入口为空操作，避免 zombie measure 循环。
 * @param view 要中和的 EditorView 实例。
 * @returns void
 */
function neutralizeEditorView(view: EditorView): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const neutralizedView = view as any;
    const noop = (): void => { /* neutralized – no-op */ };

    if (typeof neutralizedView.measureScheduled === "number" && neutralizedView.measureScheduled > -1) {
        cancelAnimationFrame(neutralizedView.measureScheduled);
        neutralizedView.measureScheduled = -1;
    }

    neutralizedView.requestMeasure = noop;
    neutralizedView.measure = noop;
    neutralizedView.dispatch = noop;
    neutralizedView.update = noop;
    neutralizedView.destroyed = true;
}

/**
 * @function useCodeMirrorEditorLifecycle
 * @description 管理 EditorView 的创建、更新、gutter 补偿同步与清理。
 * @param options 生命周期 Hook 参数。
 * @returns 当前 EditorView 引用。
 */
export function useCodeMirrorEditorLifecycle(
    options: UseCodeMirrorEditorLifecycleOptions,
): { viewRef: MutableRefObject<EditorView | null> } {
    const viewRef = useRef<EditorView | null>(null);
    const vimModeCompartmentRef = useRef<Compartment>(new Compartment());
    const fontFamilyCompartmentRef = useRef<Compartment>(new Compartment());
    const fontSizeCompartmentRef = useRef<Compartment>(new Compartment());
    const tabSizeCompartmentRef = useRef<Compartment>(new Compartment());
    const lineWrappingCompartmentRef = useRef<Compartment>(new Compartment());
    const lineNumbersCompartmentRef = useRef<Compartment>(new Compartment());
    const exitFrontmatterVimNavigationRef = useRef(options.onRequestExitFrontmatterVimNavigation);

    useEffect(() => {
        exitFrontmatterVimNavigationRef.current = options.onRequestExitFrontmatterVimNavigation;
    }, [options.onRequestExitFrontmatterVimNavigation]);

    useEffect(() => {
        syncEditorTabGutterWidth({
            tabRoot: options.tabRootRef.current,
            view: viewRef.current,
            displayMode: options.effectiveDisplayMode,
        });
    }, [options.displayFilePath, options.editorLineNumbers, options.effectiveDisplayMode, options.readContent, options.tabRootRef]);

    useEffect(() => {
        if (!options.hostRef.current || viewRef.current) {
            return;
        }

        const extensions = [
                vimModeCompartmentRef.current.of(options.vimModeEnabled ? vim() : []),
                editorBaseSetup,
                markdown(),
                createCodeMirrorThemeExtension(),
                fontFamilyCompartmentRef.current.of(
                    createCodeMirrorTypographyThemeExtension(
                        SHARED_EDITOR_FONT_FAMILY_CSS_VALUE,
                        SHARED_EDITOR_FONT_SIZE_CSS_VALUE,
                    ),
                ),
                fontSizeCompartmentRef.current.of([]),
                tabSizeCompartmentRef.current.of(EditorState.tabSize.of(options.editorTabSize)),
                lineWrappingCompartmentRef.current.of(
                    options.editorLineWrapping ? EditorView.lineWrapping : [],
                ),
                lineNumbersCompartmentRef.current.of(
                    buildLineNumbersExtension(options.editorLineNumbers),
                ),
                keymap.of([indentWithTab]),
                createFrontmatterSyntaxExtension({
                    onRequestExitVimNavigation: () => {
                        exitFrontmatterVimNavigationRef.current();
                    },
                }),
                createCodeBlockHighlightExtension(),
                ...createLatexSyntaxExtension(),
                createMarkdownTableSyntaxExtension(
                    options.containerApi,
                    () => options.currentFilePathRef.current,
                ),
                options.registeredLineSyntaxRenderExtension,
                createTaskCheckboxToggleExtension(),
                createImageEmbedSyntaxExtension(() => options.currentFilePathRef.current),
                createWikiLinkPreviewExtension(
                    options.containerApi,
                    () => options.currentFilePathRef.current,
                ),
                createWikiLinkNavigationExtension(
                    options.containerApi,
                    () => options.currentFilePathRef.current,
                ),
                EditorView.domEventHandlers({
                    mousedown(event, view) {
                        try {
                            if (event.button !== 0) {
                                return false;
                            }

                            options.prefetchSegmentationAtMouseEvent(view, event);

                            if (event.detail !== 2) {
                                return false;
                            }

                            const handled = options.trySelectWordAtMouseEvent(view, event);
                            if (!handled) {
                                return false;
                            }

                            event.preventDefault();
                            return true;
                        } catch (_error) {
                            return false;
                        }
                    },
                }),
                ...getRegisteredEditPluginExtensions({
                    getCurrentFilePath: () => options.currentFilePathRef.current,
                }),
                EditorView.updateListener.of((update) => {
                    if (update.docChanged) {
                        const nextContent = update.state.doc.toString();
                        options.setReadContent(nextContent);
                        reportArticleContent({
                            articleId: options.articleId,
                            path: options.currentFilePathRef.current,
                            content: nextContent,
                        });
                    }

                    if (update.docChanged || update.selectionSet) {
                        options.scheduleActiveLineSegmentation(update.state);
                    }

                    if (update.focusChanged && update.view.hasFocus) {
                        reportArticleFocus({
                            articleId: options.articleId,
                            path: options.currentFilePathRef.current,
                            content: update.state.doc.toString(),
                        });
                    }

                    if (update.focusChanged && !update.view.hasFocus) {
                        void flushAutoSaveByPath(options.currentFilePathRef.current);
                    }
                }),
        ];

        const state = EditorState.create({
            doc: options.initialDoc,
            extensions: extensions as Extension,
        });

        try {
            viewRef.current = new EditorView({
                state,
                parent: options.hostRef.current,
            });
        } catch (constructionError) {
            console.error("[editor] EditorView construction failed", {
                articleId: options.articleId,
                filePath: options.currentFilePathRef.current,
                message: constructionError instanceof Error ? constructionError.message : String(constructionError),
            });
            if (options.hostRef.current) {
                options.hostRef.current.innerHTML = "";
            }
            return;
        }

        syncEditorTabGutterWidth({
            tabRoot: options.tabRootRef.current,
            view: viewRef.current,
            displayMode: options.effectiveDisplayMode,
        });

        const gutterResizeObserver = typeof ResizeObserver !== "undefined"
            ? new ResizeObserver(() => {
                syncEditorTabGutterWidth({
                    tabRoot: options.tabRootRef.current,
                    view: viewRef.current,
                    displayMode: options.effectiveDisplayMode,
                });
            })
            : null;
        const gutterMutationObserver = typeof MutationObserver !== "undefined"
            ? new MutationObserver(() => {
                syncEditorTabGutterWidth({
                    tabRoot: options.tabRootRef.current,
                    view: viewRef.current,
                    displayMode: options.effectiveDisplayMode,
                });
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
            syncEditorTabGutterWidth({
                tabRoot: options.tabRootRef.current,
                view: viewRef.current,
                displayMode: options.effectiveDisplayMode,
            });
        });

        registerVimTokenProvider(viewRef.current, options.getLineTokens);

        const cleanupPasteHandler = attachPasteImageHandler(
            viewRef.current,
            {
                getCurrentFilePath: () => options.currentFilePathRef.current,
                createBinaryFile: createVaultBinaryFile,
                canMutateDocument: () => canMutateEditorDocument(options.displayModeRef.current),
            },
        );

        reportArticleContent({
            articleId: options.articleId,
            path: options.currentFilePathRef.current,
            content: state.doc.toString(),
        });

        if (viewRef.current && options.initialAutoFocus && !options.hasAppliedInitialAutoFocusRef.current) {
            options.hasAppliedInitialAutoFocusRef.current = true;
            const targetOffset = Math.max(0, Math.min(options.initialCursorOffset ?? state.doc.length, state.doc.length));
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
        void options.prefetchLineSegmentation(activeLine.number, activeLine.text);

        return () => {
            options.clearPendingSegmentation();
            gutterResizeObserver?.disconnect();
            gutterMutationObserver?.disconnect();
            cleanupPasteHandler();
            if (viewRef.current) {
                unregisterVimTokenProvider(viewRef.current);
                safeDestroyEditorView(viewRef.current);
            }
            viewRef.current = null;
        };
    }, [options.initialDoc, options.articleId, options.containerApi]);

    useEffect(() => {
        const view = viewRef.current;
        if (!view) {
            return;
        }

        view.dispatch({
            effects: vimModeCompartmentRef.current.reconfigure(options.vimModeEnabled ? vim() : []),
        });

        console.info("[editor] vim mode changed", {
            articleId: options.articleId,
            filePath: options.currentFilePath,
            vimModeEnabled: options.vimModeEnabled,
        });
    }, [options.vimModeEnabled, options.articleId, options.currentFilePath]);

    useEffect(() => {
        const view = viewRef.current;
        if (!view) {
            return;
        }

        view.dispatch({
            effects: fontFamilyCompartmentRef.current.reconfigure(
                createCodeMirrorTypographyThemeExtension(
                    SHARED_EDITOR_FONT_FAMILY_CSS_VALUE,
                    SHARED_EDITOR_FONT_SIZE_CSS_VALUE,
                ),
            ),
        });
        view.dispatch({
            effects: fontSizeCompartmentRef.current.reconfigure([]),
        });

        console.info("[editor] shared typography changed", {
            articleId: options.articleId,
            editorFontFamily: options.editorFontFamily,
            editorFontSize: options.editorFontSize,
        });
    }, [options.editorFontFamily, options.editorFontSize, options.articleId]);

    useEffect(() => {
        const view = viewRef.current;
        if (!view) {
            return;
        }

        view.dispatch({
            effects: tabSizeCompartmentRef.current.reconfigure(
                EditorState.tabSize.of(options.editorTabSize),
            ),
        });

        console.info("[editor] tab size changed", { articleId: options.articleId, editorTabSize: options.editorTabSize });
    }, [options.editorTabSize, options.articleId]);

    useEffect(() => {
        const view = viewRef.current;
        if (!view) {
            return;
        }

        view.dispatch({
            effects: lineWrappingCompartmentRef.current.reconfigure(
                options.editorLineWrapping ? EditorView.lineWrapping : [],
            ),
        });

        console.info("[editor] line wrapping changed", { articleId: options.articleId, editorLineWrapping: options.editorLineWrapping });
    }, [options.editorLineWrapping, options.articleId]);

    useEffect(() => {
        const view = viewRef.current;
        if (!view) {
            return;
        }

        view.dispatch({
            effects: lineNumbersCompartmentRef.current.reconfigure(
                buildLineNumbersExtension(options.editorLineNumbers),
            ),
        });

        console.info("[editor] line numbers mode changed", { articleId: options.articleId, editorLineNumbers: options.editorLineNumbers });
    }, [options.editorLineNumbers, options.articleId]);

    useEffect(() => {
        const view = viewRef.current;
        if (!view) {
            return;
        }

        const currentDoc = view.state.doc.toString();
        if (currentDoc === options.initialDoc) {
            return;
        }

        view.dispatch({
            changes: {
                from: 0,
                to: view.state.doc.length,
                insert: options.initialDoc,
            },
        });
        options.setReadContent(options.initialDoc);
    }, [options.initialDoc]);

    useEffect(() => {
        const view = viewRef.current;
        if (!view || !options.articleSnapshot) {
            return;
        }

        if (!options.articleSnapshot.hasContentSnapshot) {
            return;
        }

        if (options.articleSnapshot.path !== options.currentFilePathRef.current) {
            return;
        }

        const currentDoc = view.state.doc.toString();
        if (currentDoc === options.articleSnapshot.content) {
            return;
        }

        view.dispatch({
            changes: {
                from: 0,
                to: view.state.doc.length,
                insert: options.articleSnapshot.content,
            },
        });
        options.setReadContent(options.articleSnapshot.content);

        console.info("[editor] synced content from editor context state", {
            articleId: options.articleId,
            path: options.articleSnapshot.path,
            updatedAt: options.articleSnapshot.updatedAt,
        });
    }, [options.articleSnapshot?.updatedAt, options.articleSnapshot?.content, options.articleSnapshot?.path, options.articleId]);

    return { viewRef };
}