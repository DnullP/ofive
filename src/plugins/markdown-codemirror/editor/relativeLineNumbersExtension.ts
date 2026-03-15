/**
 * @module plugins/markdown-codemirror/editor/relativeLineNumbersExtension
 * @description 相对行号 CM6 扩展：在编辑器行号栏中显示当前行的绝对行号，
 *   其余行显示与光标行的距离（差值绝对值），与 Vim `set relativenumber` 行为一致。
 *
 * @dependencies
 *  - @codemirror/view (lineNumbers, EditorView)
 *  - @codemirror/state (EditorState)
 *
 * @usage
 * ```ts
 * import { createRelativeLineNumbersExtension } from "./relativeLineNumbersExtension";
 * // 在 EditorView extensions 中使用：
 * extensions: [createRelativeLineNumbersExtension()]
 * ```
 *
 * @exports
 *  - createRelativeLineNumbersExtension — 返回 CM6 Extension，启用相对行号
 *
 * 注意：
 *  - 对于通过 `cm-hidden-block-line`（height:0 + overflow:hidden）隐藏的行（如 frontmatter），
 *    行号虽然会被计算，但因其 gutter 元素同样被隐藏，用户不可见，不影响体验。
 *  - 光标行始终显示绝对行号，方便定位；其余可见行显示与光标行的距离。
 */

import type { Extension } from "@codemirror/state";
import { lineNumbers } from "@codemirror/view";

/**
 * @function createRelativeLineNumbersExtension
 * @description 创建相对行号扩展。
 *   - 光标所在行：显示绝对行号（如第 42 行显示 "42"）
 *   - 其余行：显示与光标行的距离绝对值（如距离 3 行显示 "3"）
 *
 * @returns CM6 Extension 实例。
 *
 * 实现说明：
 *   利用 `lineNumbers({ formatNumber })` 的回调在每次 gutter 渲染时计算
 *   光标所在文档行号，再对每行计算与光标行的距离。
 *   CM6 在光标移动（selection change）时会触发 view update，gutter 会重新
 *   调用 `formatNumber` 并比较前后 GutterMarker 文本决定是否更新 DOM。
 */
export function createRelativeLineNumbersExtension(): Extension {
    return lineNumbers({
        formatNumber(lineNo: number, state): string {
            /* 获取主选区光标所在文档行号（1-based） */
            const cursorLine = state.doc.lineAt(
                state.selection.main.head,
            ).number;

            /* 光标所在行显示绝对行号，其余行显示距离 */
            if (lineNo === cursorLine) {
                return String(lineNo);
            }
            return String(Math.abs(lineNo - cursorLine));
        },
    });
}
