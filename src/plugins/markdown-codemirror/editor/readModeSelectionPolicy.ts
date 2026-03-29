/**
 * @module plugins/markdown-codemirror/editor/readModeSelectionPolicy
 * @description 阅读态文本选择策略模块：判断当前点击是否属于文本选区收尾操作，从而避免抢占文本选择。
 * @dependencies
 *  - 无
 */

/**
 * @interface SelectionRangeLike
 * @description 最小选区 range 接口，用于判断是否与当前目标节点相交。
 */
export interface SelectionRangeLike {
    /** 判断该 range 是否与当前点击目标相交。 */
    intersectsNode: (node: Node) => boolean;
}

/**
 * @interface SelectionLike
 * @description 最小 Selection 接口。
 */
export interface SelectionLike {
    /** 选区是否折叠。 */
    isCollapsed: boolean;
    /** 当前 range 数量。 */
    rangeCount: number;
    /** 读取指定 range。 */
    getRangeAt: (index: number) => SelectionRangeLike;
}

/**
 * @function shouldSkipWikiLinkNavigationForSelection
 * @description 当用户拖拽选择了当前链接中的文本时，阻止阅读态 WikiLink 导航。
 * @param selection 浏览器选区对象。
 * @param linkNode 当前点击的链接节点。
 * @returns 当前点击属于文本选择流程时返回 true。
 */
export function shouldSkipWikiLinkNavigationForSelection(
    selection: SelectionLike | null | undefined,
    linkNode: Node,
): boolean {
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
        return false;
    }

    try {
        return Array.from({ length: selection.rangeCount }).some((_, index) => {
            const range = selection.getRangeAt(index);
            return range.intersectsNode(linkNode);
        });
    } catch {
        return false;
    }
}