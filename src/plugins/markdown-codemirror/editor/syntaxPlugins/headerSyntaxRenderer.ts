/**
 * @module plugins/markdown-codemirror/editor/syntaxPlugins/headerSyntaxRenderer
 * @description Header 语法渲染插件：选区未命中时渲染标题样式，选区命中时回退源码。
 * @dependencies
 *  - @codemirror/view
 *  - ../syntaxRenderRegistry
 */

import { Decoration } from "@codemirror/view";
import { pushSyntaxDecorationRange, rangeIntersectsSelection, registerLineSyntaxRenderer } from "../syntaxRenderRegistry";

const HEADER_PATTERN = /^(#{1,6})\s+(.+)$/;

/**
 * @function registerHeaderSyntaxRenderer
 * @description 注册 Header 渲染插件。
 *   当编辑器有焦点且选区与标题行重叠时回退源码，否则渲染标题样式。
 */
export function registerHeaderSyntaxRenderer(): void {
    registerLineSyntaxRenderer({
        id: "header-line",
        applyLineDecorations(context) {
            const match = context.lineText.match(HEADER_PATTERN);
            if (!match) {
                return;
            }

            const lineEnd = context.lineFrom + context.lineText.length;
            const isEditing = context.view.hasFocus
                && rangeIntersectsSelection(context.view, context.lineFrom, lineEnd);

            const hashes = match[1] ?? "#";
            const level = Math.min(6, Math.max(1, hashes.length));
            const markerLength = hashes.length + 1;
            const markerEnd = context.lineFrom + Math.min(context.lineText.length, markerLength);

            if (isEditing) {
                // While editing we want to show the raw source (including hashes),
                // but preserve the visual header styling (font, size, weight).
                // Apply a mark to the whole line that keeps the rendered header
                // appearance without replacing or hiding the source characters.
                pushSyntaxDecorationRange(
                    context.ranges,
                    context.lineFrom,
                    context.lineFrom + context.lineText.length,
                    Decoration.mark({ class: `cm-rendered-header cm-rendered-header-h${String(level)} cm-rendered-header-source` }),
                );

                return;
            }

            // Not editing: hide the marker and render the rest as a styled header.
            pushSyntaxDecorationRange(
                context.ranges,
                context.lineFrom,
                markerEnd,
                Decoration.replace({}),
            );
            pushSyntaxDecorationRange(
                context.ranges,
                markerEnd,
                context.lineFrom + context.lineText.length,
                Decoration.mark({ class: `cm-rendered-header cm-rendered-header-h${String(level)}` }),
            );
        },
    });
}
