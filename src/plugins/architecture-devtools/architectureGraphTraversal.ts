/**
 * @module plugins/architecture-devtools/architectureGraphTraversal
 * @description 架构图遍历工具：根据命中的根节点构造依赖树、被依赖树或双向关系子图。
 *
 * @dependencies
 *   - ./architectureRegistry
 *
 * @example
 *   const visibleNodeIds = buildTransitiveVisibleNodeIds(
 *       snapshot.nodes.map((node) => node.id),
 *       snapshot.edges,
 *       ["plugin:imageViewerOpenerPlugin"],
 *       "dependencies",
 *   );
 *
 * @exports
 *   - GraphTraversalMode 图遍历模式。
 *   - buildTransitiveVisibleNodeIds 根据根节点展开可见子图节点集合。
 */

import type { ArchitectureEdge } from "./architectureRegistry";

/**
 * @type GraphTraversalMode
 * @description 架构图遍历模式。
 */
export type GraphTraversalMode = "dependencies" | "dependents" | "neighbors";

/**
 * @function createAdjacencyMap
 * @description 从边列表构建单向邻接表。
 * @param edges 架构边集合。
 * @param direction 邻接方向，outgoing 表示 from -> to，incoming 表示 to -> from。
 * @returns 节点到邻接节点列表的映射。
 */
function createAdjacencyMap(
    edges: ArchitectureEdge[],
    direction: "outgoing" | "incoming",
): Map<string, string[]> {
    const adjacency = new Map<string, string[]>();

    edges.forEach((edge) => {
        const from = direction === "outgoing" ? edge.from : edge.to;
        const to = direction === "outgoing" ? edge.to : edge.from;
        adjacency.set(from, [...(adjacency.get(from) ?? []), to]);
    });

    return adjacency;
}

/**
 * @function expandVisibleIds
 * @description 从根节点出发沿指定邻接表执行传递遍历，补全可见节点。
 * @param adjacency 邻接表。
 * @param rootNodeIds 根节点 ID 列表。
 * @param visible 已可见节点集合，会被原地扩展。
 */
function expandVisibleIds(
    adjacency: Map<string, string[]>,
    rootNodeIds: string[],
    visible: Set<string>,
): void {
    const stack = [...rootNodeIds];

    while (stack.length > 0) {
        const currentNodeId = stack.pop();
        if (!currentNodeId) {
            continue;
        }

        const nextNodeIds = adjacency.get(currentNodeId) ?? [];
        nextNodeIds.forEach((nextNodeId) => {
            if (visible.has(nextNodeId)) {
                return;
            }

            visible.add(nextNodeId);
            stack.push(nextNodeId);
        });
    }
}

/**
 * @function buildTransitiveVisibleNodeIds
 * @description 从命中的根节点出发构建传递闭包，得到当前模式下应展示的节点集合。
 * @param allNodeIds 全量节点 ID 列表。
 * @param edges 架构边集合。
 * @param matchedNodeIds 直接命中的根节点 ID 列表。
 * @param mode 图遍历模式。
 * @returns 当前模式下应展示的节点 ID 集合。
 */
export function buildTransitiveVisibleNodeIds(
    allNodeIds: string[],
    edges: ArchitectureEdge[],
    matchedNodeIds: string[],
    mode: GraphTraversalMode,
): Set<string> {
    if (matchedNodeIds.length === 0) {
        return new Set();
    }

    if (matchedNodeIds.length === allNodeIds.length) {
        return new Set(allNodeIds);
    }

    const visible = new Set<string>(matchedNodeIds);

    if (mode === "dependencies" || mode === "neighbors") {
        expandVisibleIds(createAdjacencyMap(edges, "outgoing"), matchedNodeIds, visible);
    }

    if (mode === "dependents" || mode === "neighbors") {
        expandVisibleIds(createAdjacencyMap(edges, "incoming"), matchedNodeIds, visible);
    }

    return visible;
}