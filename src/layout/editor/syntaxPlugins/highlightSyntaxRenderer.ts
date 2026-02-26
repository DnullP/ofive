/**
 * @module layout/editor/syntaxPlugins/highlightSyntaxRenderer
 * @description 高亮行内语法渲染插件：支持 `==text==` 标记高亮。
 *   非编辑态下隐藏 `==` 标记并对内容添加高亮背景。
 * @dependencies
 *  - ../syntaxRenderRegistry
 */

import { addDelimitedInlineSyntaxDecoration, registerLineSyntaxRenderer } from "../syntaxRenderRegistry";

/** 匹配 `==text==` 高亮语法 */
const HIGHLIGHT_INLINE_PATTERN = /(==)(?=\S)(.+?)(?<=\S)\1/g;

/**
 * @function registerHighlightSyntaxRenderer
 * @description 注册高亮渲染插件。
 */
export function registerHighlightSyntaxRenderer(): void {
    registerLineSyntaxRenderer({
        id: "inline-highlight",
        applyLineDecorations(context) {
            const matches = Array.from(context.lineText.matchAll(HIGHLIGHT_INLINE_PATTERN));
            matches.forEach((match) => {
                const fullText = match[0] ?? "";
                const delimiter = match[1] ?? "==";
                const matchIndex = match.index ?? -1;

                addDelimitedInlineSyntaxDecoration(
                    context,
                    matchIndex,
                    fullText,
                    delimiter.length,
                    delimiter.length,
                    "cm-rendered-highlight",
                );
            });
        },
    });
}
