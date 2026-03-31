/**
 * @module plugins/markdown-codemirror/editor/syntaxPlugins/tagSyntaxRenderer
 * @description Tag 行内语法渲染插件：支持 `#123`（`#` 后无空格）。
 * @dependencies
 *  - ../syntaxRenderRegistry
 */

import { registerLineSyntaxRenderer, pushSyntaxDecorationRange } from "../syntaxRenderRegistry";
import { Decoration } from "@codemirror/view";
import { computeTagColorStyles } from "../utils/tagColor";

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
                const tokenFrom = context.lineFrom + tokenStartInLine;
                const tokenTo = tokenFrom + tokenFullText.length;

                // 根据 tag 文本生成确定性的颜色，保证相同 tag 全局颜色一致
                const styles = computeTagColorStyles(tagText.slice(1));
                const styleAttr = `background:${styles.background};border-color:${styles.border};color:${styles.text}`;

                pushSyntaxDecorationRange(
                    context.ranges,
                    tokenFrom,
                    tokenTo,
                    Decoration.mark({
                        class: "cm-rendered-tag",
                        attributes: { style: styleAttr },
                    }),
                );
            });
        },
    });
}

// computeTagColorStyles is provided by ../utils/tagColor
