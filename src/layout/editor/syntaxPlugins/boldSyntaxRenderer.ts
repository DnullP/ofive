/**
 * @module layout/editor/syntaxPlugins/boldSyntaxRenderer
 * @description Bold 行内语法渲染插件：支持 `**text**` 与 `__text__`。
 * @dependencies
 *  - ../syntaxRenderRegistry
 */

import { addDelimitedInlineSyntaxDecoration, registerLineSyntaxRenderer } from "../syntaxRenderRegistry";

const BOLD_INLINE_PATTERN = /(\*\*|__)(?=\S)(.+?)(?<=\S)\1/g;

/**
 * @function registerBoldSyntaxRenderer
 * @description 注册 Bold 渲染插件。
 */
export function registerBoldSyntaxRenderer(): void {
    registerLineSyntaxRenderer({
        id: "inline-bold",
        applyLineDecorations(context) {
            const matches = Array.from(context.lineText.matchAll(BOLD_INLINE_PATTERN));
            matches.forEach((match) => {
                const fullText = match[0] ?? "";
                const delimiter = match[1] ?? "**";
                const matchIndex = match.index ?? -1;

                addDelimitedInlineSyntaxDecoration(
                    context,
                    matchIndex,
                    fullText,
                    delimiter.length,
                    delimiter.length,
                    "cm-rendered-bold",
                );
            });
        },
    });
}
