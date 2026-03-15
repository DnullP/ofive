/**
 * @module plugins/markdown-codemirror/editor/syntaxPlugins/blockquoteSyntaxRenderer
 * @description Blockquote 行语法渲染插件：为 `> ` 开头的行渲染引用样式。
 *   非编辑态下隐藏 `> ` 前缀标记，并给内容区添加渲染样式类。
 * @dependencies
 *  - @codemirror/view
 *  - ../syntaxRenderRegistry
 */

import { Decoration } from "@codemirror/view";
import {
    pushSyntaxDecorationRange,
    rangeIntersectsSelection,
    registerLineSyntaxRenderer,
} from "../syntaxRenderRegistry";

/** 匹配 `> ` 开头的引用行（支持多级 `>> `、`>>> ` 等） */
const BLOCKQUOTE_PATTERN = /^((?:>\s*)+)(.*)$/;

/**
 * @function registerBlockquoteSyntaxRenderer
 * @description 注册 Blockquote 渲染插件。
 *   编辑态下回退源码，非编辑态下隐藏 `> ` 标记并高亮内容。
 */
export function registerBlockquoteSyntaxRenderer(): void {
    registerLineSyntaxRenderer({
        id: "blockquote-line",
        applyLineDecorations(context) {
            const match = context.lineText.match(BLOCKQUOTE_PATTERN);
            if (!match) {
                return;
            }

            const lineEnd = context.lineFrom + context.lineText.length;
            const isEditing =
                context.view.hasFocus &&
                rangeIntersectsSelection(context.view, context.lineFrom, lineEnd);
            if (isEditing) {
                return;
            }

            const marker = match[1] ?? ">";
            const markerEnd = context.lineFrom + marker.length;

            /* 隐藏 `> ` 前缀标记 */
            pushSyntaxDecorationRange(
                context.ranges,
                context.lineFrom,
                markerEnd,
                Decoration.replace({}),
            );

            /* 给内容区添加引用样式 */
            if (markerEnd < lineEnd) {
                pushSyntaxDecorationRange(
                    context.ranges,
                    markerEnd,
                    lineEnd,
                    Decoration.mark({ class: "cm-rendered-blockquote" }),
                );
            }
        },
    });
}
