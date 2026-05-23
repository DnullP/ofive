/**
 * @module plugins/markdown-codemirror/editor/syntaxPlugins/headerSyntaxRenderer
 * @description Header 语法渲染插件：选区未命中时渲染标题样式，选区命中时回退源码并保持正文对齐。
 * @dependencies
 *  - @codemirror/view
 *  - ../syntaxRenderRegistry
 */

import { Decoration } from "@codemirror/view";
import {
    pushLineSyntaxDecoration,
    pushSyntaxDecorationRange,
    rangeIntersectsSelection,
    registerLineSyntaxRenderer,
    type LineSyntaxDecorationContext,
} from "../syntaxRenderRegistry";

const HEADER_PATTERN = /^(#{1,6})\s+(.+)$/;

/**
 * @function applyHeaderLineDecorations
 * @description 为单行标题应用装饰。标题行被选中时回退源码，同时让标题文字沿用渲染态起点。
 * @param context 语法渲染上下文。
 */
export function applyHeaderLineDecorations(context: LineSyntaxDecorationContext): void {
    const match = context.lineText.match(HEADER_PATTERN);
    if (!match) {
        return;
    }

    const lineEnd = context.lineFrom + context.lineText.length;
    const isEditing = rangeIntersectsSelection(context.view, context.lineFrom, lineEnd);

    const hashes = match[1] ?? "#";
    const level = Math.min(6, Math.max(1, hashes.length));
    const markerLength = hashes.length + 1;
    const markerEnd = context.lineFrom + Math.min(context.lineText.length, markerLength);

    if (isEditing) {
        pushSyntaxDecorationRange(
            context.ranges,
            context.lineFrom,
            markerEnd,
            Decoration.mark({
                class: `cm-rendered-header-source-marker cm-rendered-header-source-marker-h${String(level)}`,
            }),
        );
        pushLineSyntaxDecoration(
            context.ranges,
            context.lineFrom,
            Decoration.line({
                class: `cm-rendered-header-source-line cm-rendered-header-h${String(level)}`,
            }),
        );
        return;
    }

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
    pushLineSyntaxDecoration(
        context.ranges,
        context.lineFrom,
        Decoration.line({
            class: `cm-rendered-header-line cm-rendered-header-line-h${String(level)}`,
        }),
    );
}

/**
 * @function registerHeaderSyntaxRenderer
 * @description 注册 Header 渲染插件。
 */
export function registerHeaderSyntaxRenderer(): void {
    registerLineSyntaxRenderer({
        id: "header-line",
        applyLineDecorations: applyHeaderLineDecorations,
        allowComposingSelectionLine: true,
    });
}
