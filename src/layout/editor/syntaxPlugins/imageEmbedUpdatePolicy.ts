/**
 * @module layout/editor/syntaxPlugins/imageEmbedUpdatePolicy
 * @description 图片嵌入插件更新判定策略，提供可测试的纯函数，避免异步刷新状态回归。
 * @dependencies
 *  - 无
 */

/**
 * @function shouldRebuildImageEmbedDecorations
 * @description 判断图片嵌入插件是否应重建 decorations。
 * @param context 更新上下文。
 * @param context.docChanged 文档内容是否变化。
 * @param context.selectionSet 选择区是否变化。
 * @param context.viewportChanged 可视区域是否变化。
 * @param context.focusChanged 焦点状态是否变化。
 * @param context.transactionCount 本次 update 内事务数量。
 * @returns 任一触发条件成立返回 true，否则返回 false。
 * @throws 无显式异常；纯函数仅基于输入参数计算。
 */
export function shouldRebuildImageEmbedDecorations(context: {
    docChanged: boolean;
    selectionSet: boolean;
    viewportChanged: boolean;
    focusChanged: boolean;
    transactionCount: number;
}): boolean {
    return (
        context.docChanged ||
        context.selectionSet ||
        context.viewportChanged ||
        context.focusChanged ||
        context.transactionCount > 0
    );
}
