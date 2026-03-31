/**
 * @module plugins/architecture-devtools/architectureReverseDependency
 * @description 架构 DevTools 反向模块依赖辅助模块：识别“右侧模块依赖左侧模块”的
 *   可疑边，并将这些边格式化为便于复制与排查的纯文本。
 *
 * @dependencies
 *   - ./architectureRegistry
 *
 * @example
 *   const reverseEdges = collectReverseModuleDependencyDetails(edges, nodeMap, positions);
 *   const text = formatReverseModuleDependencyDetailsForClipboard(reverseEdges);
 *
 * @exports
 *   - ReverseDependencyNodePosition
 *   - ReverseModuleDependencyDetail
 *   - collectReverseModuleDependencyDetails
 *   - formatReverseModuleDependencyDetailsForClipboard
 */

import type {
    ArchitectureEdge,
    ArchitectureNode,
    ArchitectureNodeKind,
} from "./architectureRegistry";

/**
 * @interface ReverseDependencyNodePosition
 * @description 反向依赖检测所需的最小节点位置信息。
 * @field x 节点在 DAG 中的横向坐标。
 */
export interface ReverseDependencyNodePosition {
    /** 节点在 DAG 中的横向坐标。 */
    x: number;
}

/**
 * @interface ReverseModuleDependencyDetail
 * @description 一条右侧模块反向依赖左侧模块的明细。
 * @field edge 原始架构边。
 * @field fromNode 依赖发起模块。
 * @field toNode 被依赖模块。
 */
export interface ReverseModuleDependencyDetail {
    /** 原始架构边。 */
    edge: ArchitectureEdge;
    /** 依赖发起模块。 */
    fromNode: ArchitectureNode;
    /** 被依赖模块。 */
    toNode: ArchitectureNode;
}

/**
 * @function isArchitectureModuleKind
 * @description 判断节点类别是否属于模块节点。
 * @param kind 节点类别。
 * @returns 是否为模块节点。
 */
function isArchitectureModuleKind(kind: ArchitectureNodeKind): boolean {
    return kind === "ui-module" || kind === "backend-module";
}

/**
 * @function formatModuleDescriptor
 * @description 生成模块节点在复制文本中的简短描述。
 * @param node 模块节点。
 * @returns 节点描述文本。
 */
function formatModuleDescriptor(node: ArchitectureNode): string {
    const layerText = node.kind === "ui-module" ? ` / ${node.moduleLayer ?? "infrastructure"}` : "";
    return `${node.title} (${node.kind}${layerText})`;
}

/**
 * @function collectReverseModuleDependencyDetails
 * @description 收集当前可见图中从右向左指向的模块依赖边。
 * @param edges 当前可见边集合。
 * @param nodeMap 节点映射。
 * @param positions DAG 节点位置映射。
 * @returns 反向模块依赖明细列表。
 */
export function collectReverseModuleDependencyDetails(
    edges: ArchitectureEdge[],
    nodeMap: Map<string, ArchitectureNode>,
    positions: Map<string, ReverseDependencyNodePosition>,
): ReverseModuleDependencyDetail[] {
    return edges.flatMap((edge) => {
        const fromNode = nodeMap.get(edge.from);
        const toNode = nodeMap.get(edge.to);
        const fromPosition = positions.get(edge.from);
        const toPosition = positions.get(edge.to);

        if (!fromNode || !toNode || !fromPosition || !toPosition) {
            return [];
        }

        if (!isArchitectureModuleKind(fromNode.kind) || !isArchitectureModuleKind(toNode.kind)) {
            return [];
        }

        if (fromPosition.x <= toPosition.x) {
            return [];
        }

        return [{
            edge,
            fromNode,
            toNode,
        }];
    });
}

/**
 * @function formatReverseModuleDependencyDetailsForClipboard
 * @description 将反向模块依赖明细格式化为可直接复制的纯文本。
 * @param details 反向模块依赖明细列表。
 * @returns 纯文本；无数据时返回空字符串。
 */
export function formatReverseModuleDependencyDetailsForClipboard(
    details: ReverseModuleDependencyDetail[],
): string {
    if (details.length === 0) {
        return "";
    }

    return details.map((detail, index) => {
        const edgeDetails = detail.edge.details && detail.edge.details.length > 0
            ? detail.edge.details.map((item) => `- ${item}`).join("\n")
            : "- none";

        return [
            `#${String(index + 1)} ${detail.fromNode.title} -> ${detail.toNode.title}`,
            `from=${formatModuleDescriptor(detail.fromNode)}`,
            `fromLocation=${detail.fromNode.location ?? "unknown"}`,
            `fromSummary=${detail.fromNode.summary}`,
            `to=${formatModuleDescriptor(detail.toNode)}`,
            `toLocation=${detail.toNode.location ?? "unknown"}`,
            `toSummary=${detail.toNode.summary}`,
            `edgeKind=${detail.edge.kind}`,
            `edgeLabel=${detail.edge.label ?? "none"}`,
            "edgeDetails:",
            edgeDetails,
        ].join("\n");
    }).join("\n\n---\n\n");
}