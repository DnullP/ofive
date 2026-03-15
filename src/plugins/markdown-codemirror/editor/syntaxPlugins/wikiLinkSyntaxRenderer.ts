/**
 * @module plugins/markdown-codemirror/editor/syntaxPlugins/wikiLinkSyntaxRenderer
 * @description WikiLink 语法插件：统一承载解析、渲染与 Cmd/Ctrl+Click 导航行为。
 * @dependencies
 *  - ../syntaxRenderRegistry
 */

import type { DockviewApi } from "dockview";
import type { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import i18n from "../../../../i18n";
import { addDelimitedInlineSyntaxDecoration, registerLineSyntaxRenderer } from "../syntaxRenderRegistry";
import { resolveWikiLinkTarget } from "../../../../api/vaultApi";
import { openFileInDockview } from "../../../../host/layout/openFileService";
import { resolveParentDirectory } from "../pathUtils";

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
        const rawTarget = (match[2] ?? "").trim();
        const [linkTargetPart, ...displayParts] = rawTarget.split("|");
        const target = (linkTargetPart ?? "").trim();
        const displayText = displayParts.join("|").trim();
        const matchIndex = match.index ?? -1;
        const hasImageEmbedPrefix = matchIndex > 0 && lineText.charAt(matchIndex - 1) === "!";
        if (hasImageEmbedPrefix) {
            continue;
        }
        if (matchIndex < 0 || target.length === 0) {
            continue;
        }

        const from = line.from + matchIndex;
        const to = from + fullText.length;
        if (position >= from && position <= to) {
            return {
                from,
                to,
                target,
                displayText: displayText.length > 0 ? displayText : target,
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
                const leftDelimiter = match[1] ?? "[[";
                const rightDelimiter = match[3] ?? "]]";
                const matchIndex = match.index ?? -1;
                const hasImageEmbedPrefix = matchIndex > 0 && context.lineText.charAt(matchIndex - 1) === "!";
                if (hasImageEmbedPrefix) {
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

            const position = view.posAtCoords({ x: event.clientX, y: event.clientY });
            if (position === null) {
                return false;
            }

            const wikiLink = findWikiLinkAtPosition(view.state, position);
            if (!wikiLink) {
                return false;
            }

            event.preventDefault();
            void (async () => {
                const currentFilePath = getCurrentFilePath();
                const currentDirectory = resolveParentDirectory(currentFilePath);

                try {
                    const resolved = await resolveWikiLinkTarget(currentDirectory, wikiLink.target);
                    if (!resolved) {
                        console.warn("[editor] wikilink target not found", {
                            currentDirectory,
                            target: wikiLink.target,
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
                        target: wikiLink.target,
                        resolvedPath: resolved.relativePath,
                    });
                } catch (error) {
                    console.error("[editor] wikilink open failed", {
                        currentDirectory,
                        target: wikiLink.target,
                        message: error instanceof Error ? error.message : String(error),
                    });

                    const fallbackPath = wikiLink.target.endsWith(".md")
                        ? wikiLink.target
                        : `${wikiLink.target}.md`;
                    const fallbackId = createWikiLinkTabId(wikiLink.target);
                    const fallbackPanel = containerApi.getPanel(fallbackId);
                    if (fallbackPanel) {
                        fallbackPanel.api.setActive();
                    } else {
                        void openFileInDockview({
                            containerApi,
                            relativePath: fallbackPath,
                            contentOverride: `# ${wikiLink.target}\n\n${i18n.t("editor.newPageContent", { target: wikiLink.target })}`,
                        });
                    }
                }
            })();

            return true;
        },
    });
}
