/**
 * @module plugins/markdown-codemirror/editor/syntaxPlugins/tagSyntaxRenderer
 * @description Tag 行内语法渲染插件：支持 `#123`（`#` 后无空格）。
 * @dependencies
 *  - ../syntaxRenderRegistry
 */

import { registerLineSyntaxRenderer, pushSyntaxDecorationRange } from "../syntaxRenderRegistry";
import { Decoration } from "@codemirror/view";

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

/**
 * 基于 tag 内容计算颜色样式
 * 返回 background / border / text 三色供 inline style 使用
 */
function computeTagColorStyles(tag: string): { background: string; border: string; text: string } {
    // 两次哈希：一个用于 hue，另一个用于驱动 saturation/lightness 变化
    let h = 0;
    let v = 0;
    for (let i = 0; i < tag.length; i++) {
        const code = tag.charCodeAt(i);
        h = (h * 31 + code) | 0;
        v = (v * 131 + code) | 0;
    }
    h = Math.abs(h) % 360;
    v = Math.abs(v) % 100; // 0..99

    // 放宽饱和度与亮度的变化范围以提高差异度
    // saturation: 50% - 95%
    const sat = 50 + Math.round((v / 99) * 45);
    // background lightness: 92% (very light) down to 56% (darker)
    const lightBg = 92 - Math.round((v / 99) * 36);
    // border slightly darker than background
    const borderLight = Math.max(22, lightBg - 14);
    // text should be dark enough for contrast: map to 12% - 28%
    const textLight = 12 + Math.round((1 - v / 99) * 16);

    // 给予背景与边框一定透明度，文本保持不透明以确保可读性
    const bgAlpha = 0.85;
    const borderAlpha = 0.9;
    const background = `hsl(${h} ${sat}% ${lightBg}% / ${bgAlpha})`;
    const border = `hsl(${h} ${Math.max(30, sat - 10)}% ${borderLight}% / ${borderAlpha})`;
    const text = `hsl(${h} ${Math.max(10, sat - 40)}% ${textLight}%)`;
    return { background, border, text };
}
