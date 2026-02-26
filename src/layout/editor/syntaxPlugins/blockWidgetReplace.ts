/**
 * @module layout/editor/syntaxPlugins/blockWidgetReplace
 * @description 多行块级 Widget 替换工具：为将多行文档内容替换为单个可视化组件的场景提供通用方案。
 *
 * 核心思路：
 * 1. 使用 `Decoration.line` 为源码行添加隐藏样式类（CSS `height:0` 等），使内容不可见。
 *    对应的 gutter 元素由 CM6 自动同步为 0 高度，配合 CSS `overflow:hidden` 裁剪溢出行号。
 * 2. 使用 `Decoration.widget` 在隐藏行之后插入可视化组件。
 * 3. 使用 `EditorView.atomicRanges` 将隐藏范围标记为原子区域，
 *    使光标在键盘导航时自动跳过，不会进入源码区域。
 *
 * 注意：
 * - Widget 使用 `block: false`（行内模式），不使用 `block: true`。
 *   因为 `block: true` 会改变 CM6 的 block tree，在 EditorView 构造/销毁的
 *   React 生命周期窗口中触发 `cursorLayer.markers` 在 `docView` 未就绪时
 *   调用 `coordsAtPos`，导致空引用异常。
 * - 不使用 `gutterLineClass` + `StateField`/`GutterMarker`，原因同上。
 *   gutter 行号隠藏通过 CSS `overflow: hidden` 实现。
 *
 * @dependencies
 *  - @codemirror/state
 *  - @codemirror/view
 *
 * @example
 *   // 在 ViewPlugin 的 buildDecorations 中，隐藏源码行并添加 widget：
 *   import { hiddenBlockLineDecoration } from "./blockWidgetReplace";
 *   for (let ln = startLine; ln <= endLine; ln++) {
 *     builder.add(doc.line(ln).from, doc.line(ln).from, hiddenBlockLineDecoration);
 *   }
 *   builder.add(afterPos, afterPos, Decoration.widget({ widget, block: false, side: -1 }));
 *
 *   // 创建扩展时，组合 atomicRanges：
 *   import { createBlockAtomicRangesExtension } from "./blockWidgetReplace";
 *   return [plugin, createBlockAtomicRangesExtension(computeRange)];
 *
 * @exports
 *  - hiddenBlockLineDecoration: 源码行隐藏装饰（Decoration.line）
 *  - createBlockAtomicRangesExtension: 原子范围扩展工厂
 *  - BlockRange: 范围接口
 */

import { RangeSet } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import { Decoration, EditorView } from "@codemirror/view";

/**
 * @interface BlockRange
 * @description 块级替换范围。
 */
export interface BlockRange {
    /** 范围起始偏移（闭区间）。 */
    from: number;
    /** 范围结束偏移（开区间）。 */
    to: number;
}

/**
 * 源码行隐藏装饰：为被替换的源码行添加 CSS 类，通过样式将行高设为 0 使内容不可见。
 * 对应的 gutter 元素由 CM6 同步为 0 高度，配合 `.cm-gutterElement { overflow:hidden }`
 * 确保行号文本不溢出。
 * 配合样式 `.cm-hidden-block-line { height:0; overflow:hidden; ... }`。
 */
export const hiddenBlockLineDecoration: Decoration = Decoration.line({
    class: "cm-hidden-block-line",
});

/** 原子范围标记：仅用于 RangeSet 占位，值本身不被使用。 */
const atomicRangeMarker = Decoration.mark({});

/**
 * @function createBlockAtomicRangesExtension
 * @description 创建原子范围扩展：将隐藏范围标记为原子区域，防止光标进入被隐藏的源码范围。
 * 当光标因键盘导航（如 Cmd+Home、方向键）试图进入原子区域时，
 * CodeMirror 6 会自动将光标跳到区域边界。
 *
 * @param computeRange 计算当前需要原子化的范围的回调，返回 null 表示无范围。
 * @returns CodeMirror Extension。
 * @throws 无显式异常。
 */
export function createBlockAtomicRangesExtension(
    computeRange: (view: EditorView) => BlockRange | null,
): Extension {
    return EditorView.atomicRanges.of((view) => {
        const range = computeRange(view);
        if (!range) {
            return RangeSet.empty;
        }

        return RangeSet.of([atomicRangeMarker.range(range.from, range.to)]);
    });
}
