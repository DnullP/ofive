/**
 * @module layout/editor/syntaxPlugins/strikethroughSyntaxRenderer
 * @description Strikethrough 行内语法渲染插件：支持 `~~text~~`。
 * @dependencies
 *  - ../syntaxRenderRegistry
 */

import { addDelimitedInlineSyntaxDecoration, registerLineSyntaxRenderer } from "../syntaxRenderRegistry";

const STRIKETHROUGH_INLINE_PATTERN = /(~~)(?=\S)(.+?)(?<=\S)\1/g;

/**
 * @function registerStrikethroughSyntaxRenderer
 * @description 注册 Strikethrough 渲染插件。
 */
export function registerStrikethroughSyntaxRenderer(): void {
    registerLineSyntaxRenderer({
        id: "inline-strikethrough",
        applyLineDecorations(context) {
            const matches = Array.from(context.lineText.matchAll(STRIKETHROUGH_INLINE_PATTERN));
            matches.forEach((match) => {
                const fullText = match[0] ?? "";
                const delimiter = match[1] ?? "~~";
                const matchIndex = match.index ?? -1;

                addDelimitedInlineSyntaxDecoration(
                    context,
                    matchIndex,
                    fullText,
                    delimiter.length,
                    delimiter.length,
                    "cm-rendered-strikethrough",
                );
            });
        },
    });
}
