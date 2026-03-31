/**
 * @module plugins/markdown-codemirror/editor/lineNumbersModeExtension
 * @description 编辑器行号模式扩展构建器。
 *   该模块把 `off | absolute | relative` 三种行号模式收敛为统一扩展工厂，
 *   供 CodeMirror EditorView 在初始化和动态重配置时复用。
 *
 * @dependencies
 *  - @codemirror/view
 *  - @codemirror/state
 *  - ./relativeLineNumbersExtension
 *
 * @usage
 * ```ts
 * import { buildLineNumbersExtension } from "./lineNumbersModeExtension";
 *
 * const extension = buildLineNumbersExtension("relative");
 * ```
 *
 * @exports
 *  - buildLineNumbersExtension - 根据模式返回对应的 CodeMirror Extension
 */

import type { Extension } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";
import { createRelativeLineNumbersExtension } from "./relativeLineNumbersExtension";

/**
 * @function buildLineNumbersExtension
 * @description 根据行号模式构建 CM6 行号相关扩展。
 *   - `off`：通过 theme 隐藏 gutter
 *   - `absolute`：启用默认绝对行号
 *   - `relative`：启用相对行号
 *
 * @param mode 行号显示模式。
 * @returns 对应的 CodeMirror Extension。
 */
export function buildLineNumbersExtension(
    mode: "off" | "absolute" | "relative",
): Extension {
    switch (mode) {
        case "off":
            return [
                lineNumbers(),
                /* theme-guard-ignore-next-line: 这里是实例级 gutter 显隐控制，不属于静态主题定义。 */
                EditorView.theme({
                    ".cm-gutters": { display: "none !important" },
                }),
            ];
        case "relative":
            return createRelativeLineNumbersExtension();
        case "absolute":
        default:
            return lineNumbers();
    }
}