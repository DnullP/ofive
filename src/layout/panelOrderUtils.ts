/**
 * @module layout/panelOrderUtils
 * @description Panel 排序工具：用于将 Paneview 当前顺序持久化回布局状态。
 * @dependencies
 *  - 无（纯函数）
 *
 * @example
 *   const next = applyPanelOrderForPosition(prev, "left", ["files", "search"])
 */

/**
 * @type PanelPositionLike
 * @description 侧栏位置类型。
 */
export type PanelPositionLike = "left" | "right";

/**
 * @interface PanelRuntimeStateLike
 * @description 面板运行时状态最小结构。
 */
export interface PanelRuntimeStateLike {
    /** 面板唯一 ID */
    id: string;
    /** 所属侧栏 */
    position: PanelPositionLike;
    /** 排序值 */
    order: number;
}

/**
 * @function applyPanelOrderForPosition
 * @description 将指定侧栏中 Paneview 的当前顺序写回运行时状态。
 * @param previousStates 变更前状态列表。
 * @param targetPosition 目标侧栏位置。
 * @param orderedIds 目标侧栏中按显示顺序排列的面板 ID 列表。
 * @returns 变更后的状态列表。
 */
export function applyPanelOrderForPosition<TState extends PanelRuntimeStateLike>(
    previousStates: TState[],
    targetPosition: PanelPositionLike,
    orderedIds: string[],
): TState[] {
    return previousStates.map((item) => {
        if (item.position !== targetPosition) {
            return item;
        }

        const nextOrder = orderedIds.indexOf(item.id);
        if (nextOrder < 0 || item.order === nextOrder) {
            return item;
        }

        return {
            ...item,
            order: nextOrder,
        };
    });
}
