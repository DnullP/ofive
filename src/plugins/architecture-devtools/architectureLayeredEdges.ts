/**
 * @module plugins/architecture-devtools/architectureLayeredEdges
 * @description 架构 DevTools 分层边过滤辅助模块：根据节点层级决定哪些边需要保留在
 *   DAG 视图中，同时保留模块之间的回头边，供红色反向依赖提示使用。
 *
 * @dependencies
 *   - ./architectureRegistry
 *
 * @example
 *   const visibleEdges = buildLayeredEdges(nodes, edges, kindLayerMaps);
 *
 * @exports
 *   - buildLayeredEdges
 */

import type {
    ArchitectureEdge,
    ArchitectureModuleLayer,
    ArchitectureNode,
    ArchitectureNodeKind,
} from "./architectureRegistry";

/**
 * @function isModuleNodeKind
 * @description 判断节点类别是否属于模块节点。
 * @param kind 节点类别。
 * @returns 是否为模块节点。
 */
function isModuleNodeKind(kind: ArchitectureNodeKind): boolean {
    return kind === "ui-module" || kind === "backend-module";
}

/**
 * @function getNodeModuleLayer
 * @description 读取模块节点的层级分类。
 * @param node 架构节点。
 * @returns 模块层级；非模块节点返回 null。
 */
function getNodeModuleLayer(node: ArchitectureNode): ArchitectureModuleLayer | null {
    if (node.kind !== "ui-module") {
        return null;
    }

    return node.moduleLayer ?? "infrastructure";
}

/**
 * @function buildLayeredEdges
 * @description 对同类节点依赖边执行分层约束，并保留模块节点的回头边用于异常提示。
 * @param nodes 当前节点集合。
 * @param edges 当前边集合。
 * @param kindLayerMaps 各类别层级映射。
 * @returns 过滤后的边集合。
 */
export function buildLayeredEdges(
    nodes: ArchitectureNode[],
    edges: ArchitectureEdge[],
    kindLayerMaps: Map<ArchitectureNodeKind, Map<string, number>>,
): ArchitectureEdge[] {
    const nodeMap = new Map(nodes.map((node) => [node.id, node]));
    return edges.filter((edge) => {
        const fromNode = nodeMap.get(edge.from);
        const toNode = nodeMap.get(edge.to);
        if (!fromNode || !toNode) {
            return false;
        }

        if (fromNode.kind !== toNode.kind) {
            return true;
        }

        if (
            fromNode.kind === "ui-module" &&
            getNodeModuleLayer(fromNode) !== getNodeModuleLayer(toNode)
        ) {
            return true;
        }

        const layerMap = kindLayerMaps.get(fromNode.kind);
        const fromLayer = layerMap?.get(edge.from) ?? 0;
        const toLayer = layerMap?.get(edge.to) ?? 0;

        if (toLayer > fromLayer) {
            return true;
        }

        if (isModuleNodeKind(fromNode.kind)) {
            return true;
        }

        return false;
    });
}