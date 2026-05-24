/**
 * @module plugins/knowledge-graph/tab/knowledgeGraphHoverHighlight
 * @description 知识图谱 hover 高亮计算：一跳邻居选择与边可见度样式。
 */

export type KnowledgeGraphRgbaColor = [number, number, number, number];

export interface KnowledgeGraphHoverLinkStyleInput {
    links: readonly number[];
    hoveredNodeIndex: number;
    baseLinkWidth: number;
    defaultLinkColor: KnowledgeGraphRgbaColor;
    activeLinkColor: KnowledgeGraphRgbaColor;
    dimLinkAlpha: number;
    activeLinkAlpha: number;
    activeLinkWidthMultiplier: number;
    transitionProgress?: number;
}

export interface KnowledgeGraphHoverLinkStyle {
    linkColors: Float32Array;
    linkWidths: Float32Array;
    incidentLinkCount: number;
}

function isValidNodeIndex(value: number | undefined, nodeCount: number): value is number {
    return (
        value !== undefined
        && Number.isInteger(value)
        && value >= 0
        && value < nodeCount
    );
}

function clamp01(value: number): number {
    if (!Number.isFinite(value)) {
        return 0;
    }

    return Math.max(0, Math.min(1, value));
}

function lerp(from: number, to: number, progress: number): number {
    return from + (to - from) * progress;
}

/**
 * @function buildKnowledgeGraphHoverSelection
 * @description 返回 hover 节点与所有直接相连节点索引，供 Cosmos selection greyout 使用。
 * @param nodeCount 节点数量。
 * @param links 扁平边数组，格式为 [sourceIndex, targetIndex, ...]。
 * @param hoveredNodeIndex 当前 hover 节点索引。
 * @returns hover 节点与一跳邻居索引。
 */
export function buildKnowledgeGraphHoverSelection(
    nodeCount: number,
    links: readonly number[],
    hoveredNodeIndex: number,
): number[] {
    const safeNodeCount = Math.max(0, Math.floor(nodeCount));
    if (!isValidNodeIndex(hoveredNodeIndex, safeNodeCount)) {
        return [];
    }

    const selectedIndices = new Set<number>([hoveredNodeIndex]);
    for (let offset = 0; offset + 1 < links.length; offset += 2) {
        const sourceIndex = links[offset];
        const targetIndex = links[offset + 1];
        if (
            !isValidNodeIndex(sourceIndex, safeNodeCount)
            || !isValidNodeIndex(targetIndex, safeNodeCount)
        ) {
            continue;
        }

        if (sourceIndex === hoveredNodeIndex) {
            selectedIndices.add(targetIndex);
        }
        if (targetIndex === hoveredNodeIndex) {
            selectedIndices.add(sourceIndex);
        }
    }

    return Array.from(selectedIndices);
}

/**
 * @function buildKnowledgeGraphHoverLinkStyle
 * @description 生成 hover 状态下的边颜色和宽度数组。hover 节点的 incident edges 更亮更粗，其它边变淡。
 * @param input hover 边样式输入。
 * @returns Cosmos setLinkColors / setLinkWidths 可直接使用的数组。
 */
export function buildKnowledgeGraphHoverLinkStyle(
    input: KnowledgeGraphHoverLinkStyleInput,
): KnowledgeGraphHoverLinkStyle {
    const linkCount = Math.max(0, Math.floor(input.links.length / 2));
    const linkColors = new Float32Array(linkCount * 4);
    const linkWidths = new Float32Array(linkCount);
    const safeBaseWidth = Math.max(0.1, input.baseLinkWidth);
    const progress = clamp01(input.transitionProgress ?? 1);
    const activeWidth = safeBaseWidth * lerp(
        1,
        Math.max(1, input.activeLinkWidthMultiplier),
        progress,
    );
    const dimAlpha = lerp(1, clamp01(input.dimLinkAlpha), progress);
    const activeAlpha = clamp01(input.activeLinkAlpha);
    let incidentLinkCount = 0;

    for (let linkIndex = 0; linkIndex < linkCount; linkIndex += 1) {
        const sourceIndex = input.links[linkIndex * 2];
        const targetIndex = input.links[linkIndex * 2 + 1];
        const isIncident =
            sourceIndex === input.hoveredNodeIndex
            || targetIndex === input.hoveredNodeIndex;
        const colorProgress = isIncident ? progress : 0;
        const alpha = isIncident
            ? lerp(input.defaultLinkColor[3], input.activeLinkColor[3] * activeAlpha, progress)
            : input.defaultLinkColor[3] * dimAlpha;

        linkColors[linkIndex * 4] = lerp(input.defaultLinkColor[0], input.activeLinkColor[0], colorProgress);
        linkColors[linkIndex * 4 + 1] = lerp(input.defaultLinkColor[1], input.activeLinkColor[1], colorProgress);
        linkColors[linkIndex * 4 + 2] = lerp(input.defaultLinkColor[2], input.activeLinkColor[2], colorProgress);
        linkColors[linkIndex * 4 + 3] = clamp01(alpha);
        linkWidths[linkIndex] = isIncident ? activeWidth : safeBaseWidth;

        if (isIncident) {
            incidentLinkCount += 1;
        }
    }

    return {
        linkColors,
        linkWidths,
        incidentLinkCount,
    };
}
