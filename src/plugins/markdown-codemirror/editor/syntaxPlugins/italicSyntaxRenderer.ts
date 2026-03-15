/**
 * @module plugins/markdown-codemirror/editor/syntaxPlugins/italicSyntaxRenderer
 * @description Italic 行内语法渲染插件：支持 `*text*` 与 `_text_`。
 * @dependencies
 *  - ../syntaxRenderRegistry
 */

import { addDelimitedInlineSyntaxDecoration, registerLineSyntaxRenderer } from "../syntaxRenderRegistry";

const ITALIC_STAR_INLINE_PATTERN = /(?<!\*)\*(?=\S)(.+?)(?<=\S)\*(?!\*)/g;
const ITALIC_UNDERSCORE_INLINE_PATTERN = /(?<!_)_(?=\S)(.+?)(?<=\S)_(?!_)/g;

/**
 * @function registerItalicSyntaxRenderer
 * @description 注册 Italic 渲染插件。
 */
export function registerItalicSyntaxRenderer(): void {
    registerLineSyntaxRenderer({
        id: "inline-italic",
        applyLineDecorations(context) {
            const starMatches = Array.from(context.lineText.matchAll(ITALIC_STAR_INLINE_PATTERN));
            starMatches.forEach((match) => {
                const fullText = match[0] ?? "";
                const matchIndex = match.index ?? -1;
                addDelimitedInlineSyntaxDecoration(
                    context,
                    matchIndex,
                    fullText,
                    1,
                    1,
                    "cm-rendered-italic",
                );
            });

            const underscoreMatches = Array.from(context.lineText.matchAll(ITALIC_UNDERSCORE_INLINE_PATTERN));
            underscoreMatches.forEach((match) => {
                const fullText = match[0] ?? "";
                const matchIndex = match.index ?? -1;
                addDelimitedInlineSyntaxDecoration(
                    context,
                    matchIndex,
                    fullText,
                    1,
                    1,
                    "cm-rendered-italic",
                );
            });
        },
    });
}
