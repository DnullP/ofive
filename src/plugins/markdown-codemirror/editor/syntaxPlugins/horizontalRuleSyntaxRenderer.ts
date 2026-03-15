/**
 * @module plugins/markdown-codemirror/editor/syntaxPlugins/horizontalRuleSyntaxRenderer
 * @description 水平分割线语法渲染插件：为 `---`、`***`、`___` 行渲染分割线样式。
 *   非编辑态下用装饰类渲染为可视化分割线。
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

/** 匹配独占整行的水平分割线语法：--- / *** / ___ (至少三个连续字符) */
const HR_PATTERN = /^(\s*)([-*_])\2{2,}\s*$/;

/**
 * @function registerHorizontalRuleSyntaxRenderer
 * @description 注册水平分割线渲染插件。
 *   编辑态下回退源码，非编辑态下渲染为分割线。
 */
export function registerHorizontalRuleSyntaxRenderer(): void {
    registerLineSyntaxRenderer({
        id: "horizontal-rule-line",
        applyLineDecorations(context) {
            const match = context.lineText.match(HR_PATTERN);
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

            pushSyntaxDecorationRange(
                context.ranges,
                context.lineFrom,
                lineEnd,
                Decoration.mark({ class: "cm-rendered-horizontal-rule" }),
            );
        },
    });
}
