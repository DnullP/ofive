/**
 * @module plugins/markdown-codemirror/editor/syntaxPlugins/codeBlockSyntaxRenderer
 * @description 围栏代码块语法渲染插件：为 ``` 围栏代码块添加背景装饰。
 *   非编辑态下为围栏行和内容行施加背景样式类，编辑态回退源码。
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

/** 匹配围栏起始行 ``` 或 ~~~（可带语言标识） */
const FENCE_OPEN_PATTERN = /^(`{3,}|~{3,})(\s*\S*)\s*$/;
/** 匹配围栏结束行 ``` 或 ~~~ */
const FENCE_CLOSE_PATTERN = /^(`{3,}|~{3,})\s*$/;

/**
 * 跨行状态：记录当前是否处于围栏代码块内。
 * 由于 syntaxRenderRegistry 按行调用，我们用 view → 状态映射来跟踪跨行上下文。
 */
const fenceState = new WeakMap<object, { inFence: boolean; fenceChar: string; lastDocLength: number }>();

/**
 * @function registerCodeBlockSyntaxRenderer
 * @description 注册围栏代码块渲染插件。
 *   为围栏标记行和代码内容行添加背景装饰样式。
 */
export function registerCodeBlockSyntaxRenderer(): void {
    registerLineSyntaxRenderer({
        id: "code-block",
        applyLineDecorations(context) {
            const docLength = context.view.state.doc.length;
            let state = fenceState.get(context.view);

            /* 每次文档发生变化或处于首行时重置状态 */
            if (!state || state.lastDocLength !== docLength) {
                state = { inFence: false, fenceChar: "", lastDocLength: docLength };
                fenceState.set(context.view, state);
            }

            /* 如果此行是整个文档的第一行，重置 inFence */
            if (context.lineFrom === 0) {
                state.inFence = false;
                state.fenceChar = "";
            }

            const lineEnd = context.lineFrom + context.lineText.length;

            if (!state.inFence) {
                /* 尝试匹配围栏开始 */
                const openMatch = context.lineText.match(FENCE_OPEN_PATTERN);
                if (openMatch) {
                    state.inFence = true;
                    state.fenceChar = (openMatch[1] ?? "```").charAt(0);

                    const isEditing = rangeIntersectsSelection(context.view, context.lineFrom, lineEnd);
                    if (!isEditing) {
                        pushSyntaxDecorationRange(
                            context.ranges,
                            context.lineFrom,
                            lineEnd,
                            Decoration.mark({ class: "cm-rendered-code-block-fence" }),
                        );
                    }
                }
            } else {
                /* 在围栏内部 */
                const closeMatch = context.lineText.match(FENCE_CLOSE_PATTERN);
                const isClosingFence =
                    closeMatch &&
                    (closeMatch[1] ?? "").charAt(0) === state.fenceChar;

                if (isClosingFence) {
                    state.inFence = false;

                    const isEditing = rangeIntersectsSelection(context.view, context.lineFrom, lineEnd);
                    if (!isEditing) {
                        pushSyntaxDecorationRange(
                            context.ranges,
                            context.lineFrom,
                            lineEnd,
                            Decoration.mark({ class: "cm-rendered-code-block-fence" }),
                        );
                    }
                } else {
                    /* 代码内容行 */
                    if (context.lineText.length > 0) {
                        pushSyntaxDecorationRange(
                            context.ranges,
                            context.lineFrom,
                            lineEnd,
                            Decoration.mark({ class: "cm-rendered-code-block-content" }),
                        );
                    }
                }
            }
        },
    });
}
