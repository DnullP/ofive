/**
 * @module layout/knowledgeGraphLabelSelector
 * @description 知识图谱标签选择器：基于视口与屏幕密度从全部节点标签中筛选
 *   出当前应渲染的小批量标签，避免在高密度图谱中对全部标签做逐帧 DOM 更新。
 * @dependencies
 *  - none
 *
 * @example
 *   const labels = selectVisibleGraphLabels({
 *       items,
 *       getScreenPosition,
 *       viewWidth,
 *       viewHeight,
 *       viewPaddingPx: 24,
 *       cellWidthPx: 110,
 *       cellHeightPx: 28,
 *       maxVisibleLabels: 120,
 *       labelOffsetYPx: 14,
 *   });
 *
 * @exports
 *  - GraphLabelItem
 *  - VisibleGraphLabel
 *  - selectVisibleGraphLabels
 */

/**
 * @interface GraphLabelItem
 * @description 图谱标签源数据。
 */
export interface GraphLabelItem {
    /** 节点索引。 */
    index: number;
    /** 标签文本。 */
    text: string;
}

/**
 * @interface VisibleGraphLabel
 * @description 已完成筛选与屏幕定位的标签数据。
 */
export interface VisibleGraphLabel {
    /** 节点索引。 */
    index: number;
    /** 标签文本。 */
    text: string;
    /** 屏幕 X 坐标。 */
    screenX: number;
    /** 屏幕 Y 坐标。 */
    screenY: number;
}

/**
 * @interface GraphLabelSelectionInput
 * @description 标签选择器输入参数。
 */
export interface GraphLabelSelectionInput {
    /** 全量标签项。 */
    items: GraphLabelItem[];
    /** 根据索引读取屏幕坐标。 */
    getScreenPosition: (index: number) => [number, number] | null;
    /** 视口宽度。 */
    viewWidth: number;
    /** 视口高度。 */
    viewHeight: number;
    /** 视口外扩边界。 */
    viewPaddingPx: number;
    /** 屏幕网格宽度。 */
    cellWidthPx: number;
    /** 屏幕网格高度。 */
    cellHeightPx: number;
    /** 最大可见标签数。 */
    maxVisibleLabels: number;
    /** 标签 Y 偏移。 */
    labelOffsetYPx: number;
    /** 上一帧已可见标签，用于稳定选择结果。 */
    preferredVisibleIndices?: ReadonlySet<number>;
    /** 上一帧已可见标签的稳定性距离补偿。 */
    preferredStabilityDistancePx?: number;
}

interface LabelCandidate {
    index: number;
    text: string;
    screenX: number;
    screenY: number;
    distanceToCenter: number;
    sortDistance: number;
}

/**
 * @function selectVisibleGraphLabels
 * @description 从全量标签中选出当前应该绘制的标签。
 *   选择策略遵循以下顺序：
 *   1. 跳过屏幕外标签
 *   2. 按距视口中心距离排序，优先保留中心区域
 *   3. 使用屏幕网格去重，限制局部标签密度
 *   4. 受 maxVisibleLabels 限制截断
 * @param input 标签选择输入。
 * @returns 当前应绘制的标签列表。
 */
export function selectVisibleGraphLabels(
    input: GraphLabelSelectionInput,
): VisibleGraphLabel[] {
    const {
        items,
        getScreenPosition,
        viewWidth,
        viewHeight,
        viewPaddingPx,
        cellWidthPx,
        cellHeightPx,
        maxVisibleLabels,
        labelOffsetYPx,
        preferredVisibleIndices,
        preferredStabilityDistancePx,
    } = input;

    if (
        items.length === 0 ||
        viewWidth <= 0 ||
        viewHeight <= 0 ||
        maxVisibleLabels <= 0
    ) {
        return [];
    }

    const viewCenterX = viewWidth / 2;
    const viewCenterY = viewHeight / 2;
    const stabilityDistance = Math.max(0, preferredStabilityDistancePx ?? 0);
    const candidates: LabelCandidate[] = [];

    items.forEach((item) => {
        const screenPosition = getScreenPosition(item.index);
        if (!screenPosition) {
            return;
        }

        const [screenX, rawScreenY] = screenPosition;
        const screenY = rawScreenY - labelOffsetYPx;
        const isInsideView =
            Number.isFinite(screenX) &&
            Number.isFinite(screenY) &&
            screenX >= -viewPaddingPx &&
            screenX <= viewWidth + viewPaddingPx &&
            screenY >= -viewPaddingPx &&
            screenY <= viewHeight + viewPaddingPx;

        if (!isInsideView) {
            return;
        }

        const distanceX = screenX - viewCenterX;
        const distanceY = screenY - viewCenterY;
        const distanceToCenter = distanceX * distanceX + distanceY * distanceY;
        const preferredBoost = preferredVisibleIndices?.has(item.index)
            ? stabilityDistance * stabilityDistance
            : 0;
        candidates.push({
            index: item.index,
            text: item.text,
            screenX,
            screenY,
            distanceToCenter,
            sortDistance: Math.max(0, distanceToCenter - preferredBoost),
        });
    });

    candidates.sort((left, right) => {
        if (left.sortDistance !== right.sortDistance) {
            return left.sortDistance - right.sortDistance;
        }

        if (left.distanceToCenter !== right.distanceToCenter) {
            return left.distanceToCenter - right.distanceToCenter;
        }

        return left.index - right.index;
    });

    const occupiedCells = new Set<string>();
    const visibleLabels: VisibleGraphLabel[] = [];

    candidates.forEach((candidate) => {
        if (visibleLabels.length >= maxVisibleLabels) {
            return;
        }

        const cellX = Math.floor(candidate.screenX / Math.max(1, cellWidthPx));
        const cellY = Math.floor(candidate.screenY / Math.max(1, cellHeightPx));
        const cellKey = `${String(cellX)}:${String(cellY)}`;
        if (occupiedCells.has(cellKey)) {
            return;
        }

        occupiedCells.add(cellKey);
        visibleLabels.push({
            index: candidate.index,
            text: candidate.text,
            screenX: candidate.screenX,
            screenY: candidate.screenY,
        });
    });

    if (visibleLabels.length > 0) {
        return visibleLabels;
    }

    const firstCandidate = candidates[0];
    return firstCandidate
        ? [{
            index: firstCandidate.index,
            text: firstCandidate.text,
            screenX: firstCandidate.screenX,
            screenY: firstCandidate.screenY,
        }]
        : [];
}