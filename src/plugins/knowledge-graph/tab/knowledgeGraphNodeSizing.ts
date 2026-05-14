/**
 * @module plugins/knowledge-graph/tab/knowledgeGraphNodeSizing
 * @description 知识图谱节点尺寸计算：基于入边与出边总数按饱和指数曲线放大高连接节点。
 */

/**
 * @constant KNOWLEDGE_GRAPH_NODE_SIZE_MAX_MULTIPLIER
 * @description 节点尺寸相对基础尺寸的最大倍率，避免超级 hub 过大。
 */
const KNOWLEDGE_GRAPH_NODE_SIZE_MAX_MULTIPLIER = 2.2;

/**
 * @constant KNOWLEDGE_GRAPH_NODE_SIZE_DEGREE_DECAY
 * @description 饱和指数曲线的衰减系数；值越大，高连接节点增长越慢。
 */
const KNOWLEDGE_GRAPH_NODE_SIZE_DEGREE_DECAY = 28;

/**
 * @function buildKnowledgeGraphPointSizes
 * @description 根据入边与出边总数生成节点尺寸。孤立节点保持基础尺寸，连接越多尺寸越大且增幅按饱和指数曲线收敛。
 * @param nodeCount 节点数量。
 * @param links 扁平边数组，格式为 [sourceIndex, targetIndex, ...]。
 * @param baseSize 基础节点尺寸。
 * @returns 每个节点对应的尺寸数组。
 */
export function buildKnowledgeGraphPointSizes(
    nodeCount: number,
    links: readonly number[],
    baseSize: number,
): Float32Array {
    const safeNodeCount = Math.max(0, Math.floor(nodeCount));
    const safeBaseSize = Math.max(1, baseSize);
    const maxSize = safeBaseSize * KNOWLEDGE_GRAPH_NODE_SIZE_MAX_MULTIPLIER;
    const degrees = new Uint32Array(safeNodeCount);
    const pointSizes = new Float32Array(safeNodeCount);

    for (let offset = 0; offset + 1 < links.length; offset += 2) {
        const sourceIndex = links[offset];
        const targetIndex = links[offset + 1];

        if (
            sourceIndex !== undefined
            && Number.isInteger(sourceIndex)
            && sourceIndex >= 0
            && sourceIndex < safeNodeCount
        ) {
            degrees[sourceIndex] += 1;
        }

        if (
            targetIndex !== undefined
            && Number.isInteger(targetIndex)
            && targetIndex >= 0
            && targetIndex < safeNodeCount
        ) {
            degrees[targetIndex] += 1;
        }
    }

    for (let index = 0; index < safeNodeCount; index += 1) {
        const degree = degrees[index] ?? 0;
        const growth = 1 - Math.exp(-degree / KNOWLEDGE_GRAPH_NODE_SIZE_DEGREE_DECAY);
        pointSizes[index] = safeBaseSize + (maxSize - safeBaseSize) * growth;
    }

    return pointSizes;
}
