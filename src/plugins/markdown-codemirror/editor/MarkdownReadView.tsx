/**
 * @module plugins/markdown-codemirror/editor/MarkdownReadView
 * @description 编辑器阅读态视图：渲染 Markdown 正文，并在阅读态补齐
 *   Frontmatter、图片嵌入、Tag、Highlight、LaTeX 等增强特性。
 * @dependencies
 *  - react
 *  - react-markdown
 *  - remark-gfm
 *  - remark-breaks
 *  - katex
 *  - ../../../../api/vaultApi
 *  - ./markdownReadTransform
 *  - ./pathUtils
 *  - ./syntaxPlugins/wikiLinkSyntaxRenderer
 *
 * @example
 *   <MarkdownReadView content={markdown} currentFilePath={path} containerApi={api} />
 */

import {
    useContext,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type ComponentPropsWithoutRef,
    type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import type { WorkbenchContainerApi } from "../../../host/layout/workbenchContracts";
import katex from "katex";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import i18n from "../../../i18n";
import {
    readVaultMarkdownFile,
    readVaultBinaryFile,
    resolveWikiLinkTarget,
    resolveMediaEmbedTarget,
} from "../../../api/vaultApi";
import { resolveParentDirectory } from "./pathUtils";
import { openWikiLinkTarget } from "./syntaxPlugins/wikiLinkSyntaxRenderer";
import {
    decodeReadModeBlockLatexHref,
    decodeReadModeHighlightHref,
    decodeReadModeInlineLatexHref,
    decodeReadModeMediaEmbedHref,
    decodeReadModeTagHref,
    decodeReadModeWikiLinkHref,
    prepareMarkdownForReadMode,
    type ReadModeFrontmatterField,
} from "./markdownReadTransform";
import { computeTagColorStyles } from "./utils/tagColor";
import { shouldSkipWikiLinkNavigationForSelection } from "./readModeSelectionPolicy";
import {
    createWikiLinkPreviewId,
    hasWikiLinkPreviewDescendant,
    registerWikiLinkPreview,
    subscribeWikiLinkPreviewHierarchy,
    unregisterWikiLinkPreview,
    WikiLinkPreviewParentContext,
} from "./wikiLinkPreviewHierarchy";

const READ_MODE_WIKILINK_PREVIEW_HIDE_DELAY_MS = 500;
const READ_MODE_WIKILINK_PREVIEW_EXIT_ANIMATION_MS = 140;
const READ_MODE_WIKILINK_PREVIEW_GAP_PX = 4;
const READ_MODE_WIKILINK_PREVIEW_INTERACTION_GRACE_MS = 700;

type ReadModeWikiLinkPreviewData =
    | { status: "loading" }
    | { status: "not-found" }
    | { status: "error"; message: string }
    | {
        status: "ready";
        resolvedPath: string;
        content: string;
    };

interface ReadModeWikiLinkAnchorProps extends ComponentPropsWithoutRef<"a"> {
    /** WikiLink 原始目标。 */
    wikiLinkTarget: string;
    /** 当前文档路径。 */
    currentFilePath: string;
    /** Dockview 容器 API。 */
    containerApi: WorkbenchContainerApi;
    /** 父级 preview id。 */
    parentPreviewId: string | null;
}

const readModeWikiLinkPreviewCache = new Map<string, ReadModeWikiLinkPreviewData>();

function isApplePlatform(platform: string): boolean {
    return /(Mac|iPhone|iPad|iPod)/i.test(platform);
}

function isWikiLinkPreviewModifierPressed(
    metaKey: boolean,
    ctrlKey: boolean,
    platform: string = globalThis.navigator?.platform ?? "",
): boolean {
    return isApplePlatform(platform) ? metaKey : ctrlKey;
}

function buildReadModeWikiLinkPreviewCacheKey(currentFilePath: string, target: string): string {
    return `${resolveParentDirectory(currentFilePath)}::${target}`;
}

/**
 * @function shouldKeepReadModeWikiLinkPreviewHovered
 * @description 判断鼠标离开锚点或预览时，是否仍应视为停留在同一预览链路内。
 * @param isTransitioningIntoPreview `relatedTarget` 是否仍在当前 preview DOM 内。
 * @param isPointerInsidePreview 当前指针坐标是否仍命中 preview 盒模型。
 * @returns 若应继续保活当前 preview，则返回 true。
 */
export function shouldKeepReadModeWikiLinkPreviewHovered(
    isTransitioningIntoPreview: boolean,
    isPointerInsidePreview: boolean,
): boolean {
    return isTransitioningIntoPreview || isPointerInsidePreview;
}

function ReadModeWikiLinkAnchor(props: ReadModeWikiLinkAnchorProps): ReactNode {
    const {
        wikiLinkTarget,
        currentFilePath,
        containerApi,
        parentPreviewId,
        children,
        className,
        onClick,
        onMouseEnter,
        onMouseLeave,
        onMouseMove,
        ...anchorProps
    } = props;
    const anchorRef = useRef<HTMLAnchorElement | null>(null);
    const previewRef = useRef<HTMLDivElement | null>(null);
    const previewIdRef = useRef<string>(createWikiLinkPreviewId());
    const pointerPositionRef = useRef<{ clientX: number; clientY: number } | null>(null);
    const lastPreviewInteractionAtRef = useRef(0);
    const hideTimerRef = useRef<number | null>(null);
    const unmountTimerRef = useRef<number | null>(null);
    const isAnchorHoveredRef = useRef(false);
    const isPreviewHoveredRef = useRef(false);
    const modifierPressedRef = useRef(false);
    const requestSequenceRef = useRef(0);
    const [previewMounted, setPreviewMounted] = useState(false);
    const [previewVisible, setPreviewVisible] = useState(false);
    const [interactionActive, setInteractionActive] = useState(false);
    const [previewPlacement, setPreviewPlacement] = useState<"above" | "below">("below");
    const [previewPosition, setPreviewPosition] = useState<{ left: number; top: number } | null>(null);
    const [previewData, setPreviewData] = useState<ReadModeWikiLinkPreviewData>({ status: "loading" });

    const hasDescendantPreview = (): boolean => hasWikiLinkPreviewDescendant(previewIdRef.current);

    const cancelScheduledHide = (): void => {
        if (hideTimerRef.current === null) {
            return;
        }

        window.clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
    };

    const markPreviewInteraction = (): void => {
        lastPreviewInteractionAtRef.current = Date.now();
    };

    const hasRecentPreviewInteraction = (): boolean => {
        return Date.now() - lastPreviewInteractionAtRef.current
            <= READ_MODE_WIKILINK_PREVIEW_INTERACTION_GRACE_MS;
    };

    const cancelScheduledUnmount = (): void => {
        if (unmountTimerRef.current === null) {
            return;
        }

        window.clearTimeout(unmountTimerRef.current);
        unmountTimerRef.current = null;
    };

    const revivePreviewVisibility = (): void => {
        cancelScheduledUnmount();
        if (previewMounted) {
            setPreviewVisible(true);
        }
        markPreviewInteraction();
    };

    const hidePreview = (): void => {
        cancelScheduledHide();
        setPreviewVisible(false);
        setInteractionActive(false);
        isPreviewHoveredRef.current = false;
        cancelScheduledUnmount();
        unmountTimerRef.current = window.setTimeout(() => {
            unmountTimerRef.current = null;
            setPreviewMounted(false);
        }, READ_MODE_WIKILINK_PREVIEW_EXIT_ANIMATION_MS);
    };

    const scheduleHidePreview = (): void => {
        if (!previewMounted || isPreviewHoveredRef.current || hasDescendantPreview()) {
            return;
        }

        if (hideTimerRef.current !== null) {
            return;
        }

        hideTimerRef.current = window.setTimeout(() => {
            hideTimerRef.current = null;
            syncPreviewHoverStateFromPointer();
            if (isPreviewHoveredRef.current) {
                return;
            }
            if (isAnchorHoveredRef.current && modifierPressedRef.current) {
                return;
            }
            if (hasDescendantPreview()) {
                return;
            }
            if (hasRecentPreviewInteraction()) {
                scheduleHidePreview();
                return;
            }
            hidePreview();
        }, READ_MODE_WIKILINK_PREVIEW_HIDE_DELAY_MS);
    };

    const updatePreviewPosition = (): void => {
        const anchorElement = anchorRef.current;
        const previewElement = previewRef.current;
        if (!anchorElement || !previewElement) {
            return;
        }

        const anchorRect = anchorElement.getBoundingClientRect();
        const previewWidth = previewElement.offsetWidth;
        const previewHeight = previewElement.offsetHeight;
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        const viewportPadding = 12;

        let left = Math.min(
            Math.max(viewportPadding, anchorRect.left),
            Math.max(viewportPadding, viewportWidth - previewWidth - viewportPadding),
        );

        let placement: "above" | "below" = "below";
        let top = anchorRect.bottom + READ_MODE_WIKILINK_PREVIEW_GAP_PX;

        if (
            top + previewHeight > viewportHeight - viewportPadding
            && anchorRect.top - previewHeight - READ_MODE_WIKILINK_PREVIEW_GAP_PX >= viewportPadding
        ) {
            placement = "above";
            top = anchorRect.top - previewHeight - READ_MODE_WIKILINK_PREVIEW_GAP_PX;
        }

        if (top + previewHeight > viewportHeight - viewportPadding) {
            top = Math.max(viewportPadding, viewportHeight - previewHeight - viewportPadding);
        }

        if (left + previewWidth > viewportWidth - viewportPadding) {
            left = Math.max(viewportPadding, viewportWidth - previewWidth - viewportPadding);
        }

        setPreviewPlacement(placement);
        setPreviewPosition({
            left: Math.round(left),
            top: Math.round(top),
        });
    };

    const isPointerInsidePreview = (clientX: number, clientY: number): boolean => {
        const previewElement = previewRef.current;
        if (!previewElement || typeof document === "undefined") {
            return false;
        }

        const hoveredElement = document.elementFromPoint(clientX, clientY);
        if (hoveredElement instanceof Node && previewElement.contains(hoveredElement)) {
            return true;
        }

        const rect = previewElement.getBoundingClientRect();
        return clientX >= rect.left
            && clientX <= rect.right
            && clientY >= rect.top
            && clientY <= rect.bottom;
    };

    const resolvePointerCoords = (clientX: number, clientY: number): { clientX: number; clientY: number } => {
        if (clientX !== 0 || clientY !== 0) {
            return { clientX, clientY };
        }

        return pointerPositionRef.current ?? { clientX, clientY };
    };

    const isEventTransitioningIntoPreview = (relatedTarget: EventTarget | null): boolean => {
        const previewElement = previewRef.current;
        if (!previewElement || !(relatedTarget instanceof Node)) {
            return false;
        }

        return previewElement.contains(relatedTarget);
    };

    const syncPreviewHoverStateFromPointer = (): void => {
        const pointerPosition = pointerPositionRef.current;
        if (!pointerPosition) {
            return;
        }

        const isPointerInside = isPointerInsidePreview(
            pointerPosition.clientX,
            pointerPosition.clientY,
        );

        if (!isPointerInside) {
            isPreviewHoveredRef.current = false;
            return;
        }

        isPreviewHoveredRef.current = true;
        setInteractionActive(true);
        cancelScheduledHide();
        markPreviewInteraction();
        revivePreviewVisibility();
    };

    const syncPreviewHoverStateFromCoords = (clientX: number, clientY: number): void => {
        const isPointerInside = isPointerInsidePreview(clientX, clientY);

        if (!isPointerInside) {
            isPreviewHoveredRef.current = false;
            return;
        }

        pointerPositionRef.current = { clientX, clientY };
        isPreviewHoveredRef.current = true;
        setInteractionActive(true);
        cancelScheduledHide();
        markPreviewInteraction();
        revivePreviewVisibility();
    };

    const showPreview = (): void => {
        cancelScheduledHide();
        cancelScheduledUnmount();
        setInteractionActive(true);
        setPreviewMounted(true);
        setPreviewVisible(true);
        markPreviewInteraction();

        const cacheKey = buildReadModeWikiLinkPreviewCacheKey(currentFilePath, wikiLinkTarget);
        const cachedPreview = readModeWikiLinkPreviewCache.get(cacheKey);
        if (cachedPreview) {
            setPreviewData(cachedPreview);
            return;
        }

        setPreviewData({ status: "loading" });
        const currentDirectory = resolveParentDirectory(currentFilePath);
        const requestToken = requestSequenceRef.current + 1;
        requestSequenceRef.current = requestToken;

        void resolveWikiLinkTarget(currentDirectory, wikiLinkTarget)
            .then(async (resolved) => {
                if (requestSequenceRef.current !== requestToken) {
                    return;
                }

                if (!resolved) {
                    const notFoundData: ReadModeWikiLinkPreviewData = { status: "not-found" };
                    readModeWikiLinkPreviewCache.set(cacheKey, notFoundData);
                    setPreviewData(notFoundData);
                    return;
                }

                const file = await readVaultMarkdownFile(resolved.relativePath);
                if (requestSequenceRef.current !== requestToken) {
                    return;
                }

                const readyData: ReadModeWikiLinkPreviewData = {
                    status: "ready",
                    resolvedPath: resolved.relativePath,
                    content: file.content,
                };
                readModeWikiLinkPreviewCache.set(cacheKey, readyData);
                setPreviewData(readyData);
            })
            .catch((error) => {
                if (requestSequenceRef.current !== requestToken) {
                    return;
                }

                setPreviewData({
                    status: "error",
                    message: error instanceof Error ? error.message : String(error),
                });
            });
    };

    useEffect(() => {
        if (!previewMounted) {
            return;
        }

        registerWikiLinkPreview(previewIdRef.current, parentPreviewId);

        return () => {
            unregisterWikiLinkPreview(previewIdRef.current);
        };
    }, [parentPreviewId, previewMounted]);

    useEffect(() => {
        if (!previewMounted) {
            return;
        }

        return subscribeWikiLinkPreviewHierarchy(() => {
            if (hasDescendantPreview()) {
                cancelScheduledHide();
                return;
            }

            if (!isAnchorHoveredRef.current && !isPreviewHoveredRef.current) {
                scheduleHidePreview();
            }
        });
    }, [previewMounted]);

    useEffect(() => {
        if (!previewMounted) {
            return;
        }

        const frameId = window.requestAnimationFrame(() => {
            updatePreviewPosition();
            syncPreviewHoverStateFromPointer();
        });

        return () => {
            window.cancelAnimationFrame(frameId);
        };
    }, [previewMounted, previewVisible, previewData]);

    useLayoutEffect(() => {
        if (!interactionActive) {
            return;
        }

        const handleWindowKeyChange = (event: KeyboardEvent): void => {
            modifierPressedRef.current = isWikiLinkPreviewModifierPressed(
                event.metaKey,
                event.ctrlKey,
            );
            if (modifierPressedRef.current) {
                if (isAnchorHoveredRef.current || isPreviewHoveredRef.current) {
                    showPreview();
                }
                return;
            }

            if (!isPreviewHoveredRef.current) {
                scheduleHidePreview();
            }
        };

        const handleViewportChange = (): void => {
            updatePreviewPosition();
        };

        const handleWindowWheel = (event: WheelEvent): void => {
            const pointerCoords = resolvePointerCoords(event.clientX, event.clientY);
            syncPreviewHoverStateFromCoords(pointerCoords.clientX, pointerCoords.clientY);
        };

        window.addEventListener("keydown", handleWindowKeyChange, true);
        window.addEventListener("keyup", handleWindowKeyChange, true);
        window.addEventListener("resize", handleViewportChange, true);
        window.addEventListener("scroll", handleViewportChange, true);
        window.addEventListener("wheel", handleWindowWheel, true);

        return () => {
            window.removeEventListener("keydown", handleWindowKeyChange, true);
            window.removeEventListener("keyup", handleWindowKeyChange, true);
            window.removeEventListener("resize", handleViewportChange, true);
            window.removeEventListener("scroll", handleViewportChange, true);
            window.removeEventListener("wheel", handleWindowWheel, true);
        };
    }, [interactionActive, previewMounted]);

    useEffect(() => () => {
        cancelScheduledHide();
        cancelScheduledUnmount();
    }, []);

    return (
        <>
            <a
                {...anchorProps}
                ref={anchorRef}
                className={className}
                onClick={(event) => {
                    onClick?.(event);
                    if (event.defaultPrevented) {
                        return;
                    }

                    event.preventDefault();
                    if (shouldSkipWikiLinkNavigationForSelection(
                        window.getSelection(),
                        event.currentTarget,
                    )) {
                        return;
                    }

                    void openWikiLinkTarget(
                        containerApi,
                        () => currentFilePath,
                        wikiLinkTarget,
                    );
                }}
                onMouseEnter={(event) => {
                    isAnchorHoveredRef.current = true;
                    setInteractionActive(true);
                    markPreviewInteraction();
                    pointerPositionRef.current = {
                        clientX: event.clientX,
                        clientY: event.clientY,
                    };
                    modifierPressedRef.current = isWikiLinkPreviewModifierPressed(
                        event.metaKey,
                        event.ctrlKey,
                    );
                    onMouseEnter?.(event);
                    if (modifierPressedRef.current) {
                        showPreview();
                    }
                }}
                onMouseMove={(event) => {
                    pointerPositionRef.current = {
                        clientX: event.clientX,
                        clientY: event.clientY,
                    };
                    markPreviewInteraction();
                    modifierPressedRef.current = isWikiLinkPreviewModifierPressed(
                        event.metaKey,
                        event.ctrlKey,
                    );
                    onMouseMove?.(event);
                    if (modifierPressedRef.current) {
                        showPreview();
                    } else if (!isPreviewHoveredRef.current) {
                        scheduleHidePreview();
                    }
                }}
                onMouseLeave={(event) => {
                    const transitioningIntoPreview = isEventTransitioningIntoPreview(
                        event.relatedTarget,
                    );
                    const pointerInsidePreview = isPointerInsidePreview(
                        event.clientX,
                        event.clientY,
                    );
                    isAnchorHoveredRef.current = false;
                    pointerPositionRef.current = {
                        clientX: event.clientX,
                        clientY: event.clientY,
                    };
                    onMouseLeave?.(event);
                    if (shouldKeepReadModeWikiLinkPreviewHovered(
                        transitioningIntoPreview,
                        pointerInsidePreview,
                    )) {
                        isPreviewHoveredRef.current = true;
                        setInteractionActive(true);
                        cancelScheduledHide();
                        revivePreviewVisibility();
                        return;
                    }
                    if (!previewMounted && !isPreviewHoveredRef.current) {
                        setInteractionActive(false);
                    }
                    scheduleHidePreview();
                }}
            >
                {children}
            </a>
            {previewMounted && typeof document !== "undefined"
                ? createPortal(
                    <div
                        ref={previewRef}
                        className={`cm-wikilink-preview-tooltip${previewVisible ? " is-visible" : " is-hiding"}`}
                        data-floating-surface="true"
                        data-placement={previewPlacement}
                        style={previewPosition ? {
                            left: `${previewPosition.left}px`,
                            top: `${previewPosition.top}px`,
                        } : undefined}
                        onMouseEnter={(event) => {
                            event.stopPropagation();
                            isPreviewHoveredRef.current = true;
                            setInteractionActive(true);
                            markPreviewInteraction();
                            pointerPositionRef.current = {
                                clientX: event.clientX,
                                clientY: event.clientY,
                            };
                            cancelScheduledHide();
                            revivePreviewVisibility();
                        }}
                        onMouseMove={(event) => {
                            event.stopPropagation();
                            markPreviewInteraction();
                            pointerPositionRef.current = {
                                clientX: event.clientX,
                                clientY: event.clientY,
                            };
                        }}
                        onWheel={(event) => {
                            event.stopPropagation();
                            const pointerCoords = resolvePointerCoords(
                                event.clientX,
                                event.clientY,
                            );
                            isPreviewHoveredRef.current = true;
                            setInteractionActive(true);
                            markPreviewInteraction();
                            pointerPositionRef.current = {
                                clientX: pointerCoords.clientX,
                                clientY: pointerCoords.clientY,
                            };
                            cancelScheduledHide();
                            revivePreviewVisibility();
                        }}
                        onMouseLeave={(event) => {
                            event.stopPropagation();
                            const transitioningWithinPreview = isEventTransitioningIntoPreview(
                                event.relatedTarget,
                            );
                            const pointerInsidePreview = isPointerInsidePreview(
                                event.clientX,
                                event.clientY,
                            );
                            pointerPositionRef.current = {
                                clientX: event.clientX,
                                clientY: event.clientY,
                            };
                            if (shouldKeepReadModeWikiLinkPreviewHovered(
                                transitioningWithinPreview,
                                pointerInsidePreview,
                            )) {
                                isPreviewHoveredRef.current = true;
                                setInteractionActive(true);
                                cancelScheduledHide();
                                revivePreviewVisibility();
                                return;
                            }
                            isPreviewHoveredRef.current = false;
                            if (isAnchorHoveredRef.current && modifierPressedRef.current) {
                                return;
                            }
                            if (!isAnchorHoveredRef.current) {
                                setInteractionActive(false);
                            }
                            scheduleHidePreview();
                        }}
                    >
                        <div className="cm-wikilink-preview">
                            <div className="cm-wikilink-preview__header">
                                <div className="cm-wikilink-preview__title">{children}</div>
                                <div className="cm-wikilink-preview__path">
                                    {previewData.status === "ready"
                                        ? previewData.resolvedPath
                                        : wikiLinkTarget}
                                </div>
                            </div>
                            <div
                                className="cm-wikilink-preview__body"
                                onScroll={(event) => {
                                    event.stopPropagation();
                                    isPreviewHoveredRef.current = true;
                                    setInteractionActive(true);
                                    markPreviewInteraction();
                                    cancelScheduledHide();
                                    revivePreviewVisibility();
                                }}
                            >
                                {previewData.status === "loading" ? (
                                    <div className="cm-wikilink-preview__status">
                                        {i18n.t("editor.wikilinkPreviewLoading")}
                                    </div>
                                ) : null}
                                {previewData.status === "not-found" ? (
                                    <div className="cm-wikilink-preview__status">
                                        {i18n.t("editor.wikilinkPreviewNotFound")}
                                    </div>
                                ) : null}
                                {previewData.status === "error" ? (
                                    <div className="cm-wikilink-preview__status">
                                        {`${i18n.t("editor.wikilinkPreviewError")} ${previewData.message}`}
                                    </div>
                                ) : null}
                                {previewData.status === "ready" ? (
                                    <WikiLinkPreviewParentContext.Provider value={previewIdRef.current}>
                                        <MarkdownReadView
                                            content={previewData.content}
                                            currentFilePath={previewData.resolvedPath}
                                            containerApi={containerApi}
                                        />
                                    </WikiLinkPreviewParentContext.Provider>
                                ) : null}
                            </div>
                        </div>
                    </div>,
                    document.body,
                )
                : null}
        </>
    );
}

interface MarkdownReadViewProps {
    /** 阅读态 Markdown 正文。 */
    content: string;
    /** 当前文件相对路径。 */
    currentFilePath: string;
    /** Dockview 容器 API。 */
    containerApi: WorkbenchContainerApi;
}

/**
 * @function MarkdownReadView
 * @description 渲染阅读态 Markdown 内容，并为 WikiLink 提供点击跳转。
 * @param props 组件参数。
 * @returns React 节点。
 */
export function MarkdownReadView(props: MarkdownReadViewProps): ReactNode {
    const parentPreviewId = useContext(WikiLinkPreviewParentContext);
    const preparedMarkdown = useMemo(
        () => prepareMarkdownForReadMode(props.content),
        [props.content],
    );
    const markdownComponents = useMemo<Components>(() => ({
        p: (componentProps) => {
            const { node, children, ...restProps } = componentProps;
            const blockLatexSource = extractBlockLatexFromParagraph(node);
            if (blockLatexSource) {
                return <ReadModeLatex latex={blockLatexSource} displayMode />;
            }

            return <p {...restProps}>{children}</p>;
        },
        h1: (componentProps) => <h1 className="cm-rendered-header cm-rendered-header-h1" {...componentProps} />,
        h2: (componentProps) => <h2 className="cm-rendered-header cm-rendered-header-h2" {...componentProps} />,
        h3: (componentProps) => <h3 className="cm-rendered-header cm-rendered-header-h3" {...componentProps} />,
        h4: (componentProps) => <h4 className="cm-rendered-header cm-rendered-header-h4" {...componentProps} />,
        h5: (componentProps) => <h5 className="cm-rendered-header cm-rendered-header-h5" {...componentProps} />,
        h6: (componentProps) => <h6 className="cm-rendered-header cm-rendered-header-h6" {...componentProps} />,
        strong: (componentProps) => <strong className="cm-rendered-bold" {...componentProps} />,
        em: (componentProps) => <em className="cm-rendered-italic" {...componentProps} />,
        del: (componentProps) => <del className="cm-rendered-strikethrough" {...componentProps} />,
        blockquote: (componentProps) => <blockquote className="cm-rendered-blockquote" {...componentProps} />,
        hr: (componentProps) => <hr className="cm-rendered-horizontal-rule" {...componentProps} />,
        code: ({ node: _node, className, children, ...componentProps }: ComponentPropsWithoutRef<"code"> & { node?: unknown }) => {
            const isInline = !String(className ?? "").includes("language-");
            if (isInline) {
                return (
                    <code
                        className={`cm-rendered-inline-code ${className ?? ""}`.trim()}
                        {...componentProps}
                    >
                        {children}
                    </code>
                );
            }

            return (
                <code className={`cm-tab-reader-code ${className ?? ""}`.trim()} {...componentProps}>
                    {children}
                </code>
            );
        },
        pre: (componentProps) => <pre className="cm-tab-reader-pre" {...componentProps} />,
        ul: (componentProps) => <ul className="cm-tab-reader-list cm-tab-reader-list-unordered" {...componentProps} />,
        ol: (componentProps) => <ol className="cm-tab-reader-list cm-tab-reader-list-ordered" {...componentProps} />,
        img: (componentProps) => {
            const { src, alt, ...restProps } = componentProps;
            const mediaTarget = decodeReadModeMediaEmbedHref(src);
            if (mediaTarget) {
                return (
                    <ReadModeImageEmbed
                        alt={alt ?? mediaTarget}
                        currentFilePath={props.currentFilePath}
                        rawTarget={mediaTarget}
                    />
                );
            }

            return (
                <img
                    {...restProps}
                    alt={alt ?? ""}
                    className="cm-tab-reader-image"
                    src={src}
                />
            );
        },
        li: (componentProps) => {
            const { className, ...restProps } = componentProps;
            return (
            <li
                className={className
                    ? `cm-tab-reader-list-item ${className}`
                    : "cm-tab-reader-list-item"}
                {...restProps}
            />
            );
        },
        a: (componentProps) => {
            const { href, children, ...restProps } = componentProps;
            const wikiLinkTarget = decodeReadModeWikiLinkHref(href);
            if (wikiLinkTarget) {
                return (
                    <ReadModeWikiLinkAnchor
                        {...restProps}
                        href={href}
                        className="cm-rendered-wikilink"
                        wikiLinkTarget={wikiLinkTarget}
                        currentFilePath={props.currentFilePath}
                        containerApi={props.containerApi}
                        parentPreviewId={parentPreviewId}
                    >
                        {children}
                    </ReadModeWikiLinkAnchor>
                );
            }

            if (decodeReadModeHighlightHref(href) !== null) {
                return (
                    <mark className="cm-rendered-highlight">
                        {children}
                    </mark>
                );
            }

            const tagTarget = decodeReadModeTagHref(href);
            if (tagTarget !== null) {
                const styles = computeTagColorStyles(tagTarget);
                const styleAttr = {
                    background: styles.background,
                    borderColor: styles.border,
                    color: styles.text,
                } as React.CSSProperties;

                return (
                    <span className="cm-rendered-tag" style={styleAttr}>
                        {children}
                    </span>
                );
            }

            const inlineLatexSource = decodeReadModeInlineLatexHref(href);
            if (inlineLatexSource !== null) {
                return <ReadModeLatex latex={inlineLatexSource} displayMode={false} />;
            }

            return (
                <a
                    {...restProps}
                    href={href}
                    className="cm-rendered-link"
                    target="_blank"
                    rel="noreferrer"
                >
                    {children}
                </a>
            );
        },
    }), [parentPreviewId, props.containerApi, props.currentFilePath]);

    return (
        <div className="cm-tab-reader">
            <div className="cm-tab-reader-content">
                {preparedMarkdown.hasFrontmatter ? (
                    <ReadModeFrontmatterPanel frontmatter={preparedMarkdown.frontmatter} />
                ) : null}
                <ReactMarkdown
                    remarkPlugins={[remarkGfm, remarkBreaks]}
                    components={markdownComponents}
                >
                    {preparedMarkdown.renderedMarkdown}
                </ReactMarkdown>
            </div>
        </div>
    );
}

interface ReadModeFrontmatterPanelProps {
    /** 阅读态 frontmatter 字段列表。 */
    frontmatter: ReadModeFrontmatterField[];
}

/**
 * @function ReadModeFrontmatterPanel
 * @description 在阅读态顶部渲染结构化 frontmatter 面板。
 * @param props 面板参数。
 * @returns frontmatter 面板。
 */
function ReadModeFrontmatterPanel(props: ReadModeFrontmatterPanelProps): ReactNode {
    return (
        <section className="cm-read-frontmatter-panel">
            <div className="cm-read-frontmatter-title">{i18n.t("frontmatter.readModeTitle")}</div>
            {props.frontmatter.length > 0 ? (
                <dl className="cm-read-frontmatter-list">
                    {props.frontmatter.map((field) => (
                        <div className="cm-read-frontmatter-row" key={field.key}>
                            <dt className="cm-read-frontmatter-key">{field.key}</dt>
                            <dd className="cm-read-frontmatter-value">{field.value}</dd>
                        </div>
                    ))}
                </dl>
            ) : (
                <div className="cm-read-frontmatter-empty">{i18n.t("frontmatter.emptyFrontmatter")}</div>
            )}
        </section>
    );
}

interface ReadModeImageEmbedProps {
    /** 图片嵌入原始目标。 */
    rawTarget: string;
    /** 当前文档路径。 */
    currentFilePath: string;
    /** 图片 alt 文本。 */
    alt: string;
}

type ReadModeImageState =
    | { status: "loading" }
    | { status: "error"; message: string }
    | { status: "ready"; source: string; label: string };

/**
 * @function ReadModeImageEmbed
 * @description 在阅读态中解析并渲染 `![[...]]` 图片嵌入。
 * @param props 图片嵌入参数。
 * @returns 图片嵌入节点。
 */
function ReadModeImageEmbed(props: ReadModeImageEmbedProps): ReactNode {
    const [imageState, setImageState] = useState<ReadModeImageState>({ status: "loading" });

    useEffect(() => {
        let isDisposed = false;
        const currentDirectory = resolveParentDirectory(props.currentFilePath);

        setImageState({ status: "loading" });
        console.info("[markdown-read-view] image embed resolve start", {
            currentDirectory,
            target: props.rawTarget,
        });

        void resolveMediaEmbedTarget(currentDirectory, props.rawTarget)
            .then(async (resolvedTarget) => {
                if (isDisposed) {
                    return;
                }

                if (!resolvedTarget) {
                    console.warn("[markdown-read-view] image embed resolve returned empty", {
                        currentDirectory,
                        target: props.rawTarget,
                    });
                    setImageState({
                        status: "error",
                        message: i18n.t("image.notFound"),
                    });
                    return;
                }

                const binaryResponse = await readVaultBinaryFile(resolvedTarget.relativePath);
                if (!binaryResponse.mimeType.startsWith("image/")) {
                    console.warn("[markdown-read-view] image embed mime unsupported", {
                        mimeType: binaryResponse.mimeType,
                        relativePath: resolvedTarget.relativePath,
                    });
                    setImageState({
                        status: "error",
                        message: i18n.t("image.unsupportedType", { type: binaryResponse.mimeType }),
                    });
                    return;
                }

                setImageState({
                    status: "ready",
                    source: `data:${binaryResponse.mimeType};base64,${binaryResponse.base64Content}`,
                    label: resolvedTarget.relativePath.split("/").pop() ?? resolvedTarget.relativePath,
                });
            })
            .catch((error) => {
                if (isDisposed) {
                    return;
                }

                console.warn("[markdown-read-view] image embed render failed", {
                    message: error instanceof Error ? error.message : String(error),
                    target: props.rawTarget,
                });
                setImageState({
                    status: "error",
                    message: i18n.t("image.loadError", { src: props.rawTarget }),
                });
            });

        return () => {
            isDisposed = true;
        };
    }, [props.currentFilePath, props.rawTarget]);

    if (imageState.status === "ready") {
        return (
            <span className="cm-image-embed-widget">
                <img
                    alt={props.alt}
                    className="cm-image-embed-image"
                    src={imageState.source}
                />
                <span className="cm-image-embed-caption">{imageState.label}</span>
            </span>
        );
    }

    return (
        <span className="cm-image-embed-widget">
            <span className={imageState.status === "loading" ? "cm-image-embed-loading" : "cm-image-embed-error"}>
                {imageState.status === "loading"
                    ? i18n.t("image.loading", { src: props.rawTarget })
                    : imageState.message}
            </span>
        </span>
    );
}

interface ReadModeLatexProps {
    /** LaTeX 公式源码。 */
    latex: string;
    /** 是否以 display 模式渲染。 */
    displayMode: boolean;
}

interface ReadModeLatexRenderResult {
    /** 渲染后的 HTML。 */
    html: string;
    /** 是否渲染失败。 */
    isError: boolean;
}

const readModeLatexCache = new Map<string, ReadModeLatexRenderResult>();

/**
 * @function ReadModeLatex
 * @description 在阅读态中使用 KaTeX 渲染行内或块级数学公式。
 * @param props LaTeX 参数。
 * @returns 数学公式节点。
 */
function ReadModeLatex(props: ReadModeLatexProps): ReactNode {
    const renderResult = useMemo(
        () => renderReadModeLatex(props.latex, props.displayMode),
        [props.displayMode, props.latex],
    );

    if (props.displayMode) {
        return (
            <div
                className={renderResult.isError
                    ? "cm-latex-block-widget cm-latex-block-error"
                    : "cm-latex-block-widget"}
                dangerouslySetInnerHTML={{ __html: renderResult.html }}
            />
        );
    }

    return (
        <span
            className={renderResult.isError
                ? "cm-latex-inline-widget cm-latex-inline-error"
                : "cm-latex-inline-widget"}
            dangerouslySetInnerHTML={{ __html: renderResult.html }}
        />
    );
}

/**
 * @function renderReadModeLatex
 * @description 将 LaTeX 公式缓存并渲染为 HTML。
 * @param latex LaTeX 公式源码。
 * @param displayMode 是否为 display 模式。
 * @returns 渲染结果。
 */
function renderReadModeLatex(latex: string, displayMode: boolean): ReadModeLatexRenderResult {
    const cacheKey = `${displayMode ? "block" : "inline"}::${latex}`;
    const cachedResult = readModeLatexCache.get(cacheKey);
    if (cachedResult) {
        return cachedResult;
    }

    try {
        const html = katex.renderToString(latex, {
            displayMode,
            throwOnError: false,
            strict: false,
            trust: false,
            output: "htmlAndMathml",
        });
        const renderResult = { html, isError: false };
        readModeLatexCache.set(cacheKey, renderResult);
        return renderResult;
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const renderResult = {
            // i18n-guard-ignore-next-line
            html: `<span class="cm-latex-error" title="${escapeHtml(errorMessage)}">${escapeHtml(latex)}</span>`,
            isError: true,
        };
        readModeLatexCache.set(cacheKey, renderResult);
        return renderResult;
    }
}

/**
 * @function extractBlockLatexFromParagraph
 * @description 从 React Markdown 段落节点中提取块级 LaTeX 协议链接。
 * @param node 段落节点。
 * @returns 若该段落仅承载块级 LaTeX 协议，则返回 LaTeX 源码。
 */
function extractBlockLatexFromParagraph(node: unknown): string | null {
    if (!node || typeof node !== "object") {
        return null;
    }

    const children = (node as { children?: Array<{ type?: string; tagName?: string; properties?: { href?: string } }> }).children;
    if (!children || children.length !== 1) {
        return null;
    }

    const firstChild = children[0];
    if (firstChild?.type !== "element" || firstChild.tagName !== "a") {
        return null;
    }

    return decodeReadModeBlockLatexHref(firstChild.properties?.href);
}

/**
 * @function escapeHtml
 * @description 转义 HTML 特殊字符，避免错误信息和源码注入 DOM。
 * @param text 原始文本。
 * @returns 转义后的文本。
 */
function escapeHtml(text: string): string {
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}