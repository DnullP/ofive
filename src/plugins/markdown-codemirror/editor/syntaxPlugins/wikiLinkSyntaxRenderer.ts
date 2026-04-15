/**
 * @module plugins/markdown-codemirror/editor/syntaxPlugins/wikiLinkSyntaxRenderer
 * @description WikiLink 语法插件：统一承载解析、渲染与 Cmd/Ctrl+Click 导航行为。
 * @dependencies
 *  - ../syntaxRenderRegistry
 */

import type { DockviewApi } from "dockview";
import type { EditorState } from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import i18n from "../../../../i18n";
import {
    addDelimitedInlineSyntaxDecoration,
    pushSyntaxDecorationRange,
    rangeIntersectsSelection,
    registerLineSyntaxRenderer,
} from "../syntaxRenderRegistry";
import { resolveWikiLinkTarget } from "../../../../api/vaultApi";
import { openFileInDockview } from "../../../../host/layout/openFileService";
import { resolveParentDirectory } from "../pathUtils";
import { parseWikiLinkParts } from "./wikiLinkParser";

const WIKI_LINK_PATTERN = /(\[\[)([^\]\n]+?)(\]\])/g;
const INLINE_CODE_SPAN_PATTERN = /`[^`\n]+`/g;

/**
 * @function isInsideInlineCode
 * @description 判断行内某个范围是否落在反引号行内代码内。
 * @param lineText 行文本。
 * @param startInLine 匹配在行内的起始偏移。
 * @param endInLine 匹配在行内的结束偏移。
 * @returns 若范围被行内代码完全包含则返回 true。
 */
function isInsideInlineCode(lineText: string, startInLine: number, endInLine: number): boolean {
    for (const m of lineText.matchAll(INLINE_CODE_SPAN_PATTERN)) {
        const codeStart = m.index ?? -1;
        if (codeStart < 0) continue;
        const codeEnd = codeStart + m[0].length;
        if (startInLine >= codeStart && endInLine <= codeEnd) {
            return true;
        }
    }
    return false;
}

/**
 * @interface WikiLinkMatch
 * @description Wiki link 匹配结果。
 */
export interface WikiLinkMatch {
    from: number;
    to: number;
    target: string;
    displayText: string;
}

/**
 * @interface WikiLinkMouseDownEventLike
 * @description WikiLink 左键导航所需的最小事件接口。
 */
export interface WikiLinkMouseDownEventLike {
    button: number;
    target: EventTarget | null;
    clientX: number;
    clientY: number;
    preventDefault: () => void;
}

/**
 * @interface WikiLinkMouseDownViewLike
 * @description WikiLink 左键导航所需的最小视图接口。
 */
export interface WikiLinkMouseDownViewLike {
    state: EditorState;
    posAtCoords: (coords: { x: number; y: number }) => number | null;
}

interface ClosestCapableTarget extends EventTarget {
    closest: (selector: string) => unknown;
}

function isClosestCapableTarget(value: EventTarget | null): value is ClosestCapableTarget {
    return typeof value === "object"
        && value !== null
        && "closest" in value
        && typeof value.closest === "function";
}

/**
 * @class WikiLinkDisplayWidget
 * @description Wiki link 别名显示 Widget：隐藏源码中的 target，仅展示 displayText。
 */
class WikiLinkDisplayWidget extends WidgetType {
    private readonly target: string;
    private readonly displayText: string;

    constructor(target: string, displayText: string) {
        super();
        this.target = target;
        this.displayText = displayText;
    }

    eq(other: WikiLinkDisplayWidget): boolean {
        return this.target === other.target && this.displayText === other.displayText;
    }

    toDOM(): HTMLElement {
        const linkElement = document.createElement("span");
        linkElement.className = "cm-rendered-wikilink cm-rendered-wikilink-display";
        linkElement.dataset.wikiLinkTarget = this.target;
        linkElement.textContent = this.displayText;
        return linkElement;
    }

    ignoreEvent(): boolean {
        return false;
    }
}

/**
 * @function openWikiLinkTarget
 * @description 打开或激活指定 wiki link 目标。
 * @param containerApi Dockview 容器 API。
 * @param getCurrentFilePath 获取当前文档路径。
 * @param target wiki 目标文本。
 */
export async function openWikiLinkTarget(
    containerApi: DockviewApi,
    getCurrentFilePath: () => string,
    target: string,
): Promise<void> {
    const currentFilePath = getCurrentFilePath();
    const currentDirectory = resolveParentDirectory(currentFilePath);

    try {
        const resolved = await resolveWikiLinkTarget(currentDirectory, target);
        if (!resolved) {
            console.warn("[editor] wikilink target not found", {
                currentDirectory,
                target,
            });
            return;
        }

        const targetId = `file:${resolved.relativePath}`;
        const existingPanel = containerApi.getPanel(targetId);
        if (existingPanel) {
            existingPanel.api.setActive();
            return;
        }

        await openFileInDockview({
            containerApi,
            relativePath: resolved.relativePath,
        });

        console.info("[editor] wikilink opened", {
            currentDirectory,
            target,
            resolvedPath: resolved.relativePath,
        });
    } catch (error) {
        console.error("[editor] wikilink open failed", {
            currentDirectory,
            target,
            message: error instanceof Error ? error.message : String(error),
        });

        const fallbackPath = target.endsWith(".md")
            ? target
            : `${target}.md`;
        const fallbackId = createWikiLinkTabId(target);
        const fallbackPanel = containerApi.getPanel(fallbackId);
        if (fallbackPanel) {
            fallbackPanel.api.setActive();
        } else {
            await openFileInDockview({
                containerApi,
                relativePath: fallbackPath,
                contentOverride: `# ${target}\n\n${i18n.t("editor.newPageContent", { target })}`,
            });
        }
    }
}

/**
 * @function findWikiLinkAtPosition
 * @description 在指定文档位置查找所在的 wiki link。
 * @param state 编辑器状态。
 * @param position 文档偏移位置。
 * @returns 命中的 wiki link 信息，不命中返回 null。
 */
export function findWikiLinkAtPosition(state: EditorState, position: number): WikiLinkMatch | null {
    const line = state.doc.lineAt(position);
    const lineText = line.text;
    const matches = Array.from(lineText.matchAll(WIKI_LINK_PATTERN));

    for (const match of matches) {
        const fullText = match[0] ?? "";
        const parsed = parseWikiLinkParts((match[2] ?? "").trim());
        const matchIndex = match.index ?? -1;
        const hasImageEmbedPrefix = matchIndex > 0 && lineText.charAt(matchIndex - 1) === "!";
        if (hasImageEmbedPrefix) {
            continue;
        }
        if (matchIndex < 0 || parsed === null) {
            continue;
        }
        if (isInsideInlineCode(lineText, matchIndex, matchIndex + fullText.length)) {
            continue;
        }

        const from = line.from + matchIndex;
        const to = from + fullText.length;
        if (position >= from && position <= to) {
            return {
                from,
                to,
                target: parsed.target,
                displayText: parsed.displayText,
            };
        }
    }

    return null;
}

/**
 * @function isRenderedWikiLinkTarget
 * @description 判断点击目标是否命中了 WikiLink 的渲染态 DOM。
 * @param eventTarget 鼠标事件目标。
 * @returns 命中渲染态返回 true。
 */
export function isRenderedWikiLinkTarget(eventTarget: EventTarget | null): boolean {
    if (!isClosestCapableTarget(eventTarget)) {
        return false;
    }

    return eventTarget.closest(".cm-rendered-wikilink, .cm-rendered-wikilink-display") !== null;
}

/**
 * @function extractWidgetWikiLinkTarget
 * @description 从别名 widget DOM 中提取 WikiLink 目标。
 * @param eventTarget 鼠标事件目标。
 * @returns 命中 alias widget 时返回目标文本。
 */
export function extractWidgetWikiLinkTarget(eventTarget: EventTarget | null): string | null {
    if (!isClosestCapableTarget(eventTarget)) {
        return null;
    }

    const widgetTarget = eventTarget.closest(".cm-rendered-wikilink-display") as {
        dataset?: { wikiLinkTarget?: string };
    } | null;

    return widgetTarget?.dataset?.wikiLinkTarget?.trim() ?? null;
}

/**
 * @function createWikiLinkTabId
 * @description 根据 wiki link 目标生成稳定 tab id。
 * @param target wiki 目标文本。
 * @returns tab id。
 */
function createWikiLinkTabId(target: string): string {
    return `wiki:${target.toLowerCase()}`;
}

/**
 * @function registerWikiLinkSyntaxRenderer
 * @description 注册 WikiLink 渲染插件。
 */
export function registerWikiLinkSyntaxRenderer(): void {
    registerLineSyntaxRenderer({
        id: "inline-wikilink",
        applyLineDecorations(context) {
            const matches = Array.from(context.lineText.matchAll(WIKI_LINK_PATTERN));
            matches.forEach((match) => {
                const fullText = match[0] ?? "";
                const parsed = parseWikiLinkParts((match[2] ?? "").trim());
                const leftDelimiter = match[1] ?? "[[";
                const rightDelimiter = match[3] ?? "]]";
                const matchIndex = match.index ?? -1;
                const hasImageEmbedPrefix = matchIndex > 0 && context.lineText.charAt(matchIndex - 1) === "!";
                if (hasImageEmbedPrefix || parsed === null) {
                    return;
                }

                if (isInsideInlineCode(context.lineText, matchIndex, matchIndex + fullText.length)) {
                    return;
                }

                const tokenFrom = context.lineFrom + matchIndex;
                const tokenTo = tokenFrom + fullText.length;
                const isEditingToken = context.view.hasFocus
                    && rangeIntersectsSelection(context.view, tokenFrom, tokenTo);
                if (isEditingToken) {
                    return;
                }

                if (parsed.hasExplicitDisplayText) {
                    pushSyntaxDecorationRange(
                        context.ranges,
                        tokenFrom,
                        tokenTo,
                        Decoration.replace({
                            widget: new WikiLinkDisplayWidget(parsed.target, parsed.displayText),
                        }),
                    );
                    return;
                }

                addDelimitedInlineSyntaxDecoration(
                    context,
                    matchIndex,
                    fullText,
                    leftDelimiter.length,
                    rightDelimiter.length,
                    "cm-rendered-wikilink",
                );
            });
        },
    });
}

/**
 * @function createWikiLinkNavigationExtension
 * @description 创建 wiki link 导航扩展，支持 Cmd/Ctrl + Click 打开/激活链接。
 * @param containerApi Dockview 容器 API。
 * @param getCurrentFilePath 获取当前文档路径。
 * @returns CodeMirror 扩展。
 */
export function createWikiLinkNavigationExtension(
    containerApi: DockviewApi,
    getCurrentFilePath: () => string,
): ReturnType<typeof EditorView.domEventHandlers> {
    return EditorView.domEventHandlers({
        mousedown(event, view) {
            return handleWikiLinkMouseDown(event, view, (target) => {
                void openWikiLinkTarget(containerApi, getCurrentFilePath, target);
            });
        },
    });
}

/**
 * @function handleWikiLinkMouseDown
 * @description 处理渲染态 WikiLink 的普通左键导航，命中后会阻止默认光标移动。
 * @param event 鼠标事件。
 * @param view 编辑器视图。
 * @param openTarget 打开目标的回调。
 * @returns 若事件被消费则返回 true。
 */
export function handleWikiLinkMouseDown(
    event: WikiLinkMouseDownEventLike,
    view: WikiLinkMouseDownViewLike,
    openTarget: (target: string) => void,
): boolean {
    if (event.button !== 0) {
        return false;
    }

    const widgetTarget = extractWidgetWikiLinkTarget(event.target);
    const renderedTargetHit = widgetTarget !== null || isRenderedWikiLinkTarget(event.target);
    if (!renderedTargetHit) {
        return false;
    }

    if (widgetTarget) {
        event.preventDefault();
        openTarget(widgetTarget);
        return true;
    }

    const position = view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (position === null) {
        return false;
    }

    const wikiLink = findWikiLinkAtPosition(view.state, position);
    if (!wikiLink) {
        return false;
    }

    event.preventDefault();
    openTarget(wikiLink.target);

    return true;
}
