/**
 * @module layout/editor/syntaxPlugins/tagSyntaxRenderer
 * @description Tag 行内语法渲染插件：支持 `#123`（`#` 后无空格）。
 * @dependencies
 *  - ../syntaxRenderRegistry
 */

import { addInlineSyntaxDecoration, registerLineSyntaxRenderer } from "../syntaxRenderRegistry";

const TAG_PATTERN = /(^|[\s([{])(#(?!\s)[\p{L}\p{N}_-]+)/gu;

/**
 * @function registerTagSyntaxRenderer
 * @description 注册 Tag 渲染插件。
 */
export function registerTagSyntaxRenderer(): void {
    registerLineSyntaxRenderer({
        id: "inline-tag",
        applyLineDecorations(context) {
            const matches = Array.from(context.lineText.matchAll(TAG_PATTERN));
            matches.forEach((match) => {
                const fullText = match[0] ?? "";
                const prefix = match[1] ?? "";
                const tagText = match[2] ?? "";
                const matchIndex = match.index ?? -1;
                if (matchIndex < 0 || tagText.length === 0) {
                    return;
                }

                const tokenStartInLine = matchIndex + prefix.length;
                const tokenFullText = fullText.slice(prefix.length);

                addInlineSyntaxDecoration(
                    context,
                    tokenStartInLine,
                    tokenFullText,
                    "cm-rendered-tag",
                );
            });
        },
    });
}
