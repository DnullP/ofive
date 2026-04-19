/**
 * @module plugins/markdown-codemirror/editor/syntaxPlugins/linkSyntaxRenderer
 * @description 超链接行内语法渲染插件：支持 `[text](url)` Markdown 链接语法。
 *   非编辑态下隐藏 `[`, `](url)` 标记，仅渲染链接文本并添加链接样式。
 * @dependencies
 *  - ../syntaxRenderRegistry
 */

import { Decoration } from "@codemirror/view";
import {
    pushSyntaxDecorationRange,
    rangeIntersectsSelection,
    registerLineSyntaxRenderer,
} from "../syntaxRenderRegistry";

/** 匹配 `[text](url)` 链接语法，不匹配图片 `![alt](url)` */
const LINK_PATTERN = /(?<!!)\[([^\]]+?)\]\(([^)]+?)\)/g;

/**
 * @function registerLinkSyntaxRenderer
 * @description 注册 Markdown 链接渲染插件。
 *   编辑态下回退源码，非编辑态下隐藏标记仅显示链接文本。
 */
export function registerLinkSyntaxRenderer(): void {
    registerLineSyntaxRenderer({
        id: "inline-link",
        applyLineDecorations(context) {
            const matches = Array.from(context.lineText.matchAll(LINK_PATTERN));
            matches.forEach((match) => {
                const fullText = match[0] ?? "";
                const linkText = match[1] ?? "";
                const matchIndex = match.index ?? -1;
                if (matchIndex < 0 || linkText.length === 0) {
                    return;
                }

                const tokenFrom = context.lineFrom + matchIndex;
                const tokenTo = tokenFrom + fullText.length;
                const isEditingToken = rangeIntersectsSelection(context.view, tokenFrom, tokenTo);
                if (isEditingToken) {
                    return;
                }

                /* 隐藏左侧 `[` */
                const leftBracketEnd = tokenFrom + 1;
                pushSyntaxDecorationRange(
                    context.ranges,
                    tokenFrom,
                    leftBracketEnd,
                    Decoration.replace({}),
                );

                /* 链接文本区域添加样式 */
                const textEnd = leftBracketEnd + linkText.length;
                pushSyntaxDecorationRange(
                    context.ranges,
                    leftBracketEnd,
                    textEnd,
                    Decoration.mark({ class: "cm-rendered-link" }),
                );

                /* 隐藏右侧 `](url)` */
                pushSyntaxDecorationRange(
                    context.ranges,
                    textEnd,
                    tokenTo,
                    Decoration.replace({}),
                );
            });
        },
    });
}
