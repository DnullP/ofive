/**
 * @module layout/editor/syntaxPlugins/imageEmbedSyntaxExtension
 * @description 图片嵌入语法插件：渲染 `![[...]]` 语法为编辑器内图片预览。
 * @dependencies
 *  - @codemirror/state
 *  - @codemirror/view
 *  - ../../../api/vaultApi
 *  - ../pathUtils
 *  - ../syntaxRenderRegistry
 */

import { RangeSetBuilder } from "@codemirror/state";
import i18n from "../../../i18n";
import {
    Decoration,
    type DecorationSet,
    EditorView,
    ViewPlugin,
    type ViewUpdate,
    WidgetType,
} from "@codemirror/view";
import { readVaultBinaryFile, resolveMediaEmbedTarget } from "../../../api/vaultApi";
import { shouldRebuildImageEmbedDecorations } from "./imageEmbedUpdatePolicy";
import { resolveParentDirectory } from "../pathUtils";
import { rangeIntersectsSelection } from "../syntaxRenderRegistry";

const IMAGE_EMBED_PATTERN = /(!\[\[)([^\]\n]+?)(\]\])/g;

/**
 * @type ImageEmbedRenderState
 * @description 图片嵌入渲染状态。
 */
type ImageEmbedRenderState = "loading" | "ready" | "error";

/**
 * @interface ImageEmbedCacheItem
 * @description 图片嵌入缓存条目。
 */
interface ImageEmbedCacheItem {
    /** 当前缓存状态 */
    state: ImageEmbedRenderState;
    /** 解析后的 vault 相对路径 */
    relativePath: string;
    /** 图片 src（data URL） */
    source: string;
    /** 错误信息（失败时） */
    errorMessage: string;
}

/**
 * @interface ImageEmbedWidgetPayload
 * @description 渲染到 DOM 的图片嵌入数据。
 */
interface ImageEmbedWidgetPayload {
    /** 当前渲染状态 */
    state: ImageEmbedRenderState;
    /** 展示标题（优先文件名） */
    label: string;
    /** 图片数据源 */
    source: string;
    /** 错误信息 */
    errorMessage: string;
}

/**
 * @class ImageEmbedWidget
 * @description 图片嵌入 widget：将语法 token 替换为图片预览块。
 */
class ImageEmbedWidget extends WidgetType {
    /** Widget 渲染数据。 */
    private readonly payload: ImageEmbedWidgetPayload;

    constructor(payload: ImageEmbedWidgetPayload) {
        super();
        this.payload = payload;
    }

    eq(other: ImageEmbedWidget): boolean {
        return (
            this.payload.state === other.payload.state &&
            this.payload.label === other.payload.label &&
            this.payload.source === other.payload.source &&
            this.payload.errorMessage === other.payload.errorMessage
        );
    }

    toDOM(): HTMLElement {
        try {
            const wrapperElement = document.createElement("span");
            wrapperElement.className = "cm-image-embed-widget";

            if (this.payload.state === "ready") {
                const imageElement = document.createElement("img");
                imageElement.className = "cm-image-embed-image";
                imageElement.src = this.payload.source;
                imageElement.alt = this.payload.label;
                wrapperElement.appendChild(imageElement);

                const captionElement = document.createElement("span");
                captionElement.className = "cm-image-embed-caption";
                captionElement.textContent = this.payload.label;
                wrapperElement.appendChild(captionElement);
                return wrapperElement;
            }

            const messageElement = document.createElement("span");
            if (this.payload.state === "loading") {
                messageElement.className = "cm-image-embed-loading";
                messageElement.textContent = i18n.t("image.loading", { src: this.payload.label });
            } else {
                messageElement.className = "cm-image-embed-error";
                messageElement.textContent = i18n.t("image.loadError", { src: this.payload.errorMessage || this.payload.label });
            }

            wrapperElement.appendChild(messageElement);
            return wrapperElement;
        } catch (error) {
            console.error("[editor-image-embed] widget render failed", {
                message: error instanceof Error ? error.message : String(error),
            });

            const fallbackElement = document.createElement("span");
            fallbackElement.className = "cm-image-embed-error";
            fallbackElement.textContent = i18n.t("image.renderFailed");
            return fallbackElement;
        }
    }

    ignoreEvent(): boolean {
        return false;
    }
}

/**
 * @function buildEmbedCacheKey
 * @description 构造图片嵌入缓存键，避免同目标重复请求。
 * @param currentDirectory 当前文档目录。
 * @param rawTarget 图片嵌入目标。
 * @returns 缓存键。
 */
function buildEmbedCacheKey(currentDirectory: string, rawTarget: string): string {
    return `${currentDirectory}::${rawTarget.trim()}`;
}

/**
 * @function createImageEmbedSyntaxExtension
 * @description 创建图片嵌入语法扩展。
 * @param getCurrentFilePath 获取当前文档路径。
 * @returns CodeMirror 扩展。
 */
export function createImageEmbedSyntaxExtension(
    getCurrentFilePath: () => string,
): ReturnType<typeof ViewPlugin.fromClass> {
    return ViewPlugin.fromClass(
        class {
            decorations: DecorationSet;
            private readonly imageEmbedCache: Map<string, ImageEmbedCacheItem>;
            private isDisposed: boolean;
            private refreshFrameId: number | null;

            constructor(view: EditorView) {
                this.imageEmbedCache = new Map<string, ImageEmbedCacheItem>();
                this.isDisposed = false;
                this.refreshFrameId = null;
                this.decorations = this.safeBuildDecorations(view);
            }

            update(update: ViewUpdate): void {
                if (
                    shouldRebuildImageEmbedDecorations({
                        docChanged: update.docChanged,
                        selectionSet: update.selectionSet,
                        viewportChanged: update.viewportChanged,
                        focusChanged: update.focusChanged,
                        transactionCount: update.transactions.length,
                    })
                ) {
                    this.decorations = this.safeBuildDecorations(update.view);
                }
            }

            private safeBuildDecorations(view: EditorView): DecorationSet {
                try {
                    return this.buildDecorations(view);
                } catch (error) {
                    console.error("[editor-image-embed] build decorations failed", {
                        message: error instanceof Error ? error.message : String(error),
                    });

                    const builder = new RangeSetBuilder<Decoration>();
                    return builder.finish();
                }
            }

            destroy(): void {
                this.isDisposed = true;
                if (this.refreshFrameId !== null) {
                    window.cancelAnimationFrame(this.refreshFrameId);
                    this.refreshFrameId = null;
                }
            }

            private requestRefresh(view: EditorView): void {
                if (this.isDisposed) {
                    return;
                }
                if (this.refreshFrameId !== null) {
                    return;
                }

                this.refreshFrameId = window.requestAnimationFrame(() => {
                    this.refreshFrameId = null;

                    if (this.isDisposed || !view.dom.isConnected) {
                        return;
                    }

                    try {
                        view.dispatch({});
                    } catch (error) {
                        console.warn("[editor-image-embed] skip refresh dispatch", {
                            message: error instanceof Error ? error.message : String(error),
                        });
                    }
                });
            }

            private requestImageData(
                view: EditorView,
                currentDirectory: string,
                rawTarget: string,
                cacheKey: string,
            ): void {
                const existingCache = this.imageEmbedCache.get(cacheKey);
                if (existingCache && existingCache.state === "loading") {
                    return;
                }

                this.imageEmbedCache.set(cacheKey, {
                    state: "loading",
                    relativePath: "",
                    source: "",
                    errorMessage: "",
                });

                console.info("[editor-image-embed] resolve target start", {
                    currentDirectory,
                    target: rawTarget,
                });

                void resolveMediaEmbedTarget(currentDirectory, rawTarget)
                    .then(async (resolvedTarget) => {
                        if (!resolvedTarget) {
                            console.warn("[editor-image-embed] target not found", {
                                currentDirectory,
                                target: rawTarget,
                            });

                            this.imageEmbedCache.set(cacheKey, {
                                state: "error",
                                relativePath: "",
                                source: "",
                                errorMessage: i18n.t("image.notFound"),
                            });
                            this.requestRefresh(view);
                            return;
                        }

                        const binaryResult = await readVaultBinaryFile(resolvedTarget.relativePath);
                        if (!binaryResult.mimeType.startsWith("image/")) {
                            console.warn("[editor-image-embed] unsupported mime type", {
                                relativePath: resolvedTarget.relativePath,
                                mimeType: binaryResult.mimeType,
                            });

                            this.imageEmbedCache.set(cacheKey, {
                                state: "error",
                                relativePath: resolvedTarget.relativePath,
                                source: "",
                                errorMessage: i18n.t("image.unsupportedType", { type: binaryResult.mimeType }),
                            });
                            this.requestRefresh(view);
                            return;
                        }

                        const source = `data:${binaryResult.mimeType};base64,${binaryResult.base64Content}`;
                        this.imageEmbedCache.set(cacheKey, {
                            state: "ready",
                            relativePath: resolvedTarget.relativePath,
                            source,
                            errorMessage: "",
                        });

                        console.info("[editor-image-embed] load image success", {
                            target: rawTarget,
                            relativePath: resolvedTarget.relativePath,
                            mimeType: binaryResult.mimeType,
                            base64Length: binaryResult.base64Content.length,
                        });

                        this.requestRefresh(view);
                    })
                    .catch((error) => {
                        const message = error instanceof Error ? error.message : String(error);
                        this.imageEmbedCache.set(cacheKey, {
                            state: "error",
                            relativePath: "",
                            source: "",
                            errorMessage: message,
                        });

                        console.error("[editor-image-embed] load image failed", {
                            currentDirectory,
                            target: rawTarget,
                            message,
                        });

                        this.requestRefresh(view);
                    });
            }

            private buildDecorations(view: EditorView): DecorationSet {
                const builder = new RangeSetBuilder<Decoration>();
                const currentFilePath = getCurrentFilePath();
                const currentDirectory = resolveParentDirectory(currentFilePath);

                for (const visibleRange of view.visibleRanges) {
                    let currentLine = view.state.doc.lineAt(visibleRange.from);
                    const endLineNumber = view.state.doc.lineAt(visibleRange.to).number;

                    while (currentLine.number <= endLineNumber) {
                        const matches = Array.from(currentLine.text.matchAll(IMAGE_EMBED_PATTERN));

                        matches.forEach((match) => {
                            const fullText = match[0] ?? "";
                            const rawTarget = (match[2] ?? "").trim();
                            const matchIndex = match.index ?? -1;
                            if (matchIndex < 0 || fullText.length === 0 || rawTarget.length === 0) {
                                return;
                            }

                            const tokenFrom = currentLine.from + matchIndex;
                            const tokenTo = tokenFrom + fullText.length;
                            const isEditingToken =
                                view.hasFocus && rangeIntersectsSelection(view, tokenFrom, tokenTo);
                            if (isEditingToken) {
                                return;
                            }

                            const cacheKey = buildEmbedCacheKey(currentDirectory, rawTarget);
                            const cacheItem = this.imageEmbedCache.get(cacheKey);
                            if (!cacheItem || cacheItem.state === "loading") {
                                this.requestImageData(view, currentDirectory, rawTarget, cacheKey);
                            }

                            const activeCacheItem = this.imageEmbedCache.get(cacheKey);
                            const relativePath = activeCacheItem?.relativePath ?? rawTarget;
                            const label = relativePath.split("/").pop() ?? rawTarget;

                            const widget = new ImageEmbedWidget({
                                state: activeCacheItem?.state ?? "loading",
                                label,
                                source: activeCacheItem?.source ?? "",
                                errorMessage: activeCacheItem?.errorMessage ?? "",
                            });

                            builder.add(
                                tokenFrom,
                                tokenTo,
                                Decoration.replace({
                                    widget,
                                    block: false,
                                    inclusive: false,
                                }),
                            );
                        });

                        if (currentLine.number === endLineNumber) {
                            break;
                        }
                        currentLine = view.state.doc.line(currentLine.number + 1);
                    }
                }

                return builder.finish();
            }
        },
        {
            decorations: (plugin) => plugin.decorations,
        },
    );
}
