/**
 * @module layout/editor/syntaxPlugins/inlineCodeSyntaxRenderer
 * @description Inline Code 行内语法渲染插件：支持 `` `code` ``。
 * @dependencies
 *  - ../syntaxRenderRegistry
 */

import { addDelimitedInlineSyntaxDecoration, registerLineSyntaxRenderer } from "../syntaxRenderRegistry";

const INLINE_CODE_PATTERN = /(`)([^`\n]+?)\1/g;

/**
 * @function registerInlineCodeSyntaxRenderer
 * @description 注册 Inline Code 渲染插件。
 */
export function registerInlineCodeSyntaxRenderer(): void {
    registerLineSyntaxRenderer({
        id: "inline-code",
        applyLineDecorations(context) {
            const matches = Array.from(context.lineText.matchAll(INLINE_CODE_PATTERN));
            matches.forEach((match) => {
                const fullText = match[0] ?? "";
                const delimiter = match[1] ?? "`";
                const matchIndex = match.index ?? -1;

                addDelimitedInlineSyntaxDecoration(
                    context,
                    matchIndex,
                    fullText,
                    delimiter.length,
                    delimiter.length,
                    "cm-rendered-inline-code",
                );
            });
        },
    });
}
