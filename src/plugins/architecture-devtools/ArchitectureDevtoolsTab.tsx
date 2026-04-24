/**
 * @module plugins/architecture-devtools/ArchitectureDevtoolsTab
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
 *   - ../../host/registry
 *   - ./architectureRegistry
 *   - ./architectureDevtools.css
 *
 * @exports
 *   - ArchitectureDevtoolsTab
 */

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactElement } from "react";
import type { WorkbenchTabProps } from "../../host/layout/workbenchContracts";
import i18n from "../../i18n";
import { useActivities, usePanels, useTabComponents } from "../../host/registry";
import { ArchitectureDagEdgeCanvas } from "./ArchitectureDagEdgeCanvas";
import {
    buildArchitectureEdgeAdjacencyIndex,
    collectArchitectureHighlightedNodeIds,
    getArchitectureNodeRelatedEdges,
} from "./architectureEdgeIndex";
import {
    useArchitectureSnapshot,
    type ArchitectureEdge,
    type ArchitectureModuleLayer,
    type ArchitectureNode,
    type ArchitectureNodeKind,
} from "./architectureRegistry";
import {
    buildTransitiveVisibleNodeIds,
    type GraphTraversalMode,
} from "./architectureGraphTraversal";
import { buildLayeredEdges } from "./architectureLayeredEdges";
import {
    collectReverseModuleDependencyDetails,
    formatReverseModuleDependencyDetailsForClipboard,
} from "./architectureReverseDependency";
import "./architectureDevtools.css";

const NODE_WIDTH = 236;
const NODE_HEIGHT = 104;
const COLUMN_GAP = 64;
const ROW_GAP = 20;
const PADDING_X = 32;
const PADDING_Y = 28;
const DAG_HOVER_CLEAR_DELAY_MS = 42;

const KIND_ORDER: ArchitectureNodeKind[] = [
    "plugin",
    "ui-module",
    "store",
    "event",
    "frontend-api",
    "backend-api",
    "backend-event",
    "backend-module",
];

const FILTER_KIND_ORDER: Array<ArchitectureNodeKind | "all"> = [
    "all",
    "plugin",
    "ui-module",
    "store",
    "event",
    "frontend-api",
    "backend-api",
    "backend-event",
    "backend-module",
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
 * @interface ArchitectureDagNodeProps
 * @description 单个 DAG 节点的渲染参数，收敛 hover/focus 与检查器交互。
 */
interface ArchitectureDagNodeProps {
    /** 当前节点布局信息。 */
    layoutNode: LayoutNode;
    /** 当前节点是否为直接聚焦节点。 */
    isFocused: boolean;
    /** 当前节点是否与聚焦节点相关联。 */
    isRelated: boolean;
    /** 打开节点检查器。 */
    onOpenInspector(nodeId: string): void;
}

/**
 * @interface PinchGestureEventLike
 * @description WebKit gesture 事件的最小结构，用于桌面触控板双指缩放。
 * @field scale 当前手势相对起点的缩放比例。
 * @field clientX 手势焦点 X 坐标。
 * @field clientY 手势焦点 Y 坐标。
 */
interface PinchGestureEventLike extends Event {
    /** 当前手势相对起点的缩放比例。 */
    scale: number;
    /** 手势焦点 X 坐标。 */
    clientX: number;
    /** 手势焦点 Y 坐标。 */
    clientY: number;
}

/**
 * @interface DagPinchAnchor
 * @description 记录一次双指缩放的起始视口状态，用于基于起点计算绝对滚动位置。
 * @field zoom 手势起点缩放值。
 * @field viewportOffsetX 手势起点在容器内的 X 偏移。
 * @field viewportOffsetY 手势起点在容器内的 Y 偏移。
 * @field logicalContentX 手势起点对应的逻辑内容 X 坐标。
 * @field logicalContentY 手势起点对应的逻辑内容 Y 坐标。
 */
interface DagPinchAnchor {
    /** 手势起点缩放值。 */
    zoom: number;
    /** 手势起点在容器内的 X 偏移。 */
    viewportOffsetX: number;
    /** 手势起点在容器内的 Y 偏移。 */
    viewportOffsetY: number;
    /** 手势起点对应的逻辑内容 X 坐标。 */
    logicalContentX: number;
    /** 手势起点对应的逻辑内容 Y 坐标。 */
    logicalContentY: number;
}

/**
 * @interface DagWheelZoomSession
 * @description 记录一次 ctrl+wheel 缩放序列的起点与累计滚轮位移。
 * @field anchor 序列起点锚点。
 * @field accumulatedDeltaY 自序列开始以来累计的 deltaY。
 * @field lastEventAt 最近一次事件时间戳。
 */
interface DagWheelZoomSession {
    /** 序列起点锚点。 */
    anchor: DagPinchAnchor;
    /** 自序列开始以来累计的 deltaY。 */
    accumulatedDeltaY: number;
    /** 最近一次事件时间戳。 */
    lastEventAt: number;
}

/**
 * @interface DagPointerSample
 * @description 记录最近一次鼠标在 DAG 容器内的位置，包含容器本地偏移与采样时间。
 * @field clientX 鼠标全局 X 坐标。
 * @field clientY 鼠标全局 Y 坐标。
 * @field viewportOffsetX 鼠标在容器内的 X 偏移。
 * @field viewportOffsetY 鼠标在容器内的 Y 偏移。
 * @field capturedAt 采样时间戳。
 */
interface DagPointerSample {
    /** 鼠标全局 X 坐标。 */
    clientX: number;
    /** 鼠标全局 Y 坐标。 */
    clientY: number;
    /** 鼠标在容器内的 X 偏移。 */
    viewportOffsetX: number;
    /** 鼠标在容器内的 Y 偏移。 */
    viewportOffsetY: number;
    /** 采样时间戳。 */
    capturedAt: number;
}

/**
 * @interface TouchPointLike
 * @description 双指手势计算所需的最小触点结构，仅依赖 client 坐标。
 * @field clientX 触点 X 坐标。
 * @field clientY 触点 Y 坐标。
 */
interface TouchPointLike {
    /** 触点 X 坐标。 */
    clientX: number;
    /** 触点 Y 坐标。 */
    clientY: number;
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
        case "backend-event":
            return t("architectureDevtools.backendEvents");
        case "backend-module":
            return t("architectureDevtools.backendModules");
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
 * @function getArchitectureEdgeKey
 * @description 生成架构边的稳定键，用于渲染和状态映射。
 * @param edge 架构边。
 * @returns 稳定键。
 */
function getArchitectureEdgeKey(edge: ArchitectureEdge): string {
    return `${edge.from}-${edge.to}-${edge.kind}-${edge.label ?? ""}`;
}

/**
 * @function resolveHoveredArchitectureNodeId
 * @description 从当前事件目标向上解析命中的 DAG 节点 ID，供舞台级 hover 委托复用。
 * @param target 当前事件目标。
 * @returns 命中的节点 ID；未命中时返回 null。
 */
function resolveHoveredArchitectureNodeId(target: EventTarget | null): string | null {
    if (!(target instanceof Element)) {
        return null;
    }

    const nodeElement = target.closest("[data-architecture-node-id]");
    return nodeElement instanceof Element
        ? nodeElement.getAttribute("data-architecture-node-id")
        : null;
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
        const kindNodes = nodes.filter((node) => node.kind === kind);
        if (kindNodes.length === 0) {
            return;
        }

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
            kindNodes.reduce((max, node) => Math.max(max, (layerMap?.get(node.id) ?? 0) + 1), 0),
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
 * @function clampDagZoom
 * @description 限制 DAG 缩放范围，避免过小或过大导致不可用。
 * @param value 候选缩放值。
 * @returns 限制后的缩放值。
 */
function clampDagZoom(value: number): number {
    return Math.min(2.5, Math.max(0.45, value));
}

/**
 * @function getTouchDistance
 * @description 计算双触点之间的欧式距离。
 * @param first 第一触点。
 * @param second 第二触点。
 * @returns 两点距离。
 */
function getTouchDistance(first: TouchPointLike, second: TouchPointLike): number {
    const deltaX = first.clientX - second.clientX;
    const deltaY = first.clientY - second.clientY;
    return Math.hypot(deltaX, deltaY);
}

/**
 * @function getTouchCenter
 * @description 计算双触点中心点，用于围绕手势焦点缩放。
 * @param first 第一触点。
 * @param second 第二触点。
 * @returns 中心点坐标。
 */
function getTouchCenter(first: TouchPointLike, second: TouchPointLike): { x: number; y: number } {
    return {
        x: (first.clientX + second.clientX) / 2,
        y: (first.clientY + second.clientY) / 2,
    };
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
    onFocusNode: (nodeId: string | null) => void;
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
                                onFocus={() => props.onFocusNode(node.id)}
                                onBlur={() => props.onFocusNode(null)}
                                onMouseEnter={() => props.onFocusNode(node.id)}
                                onMouseLeave={() => props.onFocusNode(null)}
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
 * @function ArchitectureDagNode
 * @description 渲染单个 DAG 节点，并将 hover/focus 交互保持在稳定回调之上，减少整图重渲染时的无效更新。
 * @param props 节点渲染参数。
 * @returns ReactElement。
 */
const ArchitectureDagNode = memo(function ArchitectureDagNode(
    props: ArchitectureDagNodeProps,
): ReactElement {
    const { layoutNode } = props;

    return (
        <g
            className={[
                "architecture-node",
                getKindColorClass(layoutNode.node.kind),
                getNodeSemanticColorClass(layoutNode.node),
                props.isFocused
                    ? "architecture-node--selected"
                    : props.isRelated
                        ? "architecture-node--related"
                        : "architecture-node--idle",
            ].join(" ")}
            data-architecture-node-id={layoutNode.node.id}
            onClick={() => props.onOpenInspector(layoutNode.node.id)}
            onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    props.onOpenInspector(layoutNode.node.id);
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
}, (previousProps, nextProps) => {
    return previousProps.layoutNode === nextProps.layoutNode
        && previousProps.isFocused === nextProps.isFocused
        && previousProps.isRelated === nextProps.isRelated
    && previousProps.onOpenInspector === nextProps.onOpenInspector;
});

/**
 * @function ArchitectureDevtoolsTab
 * @description 渲染架构可视化中心。
 * @returns DevTools tab 组件。
 */
export function ArchitectureDevtoolsTab(
    _props: WorkbenchTabProps<Record<string, unknown>>,
): ReactElement {
    const snapshot = useArchitectureSnapshot();
    const activities = useActivities();
    const panels = usePanels();
    const tabComponents = useTabComponents();

    const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
    const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);
    const [isInspectorOpen, setIsInspectorOpen] = useState(false);
    const [query, setQuery] = useState("");
    const [exactRootNodeId, setExactRootNodeId] = useState<string | null>(null);
    const [activeKind, setActiveKind] = useState<ArchitectureNodeKind | "all">("all");
    const [graphTraversalMode, setGraphTraversalMode] = useState<GraphTraversalMode>("dependencies");
    const [dagZoom, setDagZoom] = useState(1);
    const [pinchMode, setPinchMode] = useState<"none" | "touch" | "gesture">("none");
    const [reverseDependencyCopyState, setReverseDependencyCopyState] = useState<"idle" | "copied" | "error">("idle");
    const dagScrollRef = useRef<HTMLDivElement | null>(null);
    const dagViewportRef = useRef<HTMLDivElement | null>(null);
    const dagStageRef = useRef<HTMLDivElement | null>(null);
    const dagZoomRef = useRef(1);
    const dagLayoutSizeRef = useRef({ width: 0, height: 0 });
    const dagScrollPositionRef = useRef({ left: 0, top: 0 });
    const pinchScrollRestoreFrameRef = useRef<number | null>(null);
    const dagZoomPreviewFrameRef = useRef<number | null>(null);
    const pendingDagZoomPreviewRef = useRef<{ zoom: number; left: number; top: number } | null>(null);
    const dagZoomCommitTimerRef = useRef<number | null>(null);
    const touchPinchStateRef = useRef<{ distance: number; anchor: DagPinchAnchor } | null>(null);
    const gesturePinchStateRef = useRef<DagPinchAnchor | null>(null);
    const globalPointerPositionRef = useRef<{ clientX: number; clientY: number } | null>(null);
    const dagPointerSampleRef = useRef<DagPointerSample | null>(null);
    const wheelZoomSessionRef = useRef<DagWheelZoomSession | null>(null);
    const wheelZoomSuppressionUntilRef = useRef(0);
    const pinchModeRef = useRef<"none" | "touch" | "gesture">("none");
    const suppressScrollSyncRef = useRef(false);
    const focusedNodeIdRef = useRef<string | null>(null);
    const pendingFocusedNodeIdRef = useRef<string | null>(null);
    const focusedNodeFrameRef = useRef<number | null>(null);
    const focusedNodeClearTimerRef = useRef<number | null>(null);
    const hoveredDagNodeIdRef = useRef<string | null>(null);

    /**
     * @function applyFocusedNodeIdState
     * @description 立即提交聚焦节点状态，并同步 ref，供 hover 帧合并与失效清理共享。
     * @param nextNodeId 目标聚焦节点 ID。
     */
    const applyFocusedNodeIdState = useCallback((nextNodeId: string | null): void => {
        focusedNodeIdRef.current = nextNodeId;
        pendingFocusedNodeIdRef.current = nextNodeId;
        setFocusedNodeId((currentNodeId) => {
            return currentNodeId === nextNodeId ? currentNodeId : nextNodeId;
        });
    }, []);

    /**
     * @function commitFocusedNodeId
     * @description 使用 requestAnimationFrame 合并同一帧内的多次 hover 更新，避免节点切换时重复重渲染。
     * @param nextNodeId 目标聚焦节点 ID。
     */
    const commitFocusedNodeId = useCallback((nextNodeId: string | null): void => {
        pendingFocusedNodeIdRef.current = nextNodeId;
        if (focusedNodeFrameRef.current !== null) {
            return;
        }

        focusedNodeFrameRef.current = requestAnimationFrame(() => {
            focusedNodeFrameRef.current = null;
            applyFocusedNodeIdState(pendingFocusedNodeIdRef.current ?? null);
        });
    }, [applyFocusedNodeIdState]);

    /**
     * @function scheduleFocusedNodeId
     * @description 调度 hover/focus 造成的聚焦节点变更；清空动作延迟一小段时间，避免相邻节点切换时出现 null 抖动。
     * @param nextNodeId 目标聚焦节点 ID。
     * @param options 可选调度参数。
     */
    const scheduleFocusedNodeId = useCallback((
        nextNodeId: string | null,
        options?: { delayMs?: number },
    ): void => {
        if (focusedNodeClearTimerRef.current !== null) {
            window.clearTimeout(focusedNodeClearTimerRef.current);
            focusedNodeClearTimerRef.current = null;
        }

        const delayMs = options?.delayMs ?? 0;
        if (nextNodeId === null && delayMs > 0) {
            focusedNodeClearTimerRef.current = window.setTimeout(() => {
                focusedNodeClearTimerRef.current = null;
                commitFocusedNodeId(null);
            }, delayMs);
            return;
        }

        commitFocusedNodeId(nextNodeId);
    }, [commitFocusedNodeId]);

    /**
     * @function handleDagOverlayMouseMove
     * @description 通过 DAG 叠加层统一处理 hover，避免每个节点单独绑定 enter/leave 事件。
     * @param event 当前鼠标移动事件。
     */
    const handleDagOverlayMouseMove = useCallback((event: ReactMouseEvent<SVGSVGElement>): void => {
        const nextNodeId = resolveHoveredArchitectureNodeId(event.target);
        if (hoveredDagNodeIdRef.current === nextNodeId) {
            return;
        }

        hoveredDagNodeIdRef.current = nextNodeId;
        scheduleFocusedNodeId(nextNodeId, nextNodeId === null
            ? { delayMs: DAG_HOVER_CLEAR_DELAY_MS }
            : undefined);
    }, [scheduleFocusedNodeId]);

    /**
     * @function handleDagOverlayMouseLeave
     * @description 鼠标离开 DAG 叠加层时延迟清空 hover 聚焦，避免快速划过时出现 null 抖动。
     */
    const handleDagOverlayMouseLeave = useCallback((): void => {
        if (hoveredDagNodeIdRef.current === null) {
            return;
        }

        hoveredDagNodeIdRef.current = null;
        scheduleFocusedNodeId(null, { delayMs: DAG_HOVER_CLEAR_DELAY_MS });
    }, [scheduleFocusedNodeId]);

    /**
     * @function handleDagNodeFocus
     * @description 处理键盘焦点进入某个节点时的聚焦状态同步。
     * @param event 当前焦点事件。
     */
    const handleDagNodeFocus = useCallback((event: Event): void => {
        const nextNodeId = resolveHoveredArchitectureNodeId(event.target);
        if (!nextNodeId) {
            return;
        }

        hoveredDagNodeIdRef.current = nextNodeId;
        scheduleFocusedNodeId(nextNodeId);
    }, [scheduleFocusedNodeId]);

    /**
     * @function handleDagNodeBlur
     * @description 在键盘焦点离开 DAG 节点时清理聚焦态。
     * @param event 当前失焦事件。
     */
    const handleDagNodeBlur = useCallback((event: FocusEvent): void => {
        const nextTarget = event.relatedTarget;
        const nextNodeId = resolveHoveredArchitectureNodeId(nextTarget);
        if (nextNodeId) {
            hoveredDagNodeIdRef.current = nextNodeId;
            scheduleFocusedNodeId(nextNodeId);
            return;
        }

        hoveredDagNodeIdRef.current = null;
        scheduleFocusedNodeId(null, { delayMs: DAG_HOVER_CLEAR_DELAY_MS });
    }, [scheduleFocusedNodeId]);

    /**
     * @function resolveDesktopAnchorPoint
     * @description 解析桌面缩放起点，优先使用最近一次鼠标位置，避免 WebKit 手势中心偏离可见光标。
     * @param fallbackClientX 回退用 X 坐标。
     * @param fallbackClientY 回退用 Y 坐标。
     * @returns 实际用于生成缩放锚点的坐标。
     */
    const resolveDesktopAnchorPoint = (
        fallbackClientX: number,
        fallbackClientY: number,
    ): DagPointerSample | { clientX: number; clientY: number } => {
        const localSample = dagPointerSampleRef.current;
        if (localSample && Date.now() - localSample.capturedAt < 400) {
            return localSample;
        }

        const container = dagScrollRef.current;
        const pointer = globalPointerPositionRef.current;
        if (container && pointer) {
            const rect = container.getBoundingClientRect();
            const isInsideContainer =
                pointer.clientX >= rect.left &&
                pointer.clientX <= rect.right &&
                pointer.clientY >= rect.top &&
                pointer.clientY <= rect.bottom;

            if (isInsideContainer) {
                return pointer;
            }
        }

        return {
            clientX: fallbackClientX,
            clientY: fallbackClientY,
        };
    };

    /**
     * @function captureDagPinchAnchor
     * @description 记录当前缩放起点，用于后续按绝对方式求解滚动位置。
     * @param clientX 起点焦点 X 坐标。
     * @param clientY 起点焦点 Y 坐标。
     * @returns 缩放起点信息；容器缺失时返回 null。
     */
    const captureDagPinchAnchor = (
        clientX: number,
        clientY: number,
        viewportOffsetOverride?: { x: number; y: number },
    ): DagPinchAnchor | null => {
        const container = dagScrollRef.current;
        if (!container) {
            return null;
        }

        const rect = container.getBoundingClientRect();
        const viewportOffsetX = viewportOffsetOverride?.x ?? (clientX - rect.left);
        const viewportOffsetY = viewportOffsetOverride?.y ?? (clientY - rect.top);

        return {
            zoom: dagZoomRef.current,
            viewportOffsetX,
            viewportOffsetY,
            logicalContentX:
                (dagScrollPositionRef.current.left + viewportOffsetX) / dagZoomRef.current,
            logicalContentY:
                (dagScrollPositionRef.current.top + viewportOffsetY) / dagZoomRef.current,
        };
    };

    /**
     * @function beginDagPinch
     * @description 进入 DAG 双指缩放模式，暂停原生双指滚动对内部锚点的干扰。
     */
    const beginDagPinch = (mode: "touch" | "gesture"): void => {
        pinchModeRef.current = mode;
        setPinchMode(mode);
    };

    /**
     * @function endDagPinch
     * @description 退出 DAG 双指缩放模式，恢复普通滚动同步。
     */
    const endDagPinch = (): void => {
        pinchModeRef.current = "none";
        setPinchMode("none");

        if (dagZoomCommitTimerRef.current !== null) {
            window.clearTimeout(dagZoomCommitTimerRef.current);
            dagZoomCommitTimerRef.current = null;
        }

        setDagZoom(dagZoomRef.current);
    };

    /**
     * @function openInspectorForNode
     * @description 选中指定节点并打开检查器弹窗。
     * @param nodeId 节点 ID。
     */
    const openInspectorForNode = useCallback((nodeId: string): void => {
        setSelectedNodeId(nodeId);
        setIsInspectorOpen(true);
    }, []);

    /**
     * @function closeInspectorModal
     * @description 关闭检查器弹窗，但保留当前选中节点高亮。
     */
    const closeInspectorModal = useCallback((): void => {
        setIsInspectorOpen(false);
    }, []);

    /**
     * @function focusNodeDependencyTree
     * @description 以指定节点为精确根节点，切换到下游依赖树视图并关闭检查器。
     * @param node 目标节点。
     */
    const focusNodeDependencyTree = useCallback((node: ArchitectureNode): void => {
        setActiveKind(node.kind);
        setQuery(node.title);
        setExactRootNodeId(node.id);
        setGraphTraversalMode("dependencies");
        applyFocusedNodeIdState(null);
        setIsInspectorOpen(false);
    }, [applyFocusedNodeIdState]);

    /**
     * @function commitDagZoomTarget
     * @description 提交新的缩放值与目标滚动位置，并在下一次布局提交后统一写回 DOM。
     * @param nextZoom 目标缩放值。
     * @param nextScrollLeft 目标横向滚动位置。
     * @param nextScrollTop 目标纵向滚动位置。
     */
    const syncDagZoomPreviewToDom = (
        nextZoom: number,
        nextScrollLeft: number,
        nextScrollTop: number,
    ): void => {
        const container = dagScrollRef.current;
        const viewport = dagViewportRef.current;
        const stage = dagStageRef.current;
        const { width, height } = dagLayoutSizeRef.current;

        if (viewport) {
            viewport.style.width = `${String(width * nextZoom)}px`;
            viewport.style.height = `${String(height * nextZoom)}px`;
        }

        if (stage) {
            stage.style.width = `${String(width)}px`;
            stage.style.height = `${String(height)}px`;
            stage.style.transform = `scale(${String(nextZoom)})`;
        }

        if (container) {
            suppressScrollSyncRef.current = true;
            container.scrollLeft = nextScrollLeft;
            container.scrollTop = nextScrollTop;
        }
    };

    /**
     * @function scheduleDagZoomPreview
     * @description 使用 requestAnimationFrame 合并缩放过程中的 DOM 写入，避免每次输入事件都触发同步布局。
     * @param nextZoom 目标缩放值。
     * @param nextScrollLeft 目标横向滚动位置。
     * @param nextScrollTop 目标纵向滚动位置。
     */
    const scheduleDagZoomPreview = (
        nextZoom: number,
        nextScrollLeft: number,
        nextScrollTop: number,
    ): void => {
        pendingDagZoomPreviewRef.current = {
            zoom: nextZoom,
            left: nextScrollLeft,
            top: nextScrollTop,
        };

        if (dagZoomPreviewFrameRef.current !== null) {
            return;
        }

        dagZoomPreviewFrameRef.current = requestAnimationFrame(() => {
            dagZoomPreviewFrameRef.current = null;
            const pendingPreview = pendingDagZoomPreviewRef.current;
            if (!pendingPreview) {
                return;
            }

            syncDagZoomPreviewToDom(
                pendingPreview.zoom,
                pendingPreview.left,
                pendingPreview.top,
            );
        });
    };

    /**
     * @function scheduleDagZoomCommit
     * @description 在缩放输入短暂静止后再提交 React 状态，避免连续缩放期间整棵组件树频繁重渲染。
     */
    const scheduleDagZoomCommit = (): void => {
        if (dagZoomCommitTimerRef.current !== null) {
            window.clearTimeout(dagZoomCommitTimerRef.current);
        }

        dagZoomCommitTimerRef.current = window.setTimeout(() => {
            dagZoomCommitTimerRef.current = null;
            setDagZoom(dagZoomRef.current);
        }, 120);
    };

    /**
     * @function commitDagZoomTarget
     * @description 提交新的缩放值与目标滚动位置，实时预览直接写入 DOM，React 状态延迟到缩放停顿后更新。
     * @param nextZoom 目标缩放值。
     * @param nextScrollLeft 目标横向滚动位置。
     * @param nextScrollTop 目标纵向滚动位置。
     */
    const commitDagZoomTarget = (
        nextZoom: number,
        nextScrollLeft: number,
        nextScrollTop: number,
    ): void => {
        dagZoomRef.current = nextZoom;
        dagScrollPositionRef.current = {
            left: nextScrollLeft,
            top: nextScrollTop,
        };
        scheduleDagZoomPreview(nextZoom, nextScrollLeft, nextScrollTop);
        scheduleDagZoomCommit();
    };

    /**
     * @function handleDagWheelZoom
     * @description 处理桌面 ctrl+wheel 缩放，并阻止滚轮事件冒泡到外层滚动容器。
     * @param event 原生 WheelEvent。
     */
    const handleDagWheelZoom = (event: WheelEvent): void => {
        if (!event.ctrlKey) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();

        if (pinchModeRef.current !== "none") {
            return;
        }

        if (Date.now() < wheelZoomSuppressionUntilRef.current) {
            return;
        }

        const now = Date.now();
        const shouldStartNewSession =
            !wheelZoomSessionRef.current ||
            now - wheelZoomSessionRef.current.lastEventAt > 80;

        if (shouldStartNewSession) {
            const anchorPoint = resolveDesktopAnchorPoint(event.clientX, event.clientY);
            const anchor = captureDagPinchAnchor(
                anchorPoint.clientX,
                anchorPoint.clientY,
                "viewportOffsetX" in anchorPoint
                    ? {
                        x: anchorPoint.viewportOffsetX,
                        y: anchorPoint.viewportOffsetY,
                    }
                    : undefined,
            );
            if (!anchor) {
                return;
            }

            wheelZoomSessionRef.current = {
                anchor,
                accumulatedDeltaY: 0,
                lastEventAt: now,
            };
        }

        const session = wheelZoomSessionRef.current;
        if (!session) {
            return;
        }

        session.accumulatedDeltaY += event.deltaY;
        session.lastEventAt = now;
        applyDagZoomFromAnchor(
            session.anchor.zoom * Math.exp(-session.accumulatedDeltaY * 0.0025),
            session.anchor,
        );
    };

    /**
     * @function applyDagZoomFromAnchor
     * @description 基于双指手势起点的绝对锚点计算缩放后的滚动位置，避免逐帧累计误差。
     * @param nextZoom 目标缩放值。
     * @param anchor 手势起点锚点。
     * @param clientX 当前焦点 X 坐标；未传入时使用起点焦点。
     * @param clientY 当前焦点 Y 坐标；未传入时使用起点焦点。
     */
    const applyDagZoomFromAnchor = (
        nextZoom: number,
        anchor: DagPinchAnchor,
    ): void => {
        const container = dagScrollRef.current;
        const clampedZoom = clampDagZoom(nextZoom);

        if (!container || Math.abs(clampedZoom - dagZoomRef.current) < 0.001) {
            return;
        }

        commitDagZoomTarget(
            clampedZoom,
            anchor.logicalContentX * clampedZoom - anchor.viewportOffsetX,
            anchor.logicalContentY * clampedZoom - anchor.viewportOffsetY,
        );
    };

    useEffect(() => {
        dagZoomRef.current = dagZoom;
    }, [dagZoom]);

    useEffect(() => {
        focusedNodeIdRef.current = focusedNodeId;
    }, [focusedNodeId]);

    useLayoutEffect(() => {
        syncDagZoomPreviewToDom(
            dagZoom,
            dagScrollPositionRef.current.left,
            dagScrollPositionRef.current.top,
        );
    }, [dagZoom]);

    useEffect(() => {
        const container = dagScrollRef.current;
        if (!container) {
            return;
        }

        dagScrollPositionRef.current = {
            left: container.scrollLeft,
            top: container.scrollTop,
        };

        return () => {
            if (pinchScrollRestoreFrameRef.current !== null) {
                cancelAnimationFrame(pinchScrollRestoreFrameRef.current);
                pinchScrollRestoreFrameRef.current = null;
            }

            if (dagZoomPreviewFrameRef.current !== null) {
                cancelAnimationFrame(dagZoomPreviewFrameRef.current);
                dagZoomPreviewFrameRef.current = null;
            }

            if (dagZoomCommitTimerRef.current !== null) {
                window.clearTimeout(dagZoomCommitTimerRef.current);
                dagZoomCommitTimerRef.current = null;
            }

            if (focusedNodeFrameRef.current !== null) {
                cancelAnimationFrame(focusedNodeFrameRef.current);
                focusedNodeFrameRef.current = null;
            }

            if (focusedNodeClearTimerRef.current !== null) {
                window.clearTimeout(focusedNodeClearTimerRef.current);
                focusedNodeClearTimerRef.current = null;
            }
        };
    }, [handleDagNodeBlur, handleDagNodeFocus]);

    useEffect(() => {
        const stageElement = dagStageRef.current;
        if (!stageElement) {
            return;
        }

        const handleFocusIn = (event: FocusEvent): void => {
            handleDagNodeFocus(event);
        };
        const handleFocusOut = (event: FocusEvent): void => {
            handleDagNodeBlur(event);
        };

        stageElement.addEventListener("focusin", handleFocusIn);
        stageElement.addEventListener("focusout", handleFocusOut);

        return () => {
            stageElement.removeEventListener("focusin", handleFocusIn);
            stageElement.removeEventListener("focusout", handleFocusOut);
        };
    }, [handleDagNodeBlur, handleDagNodeFocus]);

    useEffect(() => {
        const handleWindowMouseMove = (event: MouseEvent): void => {
            globalPointerPositionRef.current = {
                clientX: event.clientX,
                clientY: event.clientY,
            };
        };

        window.addEventListener("mousemove", handleWindowMouseMove);

        return () => {
            window.removeEventListener("mousemove", handleWindowMouseMove);
        };
    }, []);

    useEffect(() => {
        const container = dagScrollRef.current;
        if (!container) {
            return;
        }

        const handleGestureStart = (event: Event): void => {
            const gestureEvent = event as PinchGestureEventLike;
            const anchorPoint = resolveDesktopAnchorPoint(
                gestureEvent.clientX,
                gestureEvent.clientY,
            );
            const anchor = captureDagPinchAnchor(
                anchorPoint.clientX,
                anchorPoint.clientY,
                "viewportOffsetX" in anchorPoint
                    ? {
                        x: anchorPoint.viewportOffsetX,
                        y: anchorPoint.viewportOffsetY,
                    }
                    : undefined,
            );
            if (!anchor) {
                return;
            }

            gesturePinchStateRef.current = anchor;
            wheelZoomSessionRef.current = null;
            beginDagPinch("gesture");
            wheelZoomSuppressionUntilRef.current = Date.now() + 180;
            event.preventDefault();
        };

        const handleGestureChange = (event: Event): void => {
            const gestureEvent = event as PinchGestureEventLike;
            const anchor = gesturePinchStateRef.current;
            if (!anchor) {
                return;
            }

            wheelZoomSessionRef.current = null;
            wheelZoomSuppressionUntilRef.current = Date.now() + 180;
            event.preventDefault();
            applyDagZoomFromAnchor(anchor.zoom * gestureEvent.scale, anchor);
        };

        const handleGestureEnd = (event: Event): void => {
            gesturePinchStateRef.current = null;
            wheelZoomSessionRef.current = null;
            endDagPinch();
            wheelZoomSuppressionUntilRef.current = Date.now() + 120;
            event.preventDefault();
        };

        container.addEventListener("gesturestart", handleGestureStart, { passive: false });
        container.addEventListener("gesturechange", handleGestureChange, { passive: false });
        container.addEventListener("gestureend", handleGestureEnd, { passive: false });

        return () => {
            container.removeEventListener("gesturestart", handleGestureStart);
            container.removeEventListener("gesturechange", handleGestureChange);
            container.removeEventListener("gestureend", handleGestureEnd);
        };
    }, []);

    useEffect(() => {
        const container = dagScrollRef.current;
        if (!container) {
            return;
        }

        container.addEventListener("wheel", handleDagWheelZoom, { passive: false });

        return () => {
            container.removeEventListener("wheel", handleDagWheelZoom);
        };
    }, []);

    useEffect(() => {
        if (snapshot.nodes.length === 0) {
            if (selectedNodeId !== null) {
                setSelectedNodeId(null);
            }
            if (focusedNodeId !== null) {
                applyFocusedNodeIdState(null);
            }
            if (isInspectorOpen) {
                setIsInspectorOpen(false);
            }
            return;
        }

        const hasSelectedNode = selectedNodeId
            ? snapshot.nodes.some((node) => node.id === selectedNodeId)
            : false;

        if (!hasSelectedNode) {
            setSelectedNodeId(snapshot.nodes[0]?.id ?? null);
            setIsInspectorOpen(false);
        }

        if (focusedNodeId && !snapshot.nodes.some((node) => node.id === focusedNodeId)) {
            applyFocusedNodeIdState(null);
        }
    }, [applyFocusedNodeIdState, focusedNodeId, isInspectorOpen, selectedNodeId, snapshot.nodes]);

    useEffect(() => {
        if (!isInspectorOpen) {
            return;
        }

        const handleWindowKeyDown = (event: KeyboardEvent): void => {
            if (event.key === "Escape") {
                closeInspectorModal();
            }
        };

        window.addEventListener("keydown", handleWindowKeyDown);

        return () => {
            window.removeEventListener("keydown", handleWindowKeyDown);
        };
    }, [isInspectorOpen]);

    useEffect(() => {
        if (reverseDependencyCopyState === "idle") {
            return;
        }

        const resetTimer = window.setTimeout(() => {
            setReverseDependencyCopyState("idle");
        }, 1800);

        return () => {
            window.clearTimeout(resetTimer);
        };
    }, [reverseDependencyCopyState]);

    const nodeMap = useMemo(() => {
        return new Map(snapshot.nodes.map((node) => [node.id, node]));
    }, [snapshot.nodes]);

    const matchedNodes = useMemo(() => {
        if (exactRootNodeId) {
            return snapshot.nodes.filter((node) => {
                const kindMatched = activeKind === "all" || node.kind === activeKind;
                return kindMatched && node.id === exactRootNodeId;
            });
        }

        return snapshot.nodes.filter((node) => {
            const kindMatched = activeKind === "all" || node.kind === activeKind;
            return kindMatched && matchesNodeQuery(node, query);
        });
    }, [activeKind, exactRootNodeId, query, snapshot.nodes]);

    const matchedNodeIds = useMemo(() => {
        return matchedNodes.map((node) => node.id);
    }, [matchedNodes]);

    const kindLayerMaps = useMemo(() => {
        return buildKindLayerMaps(snapshot.nodes, snapshot.edges);
    }, [snapshot.edges, snapshot.nodes]);

    const layeredEdges = useMemo(() => {
        return buildLayeredEdges(snapshot.nodes, snapshot.edges, kindLayerMaps);
    }, [kindLayerMaps, snapshot.edges, snapshot.nodes]);

    const visibleNodeIds = useMemo(() => {
        return buildTransitiveVisibleNodeIds(
            snapshot.nodes.map((node) => node.id),
            layeredEdges,
            matchedNodeIds,
            graphTraversalMode,
        );
    }, [graphTraversalMode, layeredEdges, matchedNodeIds, snapshot.nodes]);

    useEffect(() => {
        if (visibleNodeIds.size === 0) {
            if (selectedNodeId !== null) {
                setSelectedNodeId(null);
            }
            if (focusedNodeId !== null) {
                applyFocusedNodeIdState(null);
            }
            if (isInspectorOpen) {
                setIsInspectorOpen(false);
            }
            return;
        }

        if (!selectedNodeId || !visibleNodeIds.has(selectedNodeId)) {
            const nextSelectedNodeId = matchedNodes[0]?.id ?? snapshot.nodes.find((node) => {
                return visibleNodeIds.has(node.id);
            })?.id ?? null;

            if (nextSelectedNodeId !== selectedNodeId) {
                setSelectedNodeId(nextSelectedNodeId);
            }

            if (isInspectorOpen) {
                setIsInspectorOpen(false);
            }
        }

        if (focusedNodeId && !visibleNodeIds.has(focusedNodeId)) {
            applyFocusedNodeIdState(null);
        }
    }, [applyFocusedNodeIdState, focusedNodeId, isInspectorOpen, matchedNodes, selectedNodeId, snapshot.nodes, visibleNodeIds]);

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

            return true;
        });
    }, [layeredEdges, matchedNodes, snapshot.nodes.length, visibleNodeIds]);

    const visibleEdgeAdjacencyIndex = useMemo(() => {
        return buildArchitectureEdgeAdjacencyIndex(visibleEdges);
    }, [visibleEdges]);

    const layout = useMemo(() => buildLayout(visibleNodes, visibleEdges), [visibleEdges, visibleNodes]);
    useLayoutEffect(() => {
        dagLayoutSizeRef.current = {
            width: layout.width,
            height: layout.height,
        };
        syncDagZoomPreviewToDom(
            dagZoomRef.current,
            dagScrollPositionRef.current.left,
            dagScrollPositionRef.current.top,
        );
    }, [layout.height, layout.width]);

    const reverseModuleDependencyDetails = useMemo(() => {
        return collectReverseModuleDependencyDetails(visibleEdges, nodeMap, layout.positions);
    }, [layout.positions, nodeMap, visibleEdges]);
    const reverseModuleDependencyEdgeIds = useMemo(() => {
        return new Set(reverseModuleDependencyDetails.map((detail) => getArchitectureEdgeKey(detail.edge)));
    }, [reverseModuleDependencyDetails]);
    const selectedNode = nodeMap.get(selectedNodeId ?? "") ?? null;
    const selectedNodeRelatedEdges = useMemo(() => {
        return getArchitectureNodeRelatedEdges(visibleEdgeAdjacencyIndex, selectedNodeId);
    }, [selectedNodeId, visibleEdgeAdjacencyIndex]);
    const focusedNodeRelatedEdges = useMemo(() => {
        return getArchitectureNodeRelatedEdges(visibleEdgeAdjacencyIndex, focusedNodeId);
    }, [focusedNodeId, visibleEdgeAdjacencyIndex]);

    const highlightedNodeIds = useMemo(() => {
        return collectArchitectureHighlightedNodeIds(focusedNodeId, focusedNodeRelatedEdges);
    }, [focusedNodeId, focusedNodeRelatedEdges]);

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

    const handleOpenInspectorForNode = useCallback((nodeId: string): void => {
        openInspectorForNode(nodeId);
    }, [openInspectorForNode]);

    /**
     * @function handleCopyReverseModuleDependencies
     * @description 将当前可见红色依赖关系复制到系统剪贴板。
     * @returns Promise<void>
     */
    const handleCopyReverseModuleDependencies = async (): Promise<void> => {
        const clipboardText = formatReverseModuleDependencyDetailsForClipboard(
            reverseModuleDependencyDetails,
        );
        if (!clipboardText) {
            console.warn("[architectureDevtools] reverse dependency copy skipped: no reverse module dependencies");
            return;
        }

        try {
            console.info("[architectureDevtools] copying reverse module dependencies", {
                count: reverseModuleDependencyDetails.length,
            });
            await navigator.clipboard.writeText(clipboardText);
            setReverseDependencyCopyState("copied");
            console.info("[architectureDevtools] copied reverse module dependencies", {
                count: reverseModuleDependencyDetails.length,
            });
        } catch (copyError) {
            setReverseDependencyCopyState("error");
            console.error("[architectureDevtools] copy reverse module dependencies failed", {
                error: copyError instanceof Error ? copyError.message : String(copyError),
            });
        }
    };

    const reverseDependencyCopyLabel = reverseDependencyCopyState === "copied"
        ? t("architectureDevtools.copyReverseModuleDependenciesCopied")
        : reverseDependencyCopyState === "error"
            ? t("architectureDevtools.copyReverseModuleDependenciesFailed")
            : t("architectureDevtools.copyReverseModuleDependencies");

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
                                {t("architectureDevtools.backendModules")}
                            </div>
                            <div className="architecture-summary-value">
                                {summarizeKindCount(snapshot.nodes, "backend-module")}
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
                                {t("architectureDevtools.backendEvents")}
                            </div>
                            <div className="architecture-summary-value">
                                {summarizeKindCount(snapshot.nodes, "backend-event")}
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
                    onChange={(event) => {
                        setExactRootNodeId(null);
                        setQuery(event.target.value);
                    }}
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
                                onClick={() => {
                                    setExactRootNodeId(null);
                                    setActiveKind(kind);
                                }}
                                type="button"
                            >
                                {label}
                            </button>
                        );
                    })}
                </div>
                <div className="architecture-toolbar-group">
                    <div className="architecture-toolbar-label">
                        {t("architectureDevtools.treeMode")}
                    </div>
                    <div className="architecture-filter-row">
                        {([
                            ["dependencies", t("architectureDevtools.dependencyTree")],
                            ["dependents", t("architectureDevtools.dependentTree")],
                            ["neighbors", t("architectureDevtools.neighborGraph")],
                        ] as Array<[GraphTraversalMode, string]>).map(([mode, label]) => {
                            const isActive = graphTraversalMode === mode;
                            return (
                                <button
                                    className={[
                                        "architecture-filter-chip",
                                        isActive ? "architecture-filter-chip--active" : "",
                                    ].join(" ").trim()}
                                    key={mode}
                                    onClick={() => setGraphTraversalMode(mode)}
                                    type="button"
                                >
                                    {label}
                                </button>
                            );
                        })}
                    </div>
                </div>
                <div className="architecture-toolbar-meta">
                    {query.trim()
                        ? t("architectureDevtools.treeSummary", {
                            matched: matchedNodes.length,
                            visible: visibleNodes.length,
                            total: snapshot.nodes.length,
                        })
                        : t("architectureDevtools.visibleNodes", {
                            visible: visibleNodes.length,
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
                            <button
                                className={[
                                    "architecture-dag-copy-action",
                                    reverseDependencyCopyState === "copied"
                                        ? "architecture-dag-copy-action--copied"
                                        : reverseDependencyCopyState === "error"
                                            ? "architecture-dag-copy-action--error"
                                            : "",
                                ].join(" ").trim()}
                                disabled={reverseModuleDependencyDetails.length === 0}
                                onClick={() => {
                                    void handleCopyReverseModuleDependencies();
                                }}
                                type="button"
                            >
                                {reverseDependencyCopyLabel}
                            </button>
                            <div className="architecture-dag-meta">
                                {matchedNodes.length === 0
                                    ? t("architectureDevtools.noMatches")
                                    : t("architectureDevtools.relatedEdges", {
                                        count: focusedNodeId
                                            ? focusedNodeRelatedEdges.length
                                            : visibleEdges.length,
                                    })}
                                {reverseModuleDependencyDetails.length > 0
                                    ? ` · ${t("architectureDevtools.reverseModuleDependencies", {
                                        count: reverseModuleDependencyDetails.length,
                                    })}`
                                    : ""}
                                {matchedNodes.length > 0 ? ` · ${String(Math.round(dagZoom * 100))}%` : ""}
                            </div>
                        </div>
                    </div>
                    {/* architecture-dag-scroll: DAG 横向滚动容器 */}
                    <div
                        className={[
                            "architecture-dag-scroll",
                            pinchMode === "touch" ? "architecture-dag-scroll--pinching" : "",
                        ].join(" ").trim()}
                        onMouseEnter={(event) => {
                            const rect = event.currentTarget.getBoundingClientRect();
                            dagPointerSampleRef.current = {
                                clientX: event.clientX,
                                clientY: event.clientY,
                                viewportOffsetX: event.clientX - rect.left,
                                viewportOffsetY: event.clientY - rect.top,
                                capturedAt: Date.now(),
                            };
                        }}
                        onMouseLeave={() => {
                            dagPointerSampleRef.current = null;
                        }}
                        onMouseMove={(event) => {
                            const rect = event.currentTarget.getBoundingClientRect();
                            dagPointerSampleRef.current = {
                                clientX: event.clientX,
                                clientY: event.clientY,
                                viewportOffsetX: event.clientX - rect.left,
                                viewportOffsetY: event.clientY - rect.top,
                                capturedAt: Date.now(),
                            };
                        }}
                        onScroll={(event) => {
                            if (suppressScrollSyncRef.current) {
                                suppressScrollSyncRef.current = false;
                                dagScrollPositionRef.current = {
                                    left: event.currentTarget.scrollLeft,
                                    top: event.currentTarget.scrollTop,
                                };
                                return;
                            }

                            if (pinchModeRef.current === "touch") {
                                if (pinchScrollRestoreFrameRef.current !== null) {
                                    cancelAnimationFrame(pinchScrollRestoreFrameRef.current);
                                }

                                const container = event.currentTarget;
                                pinchScrollRestoreFrameRef.current = requestAnimationFrame(() => {
                                    pinchScrollRestoreFrameRef.current = null;
                                    suppressScrollSyncRef.current = true;
                                    container.scrollLeft = dagScrollPositionRef.current.left;
                                    container.scrollTop = dagScrollPositionRef.current.top;
                                });
                                return;
                            }

                            dagScrollPositionRef.current = {
                                left: event.currentTarget.scrollLeft,
                                top: event.currentTarget.scrollTop,
                            };
                        }}
                        onTouchEnd={() => {
                            touchPinchStateRef.current = null;
                            endDagPinch();
                        }}
                        onTouchMove={(event) => {
                            if (event.touches.length !== 2) {
                                touchPinchStateRef.current = null;
                                endDagPinch();
                                return;
                            }

                            const [firstTouch, secondTouch] = [event.touches[0], event.touches[1]];
                            if (!firstTouch || !secondTouch) {
                                return;
                            }

                            const pinchState = touchPinchStateRef.current;
                            if (!pinchState) {
                                return;
                            }

                            const distance = getTouchDistance(firstTouch, secondTouch);
                            event.preventDefault();
                            applyDagZoomFromAnchor(
                                pinchState.anchor.zoom * (distance / pinchState.distance),
                                pinchState.anchor,
                            );
                        }}
                        onTouchStart={(event) => {
                            if (event.touches.length !== 2) {
                                touchPinchStateRef.current = null;
                                endDagPinch();
                                return;
                            }

                            const [firstTouch, secondTouch] = [event.touches[0], event.touches[1]];
                            if (!firstTouch || !secondTouch) {
                                return;
                            }

                            const center = getTouchCenter(firstTouch, secondTouch);
                            const anchor = captureDagPinchAnchor(center.x, center.y);
                            if (!anchor) {
                                return;
                            }

                            touchPinchStateRef.current = {
                                distance: getTouchDistance(firstTouch, secondTouch),
                                anchor,
                            };
                            beginDagPinch("touch");
                            console.info("[architectureDevtools] touch pinch start", {
                                zoom: dagZoomRef.current,
                            });
                        }}
                        ref={dagScrollRef}
                    >
                        {matchedNodes.length === 0 ? (
                            <div className="architecture-empty-state">
                                {t("architectureDevtools.noMatches")}
                            </div>
                        ) : (
                            <div
                                className="architecture-dag-viewport"
                                ref={dagViewportRef}
                                style={{
                                    width: `${String(layout.width * dagZoom)}px`,
                                    height: `${String(layout.height * dagZoom)}px`,
                                }}
                            >
                                <div
                                    className="architecture-dag-stage"
                                    ref={dagStageRef}
                                    style={{
                                        width: `${String(layout.width)}px`,
                                        height: `${String(layout.height)}px`,
                                        transform: `scale(${String(dagZoom)})`,
                                    }}
                                >
                                    <ArchitectureDagEdgeCanvas
                                        edges={visibleEdges}
                                        focusedEdges={focusedNodeRelatedEdges}
                                        focusedNodeId={focusedNodeId}
                                        getEdgeKey={getArchitectureEdgeKey}
                                        height={layout.height}
                                        nodeHeight={NODE_HEIGHT}
                                        nodeWidth={NODE_WIDTH}
                                        positions={layout.positions}
                                        reverseModuleDependencyEdgeIds={reverseModuleDependencyEdgeIds}
                                        width={layout.width}
                                    />
                                <svg
                                    className="architecture-dag-overlay"
                                    height={layout.height}
                                    onMouseLeave={handleDagOverlayMouseLeave}
                                    onMouseMove={handleDagOverlayMouseMove}
                                    preserveAspectRatio="xMinYMin meet"
                                    viewBox={`0 0 ${layout.width} ${layout.height}`}
                                    width={layout.width}
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

                                    {layout.layoutNodes.map((layoutNode) => {
                                        return (
                                            <ArchitectureDagNode
                                                isFocused={focusedNodeId === layoutNode.node.id}
                                                isRelated={highlightedNodeIds.has(layoutNode.node.id)}
                                                key={layoutNode.node.id}
                                                layoutNode={layoutNode}
                                                onOpenInspector={handleOpenInspectorForNode}
                                            />
                                        );
                                    })}
                                </svg>
                                </div>
                            </div>
                        )}
                    </div>
                </div>

            </section>

            {isInspectorOpen ? (
                <div
                    className="architecture-inspector-modal-backdrop"
                    data-floating-backdrop="true"
                    onClick={closeInspectorModal}
                    role="presentation"
                >
                    <aside
                        aria-label={t("architectureDevtools.inspector")}
                        aria-modal="true"
                        className="architecture-inspector-modal"
                        data-floating-surface="true"
                        onClick={(event) => event.stopPropagation()}
                        role="dialog"
                    >
                        <div className="architecture-inspector-modal-header">
                            <div className="architecture-section-title">
                                {t("architectureDevtools.inspector")}
                            </div>
                            <div className="architecture-inspector-modal-actions">
                                {selectedNode ? (
                                    <button
                                        className="architecture-inspector-tree-action"
                                        onClick={() => focusNodeDependencyTree(selectedNode)}
                                        type="button"
                                    >
                                        {t("architectureDevtools.viewNodeDependencyTree")}
                                    </button>
                                ) : null}
                                <button
                                    className="architecture-inspector-close"
                                    onClick={closeInspectorModal}
                                    type="button"
                                >
                                    {t("common.close")}
                                </button>
                            </div>
                        </div>
                        {selectedNode ? (
                            <>
                                <div className="architecture-inspector-kind">
                                    {(() => {
                                        const moduleLayer = selectedNode.kind === "ui-module"
                                            ? getNodeModuleLayer(selectedNode)
                                            : null;
                                        return moduleLayer
                                            ? `${getKindLabel(selectedNode.kind)} · ${getModuleLayerLabel(moduleLayer)}`
                                            : getKindLabel(selectedNode.kind);
                                    })()}
                                </div>
                                <h3 className="architecture-inspector-title">
                                    {selectedNode.title}
                                </h3>
                                <p className="architecture-inspector-summary">
                                    {selectedNode.summary}
                                </p>
                                {selectedNode.location ? (
                                    <div className="architecture-location-chip">
                                        {selectedNode.location}
                                    </div>
                                ) : null}
                                {selectedNode.details && selectedNode.details.length > 0 ? (
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
                                <div className="architecture-inspector-subtitle">
                                    {t("architectureDevtools.relatedEdges", {
                                        count: selectedNodeRelatedEdges.length,
                                    })}
                                </div>
                                <div className="architecture-inspector-list">
                                    {selectedNodeRelatedEdges.map((edge) => (
                                        <div
                                            className="architecture-inspector-item"
                                            key={getArchitectureEdgeKey(edge)}
                                        >
                                            <div className="architecture-inspector-item-title">
                                                {formatEdgeDescription(edge, nodeMap)}
                                            </div>
                                            {edge.details && edge.details.length > 0 ? (
                                                <div className="architecture-inspector-item-details">
                                                    {edge.details.map((detail) => (
                                                        <div
                                                            className="architecture-inspector-item-detail"
                                                            key={`${edge.from}-${edge.to}-${detail}`}
                                                        >
                                                            {detail}
                                                        </div>
                                                    ))}
                                                </div>
                                            ) : null}
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
                </div>
            ) : null}

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
                        onFocusNode={scheduleFocusedNodeId}
                        onSelect={openInspectorForNode}
                        sectionTitle={section.label}
                        selectedNodeId={selectedNodeId}
                    />
                ))}
            </section>
        </div>
    );
}