/**
 * @module layout/layoutStateReducers
 * @description 布局面板状态的纯函数状态转换逻辑，从 DockviewLayout 中提取以便单元测试。
 *
 * 包含以下核心转换：
 * - 面板跨容器拖拽（左↔右）时的状态更新
 * - 面板拖入空侧栏区域时的状态更新
 * - 面板可见性过滤逻辑
 * - 活动 ID 自动选中逻辑
 * - 面板初始状态构建
 *
 * @dependencies
 *   - ./panelOrderUtils（PanelPositionLike 类型）
 *
 * @example
 *   import { computeCrossContainerDrop } from "./layoutStateReducers";
 *   const next = computeCrossContainerDrop({ prev, movedPanelId, ... });
 */

/* ────────── 类型定义 ────────── */

/**
 * 面板侧栏位置。
 */
export type PanelPosition = "left" | "right";

/**
 * 面板运行时状态——每个面板在布局中的位置、排序和所属活动分组。
 * @field id         - 面板唯一 ID
 * @field position   - 当前所在侧栏（"left" | "right"）
 * @field order      - 在当前侧栏中的排序值
 * @field activityId - 所属活动分组 ID（决定面板在哪个活动项下显示）
 */
export interface PanelRuntimeState {
    /** 面板唯一 ID */
    id: string;
    /** 当前所在侧栏 */
    position: PanelPosition;
    /** 在当前侧栏中的排序值 */
    order: number;
    /** 所属活动分组 ID */
    activityId: string;
}

/**
 * 面板定义信息的最小结构——只包含状态逻辑需要的字段。
 * @field id         - 面板唯一 ID
 * @field activityId - 定义时声明的活动分组 ID（可选）
 * @field position   - 定义时声明的默认侧栏位置（可选）
 * @field order      - 定义时声明的默认排序值（可选）
 * @field tabOnly    - 是否为仅标签模式（不在侧边栏生成面板容器）
 */
export interface PanelDefinitionInfo {
    /** 面板唯一 ID */
    id: string;
    /** 定义时声明的活动分组 ID */
    activityId?: string;
    /** 定义时声明的默认侧栏位置 */
    position?: PanelPosition;
    /** 定义时声明的默认排序值 */
    order?: number;
    /** 是否为仅标签模式 */
    tabOnly?: boolean;
}

/**
 * PaneviewDropEvent 中 position 的投放方位。
 */
export type DropPosition = "top" | "bottom" | "left" | "right";

/* ────────── 初始化 ────────── */

/**
 * 从面板定义列表构建初始运行时状态。
 *
 * @param panels 面板定义列表
 * @returns 初始运行时状态数组
 */
export function buildInitialPanelStates(panels: PanelDefinitionInfo[]): PanelRuntimeState[] {
    return panels.map((panel, index) => ({
        id: panel.id,
        position: panel.position ?? "left",
        order: panel.order ?? index,
        activityId: panel.activityId ?? panel.id,
    }));
}

/**
 * 当面板定义列表变化时，合并新旧状态：保留已有条目，新增缺失条目。
 *
 * @param prev 前一个运行时状态数组
 * @param panels 当前面板定义列表
 * @returns 合并后的运行时状态数组
 */
export function mergePanelStates(
    prev: PanelRuntimeState[],
    panels: PanelDefinitionInfo[],
): PanelRuntimeState[] {
    const prevMap = new Map(prev.map((item) => [item.id, item]));
    return panels.map((panel, index) => {
        const existing = prevMap.get(panel.id);
        if (existing) {
            return existing;
        }
        return {
            id: panel.id,
            position: panel.position ?? "left",
            order: panel.order ?? index,
            activityId: panel.activityId ?? panel.id,
        };
    });
}

/**
 * 删除指定 activity 后，清理 panelStates 中对该 activity 的引用。
 *
 * 规则：
 * - 被删除的容器面板本身直接移除。
 * - 其他仍存在的面板若挂在该 activity 下，则回退到其定义中的默认 activityId。
 * - 若定义中也缺少 activityId，则回退到面板自身 id。
 *
 * @param prev 当前运行时状态数组
 * @param panels 当前已注册面板定义
 * @param removedActivityId 被删除的 activity 注册 ID
 * @param removedPanelId 被删除的容器面板 ID
 * @returns 清理后的 panelStates
 */
export function removeActivityReferencesFromPanelStates(
    prev: PanelRuntimeState[],
    panels: PanelDefinitionInfo[],
    removedActivityId: string,
    removedPanelId: string,
): PanelRuntimeState[] {
    const panelById = new Map(panels.map((panel) => [panel.id, panel]));

    return prev.flatMap((item) => {
        if (item.id === removedPanelId) {
            return [];
        }

        if (item.activityId !== removedActivityId) {
            return [item];
        }

        const panel = panelById.get(item.id);
        const fallbackActivityId = panel?.activityId ?? panel?.id ?? item.id;

        return [{
            ...item,
            activityId: fallbackActivityId,
        }];
    });
}

/**
 * 修复 panelStates 中指向未知 activity 的脏引用。
 *
 * 规则：
 * - 若面板已不存在，则移除该状态条目。
 * - 若 activityId 仍然有效，则保持不变。
 * - 若 activityId 已失效，则回退到面板定义中的默认 activityId。
 * - 若定义中缺少 activityId，则回退到面板自身 id。
 *
 * @param prev 当前运行时状态数组
 * @param panels 当前已注册面板定义
 * @param validActivityIds 当前仍有效的 activityId 集合
 * @returns 修复后的 panelStates；若无需修复则直接返回原数组
 */
export function repairUnknownActivityReferencesInPanelStates(
    prev: PanelRuntimeState[],
    panels: PanelDefinitionInfo[],
    validActivityIds: Set<string>,
): PanelRuntimeState[] {
    const panelById = new Map(panels.map((panel) => [panel.id, panel]));
    let changed = false;

    const next = prev.flatMap((item) => {
        const panel = panelById.get(item.id);
        if (!panel) {
            changed = true;
            return [];
        }

        if (validActivityIds.has(item.activityId)) {
            return [item];
        }

        const fallbackActivityId = panel.activityId ?? panel.id;
        if (fallbackActivityId !== item.activityId) {
            changed = true;
            return [{
                ...item,
                activityId: fallbackActivityId,
            }];
        }

        return [item];
    });

    return changed ? next : prev;
}

/* ────────── Activity ID 解析 ────────── */

/**
 * 获取面板的当前活动 ID，优先使用运行时状态中的值，回退到定义中的值。
 *
 * @param panelId 面板 ID
 * @param panelStates 运行时状态数组
 * @param panelById 面板定义映射
 * @returns 活动 ID
 */
export function resolveActivityId(
    panelId: string,
    panelStates: PanelRuntimeState[],
    panelById: Map<string, PanelDefinitionInfo>,
): string {
    const state = panelStates.find((s) => s.id === panelId);
    if (state) {
        return state.activityId;
    }
    const def = panelById.get(panelId);
    return def?.activityId ?? panelId;
}

/* ────────── 可见面板过滤 ────────── */

/**
 * 根据侧栏位置和活动 ID 过滤可见面板列表。
 * 排除 tabOnly 面板，按 order 排序。
 *
 * @param panelStates 运行时状态数组
 * @param panelById 面板定义映射
 * @param position 目标侧栏
 * @param activeActivityId 当前激活的活动 ID（null 表示显示全部）
 * @returns 按排序的可见面板 ID 列表
 */
export function getVisiblePanelIds(
    panelStates: PanelRuntimeState[],
    panelById: Map<string, PanelDefinitionInfo>,
    position: PanelPosition,
    activeActivityId: string | null,
): string[] {
    return panelStates
        .filter((s) => s.position === position)
        .sort((a, b) => a.order - b.order)
        .filter((s) => {
            const def = panelById.get(s.id);
            if (def?.tabOnly) {
                return false;
            }
            if (activeActivityId) {
                return s.activityId === activeActivityId;
            }
            return true;
        })
        .map((s) => s.id);
}

/* ────────── 活动自动选中 ────────── */

/**
 * 活动项的最小结构。
 * @field id        - 活动 ID
 * @field isSettings - 是否为设置按钮
 * @field tabOnly   - 是否为 tabOnly（无侧边栏面板）
 */
export interface ActivityItemInfo {
    /** 活动 ID */
    id: string;
    /** 是否为设置按钮 */
    isSettings?: boolean;
    /** 是否为 tabOnly */
    tabOnly?: boolean;
}

/**
 * 自动选中活动 ID 逻辑：如果当前选中项不在候选列表中，自动选第一个。
 *
 * @param items 候选活动项列表（已排除 settings 和 tabOnly）
 * @param currentActiveId 当前激活的活动 ID
 * @returns 应该设置的活动 ID（null 表示无可选项）
 */
export function autoSelectActivityId(
    items: ActivityItemInfo[],
    currentActiveId: string | null,
): string | null {
    const eligibleItems = items.filter((i) => !i.isSettings && !i.tabOnly);
    if (eligibleItems.length === 0) {
        return null;
    }
    if (currentActiveId && eligibleItems.some((i) => i.id === currentActiveId)) {
        return currentActiveId;
    }
    return eligibleItems[0]?.id ?? null;
}

/* ────────── 跨容器拖拽 ────────── */

/**
 * 跨容器拖拽参数。
 * @field prev               - 变更前的状态数组
 * @field movedPanelId       - 被拖拽面板 ID
 * @field targetPosition     - 目标侧栏
 * @field dropTargetPanelId  - 放置目标面板 ID
 * @field dropPosition       - 放置方位（top/bottom/left/right）
 * @field panelById          - 面板定义映射
 * @field activeActivityId   - 当前激活的左侧活动 ID
 */
export interface CrossContainerDropParams {
    /** 变更前的状态数组 */
    prev: PanelRuntimeState[];
    /** 被拖拽面板 ID */
    movedPanelId: string;
    /** 目标侧栏 */
    targetPosition: PanelPosition;
    /** 放置目标面板 ID */
    dropTargetPanelId: string;
    /** 放置方位 */
    dropPosition: DropPosition;
    /** 面板定义映射 */
    panelById: Map<string, PanelDefinitionInfo>;
    /** 当前激活的左侧活动 ID */
    activeActivityId: string | null;
    /** 当前激活的右侧活动 ID（icon 与 panel 解耦后，面板加入目标 activity 分组） */
    activeRightActivityId: string | null;
}

/**
 * 计算跨容器拖拽后的面板状态。
 *
 * 核心逻辑：
 * - icon 与 panel 解耦：面板拖拽不改变 activity icon 的 bar 归属
 * - 面板拖入左侧栏时，activityId 设为目标面板的活动 ID 或当前左侧活动项
 * - 面板拖入右侧栏时，activityId 设为目标面板的活动 ID 或当前右侧活动项
 *   （面板加入目标侧栏中正在显示的 activity 分组）
 *
 * @param params 跨容器拖拽参数
 * @returns 变更后的状态数组
 *
 * @sideEffects 无（纯函数）
 */
export function computeCrossContainerDrop(params: CrossContainerDropParams): PanelRuntimeState[] {
    const {
        prev,
        movedPanelId,
        targetPosition,
        dropTargetPanelId,
        dropPosition,
        panelById,
        activeActivityId,
        activeRightActivityId,
    } = params;

    const moved = prev.find((item) => item.id === movedPanelId);
    if (!moved) {
        return prev;
    }

    const sourcePosition = moved.position;

    /* ── 计算目标 activityId ──
     * icon 与 panel 解耦：面板加入目标侧栏中 drop target 所属的 activity 分组。
     * 若无法确定目标 activity，回退到该侧栏当前激活的 activity。 */
    const targetPanelState = prev.find(
        (item) => item.id === dropTargetPanelId && item.position === targetPosition,
    );
    const targetPanelDefinition = panelById.get(dropTargetPanelId);
    const targetPanelActivityId =
        targetPanelState?.activityId ??
        (targetPanelDefinition
            ? targetPanelDefinition.activityId ?? targetPanelDefinition.id
            : undefined);

    const nextActivityId = targetPosition === "left"
        ? targetPanelActivityId ?? activeActivityId ?? moved.activityId
        : targetPanelActivityId ?? activeRightActivityId ?? moved.activityId;

    /* ── 计算排序 ── */
    const targetIds = prev
        .filter((item) => item.position === targetPosition && item.id !== movedPanelId)
        .sort((a, b) => a.order - b.order)
        .map((item) => item.id);

    let insertIndex = targetIds.indexOf(dropTargetPanelId);
    if (insertIndex < 0) {
        insertIndex = targetIds.length;
    }

    if (dropPosition === "bottom" || dropPosition === "right") {
        insertIndex += 1;
    }

    insertIndex = Math.max(0, Math.min(insertIndex, targetIds.length));
    targetIds.splice(insertIndex, 0, movedPanelId);

    const sourceIds = prev
        .filter((item) => item.position === sourcePosition && item.id !== movedPanelId)
        .sort((a, b) => a.order - b.order)
        .map((item) => item.id);

    /* ── 生成新状态 ── */
    return prev.map((item) => {
        if (item.id === movedPanelId) {
            return {
                ...item,
                position: targetPosition,
                order: targetIds.indexOf(movedPanelId),
                activityId: nextActivityId,
            };
        }

        if (item.position === targetPosition) {
            const order = targetIds.indexOf(item.id);
            if (order >= 0) {
                return { ...item, order };
            }
        }

        if (item.position === sourcePosition && sourcePosition !== targetPosition) {
            const order = sourceIds.indexOf(item.id);
            if (order >= 0) {
                return { ...item, order };
            }
        }

        return item;
    });
}

/* ────────── 空左侧栏拖入 ────────── */

/**
 * 空左侧栏拖入参数。
 * @field prev             - 变更前的状态数组
 * @field movedPanelId     - 被拖拽面板 ID
 * @field activeActivityId - 当前激活的左侧活动 ID
 */
export interface EmptySidebarDropParams {
    prev: PanelRuntimeState[];
    movedPanelId: string;
    activeActivityId: string | null;
}

/**
 * 计算拖入空左侧栏后的面板状态。
 *
 * @param params 拖入参数
 * @returns 变更后的状态数组
 *
 * @sideEffects 无（纯函数）
 */
export function computeEmptySidebarDrop(params: EmptySidebarDropParams): PanelRuntimeState[] {
    const { prev, movedPanelId, activeActivityId } = params;

    const moved = prev.find((item) => item.id === movedPanelId);
    if (!moved) {
        return prev;
    }

    const sourcePosition = moved.position;
    const nextActivityId = activeActivityId ?? moved.activityId;

    const targetIds = prev
        .filter((item) => item.position === "left" && item.id !== movedPanelId)
        .sort((a, b) => a.order - b.order)
        .map((item) => item.id);
    targetIds.push(movedPanelId);

    const sourceIds = prev
        .filter((item) => item.position === sourcePosition && item.id !== movedPanelId)
        .sort((a, b) => a.order - b.order)
        .map((item) => item.id);

    return prev.map((item) => {
        if (item.id === movedPanelId) {
            return {
                ...item,
                position: "left" as PanelPosition,
                order: targetIds.indexOf(movedPanelId),
                activityId: nextActivityId,
            };
        }

        if (item.position === "left") {
            const order = targetIds.indexOf(item.id);
            if (order >= 0) {
                return { ...item, order };
            }
        }

        if (sourcePosition !== "left" && item.position === sourcePosition) {
            const order = sourceIds.indexOf(item.id);
            if (order >= 0) {
                return { ...item, order };
            }
        }

        return item;
    });
}

/* ────────── 空右侧栏拖入 ────────── */

/**
 * 空右侧栏拖入参数。
 * @field prev          - 变更前的状态数组
 * @field movedPanelId  - 被拖拽面板 ID
 * @field panelById     - 面板定义映射
 */
export interface EmptyRightSidebarDropParams {
    prev: PanelRuntimeState[];
    movedPanelId: string;
    panelById: Map<string, PanelDefinitionInfo>;
    /** 当前激活的右侧活动 ID（面板加入该 activity 分组） */
    activeRightActivityId: string | null;
}

/**
 * 计算拖入空右侧栏后的面板状态。
 *
 * 核心逻辑：面板加入当前右侧活动项的 activity 分组。
 * icon 与 panel 解耦——面板可自由移动到任意 activity 容器中。
 *
 * @param params 拖入参数
 * @returns 变更后的状态数组
 *
 * @sideEffects 无（纯函数）
 */
export function computeEmptyRightSidebarDrop(params: EmptyRightSidebarDropParams): PanelRuntimeState[] {
    const { prev, movedPanelId, panelById, activeRightActivityId } = params;

    const moved = prev.find((item) => item.id === movedPanelId);
    if (!moved) {
        return prev;
    }

    const sourcePosition = moved.position;

    /* 面板加入当前右侧活动分组；若无活动分组则回退到面板原始定义 */
    const movedDef = panelById.get(movedPanelId);
    const nextActivityId = activeRightActivityId ?? movedDef?.activityId ?? moved.activityId;

    const targetIds = prev
        .filter((item) => item.position === "right" && item.id !== movedPanelId)
        .sort((a, b) => a.order - b.order)
        .map((item) => item.id);
    targetIds.push(movedPanelId);

    const sourceIds = prev
        .filter((item) => item.position === sourcePosition && item.id !== movedPanelId)
        .sort((a, b) => a.order - b.order)
        .map((item) => item.id);

    return prev.map((item) => {
        if (item.id === movedPanelId) {
            return {
                ...item,
                position: "right" as PanelPosition,
                order: targetIds.indexOf(movedPanelId),
                activityId: nextActivityId,
            };
        }

        if (item.position === "right") {
            const order = targetIds.indexOf(item.id);
            if (order >= 0) {
                return { ...item, order };
            }
        }

        if (sourcePosition !== "right" && item.position === sourcePosition) {
            const order = sourceIds.indexOf(item.id);
            if (order >= 0) {
                return { ...item, order };
            }
        }

        return item;
    });
}

/* ────────── 计算拖回右侧后应激活的活动 ID ────────── */

/**
 * 计算面板拖入右侧栏后应设置的 activeRightActivityId。
 * 使用面板定义中的原始 activityId，而非运行时可能已被修改的值。
 *
 * @param movedPanelId 被拖拽面板 ID
 * @param panelById 面板定义映射
 * @returns 应该设置的右侧活动 ID
 */
export function resolveRightActivityIdAfterDrop(
    movedPanelId: string,
    panelById: Map<string, PanelDefinitionInfo>,
): string {
    const def = panelById.get(movedPanelId);
    return def?.activityId ?? movedPanelId;
}
