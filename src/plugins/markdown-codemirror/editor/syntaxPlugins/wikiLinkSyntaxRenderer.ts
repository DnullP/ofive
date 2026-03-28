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

/**
 * @interface WikiLinkMatch
 * @description Wiki link 匹配结果。
 */
interface WikiLinkMatch {
    from: number;
    to: number;
    target: string;
    displayText: string;
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
async function openWikiLinkTarget(
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
function findWikiLinkAtPosition(state: EditorState, position: number): WikiLinkMatch | null {
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
            if (!(event.metaKey || event.ctrlKey) || event.button !== 0) {
                return false;
            }

            const eventTarget = event.target;
            if (eventTarget instanceof Element) {
                const widgetTarget = eventTarget
                    .closest<HTMLElement>(".cm-rendered-wikilink-display")
                    ?.dataset.wikiLinkTarget
                    ?.trim();
                if (widgetTarget) {
                    event.preventDefault();
                    void openWikiLinkTarget(containerApi, getCurrentFilePath, widgetTarget);
                    return true;
                }
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
            void openWikiLinkTarget(containerApi, getCurrentFilePath, wikiLink.target);

            return true;
        },
    });
}
