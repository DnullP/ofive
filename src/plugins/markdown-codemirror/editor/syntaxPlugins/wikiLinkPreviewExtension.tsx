/**
 * @module plugins/markdown-codemirror/editor/syntaxPlugins/wikiLinkPreviewExtension
 * @description WikiLink 预览扩展：当用户按住主修饰键并悬停在渲染态 WikiLink 上时，
 *   在链接附近展示锚定气泡，并以阅读态预览目标笔记内容。
 * @dependencies
 *  - react
 *  - react-dom/client
 *  - @codemirror/view
 *  - ../../../../api/vaultApi
 *  - ../MarkdownReadView
 *  - ./wikiLinkSyntaxRenderer
 *
 * @example
 *   createWikiLinkPreviewExtension(containerApi, () => currentFilePath)
 *
 * @exports
 *  - createWikiLinkPreviewExtension 创建 WikiLink hover 预览扩展
 *  - isWikiLinkPreviewModifierPressed 判断当前是否按下预览修饰键
 *  - resolveWikiLinkPreviewAtMouseEvent 从鼠标事件解析当前命中的 WikiLink
 */

import type { ReactNode } from "react";
import type { DockviewApi } from "dockview";
import { createRoot, type Root } from "react-dom/client";
import { EditorView, ViewPlugin, type PluginValue, type ViewUpdate } from "@codemirror/view";
import i18n from "../../../../i18n";
import {
    readVaultMarkdownFile,
    resolveWikiLinkTarget,
} from "../../../../api/vaultApi";
import { MarkdownReadView } from "../MarkdownReadView";
import { resolveParentDirectory } from "../pathUtils";
import {
    createWikiLinkPreviewId,
    hasWikiLinkPreviewDescendant,
    registerWikiLinkPreview,
    subscribeWikiLinkPreviewHierarchy,
    unregisterWikiLinkPreview,
    WikiLinkPreviewParentContext,
} from "../wikiLinkPreviewHierarchy";
import {
    extractWidgetWikiLinkTarget,
    findWikiLinkAtPosition,
    isRenderedWikiLinkTarget,
    type WikiLinkMatch,
} from "./wikiLinkSyntaxRenderer";

const WIKI_LINK_PREVIEW_HIDE_DELAY_MS = 500;
const WIKI_LINK_PREVIEW_GAP_PX = 4;
const WIKI_LINK_PREVIEW_EXIT_ANIMATION_MS = 140;

/**
 * @interface WikiLinkPreviewModifierState
 * @description 预览修饰键判定所需的最小键盘状态。
 */
export interface WikiLinkPreviewModifierState {
    /** macOS 上的 Cmd 键状态。 */
    metaKey: boolean;
    /** Windows/Linux 上的 Ctrl 键状态。 */
    ctrlKey: boolean;
}

/**
 * @interface WikiLinkPreviewMouseEventLike
 * @description 解析 WikiLink hover 命中所需的最小鼠标事件。
 */
export interface WikiLinkPreviewMouseEventLike extends WikiLinkPreviewModifierState {
    /** 鼠标事件目标。 */
    target: EventTarget | null;
    /** 视口坐标 X。 */
    clientX: number;
    /** 视口坐标 Y。 */
    clientY: number;
}

/**
 * @interface WikiLinkPreviewViewLike
 * @description 解析 WikiLink hover 命中所需的最小视图接口。
 */
export interface WikiLinkPreviewViewLike {
    /** 编辑器状态。 */
    state: EditorView["state"];
    /** 根据坐标解析文档偏移。 */
    posAtCoords(coords: { x: number; y: number }): number | null;
}

/**
 * @interface WikiLinkPreviewTarget
 * @description 当前 hover 命中的 WikiLink 与锚点信息。
 */
export interface WikiLinkPreviewTarget extends WikiLinkMatch {
    /** 锚点位置，用于计算气泡定位。 */
    anchorPos: number;
}

type WikiLinkPreviewData =
    | { status: "loading" }
    | { status: "not-found" }
    | { status: "error"; message: string }
    | {
        status: "ready";
        resolvedPath: string;
        content: string;
    };

interface WikiLinkPreviewCardProps {
    anchor: WikiLinkPreviewTarget;
    data: WikiLinkPreviewData;
    containerApi: DockviewApi;
    previewId: string;
}

/**
 * @function isApplePlatform
 * @description 判断当前平台是否使用 Cmd 作为主修饰键。
 * @param platform 平台字符串。
 * @returns 若平台属于 Apple 生态则返回 true。
 */
function isApplePlatform(platform: string): boolean {
    return /(Mac|iPhone|iPad|iPod)/i.test(platform);
}

/**
 * @function isWikiLinkPreviewModifierPressed
 * @description 判断当前键盘状态是否满足 WikiLink 预览触发条件。
 * @param state 键盘状态。
 * @param platform 平台字符串，默认读取浏览器平台。
 * @returns 若主修饰键按下则返回 true。
 */
export function isWikiLinkPreviewModifierPressed(
    state: WikiLinkPreviewModifierState,
    platform: string = globalThis.navigator?.platform ?? "",
): boolean {
    return isApplePlatform(platform)
        ? state.metaKey
        : state.ctrlKey;
}

/**
 * @function resolveWikiLinkPreviewAtMouseEvent
 * @description 从一次 hover 鼠标事件中解析命中的渲染态 WikiLink。
 * @param event 鼠标事件。
 * @param view 编辑器视图。
 * @returns 命中的 WikiLink 及锚点信息，未命中返回 null。
 */
export function resolveWikiLinkPreviewAtMouseEvent(
    event: WikiLinkPreviewMouseEventLike,
    view: WikiLinkPreviewViewLike,
): WikiLinkPreviewTarget | null {
    const widgetTarget = extractWidgetWikiLinkTarget(event.target);
    const renderedTargetHit = widgetTarget !== null || isRenderedWikiLinkTarget(event.target);
    if (!renderedTargetHit) {
        return null;
    }

    const position = view.posAtCoords({
        x: event.clientX,
        y: event.clientY,
    });
    if (position === null) {
        return null;
    }

    const matchedLink = findWikiLinkAtPosition(view.state, position);
    if (matchedLink !== null) {
        return {
            ...matchedLink,
            anchorPos: matchedLink.from,
        };
    }

    if (widgetTarget === null) {
        return null;
    }

    return {
        from: position,
        to: position,
        target: widgetTarget,
        displayText: widgetTarget,
        anchorPos: position,
    };
}

/**
 * @function arePreviewTargetsEqual
 * @description 判断两次 hover 命中的 WikiLink 是否可视为同一个预览目标。
 * @param left 左侧目标。
 * @param right 右侧目标。
 * @returns 相同返回 true。
 */
function arePreviewTargetsEqual(
    left: WikiLinkPreviewTarget | null,
    right: WikiLinkPreviewTarget | null,
): boolean {
    if (left === right) {
        return true;
    }

    if (left === null || right === null) {
        return false;
    }

    return left.from === right.from
        && left.to === right.to
        && left.target === right.target
        && left.displayText === right.displayText
        && left.anchorPos === right.anchorPos;
}

/**
 * @function buildPreviewCacheKey
 * @description 构建 WikiLink 预览缓存键，确保相对路径解析上下文参与缓存。
 * @param currentFilePath 当前文档路径。
 * @param target WikiLink 目标文本。
 * @returns 缓存键。
 */
function buildPreviewCacheKey(currentFilePath: string, target: string): string {
    return `${resolveParentDirectory(currentFilePath)}::${target}`;
}

/**
 * @function WikiLinkPreviewCard
 * @description 渲染 WikiLink 预览气泡主体。
 * @param props 预览卡片参数。
 * @returns React 节点。
 */
function WikiLinkPreviewCard(props: WikiLinkPreviewCardProps): ReactNode {
    return (
        <div className="cm-wikilink-preview">
            {/* cm-wikilink-preview__header: 预览卡片头部，承载标题与目标路径 */}
            <div className="cm-wikilink-preview__header">
                {/* cm-wikilink-preview__title: 主标题，显示 hover 命中的链接文本 */}
                <div className="cm-wikilink-preview__title">{props.anchor.displayText}</div>
                {/* cm-wikilink-preview__path: 次级路径，显示解析后的目标文件路径 */}
                <div className="cm-wikilink-preview__path">
                    {props.data.status === "ready"
                        ? props.data.resolvedPath
                        : props.anchor.target}
                </div>
            </div>
            {/* cm-wikilink-preview__body: 预览正文区域，承载状态提示或阅读态内容 */}
            <div className="cm-wikilink-preview__body">
                {props.data.status === "loading" ? (
                    <div className="cm-wikilink-preview__status">
                        {i18n.t("editor.wikilinkPreviewLoading")}
                    </div>
                ) : null}
                {props.data.status === "not-found" ? (
                    <div className="cm-wikilink-preview__status">
                        {i18n.t("editor.wikilinkPreviewNotFound")}
                    </div>
                ) : null}
                {props.data.status === "error" ? (
                    <div className="cm-wikilink-preview__status">
                        {`${i18n.t("editor.wikilinkPreviewError")} ${props.data.message}`}
                    </div>
                ) : null}
                {props.data.status === "ready" ? (
                    <WikiLinkPreviewParentContext.Provider value={props.previewId}>
                        <MarkdownReadView
                            content={props.data.content}
                            currentFilePath={props.data.resolvedPath}
                            containerApi={props.containerApi}
                        />
                    </WikiLinkPreviewParentContext.Provider>
                ) : null}
            </div>
        </div>
    );
}

/**
 * @class WikiLinkPreviewPlugin
 * @description 管理 hover 预览气泡的 DOM、定位与异步内容加载。
 */
class WikiLinkPreviewPlugin implements PluginValue {
    private readonly view: EditorView;
    private readonly containerApi: DockviewApi;
    private readonly getCurrentFilePath: () => string;
    private readonly previewCache = new Map<string, WikiLinkPreviewData>();
    private readonly ownerWindow: Window;
    private readonly ownerDocument: Document;
    private readonly previewId = createWikiLinkPreviewId();
    private readonly disposeHierarchySubscription: () => void;
    private previewRoot: Root | null = null;
    private previewElement: HTMLDivElement | null = null;
    private pointerPosition: { clientX: number; clientY: number } | null = null;
    private hoveredTarget: WikiLinkPreviewTarget | null = null;
    private activeTarget: WikiLinkPreviewTarget | null = null;
    private hideTimerId: number | null = null;
    private unmountTimerId: number | null = null;
    private isPointerOverPreview = false;
    private modifierPressed = false;
    private requestSequence = 0;

    constructor(
        view: EditorView,
        containerApi: DockviewApi,
        getCurrentFilePath: () => string,
    ) {
        this.view = view;
        this.containerApi = containerApi;
        this.getCurrentFilePath = getCurrentFilePath;
        this.ownerDocument = view.dom.ownerDocument;
        this.ownerWindow = this.ownerDocument.defaultView ?? window;

        this.ownerWindow.addEventListener("keydown", this.handleWindowKeyChange, true);
        this.ownerWindow.addEventListener("keyup", this.handleWindowKeyChange, true);
        this.ownerWindow.addEventListener("blur", this.handleWindowBlur, true);
        this.ownerWindow.addEventListener("resize", this.handleViewportChange, true);
        this.ownerWindow.addEventListener("wheel", this.handleWindowWheel, {
            capture: true,
            passive: true,
        });
        this.view.scrollDOM.addEventListener("scroll", this.handleViewportChange, true);
        this.disposeHierarchySubscription = subscribeWikiLinkPreviewHierarchy(
            this.handleHierarchyChange,
        );
    }

    update(update: ViewUpdate): void {
        if (update.docChanged || (update.focusChanged && !update.view.hasFocus)) {
            this.hidePreviewImmediately();
            return;
        }

        if (update.geometryChanged || update.viewportChanged) {
            this.positionPreview();
        }
    }

    destroy(): void {
        this.ownerWindow.removeEventListener("keydown", this.handleWindowKeyChange, true);
        this.ownerWindow.removeEventListener("keyup", this.handleWindowKeyChange, true);
        this.ownerWindow.removeEventListener("blur", this.handleWindowBlur, true);
        this.ownerWindow.removeEventListener("resize", this.handleViewportChange, true);
        this.ownerWindow.removeEventListener("wheel", this.handleWindowWheel, true);
        this.view.scrollDOM.removeEventListener("scroll", this.handleViewportChange, true);
        this.disposeHierarchySubscription();
        this.hidePreviewImmediately();
    }

    handleMouseMove(event: MouseEvent): boolean {
        this.pointerPosition = {
            clientX: event.clientX,
            clientY: event.clientY,
        };
        const hoveredTarget = resolveWikiLinkPreviewAtMouseEvent(event, this.view);
        this.hoveredTarget = hoveredTarget;

        const modifierPressed = isWikiLinkPreviewModifierPressed(event);
        this.modifierPressed = modifierPressed;

        if (hoveredTarget === null || !modifierPressed) {
            this.scheduleHidePreview();
            return false;
        }

        this.showPreview(hoveredTarget);
        return false;
    }

    handleMouseLeave(): boolean {
        this.hoveredTarget = null;
        this.scheduleHidePreview();
        return false;
    }

    handleMouseDown(): boolean {
        this.hidePreviewImmediately();
        return false;
    }

    private readonly handleWindowKeyChange = (event: KeyboardEvent): void => {
        const modifierPressed = isWikiLinkPreviewModifierPressed(event);
        this.modifierPressed = modifierPressed;

        if (!modifierPressed) {
            this.scheduleHidePreview();
            return;
        }

        if (this.hoveredTarget !== null) {
            this.showPreview(this.hoveredTarget);
        }
    };

    private readonly handleWindowBlur = (): void => {
        this.modifierPressed = false;
        this.hoveredTarget = null;
        this.hidePreviewImmediately();
    };

    private readonly handleViewportChange = (): void => {
        this.positionPreview();
    };

    private resolvePointerCoords(clientX: number, clientY: number): { clientX: number; clientY: number } {
        if (clientX !== 0 || clientY !== 0) {
            return { clientX, clientY };
        }

        return this.pointerPosition ?? { clientX, clientY };
    }

    private readonly handleWindowWheel = (event: WheelEvent): void => {
        const pointerCoords = this.resolvePointerCoords(event.clientX, event.clientY);
        this.pointerPosition = pointerCoords;
        this.syncPreviewHoverStateFromCoords(pointerCoords.clientX, pointerCoords.clientY);
    };

    private readonly handleHierarchyChange = (): void => {
        if (hasWikiLinkPreviewDescendant(this.previewId)) {
            this.cancelScheduledHide();
            return;
        }

        if (
            this.activeTarget !== null
            && !this.isPointerOverPreview
            && (this.hoveredTarget === null || !this.modifierPressed)
        ) {
            this.scheduleHidePreview();
        }
    };

    private showPreview(target: WikiLinkPreviewTarget): void {
        this.cancelScheduledHide();

        if (arePreviewTargetsEqual(this.activeTarget, target) && this.previewElement !== null) {
            this.positionPreview();
            return;
        }

        this.activeTarget = target;
        this.renderPreview(target, { status: "loading" });

        const currentFilePath = this.getCurrentFilePath();
        const cacheKey = buildPreviewCacheKey(currentFilePath, target.target);
        const cachedPreview = this.previewCache.get(cacheKey);
        if (cachedPreview) {
            this.renderPreview(target, cachedPreview);
            return;
        }

        const currentDirectory = resolveParentDirectory(currentFilePath);
        const requestToken = this.requestSequence + 1;
        this.requestSequence = requestToken;

        void this.loadPreviewData(currentDirectory, target, requestToken, cacheKey);
    }

    private hidePreviewImmediately(): void {
        this.cancelScheduledHide();
        this.cancelScheduledUnmount();
        this.activeTarget = null;
        this.isPointerOverPreview = false;

        this.destroyPreviewElement();
    }

    private hidePreview(): void {
        this.cancelScheduledHide();
        this.activeTarget = null;
        this.isPointerOverPreview = false;

        if (this.previewElement === null) {
            this.destroyPreviewElement();
            return;
        }

        this.previewElement.classList.remove("is-visible");
        this.previewElement.classList.add("is-hiding");
        this.cancelScheduledUnmount();
        this.unmountTimerId = this.ownerWindow.setTimeout(() => {
            this.unmountTimerId = null;
            this.destroyPreviewElement();
        }, WIKI_LINK_PREVIEW_EXIT_ANIMATION_MS);
    }

    private destroyPreviewElement(): void {
        unregisterWikiLinkPreview(this.previewId);
        if (this.previewElement !== null) {
            this.previewElement.removeEventListener("mouseenter", this.handlePreviewMouseEnter);
            this.previewElement.removeEventListener("mousemove", this.handlePreviewMouseMove);
            this.previewElement.removeEventListener("mouseleave", this.handlePreviewMouseLeave);
        }

        if (this.previewRoot !== null) {
            this.previewRoot.unmount();
            this.previewRoot = null;
        }

        if (this.previewElement !== null) {
            this.previewElement.remove();
            this.previewElement = null;
        }
    }

    private async loadPreviewData(
        currentDirectory: string,
        target: WikiLinkPreviewTarget,
        requestToken: number,
        cacheKey: string,
    ): Promise<void> {
        try {
            const resolved = await resolveWikiLinkTarget(currentDirectory, target.target);
            if (!this.shouldAcceptAsyncResult(target, requestToken)) {
                return;
            }

            if (resolved === null) {
                const notFoundData: WikiLinkPreviewData = { status: "not-found" };
                this.previewCache.set(cacheKey, notFoundData);
                this.renderPreview(target, notFoundData);
                return;
            }

            const file = await readVaultMarkdownFile(resolved.relativePath);
            if (!this.shouldAcceptAsyncResult(target, requestToken)) {
                return;
            }

            const readyData: WikiLinkPreviewData = {
                status: "ready",
                resolvedPath: resolved.relativePath,
                content: file.content,
            };
            this.previewCache.set(cacheKey, readyData);
            this.renderPreview(target, readyData);
        } catch (error) {
            if (!this.shouldAcceptAsyncResult(target, requestToken)) {
                return;
            }

            const errorMessage = error instanceof Error ? error.message : String(error);
            this.renderPreview(target, {
                status: "error",
                message: errorMessage,
            });
        }
    }

    private shouldAcceptAsyncResult(
        target: WikiLinkPreviewTarget,
        requestToken: number,
    ): boolean {
        return this.requestSequence === requestToken
            && arePreviewTargetsEqual(this.activeTarget, target);
    }

    private scheduleHidePreview(): void {
        if (
            this.activeTarget === null
            || this.isPointerOverPreview
            || hasWikiLinkPreviewDescendant(this.previewId)
        ) {
            return;
        }

        if (this.hideTimerId !== null) {
            return;
        }

        this.hideTimerId = this.ownerWindow.setTimeout(() => {
            this.hideTimerId = null;
            this.syncPreviewHoverStateFromPointer();
            if (this.isPointerOverPreview) {
                return;
            }

            if (this.hoveredTarget !== null && this.modifierPressed) {
                this.showPreview(this.hoveredTarget);
                return;
            }

            if (hasWikiLinkPreviewDescendant(this.previewId)) {
                return;
            }

            this.hidePreview();
        }, WIKI_LINK_PREVIEW_HIDE_DELAY_MS);
    }

    private cancelScheduledHide(): void {
        if (this.hideTimerId === null) {
            return;
        }

        this.ownerWindow.clearTimeout(this.hideTimerId);
        this.hideTimerId = null;
    }

    private cancelScheduledUnmount(): void {
        if (this.unmountTimerId === null) {
            return;
        }

        this.ownerWindow.clearTimeout(this.unmountTimerId);
        this.unmountTimerId = null;
    }

    private revivePreviewVisibility(): void {
        this.cancelScheduledUnmount();
        if (this.previewElement === null) {
            return;
        }

        this.previewElement.classList.remove("is-hiding");
        this.previewElement.classList.add("is-visible");
    }

    private isPointerInsidePreview(clientX: number, clientY: number): boolean {
        if (this.previewElement === null) {
            return false;
        }

        const hoveredElement = this.ownerDocument.elementFromPoint(clientX, clientY);
        if (hoveredElement instanceof Node && this.previewElement.contains(hoveredElement)) {
            return true;
        }

        const rect = this.previewElement.getBoundingClientRect();
        return clientX >= rect.left
            && clientX <= rect.right
            && clientY >= rect.top
            && clientY <= rect.bottom;
    }

    private readonly handlePreviewMouseEnter = (): void => {
        this.isPointerOverPreview = true;
        this.cancelScheduledHide();
        this.revivePreviewVisibility();
    };

    private readonly handlePreviewMouseMove = (event: MouseEvent): void => {
        this.pointerPosition = {
            clientX: event.clientX,
            clientY: event.clientY,
        };
    };

    private readonly handlePreviewWheel = (event: WheelEvent): void => {
        const pointerCoords = this.resolvePointerCoords(event.clientX, event.clientY);
        this.syncPreviewHoverStateFromCoords(pointerCoords.clientX, pointerCoords.clientY);
    };

    private readonly handlePreviewMouseLeave = (): void => {
        this.isPointerOverPreview = false;
        if (this.hoveredTarget !== null && this.modifierPressed) {
            return;
        }

        this.scheduleHidePreview();
    }

    private ensurePreviewRoot(): Root {
        if (this.previewElement === null) {
            this.previewElement = this.ownerDocument.createElement("div");
            this.previewElement.className = "cm-wikilink-preview-tooltip";
            this.previewElement.removeEventListener("wheel", this.handlePreviewWheel);
            this.previewElement.dataset.floatingSurface = "true";
            registerWikiLinkPreview(this.previewId, null);
            this.previewElement.addEventListener("mouseenter", this.handlePreviewMouseEnter);
            this.previewElement.addEventListener("mousemove", this.handlePreviewMouseMove);
            this.previewElement.addEventListener("wheel", this.handlePreviewWheel, { passive: true });
            this.previewElement.addEventListener("mouseleave", this.handlePreviewMouseLeave);
            this.ownerDocument.body.appendChild(this.previewElement);
            this.previewRoot = createRoot(this.previewElement);
        }

        if (this.previewRoot === null) {
            this.previewRoot = createRoot(this.previewElement);
        }

        return this.previewRoot;
    }

    private renderPreview(target: WikiLinkPreviewTarget, data: WikiLinkPreviewData): void {
        this.activeTarget = target;
        const root = this.ensurePreviewRoot();
        this.cancelScheduledUnmount();
        root.render(
            <WikiLinkPreviewCard
                anchor={target}
                data={data}
                containerApi={this.containerApi}
                previewId={this.previewId}
            />,
        );

        this.ownerWindow.requestAnimationFrame(() => {
            if (!arePreviewTargetsEqual(this.activeTarget, target) || this.previewElement === null) {
                return;
            }

            this.positionPreview();
            this.syncPreviewHoverStateFromPointer();
            this.previewElement.classList.remove("is-hiding");
            this.previewElement.classList.add("is-visible");
        });
    }

    private syncPreviewHoverStateFromPointer(): void {
        if (this.previewElement === null || this.pointerPosition === null) {
            return;
        }

        this.syncPreviewHoverStateFromCoords(
            this.pointerPosition.clientX,
            this.pointerPosition.clientY,
        );
    }

    private syncPreviewHoverStateFromCoords(clientX: number, clientY: number): void {
        const isPointerInside = this.isPointerInsidePreview(clientX, clientY);

        if (!isPointerInside) {
            this.isPointerOverPreview = false;
            return;
        }

        this.pointerPosition = { clientX, clientY };
        this.isPointerOverPreview = true;
        this.cancelScheduledHide();
        this.revivePreviewVisibility();
    }

    private positionPreview(): void {
        if (this.activeTarget === null || this.previewElement === null) {
            return;
        }

        const anchorCoords = this.view.coordsAtPos(this.activeTarget.anchorPos);
        if (anchorCoords === null) {
            this.hidePreviewImmediately();
            return;
        }

        const bubbleWidth = this.previewElement.offsetWidth;
        const bubbleHeight = this.previewElement.offsetHeight;
        const viewportWidth = this.ownerWindow.innerWidth;
        const viewportHeight = this.ownerWindow.innerHeight;
        const viewportPadding = 12;

        let left = Math.min(
            Math.max(viewportPadding, anchorCoords.left),
            Math.max(viewportPadding, viewportWidth - bubbleWidth - viewportPadding),
        );

        let placement: "above" | "below" = "below";
        let top = anchorCoords.bottom + WIKI_LINK_PREVIEW_GAP_PX;

        if (
            top + bubbleHeight > viewportHeight - viewportPadding
            && anchorCoords.top - bubbleHeight - WIKI_LINK_PREVIEW_GAP_PX >= viewportPadding
        ) {
            placement = "above";
            top = anchorCoords.top - bubbleHeight - WIKI_LINK_PREVIEW_GAP_PX;
        }

        if (top + bubbleHeight > viewportHeight - viewportPadding) {
            top = Math.max(viewportPadding, viewportHeight - bubbleHeight - viewportPadding);
        }

        if (left + bubbleWidth > viewportWidth - viewportPadding) {
            left = Math.max(viewportPadding, viewportWidth - bubbleWidth - viewportPadding);
        }

        this.previewElement.dataset.placement = placement;
        this.previewElement.style.left = `${Math.round(left)}px`;
        this.previewElement.style.top = `${Math.round(top)}px`;
    }
}

/**
 * @function createWikiLinkPreviewExtension
 * @description 创建 WikiLink hover 预览扩展。
 * @param containerApi Dockview 容器 API。
 * @param getCurrentFilePath 获取当前文档路径。
 * @returns CodeMirror 扩展。
 */
export function createWikiLinkPreviewExtension(
    containerApi: DockviewApi,
    getCurrentFilePath: () => string,
): ReturnType<typeof ViewPlugin.fromClass> {
    return ViewPlugin.fromClass(
        class extends WikiLinkPreviewPlugin {
            constructor(view: EditorView) {
                super(view, containerApi, getCurrentFilePath);
            }
        },
        {
            eventHandlers: {
                mousemove(this: WikiLinkPreviewPlugin, event: MouseEvent) {
                    return this.handleMouseMove(event);
                },
                mouseleave(this: WikiLinkPreviewPlugin) {
                    return this.handleMouseLeave();
                },
                mousedown(this: WikiLinkPreviewPlugin) {
                    return this.handleMouseDown();
                },
            },
        },
    );
}