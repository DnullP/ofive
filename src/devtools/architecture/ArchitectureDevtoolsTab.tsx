/**
 * @module devtools/architecture/ArchitectureDevtoolsTab
 * @description 架构可视化 DevTools Tab：展示当前项目的状态、事件、接口与依赖 DAG。
 *
 *   页面由三部分组成：
 *   - Summary：汇总状态、事件、接口与扩展注册面数量。
 *   - DAG：按照 plugin -> module -> store -> event -> api 的层级渲染依赖图。
 *   - Inventory：列出全部状态、事件、前端接口与后端接口的明细。
 *
 * @dependencies
 *   - react
 *   - dockview
 *   - ../../registry
 *   - ./architectureRegistry
 *   - ./architectureDevtools.css
 *
 * @exports
 *   - ArchitectureDevtoolsTab
 */

import { useEffect, useMemo, useState, type ReactElement } from "react";
import type { IDockviewPanelProps } from "dockview";
import i18n from "../../i18n";
import { useActivities, usePanels, useTabComponents } from "../../registry";
import {
    useArchitectureSnapshot,
    type ArchitectureEdge,
    type ArchitectureModuleLayer,
    type ArchitectureNode,
    type ArchitectureNodeKind,
} from "./architectureRegistry";
import "./architectureDevtools.css";

const NODE_WIDTH = 236;
const NODE_HEIGHT = 104;
const COLUMN_GAP = 64;
const ROW_GAP = 20;
const PADDING_X = 32;
const PADDING_Y = 28;

const KIND_ORDER: ArchitectureNodeKind[] = [
    "plugin",
    "ui-module",
    "store",
    "event",
    "frontend-api",
    "backend-api",
];

const FILTER_KIND_ORDER: Array<ArchitectureNodeKind | "all"> = [
    "all",
    "plugin",
    "ui-module",
    "store",
    "event",
    "frontend-api",
    "backend-api",
];

const MODULE_LAYER_ORDER: ArchitectureModuleLayer[] = [
    "plugin-logic",
    "infrastructure",
];

/**
 * @interface LayoutNode
 * @description 带有 DAG 布局坐标的节点。
 */
interface LayoutNode {
    node: ArchitectureNode;
    x: number;
    y: number;
}

/**
 * @interface LayoutColumn
 * @description DAG 中的单列信息，支持模块被拆分为多层子列。
 */
interface LayoutColumn {
    id: string;
    kind: ArchitectureNodeKind;
    label: string;
    x: number;
    layer?: number;
    moduleLayer?: ArchitectureModuleLayer;
}

/**
 * @function t
 * @description DevTools i18n 辅助。
 * @param key 翻译 key。
 * @param options 插值参数。
 * @returns 翻译结果。
 */
function t(key: string, options?: Record<string, unknown>): string {
    return i18n.t(key, options);
}

/**
 * @function summarizeKindCount
 * @description 统计指定类别的节点数。
 * @param nodes 节点集合。
 * @param kind 节点类别。
 * @returns 统计数量。
 */
function summarizeKindCount(
    nodes: ArchitectureNode[],
    kind: ArchitectureNodeKind,
): number {
    return nodes.filter((node) => node.kind === kind).length;
}

/**
 * @function getKindColorClass
 * @description 返回节点类别对应的样式类名。
 * @param kind 节点类别。
 * @returns 样式类名。
 */
function getKindColorClass(kind: ArchitectureNodeKind): string {
    return `architecture-node--${kind}`;
}

/**
 * @function getNodeSemanticColorClass
 * @description 返回节点的语义颜色类，用于区分插件侧与基础设施侧。
 * @param node 架构节点。
 * @returns 语义颜色类名。
 */
function getNodeSemanticColorClass(node: ArchitectureNode): string {
    if (node.kind === "plugin" || getNodeModuleLayer(node) === "plugin-logic") {
        return "architecture-node--plugin-side";
    }

    if (getNodeModuleLayer(node) === "infrastructure") {
        return "architecture-node--infrastructure-side";
    }

    return "architecture-node--neutral-side";
}

/**
 * @function getColumnSemanticClass
 * @description 返回列标题的语义颜色类。
 * @param column DAG 列定义。
 * @returns 列标题类名。
 */
function getColumnSemanticClass(column: LayoutColumn): string {
    if (column.moduleLayer === "plugin-logic") {
        return "architecture-column-label--plugin-side";
    }

    if (column.moduleLayer === "infrastructure") {
        return "architecture-column-label--infrastructure-side";
    }

    return "";
}

/**
 * @function getKindLabel
 * @description 将节点类别映射为当前语言文案。
 * @param kind 节点类别。
 * @returns 类别标签。
 */
function getKindLabel(kind: ArchitectureNodeKind): string {
    switch (kind) {
        case "plugin":
            return t("architectureDevtools.plugins");
        case "ui-module":
            return t("architectureDevtools.modules");
        case "store":
            return t("architectureDevtools.states");
        case "event":
            return t("architectureDevtools.events");
        case "frontend-api":
            return t("architectureDevtools.frontendApis");
        case "backend-api":
            return t("architectureDevtools.backendApis");
        default:
            return kind;
    }
}

/**
 * @function getModuleLayerLabel
 * @description 返回模块层级标签。
 * @param moduleLayer 模块层级。
 * @returns 标签文本。
 */
function getModuleLayerLabel(moduleLayer: ArchitectureModuleLayer): string {
    switch (moduleLayer) {
        case "infrastructure":
            return t("architectureDevtools.infrastructureModules");
        case "plugin-logic":
            return t("architectureDevtools.pluginLogicModules");
        default:
            return moduleLayer;
    }
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
 * @function getLayerCountFromMap
 * @description 计算层级映射中的总层数。
 * @param layerMap 层级映射。
 * @returns 层数，至少为 1。
 */
function getLayerCountFromMap(layerMap: Map<string, number>): number {
    return Math.max(
        1,
        Array.from(layerMap.values()).reduce((max, layer) => Math.max(max, layer + 1), 0),
    );
}

/**
 * @function buildNodeLayerMap
 * @description 针对节点子集构建层级映射。
 * @param subsetNodes 节点子集。
 * @param edges 当前边集合。
 * @returns 节点层级映射。
 */
function buildNodeLayerMap(
    subsetNodes: ArchitectureNode[],
    edges: ArchitectureEdge[],
): Map<string, number> {
    const kindNodes = [...subsetNodes].sort((left, right) => left.title.localeCompare(right.title));
    const kindNodeIds = new Set(kindNodes.map((node) => node.id));
    const sameKindEdges = edges.filter((edge) => {
        return kindNodeIds.has(edge.from) && kindNodeIds.has(edge.to) && edge.from !== edge.to;
    });

    const indegree = new Map<string, number>();
    const outgoing = new Map<string, string[]>();
    const layers = new Map<string, number>();

    kindNodes.forEach((node) => {
        indegree.set(node.id, 0);
        outgoing.set(node.id, []);
        layers.set(node.id, 0);
    });

    sameKindEdges.forEach((edge) => {
        outgoing.get(edge.from)?.push(edge.to);
        indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
    });

    const queue = kindNodes
        .filter((node) => (indegree.get(node.id) ?? 0) === 0)
        .map((node) => node.id);
    const visited = new Set<string>();

    while (queue.length > 0) {
        const currentId = queue.shift();
        if (!currentId) {
            continue;
        }

        visited.add(currentId);
        const currentLayer = layers.get(currentId) ?? 0;
        const targets = [...(outgoing.get(currentId) ?? [])].sort();

        targets.forEach((targetId) => {
            layers.set(targetId, Math.max(layers.get(targetId) ?? 0, currentLayer + 1));
            indegree.set(targetId, (indegree.get(targetId) ?? 0) - 1);
            if ((indegree.get(targetId) ?? 0) === 0) {
                queue.push(targetId);
            }
        });
    }

    const remainingIds = kindNodes
        .map((node) => node.id)
        .filter((nodeId) => !visited.has(nodeId))
        .sort();

    let fallbackBaseLayer = Array.from(layers.values()).reduce((max, layer) => {
        return Math.max(max, layer);
    }, 0);

    remainingIds.forEach((nodeId) => {
        const incomingLayers = sameKindEdges
            .filter((edge) => edge.to === nodeId)
            .map((edge) => layers.get(edge.from) ?? 0);
        const nextLayer = Math.max(fallbackBaseLayer + 1, ...incomingLayers.map((layer) => layer + 1));
        layers.set(nodeId, nextLayer);
        fallbackBaseLayer = nextLayer;
    });

    return layers;
}

/**
 * @function matchesNodeQuery
 * @description 判断节点是否匹配当前搜索词。
 * @param node 架构节点。
 * @param query 搜索词。
 * @returns 是否匹配。
 */
function matchesNodeQuery(node: ArchitectureNode, query: string): boolean {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
        return true;
    }

    const haystacks = [
        node.title,
        node.summary,
        node.location ?? "",
        ...(node.details ?? []),
    ];

    return haystacks.some((value) => value.toLowerCase().includes(normalizedQuery));
}

/**
 * @function buildVisibleNodeIds
 * @description 基于匹配结果扩展一跳邻居，保证筛选后仍能看懂上下游依赖。
 * @param nodes 全部节点。
 * @param edges 全部边。
 * @param matchedNodeIds 直接匹配的节点 ID 列表。
 * @param selectedNodeId 当前选中节点。
 * @returns 应展示的节点 ID 集合。
 */
function buildVisibleNodeIds(
    nodes: ArchitectureNode[],
    edges: ArchitectureEdge[],
    matchedNodeIds: string[],
    selectedNodeId: string | null,
): Set<string> {
    if (matchedNodeIds.length === 0) {
        return new Set(selectedNodeId ? [selectedNodeId] : []);
    }

    if (matchedNodeIds.length === nodes.length) {
        return new Set(nodes.map((node) => node.id));
    }

    const visible = new Set<string>(matchedNodeIds);
    if (selectedNodeId) {
        visible.add(selectedNodeId);
    }

    edges.forEach((edge) => {
        if (visible.has(edge.from) || visible.has(edge.to)) {
            visible.add(edge.from);
            visible.add(edge.to);
        }
    });

    return visible;
}

/**
 * @function formatEdgeDescription
 * @description 生成检查器里更易读的边描述。
 * @param edge 依赖边。
 * @param nodeMap 节点映射。
 * @returns 格式化后的描述文本。
 */
function formatEdgeDescription(
    edge: ArchitectureEdge,
    nodeMap: Map<string, ArchitectureNode>,
): string {
    const fromTitle = nodeMap.get(edge.from)?.title ?? edge.from;
    const toTitle = nodeMap.get(edge.to)?.title ?? edge.to;
    return edge.label ? `${fromTitle} -> ${toTitle} · ${edge.label}` : `${fromTitle} -> ${toTitle}`;
}

/**
 * @function buildKindLayerMap
 * @description 基于同类节点之间的依赖推导层级，确保展示时同层节点不产生依赖边。
 * @param nodes 当前节点集合。
 * @param edges 当前边集合。
 * @param kind 目标节点类别。
 * @returns 节点到层级的映射。
 */
function buildKindLayerMap(
    nodes: ArchitectureNode[],
    edges: ArchitectureEdge[],
    kind: ArchitectureNodeKind,
): Map<string, number> {
    if (kind !== "ui-module") {
        return buildNodeLayerMap(
            nodes.filter((node) => node.kind === kind),
            edges,
        );
    }

    const layerMap = new Map<string, number>();
    let offset = 0;

    MODULE_LAYER_ORDER.forEach((moduleLayer) => {
        const groupedNodes = nodes.filter((node) => {
            return node.kind === "ui-module" && getNodeModuleLayer(node) === moduleLayer;
        });
        if (groupedNodes.length === 0) {
            return;
        }

        const groupedLayerMap = buildNodeLayerMap(groupedNodes, edges);
        groupedLayerMap.forEach((layer, nodeId) => {
            layerMap.set(nodeId, offset + layer);
        });
        offset += getLayerCountFromMap(groupedLayerMap);
    });

    return layerMap;
}

/**
 * @function buildKindLayerMaps
 * @description 为所有节点类别建立独立层级映射。
 * @param nodes 当前节点集合。
 * @param edges 当前边集合。
 * @returns 类别到层级映射的集合。
 */
function buildKindLayerMaps(
    nodes: ArchitectureNode[],
    edges: ArchitectureEdge[],
): Map<ArchitectureNodeKind, Map<string, number>> {
    const maps = new Map<ArchitectureNodeKind, Map<string, number>>();
    KIND_ORDER.forEach((kind) => {
        maps.set(kind, buildKindLayerMap(nodes, edges, kind));
    });
    return maps;
}

/**
 * @function buildLayeredEdges
 * @description 对同类节点依赖边执行分层约束，仅保留跨层同类依赖。
 * @param nodes 当前节点集合。
 * @param edges 当前边集合。
 * @param kindLayerMaps 各类别层级映射。
 * @returns 过滤后的边集合。
 */
function buildLayeredEdges(
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
        return (layerMap?.get(edge.to) ?? 0) > (layerMap?.get(edge.from) ?? 0);
    });
}

/**
 * @function getLayoutColumns
 * @description 生成 DAG 的列定义，模块会按层级拆成多个子列。
 * @param kindLayerMaps 各类别层级映射。
 * @returns 列定义列表。
 */
function getLayoutColumns(
    nodes: ArchitectureNode[],
    kindLayerMaps: Map<ArchitectureNodeKind, Map<string, number>>,
): LayoutColumn[] {
    const columns: Array<Omit<LayoutColumn, "x">> = [];

    KIND_ORDER.forEach((kind) => {
        const layerMap = kindLayerMaps.get(kind);
        if (kind === "ui-module") {
            let offset = 0;

            MODULE_LAYER_ORDER.forEach((moduleLayer) => {
                const moduleNodes = nodes.filter((node) => {
                    return node.kind === "ui-module" && getNodeModuleLayer(node) === moduleLayer;
                });
                if (moduleNodes.length === 0) {
                    return;
                }

                const scopedLayerMap = new Map<string, number>();
                moduleNodes.forEach((node) => {
                    const currentLayer = (layerMap?.get(node.id) ?? offset) - offset;
                    scopedLayerMap.set(node.id, Math.max(0, currentLayer));
                });

                const layerCount = getLayerCountFromMap(scopedLayerMap);
                Array.from({ length: layerCount }, (_, index) => {
                    const globalLayer = offset + index;
                    columns.push({
                        id: `${kind}-${moduleLayer}-${globalLayer}`,
                        kind,
                        label: layerCount > 1
                            ? `${getModuleLayerLabel(moduleLayer)} L${index + 1}`
                            : getModuleLayerLabel(moduleLayer),
                        layer: globalLayer,
                        moduleLayer,
                    });
                });
                offset += layerCount;
            });

            return;
        }

        const layerCount = Math.max(
            1,
            Array.from(layerMap?.values() ?? []).reduce((max, layer) => Math.max(max, layer + 1), 0),
        );

        Array.from({ length: layerCount }, (_, index) => {
            columns.push({
                id: `${kind}-${index}`,
                kind,
                label: layerCount > 1 ? `${getKindLabel(kind)} L${index + 1}` : getKindLabel(kind),
                layer: index,
            });
        });
    });

    return columns.map((column, index) => ({
        ...column,
        x: PADDING_X + index * (NODE_WIDTH + COLUMN_GAP),
    }));
}

/**
 * @function buildLayout
 * @description 根据类别分列，生成简单稳定的 DAG 布局。
 * @param nodes 当前节点集合。
 * @param edges 当前边集合。
 * @returns 布局节点、视图宽高与位置索引。
 */
function buildLayout(nodes: ArchitectureNode[], edges: ArchitectureEdge[]): {
    layoutNodes: LayoutNode[];
    width: number;
    height: number;
    positions: Map<string, LayoutNode>;
    columns: LayoutColumn[];
    kindLayerMaps: Map<ArchitectureNodeKind, Map<string, number>>;
} {
    const kindLayerMaps = buildKindLayerMaps(nodes, edges);
    const columns = getLayoutColumns(nodes, kindLayerMaps);
    const grouped = new Map<string, ArchitectureNode[]>();

    columns.forEach((column) => {
        grouped.set(column.id, []);
    });

    nodes.forEach((node) => {
        const layerMap = kindLayerMaps.get(node.kind);
        const bucketId = node.kind === "ui-module"
            ? `${node.kind}-${getNodeModuleLayer(node) ?? "infrastructure"}-${layerMap?.get(node.id) ?? 0}`
            : `${node.kind}-${layerMap?.get(node.id) ?? 0}`;
        const bucket = grouped.get(bucketId);
        if (bucket) {
            bucket.push(node);
        }
    });

    grouped.forEach((bucket) => {
        bucket.sort((left, right) => left.title.localeCompare(right.title));
    });

    const columnNodeIds = columns.map((column) => {
        return (grouped.get(column.id) ?? []).map((node) => node.id);
    });
    const nodeToColumnIndex = new Map<string, number>();

    columnNodeIds.forEach((nodeIds, columnIndex) => {
        nodeIds.forEach((nodeId) => {
            nodeToColumnIndex.set(nodeId, columnIndex);
        });
    });

    const neighborsFromLeft = new Map<string, string[]>();
    const neighborsFromRight = new Map<string, string[]>();

    edges.forEach((edge) => {
        const fromColumnIndex = nodeToColumnIndex.get(edge.from);
        const toColumnIndex = nodeToColumnIndex.get(edge.to);
        if (fromColumnIndex === undefined || toColumnIndex === undefined) {
            return;
        }

        if (fromColumnIndex < toColumnIndex) {
            neighborsFromLeft.set(edge.to, [...(neighborsFromLeft.get(edge.to) ?? []), edge.from]);
            neighborsFromRight.set(edge.from, [...(neighborsFromRight.get(edge.from) ?? []), edge.to]);
            return;
        }

        if (toColumnIndex < fromColumnIndex) {
            neighborsFromLeft.set(edge.from, [...(neighborsFromLeft.get(edge.from) ?? []), edge.to]);
            neighborsFromRight.set(edge.to, [...(neighborsFromRight.get(edge.to) ?? []), edge.from]);
        }
    });

    const getPositionMap = (): Map<string, number> => {
        const map = new Map<string, number>();
        columnNodeIds.forEach((nodeIds) => {
            nodeIds.forEach((nodeId, rowIndex) => {
                map.set(nodeId, rowIndex);
            });
        });
        return map;
    };

    const sortColumnByBarycenter = (
        columnIndex: number,
        neighborMap: Map<string, string[]>,
        positionMap: Map<string, number>,
    ): void => {
        const nodeIds = columnNodeIds[columnIndex] ?? [];
        nodeIds.sort((leftId, rightId) => {
            const leftNeighbors = neighborMap.get(leftId) ?? [];
            const rightNeighbors = neighborMap.get(rightId) ?? [];
            const leftScore = leftNeighbors.length > 0
                ? leftNeighbors.reduce((sum, nodeId) => sum + (positionMap.get(nodeId) ?? 0), 0) / leftNeighbors.length
                : Number.MAX_SAFE_INTEGER;
            const rightScore = rightNeighbors.length > 0
                ? rightNeighbors.reduce((sum, nodeId) => sum + (positionMap.get(nodeId) ?? 0), 0) / rightNeighbors.length
                : Number.MAX_SAFE_INTEGER;

            if (leftScore !== rightScore) {
                return leftScore - rightScore;
            }

            const leftTitle = nodeMapForLayout.get(leftId)?.title ?? leftId;
            const rightTitle = nodeMapForLayout.get(rightId)?.title ?? rightId;
            return leftTitle.localeCompare(rightTitle);
        });
    };

    const nodeMapForLayout = new Map(nodes.map((node) => [node.id, node]));

    Array.from({ length: 4 }, () => {
        let positionMap = getPositionMap();
        for (let columnIndex = 1; columnIndex < columnNodeIds.length; columnIndex += 1) {
            sortColumnByBarycenter(columnIndex, neighborsFromLeft, positionMap);
            positionMap = getPositionMap();
        }

        positionMap = getPositionMap();
        for (let columnIndex = columnNodeIds.length - 2; columnIndex >= 0; columnIndex -= 1) {
            sortColumnByBarycenter(columnIndex, neighborsFromRight, positionMap);
            positionMap = getPositionMap();
        }
    });

    columns.forEach((column, columnIndex) => {
        const nodeIds = columnNodeIds[columnIndex] ?? [];
        grouped.set(column.id, nodeIds
            .map((nodeId) => nodeMapForLayout.get(nodeId))
            .filter((node): node is ArchitectureNode => node !== undefined));
    });

    const layoutNodes: LayoutNode[] = [];
    const positions = new Map<string, LayoutNode>();
    let maxRows = 0;

    columns.forEach((column) => {
        const bucket = grouped.get(column.id) ?? [];
        maxRows = Math.max(maxRows, bucket.length);

        bucket.forEach((node, rowIndex) => {
            const layoutNode: LayoutNode = {
                node,
                x: column.x,
                y: PADDING_Y + rowIndex * (NODE_HEIGHT + ROW_GAP),
            };
            layoutNodes.push(layoutNode);
            positions.set(node.id, layoutNode);
        });
    });

    return {
        columns,
        layoutNodes,
        kindLayerMaps,
        positions,
        width:
            PADDING_X * 2 +
            columns.length * NODE_WIDTH +
            (columns.length - 1) * COLUMN_GAP,
        height: PADDING_Y * 2 + maxRows * NODE_HEIGHT + Math.max(0, maxRows - 1) * ROW_GAP,
    };
}

/**
 * @function edgePath
 * @description 生成两点间的平滑贝塞尔路径。
 * @param from 起点。
 * @param to 终点。
 * @returns SVG path 字符串。
 */
function edgePath(from: LayoutNode, to: LayoutNode): string {
    const startX = from.x + NODE_WIDTH;
    const startY = from.y + NODE_HEIGHT / 2;
    const endX = to.x;
    const endY = to.y + NODE_HEIGHT / 2;
    const controlOffset = Math.max(48, (endX - startX) / 2);

    return [
        `M ${startX} ${startY}`,
        `C ${startX + controlOffset} ${startY}`,
        `${endX - controlOffset} ${endY}`,
        `${endX} ${endY}`,
    ].join(" ");
}

/**
 * @function collectRelatedEdges
 * @description 收集与选中节点相关的边。
 * @param edges 全部边。
 * @param nodeId 选中节点 ID。
 * @returns 相关边集合。
 */
function collectRelatedEdges(
    edges: ArchitectureEdge[],
    nodeId: string | null,
): ArchitectureEdge[] {
    if (!nodeId) {
        return [];
    }

    return edges.filter((edge) => edge.from === nodeId || edge.to === nodeId);
}

/**
 * @function InventorySection
 * @description 渲染指定类别节点的清单列表。
 * @param props.sectionTitle 区块标题。
 * @param props.nodes 节点集合。
 * @param props.selectedNodeId 当前选中节点。
 * @param props.onSelect 选择回调。
 * @returns ReactElement。
 */
function InventorySection(props: {
    sectionTitle: string;
    nodes: ArchitectureNode[];
    selectedNodeId: string | null;
    onSelect: (nodeId: string) => void;
    emptyMessage: string;
}): ReactElement {
    return (
        /* architecture-inventory-section: 架构清单区块容器 */
        <section className="architecture-inventory-section">
            {/* architecture-section-title: 区块标题 */}
            <div className="architecture-section-title">{props.sectionTitle}</div>
            {/* architecture-inventory-list: 区块列表 */}
            <div className="architecture-inventory-list">
                {props.nodes.length === 0 ? (
                    /* architecture-empty-state: 过滤后空状态 */
                    <div className="architecture-empty-state">{props.emptyMessage}</div>
                ) : (
                    props.nodes.map((node) => {
                        const isSelected = props.selectedNodeId === node.id;
                        return (
                            /* architecture-inventory-item: 单个架构条目 */
                            <button
                                key={node.id}
                                className={[
                                    "architecture-inventory-item",
                                    isSelected ? "architecture-inventory-item--selected" : "",
                                ].join(" ").trim()}
                                onClick={() => props.onSelect(node.id)}
                                type="button"
                            >
                                {/* architecture-inventory-item-meta: 条目元信息行 */}
                                <div className="architecture-inventory-item-meta">
                                    <span className="architecture-inventory-kind-chip">
                                        {getKindLabel(node.kind)}
                                    </span>
                                    {node.location ? (
                                        <span className="architecture-inventory-location">
                                            {node.location}
                                        </span>
                                    ) : null}
                                </div>
                                {/* architecture-inventory-item-title: 条目标题 */}
                                <div className="architecture-inventory-item-title">{node.title}</div>
                                {/* architecture-inventory-item-summary: 条目摘要 */}
                                <div className="architecture-inventory-item-summary">{node.summary}</div>
                                {node.details && node.details.length > 0 ? (
                                    /* architecture-detail-chip-row: 细项标签行 */
                                    <div className="architecture-detail-chip-row">
                                        {node.details.slice(0, 3).map((detail) => (
                                            /* architecture-detail-chip: 细项标签 */
                                            <span
                                                className="architecture-detail-chip"
                                                key={`${node.id}-${detail}`}
                                            >
                                                {detail}
                                            </span>
                                        ))}
                                    </div>
                                ) : null}
                            </button>
                        );
                    })
                )}
            </div>
        </section>
    );
}

/**
 * @function ArchitectureDevtoolsTab
 * @description 渲染架构可视化中心。
 * @returns DevTools tab 组件。
 */
export function ArchitectureDevtoolsTab(
    _props: IDockviewPanelProps<Record<string, unknown>>,
): ReactElement {
    const snapshot = useArchitectureSnapshot();
    const activities = useActivities();
    const panels = usePanels();
    const tabComponents = useTabComponents();

    const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
    const [query, setQuery] = useState("");
    const [activeKind, setActiveKind] = useState<ArchitectureNodeKind | "all">("all");
    const [dagViewMode, setDagViewMode] = useState<"fit" | "actual">("fit");

    useEffect(() => {
        if (snapshot.nodes.length === 0) {
            if (selectedNodeId !== null) {
                setSelectedNodeId(null);
            }
            return;
        }

        const hasSelectedNode = selectedNodeId
            ? snapshot.nodes.some((node) => node.id === selectedNodeId)
            : false;

        if (!hasSelectedNode) {
            setSelectedNodeId(snapshot.nodes[0]?.id ?? null);
        }
    }, [selectedNodeId, snapshot.nodes]);

    const nodeMap = useMemo(() => {
        return new Map(snapshot.nodes.map((node) => [node.id, node]));
    }, [snapshot.nodes]);

    const matchedNodes = useMemo(() => {
        return snapshot.nodes.filter((node) => {
            const kindMatched = activeKind === "all" || node.kind === activeKind;
            return kindMatched && matchesNodeQuery(node, query);
        });
    }, [activeKind, query, snapshot.nodes]);

    const kindLayerMaps = useMemo(() => {
        return buildKindLayerMaps(snapshot.nodes, snapshot.edges);
    }, [snapshot.edges, snapshot.nodes]);

    const layeredEdges = useMemo(() => {
        return buildLayeredEdges(snapshot.nodes, snapshot.edges, kindLayerMaps);
    }, [kindLayerMaps, snapshot.edges, snapshot.nodes]);

    const visibleNodeIds = useMemo(() => {
        return buildVisibleNodeIds(
            snapshot.nodes,
            layeredEdges,
            matchedNodes.map((node) => node.id),
            selectedNodeId,
        );
    }, [layeredEdges, matchedNodes, selectedNodeId, snapshot.nodes]);

    const visibleNodes = useMemo(() => {
        return snapshot.nodes.filter((node) => visibleNodeIds.has(node.id));
    }, [snapshot.nodes, visibleNodeIds]);

    const visibleEdges = useMemo(() => {
        return layeredEdges.filter((edge) => {
            const bothVisible = visibleNodeIds.has(edge.from) && visibleNodeIds.has(edge.to);
            if (!bothVisible) {
                return false;
            }

            if (matchedNodes.length === snapshot.nodes.length) {
                return true;
            }

            return (
                matchedNodes.some((node) => node.id === edge.from || node.id === edge.to) ||
                edge.from === selectedNodeId ||
                edge.to === selectedNodeId
            );
        });
    }, [layeredEdges, matchedNodes, selectedNodeId, snapshot.nodes.length, visibleNodeIds]);

    const layout = useMemo(() => buildLayout(visibleNodes, visibleEdges), [visibleEdges, visibleNodes]);
    const selectedNode = nodeMap.get(selectedNodeId ?? "") ?? null;
    const relatedEdges = collectRelatedEdges(visibleEdges, selectedNodeId);

    const highlightedNodeIds = useMemo(() => {
        const next = new Set<string>();
        if (selectedNodeId) {
            next.add(selectedNodeId);
        }
        relatedEdges.forEach((edge) => {
            next.add(edge.from);
            next.add(edge.to);
        });
        return next;
    }, [relatedEdges, selectedNodeId]);

    const inventoryNodes = useMemo(() => {
        return KIND_ORDER.map((kind) => ({
            kind,
            label: getKindLabel(kind),
            nodes: matchedNodes.filter((node) => node.kind === kind),
        }));
    }, [matchedNodes]);

    const runtimeGroups = [
        {
            label: t("architectureDevtools.activities"),
            items: activities.map((activity) => activity.id),
        },
        {
            label: t("architectureDevtools.panels"),
            items: panels.map((panel) => panel.id),
        },
        {
            label: t("architectureDevtools.tabs"),
            items: tabComponents.map((tabComponent) => tabComponent.id),
        },
    ];

    return (
        /* architecture-devtools: 页面根容器 */
        <div className="architecture-devtools">
            {/* architecture-hero: 页面头部与核心说明 */}
            <header className="architecture-hero">
                {/* architecture-hero-main: 页面标题区 */}
                <div className="architecture-hero-main">
                    {/* architecture-hero-kicker: 页面前缀 */}
                    <div className="architecture-hero-kicker">{t("architectureDevtools.kicker")}</div>
                    {/* architecture-hero-title: 页面标题 */}
                    <h2 className="architecture-hero-title">{t("architectureDevtools.title")}</h2>
                    {/* architecture-hero-description: 页面简介 */}
                    <p className="architecture-hero-description">
                        {t("architectureDevtools.description")}
                    </p>
                </div>

                {/* architecture-overview-card: 概览区 */}
                <section className="architecture-overview-card">
                    {/* architecture-summary-grid: 汇总卡片网格 */}
                    <div className="architecture-summary-grid">
                        <div className="architecture-summary-card">
                            <div className="architecture-summary-label">
                                {t("architectureDevtools.states")}
                            </div>
                            <div className="architecture-summary-value">
                                {summarizeKindCount(snapshot.nodes, "store")}
                            </div>
                        </div>
                        <div className="architecture-summary-card">
                            <div className="architecture-summary-label">
                                {t("architectureDevtools.events")}
                            </div>
                            <div className="architecture-summary-value">
                                {summarizeKindCount(snapshot.nodes, "event")}
                            </div>
                        </div>
                        <div className="architecture-summary-card">
                            <div className="architecture-summary-label">
                                {t("architectureDevtools.frontendApis")}
                            </div>
                            <div className="architecture-summary-value">
                                {summarizeKindCount(snapshot.nodes, "frontend-api")}
                            </div>
                        </div>
                        <div className="architecture-summary-card">
                            <div className="architecture-summary-label">
                                {t("architectureDevtools.backendApis")}
                            </div>
                            <div className="architecture-summary-value">
                                {summarizeKindCount(snapshot.nodes, "backend-api")}
                            </div>
                        </div>
                        <div className="architecture-summary-card">
                            <div className="architecture-summary-label">
                                {t("architectureDevtools.runtimeExtensions")}
                            </div>
                            <div className="architecture-summary-value">
                                {activities.length + panels.length + tabComponents.length}
                            </div>
                        </div>
                    </div>
                </section>
            </header>

            {/* architecture-toolbar: 搜索与筛选区 */}
            <section className="architecture-toolbar">
                <input
                    aria-label={t("architectureDevtools.searchPlaceholder")}
                    className="architecture-search-input"
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder={t("architectureDevtools.searchPlaceholder")}
                    type="search"
                    value={query}
                />
                <div className="architecture-filter-row">
                    {FILTER_KIND_ORDER.map((kind) => {
                        const isActive = activeKind === kind;
                        const label = kind === "all"
                            ? t("architectureDevtools.allKinds")
                            : getKindLabel(kind);
                        return (
                            <button
                                className={[
                                    "architecture-filter-chip",
                                    isActive ? "architecture-filter-chip--active" : "",
                                ].join(" ").trim()}
                                key={kind}
                                onClick={() => setActiveKind(kind)}
                                type="button"
                            >
                                {label}
                            </button>
                        );
                    })}
                </div>
                <div className="architecture-toolbar-meta">
                    {t("architectureDevtools.visibleNodes", {
                        visible: matchedNodes.length,
                        total: snapshot.nodes.length,
                    })}
                </div>
            </section>

            {/* architecture-main-grid: DAG 与右侧检查器布局 */}
            <section className="architecture-main-grid">
                {/* architecture-dag-card: DAG 画布卡片 */}
                <div className="architecture-dag-card">
                    <div className="architecture-dag-header">
                        <div className="architecture-section-title">
                            {t("architectureDevtools.dagTitle")}
                        </div>
                        <div className="architecture-dag-actions">
                            <div className="architecture-dag-view-switch">
                                <button
                                    aria-pressed={dagViewMode === "fit"}
                                    className={[
                                        "architecture-dag-view-button",
                                        dagViewMode === "fit"
                                            ? "architecture-dag-view-button--active"
                                            : "",
                                    ].join(" ").trim()}
                                    onClick={() => setDagViewMode("fit")}
                                    type="button"
                                >
                                    {t("architectureDevtools.dagFitView")}
                                </button>
                                <button
                                    aria-pressed={dagViewMode === "actual"}
                                    className={[
                                        "architecture-dag-view-button",
                                        dagViewMode === "actual"
                                            ? "architecture-dag-view-button--active"
                                            : "",
                                    ].join(" ").trim()}
                                    onClick={() => setDagViewMode("actual")}
                                    type="button"
                                >
                                    {t("architectureDevtools.dagActualView")}
                                </button>
                            </div>
                            <div className="architecture-dag-meta">
                                {matchedNodes.length === 0
                                    ? t("architectureDevtools.noMatches")
                                    : t("architectureDevtools.relatedEdges", {
                                        count: visibleEdges.length,
                                    })}
                            </div>
                        </div>
                    </div>
                    {/* architecture-dag-scroll: DAG 横向滚动容器 */}
                    <div
                        className={[
                            "architecture-dag-scroll",
                            dagViewMode === "fit" ? "architecture-dag-scroll--fit" : "",
                        ].join(" ").trim()}
                    >
                        {matchedNodes.length === 0 ? (
                            <div className="architecture-empty-state">
                                {t("architectureDevtools.noMatches")}
                            </div>
                        ) : (
                            <svg
                                className={[
                                    "architecture-dag-canvas",
                                    dagViewMode === "fit"
                                        ? "architecture-dag-canvas--fit"
                                        : "architecture-dag-canvas--actual",
                                ].join(" ").trim()}
                                height={dagViewMode === "fit" ? undefined : layout.height}
                                preserveAspectRatio="xMinYMin meet"
                                viewBox={`0 0 ${layout.width} ${layout.height}`}
                                width={dagViewMode === "fit" ? undefined : layout.width}
                            >
                                {layout.columns.map((column) => {
                                    return (
                                        <text
                                            className={[
                                                "architecture-column-label",
                                                getColumnSemanticClass(column),
                                            ].join(" ").trim()}
                                            key={column.id}
                                            x={column.x}
                                            y={18}
                                        >
                                            {column.label}
                                        </text>
                                    );
                                })}

                                {visibleEdges.map((edge) => {
                                    const from = layout.positions.get(edge.from);
                                    const to = layout.positions.get(edge.to);
                                    if (!from || !to) {
                                        return null;
                                    }

                                    const isHighlighted =
                                        !selectedNodeId ||
                                        edge.from === selectedNodeId ||
                                        edge.to === selectedNodeId;

                                    return (
                                        <path
                                            className={[
                                                "architecture-edge",
                                                isHighlighted
                                                    ? "architecture-edge--highlighted"
                                                    : "architecture-edge--dimmed",
                                            ].join(" ")}
                                            d={edgePath(from, to)}
                                            key={`${edge.from}-${edge.to}-${edge.kind}-${edge.label ?? ""}`}
                                        />
                                    );
                                })}

                                {layout.layoutNodes.map((layoutNode) => {
                                    const isSelected = selectedNodeId === layoutNode.node.id;
                                    const isRelated = highlightedNodeIds.has(layoutNode.node.id);

                                    return (
                                        <g
                                            className={[
                                                "architecture-node",
                                                getKindColorClass(layoutNode.node.kind),
                                                getNodeSemanticColorClass(layoutNode.node),
                                                isSelected
                                                    ? "architecture-node--selected"
                                                    : isRelated
                                                        ? "architecture-node--related"
                                                        : "architecture-node--idle",
                                            ].join(" ")}
                                            key={layoutNode.node.id}
                                            onClick={() => setSelectedNodeId(layoutNode.node.id)}
                                            onKeyDown={(event) => {
                                                if (event.key === "Enter" || event.key === " ") {
                                                    event.preventDefault();
                                                    setSelectedNodeId(layoutNode.node.id);
                                                }
                                            }}
                                            role="button"
                                            tabIndex={0}
                                        >
                                            <title>{`${layoutNode.node.title}: ${layoutNode.node.summary}`}</title>
                                            <rect
                                                height={NODE_HEIGHT}
                                                rx={18}
                                                width={NODE_WIDTH}
                                                x={layoutNode.x}
                                                y={layoutNode.y}
                                            />
                                            <text
                                                className="architecture-node-kind"
                                                x={layoutNode.x + 16}
                                                y={layoutNode.y + 24}
                                            >
                                                {getKindLabel(layoutNode.node.kind)}
                                            </text>
                                            <foreignObject
                                                height={28}
                                                width={NODE_WIDTH - 32}
                                                x={layoutNode.x + 16}
                                                y={layoutNode.y + 31}
                                            >
                                                <div className="architecture-node-title-box">
                                                    {layoutNode.node.title}
                                                </div>
                                            </foreignObject>
                                            <foreignObject
                                                height={38}
                                                width={NODE_WIDTH - 32}
                                                x={layoutNode.x + 16}
                                                y={layoutNode.y + 58}
                                            >
                                                <div className="architecture-node-summary-box">
                                                    {layoutNode.node.summary}
                                                </div>
                                            </foreignObject>
                                        </g>
                                    );
                                })}
                            </svg>
                        )}
                    </div>
                </div>

                {/* architecture-inspector-card: 右侧检查器 */}
                <aside className="architecture-inspector-card">
                    <div className="architecture-section-title">
                        {t("architectureDevtools.inspector")}
                    </div>
                    {selectedNode ? (
                        <>
                            {/* architecture-inspector-kind: 节点类别标签 */}
                            <div className="architecture-inspector-kind">
                                {selectedNode.kind === "ui-module" && getNodeModuleLayer(selectedNode)
                                    ? `${getKindLabel(selectedNode.kind)} · ${getModuleLayerLabel(getNodeModuleLayer(selectedNode))}`
                                    : getKindLabel(selectedNode.kind)}
                            </div>
                            {/* architecture-inspector-title: 节点标题 */}
                            <h3 className="architecture-inspector-title">
                                {selectedNode.title}
                            </h3>
                            {/* architecture-inspector-summary: 节点摘要 */}
                            <p className="architecture-inspector-summary">
                                {selectedNode.summary}
                            </p>
                            {selectedNode.location ? (
                                /* architecture-location-chip: 源码位置 */
                                <div className="architecture-location-chip">
                                    {selectedNode.location}
                                </div>
                            ) : null}
                            {selectedNode.details && selectedNode.details.length > 0 ? (
                                /* architecture-inspector-list: 节点明细 */
                                <div className="architecture-inspector-list">
                                    {selectedNode.details.map((detail) => (
                                        <div
                                            className="architecture-inspector-item"
                                            key={`${selectedNode.id}-${detail}`}
                                        >
                                            {detail}
                                        </div>
                                    ))}
                                </div>
                            ) : null}

                            {/* architecture-inspector-subtitle: 关联边标题 */}
                            <div className="architecture-inspector-subtitle">
                                {t("architectureDevtools.relatedEdges", {
                                    count: relatedEdges.length,
                                })}
                            </div>
                            <div className="architecture-inspector-list">
                                {relatedEdges.map((edge) => (
                                    <div
                                        className="architecture-inspector-item"
                                        key={`${edge.from}-${edge.to}-${edge.kind}-${edge.label ?? ""}`}
                                    >
                                        {formatEdgeDescription(edge, nodeMap)}
                                    </div>
                                ))}
                            </div>
                        </>
                    ) : (
                        <p className="architecture-inspector-summary">
                            {t("architectureDevtools.emptySelection")}
                        </p>
                    )}
                </aside>
            </section>

            {/* architecture-runtime-grid: 当前运行时扩展注册面 */}
            <section className="architecture-runtime-grid">
                <div className="architecture-runtime-header">
                    <div className="architecture-section-title">
                        {t("architectureDevtools.runtimeSurfaceTitle")}
                    </div>
                    <div className="architecture-runtime-description">
                        {t("architectureDevtools.runtimeSurfaceDescription")}
                    </div>
                </div>
                <div className="architecture-runtime-groups">
                    {runtimeGroups.map((group) => (
                        <div className="architecture-runtime-card" key={group.label}>
                            <div className="architecture-section-title">{group.label}</div>
                            <div className="architecture-mini-list">
                                {group.items.map((item) => (
                                    <div className="architecture-mini-item" key={item}>
                                        {item}
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            </section>

            {/* architecture-inventory-header: 清单标题 */}
            <section className="architecture-inventory-header">
                <div className="architecture-section-title">
                    {t("architectureDevtools.inventoryTitle")}
                </div>
                <div className="architecture-toolbar-meta">
                    {t("architectureDevtools.visibleNodes", {
                        visible: matchedNodes.length,
                        total: snapshot.nodes.length,
                    })}
                </div>
            </section>

            {/* architecture-inventory-grid: 全量架构清单 */}
            <section className="architecture-inventory-grid">
                {inventoryNodes.map((section) => (
                    <InventorySection
                        emptyMessage={t("architectureDevtools.noMatches")}
                        key={section.kind}
                        nodes={section.nodes}
                        onSelect={setSelectedNodeId}
                        sectionTitle={section.label}
                        selectedNodeId={selectedNodeId}
                    />
                ))}
            </section>
        </div>
    );
}