/**
 * @module layout/CodeMirrorEditorTab
 * @description 基于 CodeMirror 6 的编辑器 Tab 组件，用于在 Dockview 中承载可编辑文本内容。
 * @dependencies
 *  - react
 *  - dockview
 *  - codemirror
 *  - @codemirror/lang-markdown
 *  - ./editor/codemirrorTheme
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { IDockviewPanelProps } from "dockview";
import { EditorView } from "codemirror";
import { Compartment, EditorState, RangeSetBuilder } from "@codemirror/state";
import { Decoration, type DecorationSet, ViewPlugin, type ViewUpdate, lineNumbers as lineNumbersExtension } from "@codemirror/view";
import { indentUnit } from "@codemirror/language";
import { markdown } from "@codemirror/lang-markdown";
import { basicSetup } from "codemirror";
import { redo, selectAll, undo } from "@codemirror/commands";
import { openSearchPanel } from "@codemirror/search";
import { getCM, Vim, vim } from "@replit/codemirror-vim";
import "./CodeMirrorEditorTab.css";
import type { DockviewApi } from "dockview";
import { reportArticleContent, reportArticleFocus } from "../store/editorContextStore";
import {
    executeCommand,
    getCommandCondition,
    type CommandId,
    type EditorNativeCommandId,
} from "../commands/commandSystem";
import { isConditionSatisfied } from "../commands/focusContext";
import {
    notifyCommandPaletteOpenRequested,
    notifyQuickSwitcherOpenRequested,
    notifyTabCloseShortcutTriggered,
} from "../commands/shortcutEvents";
import { matchShortcut, useShortcutState } from "../store/shortcutStore";
import { useVaultState } from "../store/vaultStore";
import {
    renameVaultMarkdownFile,
    readVaultMarkdownFile,
    resolveWikiLinkTarget,
    segmentChineseText,
    type ChineseSegmentToken,
} from "../api/vaultApi";
import { useConfigState, DEFAULT_EDITOR_FONT_FAMILY } from "../store/configStore";
import { createRegisteredLineSyntaxRenderExtension } from "./editor/syntaxRenderRegistry";
import { ensureBuiltinSyntaxRenderersRegistered } from "./editor/registerBuiltinSyntaxRenderers";
import { createCodeMirrorThemeExtension } from "./editor/codemirrorTheme";
import { createRelativeLineNumbersExtension } from "./editor/relativeLineNumbersExtension";

ensureBuiltinSyntaxRenderersRegistered();

const registeredLineSyntaxRenderExtension = createRegisteredLineSyntaxRenderExtension();

/**
 * @constant HEADER_PATTERN
 * @description Markdown 标题匹配规则，支持 1-6 级标题。
 */
const HEADER_PATTERN = /^(#{1,6})\s+(.+)$/;

/**
 * @constant BOLD_INLINE_PATTERN
 * @description Markdown 粗体匹配规则，支持 **text** 与 __text__。
 */
const BOLD_INLINE_PATTERN = /(\*\*|__)(?=\S)(.+?)(?<=\S)\1/g;

/**
 * @constant ITALIC_STAR_INLINE_PATTERN
 * @description Markdown 斜体匹配规则，支持 *text*（排除 **bold**）。
 */
const ITALIC_STAR_INLINE_PATTERN = /(?<!\*)\*(?=\S)(.+?)(?<=\S)\*(?!\*)/g;

/**
 * @constant ITALIC_UNDERSCORE_INLINE_PATTERN
 * @description Markdown 斜体匹配规则，支持 _text_（排除 __bold__）。
 */
const ITALIC_UNDERSCORE_INLINE_PATTERN = /(?<!_)_(?=\S)(.+?)(?<=\S)_(?!_)/g;

/**
 * @constant STRIKETHROUGH_INLINE_PATTERN
 * @description Markdown 删除线匹配规则，支持 ~~text~~。
 */
const STRIKETHROUGH_INLINE_PATTERN = /(~~)(?=\S)(.+?)(?<=\S)\1/g;

/**
 * @constant INLINE_CODE_PATTERN
 * @description Markdown 行内代码匹配规则，支持 `code`。
 */
const INLINE_CODE_PATTERN = /(`)([^`\n]+?)\1/g;

/**
 * @constant WIKI_LINK_PATTERN
 * @description Wiki Link 匹配规则，支持 [[Page Name]]。
 */
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
 * @interface DecorationRange
 * @description 待写入 RangeSetBuilder 的装饰范围。
 */
interface DecorationRange {
    from: number;
    to: number;
    decoration: Decoration;
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
 * @interface ChineseWordRange
 * @description 中文词范围（行内偏移，end 为开区间）。
 */
interface ChineseWordRange {
    start: number;
    end: number;
}

/**
 * @function containsChineseCharacter
 * @description 判断文本是否包含中文字符。
 * @param text 待检测文本。
 * @returns 含中文返回 true。
 */
function containsChineseCharacter(text: string): boolean {
    return /[\u3400-\u9FFF\uF900-\uFAFF]/.test(text);
}

/**
 * @function normalizeChineseMotionTokens
 * @description 规范化分词 token：按起点去重并保留更长区间，避免重叠 token 导致运动零位移。
 * @param tokens 原始分词 token。
 * @returns 规范化后的 token 列表。
 */
function normalizeChineseMotionTokens(
    lineText: string,
    tokens: ChineseSegmentToken[],
): ChineseSegmentToken[] {
    const tokenByStart = new Map<number, ChineseSegmentToken>();

    tokens
        .filter((token) => {
            if (token.end <= token.start) {
                return false;
            }

            const tokenText = token.word.length > 0 ? token.word : lineText.slice(token.start, token.end);
            return containsChineseCharacter(tokenText);
        })
        .forEach((token) => {
            const existing = tokenByStart.get(token.start);
            if (!existing || token.end > existing.end) {
                tokenByStart.set(token.start, token);
            }
        });

    return [...tokenByStart.values()].sort((left, right) => left.start - right.start);
}

/**
 * @function getNextChineseWordCursorOffset
 * @description 根据分词结果计算 Vim `w` 在当前行的下一跳目标偏移。
 * @param lineText 当前行文本。
 * @param lineOffset 当前光标在行内偏移。
 * @param tokens 当前行分词 token。
 * @returns 下一跳偏移，找不到返回 null。
 */
function getNextChineseWordCursorOffset(
    lineText: string,
    lineOffset: number,
    tokens: ChineseSegmentToken[],
): number | null {
    if (lineOffset >= lineText.length) {
        return null;
    }

    const sortedTokens = normalizeChineseMotionTokens(lineText, tokens);

    if (sortedTokens.length === 0) {
        return null;
    }

    const currentTokenIndex = sortedTokens.findIndex(
        (token) => lineOffset >= token.start && lineOffset < token.end,
    );

    if (currentTokenIndex >= 0) {
        const currentToken = sortedTokens[currentTokenIndex];
        const nextToken = sortedTokens.find((token) => token.start >= currentToken.end);
        return nextToken ? nextToken.start : null;
    }

    const nextToken = sortedTokens.find((token) => token.start > lineOffset);
    return nextToken ? nextToken.start : null;
}

/**
 * @function getPreviousChineseWordCursorOffset
 * @description 根据分词结果计算 Vim `b` 在当前行的上一跳目标偏移。
 * @param lineText 当前行文本。
 * @param lineOffset 当前光标在行内偏移。
 * @param tokens 当前行分词 token。
 * @returns 上一跳偏移，找不到返回 null。
 */
function getPreviousChineseWordCursorOffset(
    lineText: string,
    lineOffset: number,
    tokens: ChineseSegmentToken[],
): number | null {
    if (lineOffset <= 0 || lineText.length === 0) {
        return null;
    }

    const sortedTokens = normalizeChineseMotionTokens(lineText, tokens);

    if (sortedTokens.length === 0) {
        return null;
    }

    const currentTokenIndex = sortedTokens.findIndex(
        (token) => lineOffset > token.start && lineOffset <= token.end,
    );

    if (currentTokenIndex >= 0) {
        const currentToken = sortedTokens[currentTokenIndex];
        if (lineOffset > currentToken.start) {
            return currentToken.start;
        }

        const previousToken = [...sortedTokens]
            .reverse()
            .find((token) => token.end <= currentToken.start);
        return previousToken ? previousToken.start : null;
    }

    const previousToken = [...sortedTokens]
        .reverse()
        .find((token) => token.end <= lineOffset);
    return previousToken ? previousToken.start : null;
}

/**
 * @function getEndChineseWordCursorOffset
 * @description 根据分词结果计算 Vim `e` 在当前行的目标偏移。
 * @param lineText 当前行文本。
 * @param lineOffset 当前光标在行内偏移。
 * @param tokens 当前行分词 token。
 * @returns 目标偏移，找不到返回 null。
 */
function getEndChineseWordCursorOffset(
    lineText: string,
    lineOffset: number,
    tokens: ChineseSegmentToken[],
): number | null {
    if (lineText.length === 0 || lineOffset >= lineText.length) {
        return null;
    }

    const sortedTokens = normalizeChineseMotionTokens(lineText, tokens);

    if (sortedTokens.length === 0) {
        return null;
    }

    const currentToken = sortedTokens.find(
        (token) => lineOffset >= token.start && lineOffset < token.end,
    );

    if (currentToken) {
        return Math.max(currentToken.start, currentToken.end - 1);
    }

    const nextToken = sortedTokens.find((token) => token.start > lineOffset);
    if (!nextToken) {
        return null;
    }

    return Math.max(nextToken.start, nextToken.end - 1);
}

/**
 * @function getNextChineseFallbackCursorOffset
 * @description 分词缓存未命中时的 Vim `w` 回退策略：至少向前移动一个字符，避免按键无响应。
 * @param lineText 当前行文本。
 * @param lineOffset 当前光标在行内偏移。
 * @returns 下一跳偏移，若已到行尾返回 null。
 */
function getNextChineseFallbackCursorOffset(lineText: string, lineOffset: number): number | null {
    if (lineOffset >= lineText.length) {
        return null;
    }

    return lineOffset + 1;
}

/**
 * @function getPreviousChineseFallbackCursorOffset
 * @description 分词缓存未命中时的 Vim `b` 回退策略：至少向后退一个字符。
 * @param lineOffset 当前光标在行内偏移。
 * @returns 目标偏移，无法后退返回 null。
 */
function getPreviousChineseFallbackCursorOffset(lineOffset: number): number | null {
    if (lineOffset <= 0) {
        return null;
    }

    return lineOffset - 1;
}

/**
 * @function getEndChineseFallbackCursorOffset
 * @description 分词缓存未命中时的 Vim `e` 回退策略：至少向前移动一个字符。
 * @param lineText 当前行文本。
 * @param lineOffset 当前光标在行内偏移。
 * @returns 目标偏移，无法前进返回 null。
 */
function getEndChineseFallbackCursorOffset(lineText: string, lineOffset: number): number | null {
    if (lineOffset >= lineText.length) {
        return null;
    }

    return lineOffset + 1;
}

/**
 * @function getFallbackChineseWordRange
 * @description 在无分词缓存时，基于连续中文字符推断词范围。
 * @param lineText 当前行文本。
 * @param lineOffset 当前光标在行内偏移。
 * @returns 中文词范围，无法推断返回 null。
 */
function getFallbackChineseWordRange(lineText: string, lineOffset: number): ChineseWordRange | null {
    if (lineText.length === 0) {
        return null;
    }

    const clampOffset = Math.max(0, Math.min(lineOffset, lineText.length - 1));
    const probeIndexes = [clampOffset, Math.max(0, clampOffset - 1), Math.min(lineText.length - 1, clampOffset + 1)];
    const charIndex = probeIndexes.find((index) => containsChineseCharacter(lineText.charAt(index)));

    if (charIndex === undefined) {
        return null;
    }

    let start = charIndex;
    while (start > 0 && containsChineseCharacter(lineText.charAt(start - 1))) {
        start -= 1;
    }

    let end = charIndex + 1;
    while (end < lineText.length && containsChineseCharacter(lineText.charAt(end))) {
        end += 1;
    }

    return end > start ? { start, end } : null;
}

/**
 * @function getChineseWordRangeAtCursor
 * @description 基于分词结果定位当前光标对应的中文词范围，供 `viw/ciw` 使用。
 * @param lineText 当前行文本。
 * @param lineOffset 当前光标在行内偏移。
 * @param tokens 当前行分词 token（可为空）。
 * @returns 中文词范围，无法定位返回 null。
 */
function getChineseWordRangeAtCursor(
    lineText: string,
    lineOffset: number,
    tokens: ChineseSegmentToken[] | null,
): ChineseWordRange | null {
    if (!tokens) {
        return getFallbackChineseWordRange(lineText, lineOffset);
    }

    const normalized = normalizeChineseMotionTokens(lineText, tokens);
    if (normalized.length === 0) {
        return getFallbackChineseWordRange(lineText, lineOffset);
    }

    const insideToken = normalized.find((token) => lineOffset >= token.start && lineOffset < token.end);
    if (insideToken) {
        return { start: insideToken.start, end: insideToken.end };
    }

    const leftToken = [...normalized].reverse().find((token) => lineOffset > token.start && lineOffset <= token.end);
    if (leftToken) {
        return { start: leftToken.start, end: leftToken.end };
    }

    const nextToken = normalized.find((token) => token.start >= lineOffset);
    if (nextToken) {
        return { start: nextToken.start, end: nextToken.end };
    }

    const previousToken = [...normalized].reverse().find((token) => token.end <= lineOffset);
    if (previousToken) {
        return { start: previousToken.start, end: previousToken.end };
    }

    return getFallbackChineseWordRange(lineText, lineOffset);
}

/**
 * @function resolveChineseMotionOffset
 * @description 统一计算 Vim 中文运动目标偏移，支持 `w`/`b`/`e`。
 * @param key 运动按键。
 * @param lineText 当前行文本。
 * @param lineOffset 当前光标在行内偏移。
 * @param tokens 当前行分词 token（可为空）。
 * @returns 目标偏移，无法计算返回 null。
 */
function resolveChineseMotionOffset(
    key: "w" | "b" | "e",
    lineText: string,
    lineOffset: number,
    tokens: ChineseSegmentToken[] | null,
): number | null {
    if (!tokens) {
        if (key === "w") {
            return getNextChineseFallbackCursorOffset(lineText, lineOffset);
        }
        if (key === "b") {
            return getPreviousChineseFallbackCursorOffset(lineOffset);
        }
        return getEndChineseFallbackCursorOffset(lineText, lineOffset);
    }

    if (key === "w") {
        const computedOffset = getNextChineseWordCursorOffset(lineText, lineOffset, tokens);
        if (computedOffset !== null && computedOffset !== lineOffset) {
            return computedOffset;
        }

        return getNextChineseFallbackCursorOffset(lineText, lineOffset);
    }

    if (key === "b") {
        return (
            getPreviousChineseWordCursorOffset(lineText, lineOffset, tokens) ??
            getPreviousChineseFallbackCursorOffset(lineOffset)
        );
    }

    const computedOffset = getEndChineseWordCursorOffset(lineText, lineOffset, tokens);
    if (computedOffset !== null && computedOffset !== lineOffset) {
        return computedOffset;
    }

    return getEndChineseFallbackCursorOffset(lineText, lineOffset);
}

/**
 * @function pushDecorationRange
 * @description 记录装饰范围，统一在后续阶段按顺序写入 builder，避免乱序导致插件崩溃。
 * @param ranges 装饰范围集合。
 * @param from 起始位置。
 * @param to 结束位置。
 * @param decoration 装饰定义。
 */
function pushDecorationRange(
    ranges: DecorationRange[],
    from: number,
    to: number,
    decoration: Decoration,
): void {
    if (to <= from) {
        return;
    }

    ranges.push({
        from,
        to,
        decoration,
    });
}

/**
 * @function rangeIntersectsSelection
 * @description 判断某个范围是否与当前选择或光标重合。
 * @param state 编辑器状态。
 * @param from 范围起始偏移。
 * @param to 范围结束偏移。
 * @returns 若与选择/光标重合返回 true。
 */
function rangeIntersectsSelection(state: EditorState, from: number, to: number): boolean {
    return state.selection.ranges.some((range) => {
        if (range.empty) {
            return range.from >= from && range.from <= to;
        }
        return range.from <= to && range.to >= from;
    });
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
 * @function resolveParentDirectory
 * @description 计算文档路径所在目录。
 * @param filePath 文档路径。
 * @returns 目录路径；根目录下文件返回空字符串。
 */
function resolveParentDirectory(filePath: string): string {
    const normalized = filePath.replace(/\\/g, "/");
    const index = normalized.lastIndexOf("/");
    if (index <= 0) {
        return "";
    }
    return normalized.slice(0, index);
}

/**
 * @function createWikiLinkNavigationExtension
 * @description 创建 wiki link 导航扩展，支持 Cmd/Ctrl + Click 打开/激活链接。
 * @param containerApi Dockview 容器 API。
 * @returns CodeMirror 扩展。
 */
function createWikiLinkNavigationExtension(
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

                    const fileContent = await readVaultMarkdownFile(resolved.relativePath);
                    const title = resolved.relativePath.split("/").pop() ?? wikiLink.target;

                    containerApi.addPanel({
                        id: targetId,
                        title,
                        component: "codemirror",
                        params: {
                            path: resolved.relativePath,
                            content: fileContent.content,
                        },
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
                        containerApi.addPanel({
                            id: fallbackId,
                            title: wikiLink.target,
                            component: "codemirror",
                            params: {
                                path: fallbackPath,
                                content: `# ${wikiLink.target}\n\n通过 [[${wikiLink.target}]] 打开的新页面。`,
                            },
                        });
                    }
                }
            })();

            return true;
        },
    });
}

/**
 * @function createEditorShortcutExtension
 * @description 创建编辑器快捷键扩展，使用全局快捷键配置驱动编辑器内指令触发。
 * @param getCloseFocusedShortcut 获取“关闭当前标签页”快捷键字符串。
 * @param closeFocusedTab 执行关闭当前标签页动作。
 * @returns CodeMirror DOM 事件扩展。
 */
function createEditorShortcutExtension(
    getBindings: () => Record<CommandId, string>,
    executeByCommandId: (commandId: CommandId) => void,
): ReturnType<typeof EditorView.domEventHandlers> {
    return EditorView.domEventHandlers({
        keydown(event) {
            const bindings = getBindings();
            // 仅匹配条件满足编辑器上下文的命令，跳过其他组件条件的命令
            const commandId = (Object.entries(bindings).find(([id, shortcut]) => {
                if (!matchShortcut(event, shortcut)) return false;
                const condition = getCommandCondition(id as CommandId);
                return isConditionSatisfied(condition, "tab:codemirror");
            })?.[0] ?? null) as CommandId | null;

            if (!commandId) {
                return false;
            }

            event.preventDefault();
            event.stopPropagation();

            if (commandId === "tab.closeFocused") {
                notifyTabCloseShortcutTriggered();
            }

            executeByCommandId(commandId);
            return true;
        },
    });
}

/**
 * @function createVimChineseWordMotionExtension
 * @description Vim 模式下为中文提供 `w` 跳词增强，基于后端分词缓存计算下一跳位置。
 * @param isVimModeEnabled 是否开启 Vim 模式。
 * @param isInsertMode 是否处于 Vim 插入模式。
 * @param getLineTokens 获取当前行分词缓存。
 * @returns CodeMirror DOM 事件扩展。
 */
function createVimChineseWordMotionExtension(
    isVimModeEnabled: () => boolean,
    isInsertMode: (view: EditorView) => boolean,
    isPendingVimCommand: (view: EditorView) => boolean,
    getLineTokens: (lineNumber: number, lineText: string) => ChineseSegmentToken[] | null,
): ReturnType<typeof EditorView.domEventHandlers> {
    const getPendingChineseInnerWordIntent = (view: EditorView): "visual" | "change" | null => {
        try {
            const cmAdapter = getCM(view) as {
                state?: {
                    vim?: {
                        visualMode?: boolean;
                        inputState?: {
                            operator?: string | null;
                            motion?: string | null;
                            motionArgs?: {
                                textObjectInner?: boolean;
                            } | null;
                            keyBuffer?: string[];
                        };
                    };
                };
            };

            const vimState = cmAdapter?.state?.vim;
            if (!vimState) {
                return null;
            }

            const inputState = vimState.inputState;
            const keyBuffer = inputState?.keyBuffer ?? [];
            const hasInnerWordPending =
                (inputState?.motion === "textObjectManipulation" && inputState.motionArgs?.textObjectInner === true) ||
                keyBuffer.includes("i");

            if (!hasInnerWordPending) {
                return null;
            }

            if (vimState.visualMode) {
                return "visual";
            }

            if (inputState?.operator === "change") {
                return "change";
            }

            return null;
        } catch {
            return null;
        }
    };

    const applyChineseInnerWordIntent = (
        view: EditorView,
        intent: "visual" | "change",
        from: number,
        to: number,
    ): boolean => {
        if (to <= from) {
            return false;
        }

        if (intent === "visual") {
            view.dispatch({
                selection: { anchor: from, head: to },
                scrollIntoView: true,
            });
            return true;
        }

        view.dispatch({
            changes: { from, to, insert: "" },
            selection: { anchor: from },
            scrollIntoView: true,
        });

        try {
            const cmAdapter = getCM(view);
            if (cmAdapter) {
                const vimState = (cmAdapter as {
                    state?: {
                        vim?: {
                            inputState?: {
                                keyBuffer?: string[];
                                motion?: string | null;
                                motionArgs?: unknown;
                                operator?: string | null;
                                operatorArgs?: unknown;
                                selectedCharacter?: string | undefined;
                                prefixRepeat?: string[];
                                motionRepeat?: string[];
                            };
                        };
                    };
                }).state?.vim;

                if (vimState?.inputState) {
                    vimState.inputState.keyBuffer = [];
                    vimState.inputState.motion = null;
                    vimState.inputState.motionArgs = null;
                    vimState.inputState.operator = null;
                    vimState.inputState.operatorArgs = null;
                    vimState.inputState.selectedCharacter = undefined;
                    vimState.inputState.prefixRepeat = [];
                    vimState.inputState.motionRepeat = [];
                }

                Vim.handleKey(cmAdapter, "i", "keyboard");
            }
        } catch (error) {
            console.warn("[editor] failed to enter insert mode after chinese ciw", {
                message: error instanceof Error ? error.message : String(error),
            });
        }

        return true;
    };

    return EditorView.domEventHandlers({
        keydown(event, view) {
            if (!isVimModeEnabled()) {
                return false;
            }

            const motionKey = event.key.toLowerCase();
            if (!["w", "b", "e"].includes(motionKey)) {
                return false;
            }

            if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) {
                return false;
            }

            if (isInsertMode(view)) {
                return false;
            }

            if (motionKey === "w") {
                const innerWordIntent = getPendingChineseInnerWordIntent(view);
                if (innerWordIntent) {
                    const cursor = view.state.selection.main.head;
                    const line = view.state.doc.lineAt(cursor);
                    const lineOffset = cursor - line.from;

                    if (containsChineseCharacter(line.text)) {
                        const tokens = getLineTokens(line.number, line.text);
                        const range = getChineseWordRangeAtCursor(line.text, lineOffset, tokens);
                        if (range) {
                            const handled = applyChineseInnerWordIntent(
                                view,
                                innerWordIntent,
                                line.from + range.start,
                                line.from + range.end,
                            );

                            if (handled) {
                                event.preventDefault();
                                event.stopPropagation();
                                return true;
                            }
                        }
                    }
                }
            }

            if (isPendingVimCommand(view)) {
                return false;
            }

            const cursor = view.state.selection.main.head;
            const line = view.state.doc.lineAt(cursor);
            const lineOffset = cursor - line.from;

            if (!containsChineseCharacter(line.text)) {
                return false;
            }

            const tokens = getLineTokens(line.number, line.text);
            const targetOffset = resolveChineseMotionOffset(
                motionKey as "w" | "b" | "e",
                line.text,
                lineOffset,
                tokens,
            );
            if (targetOffset === null) {
                return false;
            }

            const nextCursor = line.from + targetOffset;
            view.dispatch({
                selection: { anchor: nextCursor },
                scrollIntoView: true,
            });

            event.preventDefault();
            event.stopPropagation();
            return true;
        },
    });
}

/**
 * @function addInlineTokenDecoration
 * @description 为行内 token 添加渲染装饰：光标不在 token 内时隐藏标记并应用内容样式。
 * @param builder 装饰构建器。
 * @param lineFrom 当前行起始偏移。
 * @param matchIndex token 在当前行中的起始位置。
 * @param fullText token 完整文本。
 * @param leftMarkerLength 左侧标记长度。
 * @param rightMarkerLength 右侧标记长度。
 * @param contentClass 渲染内容样式类名。
 * @param view 编辑器视图。
 */
function addInlineTokenDecoration(
    ranges: DecorationRange[],
    lineFrom: number,
    matchIndex: number,
    fullText: string,
    leftMarkerLength: number,
    rightMarkerLength: number,
    contentClass: string,
    view: EditorView,
): void {
    if (matchIndex < 0 || fullText.length <= leftMarkerLength + rightMarkerLength) {
        return;
    }

    const tokenFrom = lineFrom + matchIndex;
    const tokenTo = tokenFrom + fullText.length;
    const contentFrom = tokenFrom + leftMarkerLength;
    const contentTo = tokenTo - rightMarkerLength;
    const isEditingToken = view.hasFocus && rangeIntersectsSelection(view.state, tokenFrom, tokenTo);

    if (isEditingToken) {
        return;
    }

    const markerDecoration = Decoration.mark({
        class: "cm-inline-marker-hidden",
    });
    const contentDecoration = Decoration.mark({
        class: contentClass,
    });

    pushDecorationRange(ranges, tokenFrom, contentFrom, markerDecoration);
    pushDecorationRange(ranges, contentFrom, contentTo, contentDecoration);
    pushDecorationRange(ranges, contentTo, tokenTo, markerDecoration);
}

/**
 * @function buildHeaderDecorations
 * @description 为标题构建 WYSIWYG 装饰：非光标行渲染为标题，光标进入时恢复源码。
 * @param view CodeMirror 视图实例。
 * @returns 标题装饰集合。
 */
function buildHeaderDecorations(view: EditorView): DecorationSet {
    const builder = new RangeSetBuilder<Decoration>();
    const ranges: DecorationRange[] = [];
    const activeLineNumber = view.state.doc.lineAt(view.state.selection.main.head).number;

    for (const visibleRange of view.visibleRanges) {
        let currentLine = view.state.doc.lineAt(visibleRange.from);
        const endLineNumber = view.state.doc.lineAt(visibleRange.to).number;

        while (currentLine.number <= endLineNumber) {
            const lineText = currentLine.text;
            const match = lineText.match(HEADER_PATTERN);
            const isEditingCurrentLine = view.hasFocus && currentLine.number === activeLineNumber;

            if (match && !isEditingCurrentLine) {
                const hashes = match[1] ?? "#";
                const level = Math.min(6, Math.max(1, hashes.length));
                const markerLength = hashes.length + 1;
                const markerEnd = Math.min(currentLine.to, currentLine.from + markerLength);

                const markerDecoration = Decoration.mark({
                    class: "cm-header-marker-hidden",
                });
                const headerDecoration = Decoration.mark({
                    class: `cm-rendered-header cm-rendered-header-h${String(level)}`,
                });

                pushDecorationRange(ranges, currentLine.from, markerEnd, markerDecoration);
                pushDecorationRange(ranges, markerEnd, currentLine.to, headerDecoration);
            }

            const boldMatches = Array.from(lineText.matchAll(BOLD_INLINE_PATTERN));
            for (const match of boldMatches) {
                const fullText = match[0] ?? "";
                const delimiter = match[1] ?? "**";
                const matchIndex = match.index ?? -1;
                addInlineTokenDecoration(
                    ranges,
                    currentLine.from,
                    matchIndex,
                    fullText,
                    delimiter.length,
                    delimiter.length,
                    "cm-rendered-bold",
                    view,
                );
            }

            const italicStarMatches = Array.from(lineText.matchAll(ITALIC_STAR_INLINE_PATTERN));
            for (const match of italicStarMatches) {
                const fullText = match[0] ?? "";
                const matchIndex = match.index ?? -1;
                addInlineTokenDecoration(
                    ranges,
                    currentLine.from,
                    matchIndex,
                    fullText,
                    1,
                    1,
                    "cm-rendered-italic",
                    view,
                );
            }

            const italicUnderscoreMatches = Array.from(lineText.matchAll(ITALIC_UNDERSCORE_INLINE_PATTERN));
            for (const match of italicUnderscoreMatches) {
                const fullText = match[0] ?? "";
                const matchIndex = match.index ?? -1;
                addInlineTokenDecoration(
                    ranges,
                    currentLine.from,
                    matchIndex,
                    fullText,
                    1,
                    1,
                    "cm-rendered-italic",
                    view,
                );
            }

            const strikethroughMatches = Array.from(lineText.matchAll(STRIKETHROUGH_INLINE_PATTERN));
            for (const match of strikethroughMatches) {
                const fullText = match[0] ?? "";
                const delimiter = match[1] ?? "~~";
                const matchIndex = match.index ?? -1;
                addInlineTokenDecoration(
                    ranges,
                    currentLine.from,
                    matchIndex,
                    fullText,
                    delimiter.length,
                    delimiter.length,
                    "cm-rendered-strikethrough",
                    view,
                );
            }

            const inlineCodeMatches = Array.from(lineText.matchAll(INLINE_CODE_PATTERN));
            for (const match of inlineCodeMatches) {
                const fullText = match[0] ?? "";
                const delimiter = match[1] ?? "`";
                const matchIndex = match.index ?? -1;
                addInlineTokenDecoration(
                    ranges,
                    currentLine.from,
                    matchIndex,
                    fullText,
                    delimiter.length,
                    delimiter.length,
                    "cm-rendered-inline-code",
                    view,
                );
            }

            const wikiLinkMatches = Array.from(lineText.matchAll(WIKI_LINK_PATTERN));
            for (const match of wikiLinkMatches) {
                const fullText = match[0] ?? "";
                const leftDelimiter = match[1] ?? "[[";
                const rightDelimiter = match[3] ?? "]]";
                const matchIndex = match.index ?? -1;
                addInlineTokenDecoration(
                    ranges,
                    currentLine.from,
                    matchIndex,
                    fullText,
                    leftDelimiter.length,
                    rightDelimiter.length,
                    "cm-rendered-wikilink",
                    view,
                );
            }

            if (currentLine.number === endLineNumber) {
                break;
            }
            currentLine = view.state.doc.line(currentLine.number + 1);
        }
    }

    ranges
        .sort((left, right) => {
            if (left.from !== right.from) {
                return left.from - right.from;
            }
            if (left.to !== right.to) {
                return left.to - right.to;
            }
            return 0;
        })
        .forEach((range) => {
            builder.add(range.from, range.to, range.decoration);
        });

    return builder.finish();
}

/**
 * @constant headerWysiwygExtension
 * @description 标题所见即所得扩展：离开光标渲染、进入光标还原源码。
 */
const headerWysiwygExtension = ViewPlugin.fromClass(
    class {
        decorations: DecorationSet;

        constructor(view: EditorView) {
            this.decorations = buildHeaderDecorations(view);
        }

        update(update: ViewUpdate): void {
            if (update.docChanged || update.selectionSet || update.viewportChanged || update.focusChanged) {
                this.decorations = buildHeaderDecorations(update.view);
            }
        }
    },
    {
        decorations: (plugin) => plugin.decorations,
    },
);

/**
 * @interface EditorStyleOptions
 * @description 编辑器样式配置参数。
 * @field fontFamily - CSS font-family 字符串
 * @field fontSize - 字体大小（px）
 * @field tabSize - Tab 缩进宽度（空格数）
 * @field lineWrapping - 是否开启自动换行
 * @field showLineNumbers - 行号显示模式："off" 隐藏 | "absolute" 绝对行号 | "relative" 相对行号
 */
interface EditorStyleOptions {
    fontFamily: string;
    fontSize: number;
    tabSize: number;
    lineWrapping: boolean;
    showLineNumbers: "off" | "absolute" | "relative";
}

/**
 * @function buildEditorStyleExtensions
 * @description 根据设置构建编辑器样式扩展数组，包括字体、字号、Tab 宽度、换行、行号。
 * @param options 样式配置项。
 * @returns CodeMirror 扩展数组。
 */
function buildEditorStyleExtensions(options: EditorStyleOptions) {
    const extensions = [];

    /* 字体族与字号 — 通过 EditorView.theme 注入 .cm-content 样式 */
    extensions.push(
        EditorView.theme({
            ".cm-content": {
                fontFamily: options.fontFamily,
                fontSize: `${options.fontSize}px`,
            },
        }),
    );

    /* Tab / 缩进宽度 */
    extensions.push(EditorState.tabSize.of(options.tabSize));
    extensions.push(indentUnit.of(" ".repeat(options.tabSize)));

    /* 自动换行 */
    if (options.lineWrapping) {
        extensions.push(EditorView.lineWrapping);
    }

    /* 行号栏 */
    if (options.showLineNumbers === "absolute") {
        extensions.push(lineNumbersExtension());
    } else if (options.showLineNumbers === "relative") {
        extensions.push(createRelativeLineNumbersExtension());
    }
    /* "off" 模式不添加行号扩展 */

    return extensions;
}

/**
 * @function buildDefaultContent
 * @description 根据文件路径构建默认内容。
 * @param filePath 文件路径。
 * @returns 编辑器默认文本。
 */
function buildDefaultContent(filePath: string): string {
    return `# ${filePath.split("/").pop() ?? filePath}\n\n> 这是基于 CodeMirror 6 的编辑器示例内容。\n\n- 支持基础编辑\n- 支持 Markdown 语法高亮\n- 支持后续扩展语言和 LSP`;
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
        "fileTree.copySelected": "Cmd+C",
        "fileTree.pasteInDirectory": "Cmd+V",
        "fileTree.deleteSelected": "Cmd+Backspace",
        "quickSwitcher.open": "Cmd+O",
        "commandPalette.open": "Cmd+J",
    });
    const vimModeEnabledRef = useRef<boolean>(false);
    const currentFilePathRef = useRef<string>(String(props.params.path ?? "未命名.md"));
    const fileNameInputRef = useRef<HTMLInputElement | null>(null);
    const segmentationCacheRef = useRef<Map<number, SegmentationCacheItem>>(new Map());
    const segmentationTimerRef = useRef<number | null>(null);
    const vimModeCompartmentRef = useRef<Compartment>(new Compartment());
    /** 编辑器样式 Compartment：管理字体、字号、Tab 宽度、换行、行号等动态设置 */
    const editorStyleCompartmentRef = useRef<Compartment>(new Compartment());
    const { bindings } = useShortcutState();
    const { files } = useVaultState();
    const { featureSettings } = useConfigState();
    const vimModeEnabled = featureSettings.vimModeEnabled;
    const editorFontFamily = featureSettings.editorFontFamily || DEFAULT_EDITOR_FONT_FAMILY;
    const editorFontSize = featureSettings.editorFontSize;
    const editorTabSize = featureSettings.editorTabSize;
    const editorLineWrapping = featureSettings.editorLineWrapping;
    const editorLineNumbers = featureSettings.editorLineNumbers;

    const [currentFilePath, setCurrentFilePath] = useState<string>(
        String(props.params.path ?? "未命名.md"),
    );
    const [isEditingFileName, setIsEditingFileName] = useState<boolean>(false);
    const [fileNameDraft, setFileNameDraft] = useState<string>(
        String(props.params.path ?? "未命名.md").split("/").pop() ?? "未命名.md",
    );
    const [renameError, setRenameError] = useState<string | null>(null);
    const articleId = props.api.id;

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

    useEffect(() => {
        bindingsRef.current = bindings;
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

    const isVimInsertMode = (view: EditorView): boolean => {
        try {
            const cmAdapter = getCM(view) as {
                state?: {
                    vim?: {
                        insertMode?: boolean;
                    };
                };
            };
            return Boolean(cmAdapter?.state?.vim?.insertMode);
        } catch {
            return false;
        }
    };

    const isPendingVimCommand = (view: EditorView): boolean => {
        try {
            const cmAdapter = getCM(view) as {
                state?: {
                    vim?: {
                        visualMode?: boolean;
                        inputState?: {
                            operator?: unknown;
                            motion?: unknown;
                            keyBuffer?: unknown;
                        };
                    };
                };
            };

            const vimState = cmAdapter?.state?.vim;
            if (!vimState) {
                return false;
            }

            if (Boolean(vimState.visualMode)) {
                return true;
            }

            if (vimState.inputState?.operator || vimState.inputState?.motion) {
                return true;
            }

            const keyBuffer = vimState.inputState?.keyBuffer;
            return Array.isArray(keyBuffer) && keyBuffer.length > 0;
        } catch {
            return false;
        }
    };

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
                createVimChineseWordMotionExtension(
                    () => vimModeEnabledRef.current,
                    isVimInsertMode,
                    isPendingVimCommand,
                    getLineTokens,
                ),
                vimModeCompartmentRef.current.of(vimModeEnabled ? vim() : []),
                basicSetup,
                markdown(),
                createCodeMirrorThemeExtension(),
                editorStyleCompartmentRef.current.of(
                    buildEditorStyleExtensions({
                        fontFamily: editorFontFamily,
                        fontSize: editorFontSize,
                        tabSize: editorTabSize,
                        lineWrapping: editorLineWrapping,
                        showLineNumbers: editorLineNumbers,
                    }),
                ),
                headerWysiwygExtension,
                registeredLineSyntaxRenderExtension,
                createEditorShortcutExtension(
                    () => bindingsRef.current,
                    executeEditorCommand,
                ),
                createWikiLinkNavigationExtension(
                    props.containerApi,
                    () => currentFilePathRef.current,
                ),
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
                }),
            ],
        });

        viewRef.current = new EditorView({
            state,
            parent: hostRef.current,
        });

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
            viewRef.current?.destroy();
            viewRef.current = null;
        };
    }, [initialDoc, articleId, props.containerApi]);

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

    /* 编辑器样式设置动态生效：字体族、字号、Tab 宽度、换行、行号 */
    useEffect(() => {
        const view = viewRef.current;
        if (!view) {
            return;
        }

        view.dispatch({
            effects: editorStyleCompartmentRef.current.reconfigure(
                buildEditorStyleExtensions({
                    fontFamily: editorFontFamily,
                    fontSize: editorFontSize,
                    tabSize: editorTabSize,
                    lineWrapping: editorLineWrapping,
                    showLineNumbers: editorLineNumbers,
                }),
            ),
        });

        console.info("[editor] style settings changed", {
            articleId,
            editorFontFamily,
            editorFontSize,
            editorTabSize,
            editorLineWrapping,
            editorLineNumbers,
        });
    }, [editorFontFamily, editorFontSize, editorTabSize, editorLineWrapping, editorLineNumbers, articleId]);

    const currentFileName = currentFilePath.split("/").pop() ?? currentFilePath;

    const commitFileRename = async (): Promise<void> => {
        const trimmedName = fileNameDraft.trim();
        if (!trimmedName) {
            setRenameError("文件名不能为空");
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
            const message = error instanceof Error ? error.message : "重命名文件失败";
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

    return (
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
    );
}
