/**
 * @module plugins/architecture-devtools/architectureEdgeIndex
 * @description 架构 DevTools 边索引辅助模块：为可见边建立按节点分组的邻接索引，
 *   以便在 hover、focus、inspector 场景下快速读取关联边与高亮节点集合，
 *   避免每次状态变化都对整张图执行全量扫描。
 *
 * @dependencies
 *   - ./architectureRegistry
 *
 * @example
 *   const index = buildArchitectureEdgeAdjacencyIndex(edges);
 *   const relatedEdges = getArchitectureNodeRelatedEdges(index, "plugin:fileTree");
 *   const highlightedNodeIds = collectArchitectureHighlightedNodeIds("plugin:fileTree", relatedEdges);
 *
 * @exports
 *   - ArchitectureEdgeAdjacencyIndex
 *   - buildArchitectureEdgeAdjacencyIndex
 *   - getArchitectureNodeRelatedEdges
 *   - collectArchitectureHighlightedNodeIds
 */

import type { ArchitectureEdge } from "./architectureRegistry";

/**
 * @interface ArchitectureEdgeAdjacencyIndex
 * @description 可见边的按节点邻接索引。
 * @field edgesByNodeId 节点 ID 到关联边列表的映射。
 */
export interface ArchitectureEdgeAdjacencyIndex {
    /** 节点 ID 到关联边列表的映射。 */
    edgesByNodeId: Map<string, ArchitectureEdge[]>;
}

/**
 * @function buildArchitectureEdgeAdjacencyIndex
 * @description 为当前可见边构建邻接索引。
 * @param edges 当前可见边集合。
 * @returns 邻接索引。
 */
export function buildArchitectureEdgeAdjacencyIndex(
    edges: ArchitectureEdge[],
): ArchitectureEdgeAdjacencyIndex {
    const edgesByNodeId = new Map<string, ArchitectureEdge[]>();

    edges.forEach((edge) => {
        edgesByNodeId.set(edge.from, [...(edgesByNodeId.get(edge.from) ?? []), edge]);
        if (edge.to !== edge.from) {
            edgesByNodeId.set(edge.to, [...(edgesByNodeId.get(edge.to) ?? []), edge]);
        }
    });

    return { edgesByNodeId };
}

/**
 * @function getArchitectureNodeRelatedEdges
 * @description 读取指定节点的关联边。
 * @param index 邻接索引。
 * @param nodeId 节点 ID。
 * @returns 关联边列表；节点为空时返回空数组。
 */
export function getArchitectureNodeRelatedEdges(
    index: ArchitectureEdgeAdjacencyIndex,
    nodeId: string | null,
): ArchitectureEdge[] {
    if (!nodeId) {
        return [];
    }

    return index.edgesByNodeId.get(nodeId) ?? [];
}

/**
 * @function collectArchitectureHighlightedNodeIds
 * @description 从聚焦节点及其关联边中提取应高亮的节点集合。
 * @param focusedNodeId 当前聚焦节点 ID。
 * @param relatedEdges 聚焦节点的关联边。
 * @returns 需要高亮的节点 ID 集合。
 */
export function collectArchitectureHighlightedNodeIds(
    focusedNodeId: string | null,
    relatedEdges: ArchitectureEdge[],
): Set<string> {
    const highlightedNodeIds = new Set<string>();
    if (focusedNodeId) {
        highlightedNodeIds.add(focusedNodeId);
    }

    relatedEdges.forEach((edge) => {
        highlightedNodeIds.add(edge.from);
        highlightedNodeIds.add(edge.to);
    });

    return highlightedNodeIds;
}