/**
 * @module plugins/canvas/canvasDocument
 * @description Canvas 文档模型与 Obsidian Canvas JSON 适配层。
 *   该模块负责：
 *   - 定义前端运行时使用的节点/边类型
 *   - 解析 Obsidian Canvas JSON 到 xyflow 运行时结构
 *   - 将当前编辑状态序列化回 `.canvas` 文件内容
 *
 * @dependencies
 *   - @xyflow/react
 *
 * @example
 *   const document = parseCanvasDocument(rawJson);
 *   const text = serializeCanvasDocument(document);
 */

import type { Edge, Node } from "@xyflow/react";

/**
 * @type CanvasNodeKind
 * @description Canvas 节点种类。
 */
export type CanvasNodeKind = "text" | "file" | "group";

/**
 * @type CanvasSide
 * @description Edge 连接侧边。
 */
export type CanvasSide = "top" | "right" | "bottom" | "left";

/**
 * @interface CanvasNodeData
 * @description 前端运行时节点数据。
 */
export interface CanvasNodeData extends Record<string, unknown> {
    /** 节点种类。 */
    kind: CanvasNodeKind;
    /** 节点主标题。 */
    label: string;
    /** 文本节点正文。 */
    text?: string;
    /** 文件节点绑定的文件路径。 */
    filePath?: string;
    /** 节点主色。 */
    color?: string;
    /** 分组节点背景色。 */
    background?: string;
    /** 节点未知字段，序列化时需原样回写。 */
    extraFields?: Record<string, unknown>;
    /** 仅前端运行时使用：文本节点当前是否处于编辑态。 */
    isEditingText?: boolean;
    /** 仅前端运行时使用：文本节点运行时注册键。 */
    runtimeKey?: string;
}

/**
 * @type CanvasFlowNode
 * @description xyflow 运行时节点类型。
 */
export type CanvasFlowNode = Node<CanvasNodeData, "ofiveCanvasNode" | "group">;

/**
 * @interface CanvasEdgeData
 * @description 前端运行时边数据。
 */
export interface CanvasEdgeData extends Record<string, unknown> {
    /** 边标签。 */
    label?: string;
    /** 边颜色。 */
    color?: string;
    /** 边未知字段，序列化时需原样回写。 */
    extraFields?: Record<string, unknown>;
}

/**
 * @type CanvasFlowEdge
 * @description xyflow 运行时边类型。
 */
export type CanvasFlowEdge = Edge<CanvasEdgeData>;

/**
 * @interface CanvasDocumentMetadata
 * @description Canvas 文档元信息。
 */
export interface CanvasDocumentMetadata extends Record<string, unknown> {
    /** 文档标题。 */
    title?: string;
}

/**
 * @interface CanvasDocument
 * @description 前端运行时 Canvas 文档快照。
 */
export interface CanvasDocument {
    /** 节点列表。 */
    nodes: CanvasFlowNode[];
    /** 边列表。 */
    edges: CanvasFlowEdge[];
    /** 附加元信息。 */
    metadata?: CanvasDocumentMetadata;
    /** 文档未知字段，序列化时需原样回写。 */
    extraFields?: Record<string, unknown>;
}

interface ObsidianCanvasTextNode extends Record<string, unknown> {
    id: string;
    type: "text";
    x: number;
    y: number;
    width: number;
    height: number;
    text?: string;
    color?: string;
    parentId?: string;
}

interface ObsidianCanvasFileNode extends Record<string, unknown> {
    id: string;
    type: "file";
    x: number;
    y: number;
    width: number;
    height: number;
    file?: string;
    color?: string;
    parentId?: string;
}

interface ObsidianCanvasGroupNode extends Record<string, unknown> {
    id: string;
    type: "group";
    x: number;
    y: number;
    width: number;
    height: number;
    label?: string;
    color?: string;
    background?: string;
    parentId?: string;
}

type ObsidianCanvasNode =
    | ObsidianCanvasTextNode
    | ObsidianCanvasFileNode
    | ObsidianCanvasGroupNode;

interface ObsidianCanvasEdge extends Record<string, unknown> {
    id: string;
    fromNode: string;
    toNode: string;
    fromSide?: string;
    toSide?: string;
    label?: string;
    color?: string;
}

interface ObsidianCanvasDocument extends Record<string, unknown> {
    nodes?: ObsidianCanvasNode[];
    edges?: ObsidianCanvasEdge[];
    metadata?: CanvasDocumentMetadata;
}

const DEFAULT_NODE_WIDTH = 260;
const DEFAULT_NODE_HEIGHT = 160;
const GROUP_SELECTION_PADDING_X = 28;
const GROUP_SELECTION_PADDING_Y = 24;

interface CanvasRect {
    x: number;
    y: number;
    width: number;
    height: number;
}

/**
 * @function createEmptyCanvasDocument
 * @description 创建空白 Canvas 文档。
 * @param title 可选标题。
 * @returns 空文档。
 */
export function createEmptyCanvasDocument(title?: string): CanvasDocument {
    return {
        nodes: [],
        edges: [],
        metadata: title ? { title } : undefined,
    };
}

/**
 * @function parseCanvasDocument
 * @description 解析 `.canvas` 文本为运行时文档。
 * @param content 原始 JSON 文本。
 * @returns 运行时文档。
 * @throws JSON 解析失败或结构非法时抛出异常。
 */
export function parseCanvasDocument(content: string): CanvasDocument {
    const parsed = JSON.parse(content) as ObsidianCanvasDocument;
    if (!parsed || typeof parsed !== "object") {
        throw new Error("Canvas 文件内容不是有效对象");
    }

    const {
        nodes: rawNodes,
        edges: rawEdges,
        metadata: rawMetadata,
        ...documentExtraFields
    } = parsed;

    const absolutePositions = new Map<string, { x: number; y: number }>();
    (Array.isArray(rawNodes) ? rawNodes : []).forEach((node) => {
        absolutePositions.set(node.id, {
            x: Number.isFinite(node.x) ? node.x : 0,
            y: Number.isFinite(node.y) ? node.y : 0,
        });
    });

    const nodes = Array.isArray(rawNodes)
        ? sortNodesForSubFlowRuntime(rawNodes.map((node) => toFlowNode(node, absolutePositions)))
        : [];
    const edges = Array.isArray(rawEdges)
        ? rawEdges.map((edge) => toFlowEdge(edge))
        : [];

    return {
        nodes,
        edges,
        metadata: rawMetadata ? { ...rawMetadata } : undefined,
        extraFields: documentExtraFields,
    };
}

/**
 * @function serializeCanvasDocument
 * @description 将运行时文档序列化为 `.canvas` JSON。
 * @param document 当前文档。
 * @returns 标准化 JSON 文本。
 */
export function serializeCanvasDocument(document: CanvasDocument): string {
    const absolutePositions = buildAbsolutePositionMap(document.nodes);
    const orderedNodes = sortNodesForSubFlowRuntime(document.nodes);
    const serialized: ObsidianCanvasDocument = {
        ...(document.extraFields ?? {}),
        nodes: orderedNodes.map((node) => toObsidianNode(node, absolutePositions)),
        edges: document.edges.map((edge) => toObsidianEdge(edge)),
    };

    if (document.metadata) {
        serialized.metadata = {
            ...document.metadata,
        };
    }

    return JSON.stringify(serialized, null, 2) + "\n";
}

/**
 * @function createTextNode
 * @description 创建默认文本节点。
 * @param id 节点 id。
 * @param x 位置 X。
 * @param y 位置 Y。
 * @returns 文本节点。
 */
export function createTextNode(id: string, x: number, y: number): CanvasFlowNode {
    return {
        id,
        type: "ofiveCanvasNode",
        position: { x, y },
        style: {
            width: DEFAULT_NODE_WIDTH,
            height: DEFAULT_NODE_HEIGHT,
        },
        data: {
            kind: "text",
            label: "Text",
            text: "New text node",
            color: "var(--canvas-node-text-accent)",
        },
    };
}

/**
 * @function createFileNode
 * @description 创建默认文件节点。
 * @param id 节点 id。
 * @param x 位置 X。
 * @param y 位置 Y。
 * @param filePath 绑定文件路径。
 * @returns 文件节点。
 */
export function createFileNode(
    id: string,
    x: number,
    y: number,
    filePath: string,
): CanvasFlowNode {
    return {
        id,
        type: "ofiveCanvasNode",
        position: { x, y },
        style: {
            width: DEFAULT_NODE_WIDTH,
            height: 120,
        },
        data: {
            kind: "file",
            label: filePath.split("/").pop() ?? filePath,
            filePath,
            color: "var(--canvas-node-file-accent)",
        },
    };
}

/**
 * @function createGroupNode
 * @description 创建默认分组节点。
 * @param id 节点 id。
 * @param x 位置 X。
 * @param y 位置 Y。
 * @returns 分组节点。
 */
export function createGroupNode(id: string, x: number, y: number): CanvasFlowNode {
    return {
        id,
        type: "group",
        position: { x, y },
        className: "canvas-tab__group-node",
        style: {
            width: 360,
            height: 220,
        },
        data: {
            kind: "group",
            label: "Group",
            color: "var(--canvas-node-group-accent)",
            background: "var(--canvas-node-group-surface)",
            extraFields: {},
        },
    };
}

/**
 * @function createGroupFromSelection
 * @description 为一组顶层节点创建 xyflow sub-flow group，并将成员节点切换为 `parentId` 模式。
 * @param document 当前运行时文档。
 * @param selectedNodeIds 当前选中的节点 ID 列表。
 * @param groupId 新分组节点 ID。
 * @returns 创建后的文档；若选中项不满足建组条件则返回 null。
 */
export function createGroupFromSelection(
    document: CanvasDocument,
    selectedNodeIds: string[],
    groupId: string,
): CanvasDocument | null {
    const selectedIdSet = new Set(selectedNodeIds);
    const memberNodes = document.nodes.filter((node) => {
        if (!selectedIdSet.has(node.id)) {
            return false;
        }

        if (node.data.kind === "group") {
            return false;
        }

        return !node.parentId;
    });

    if (memberNodes.length < 2) {
        return null;
    }

    const absolutePositions = buildAbsolutePositionMap(document.nodes);
    const selectionBounds = getBoundsForNodes(memberNodes, absolutePositions);
    const groupX = selectionBounds.x - GROUP_SELECTION_PADDING_X;
    const groupY = selectionBounds.y - GROUP_SELECTION_PADDING_Y;
    const nextGroupNode = {
        ...createGroupNode(groupId, groupX, groupY),
        style: {
            width: selectionBounds.width + GROUP_SELECTION_PADDING_X * 2,
            height: selectionBounds.height + GROUP_SELECTION_PADDING_Y * 2,
        },
    } satisfies CanvasFlowNode;

    const nextNodes = document.nodes.map((node) => {
        if (!selectedIdSet.has(node.id) || node.data.kind === "group" || node.parentId) {
            return node;
        }

        const absolutePosition = absolutePositions.get(node.id);
        if (!absolutePosition) {
            return node;
        }

        return {
            ...node,
            parentId: groupId,
            extent: "parent",
            position: {
                x: absolutePosition.x - groupX,
                y: absolutePosition.y - groupY,
            },
        } satisfies CanvasFlowNode;
    });

    return {
        ...document,
        nodes: sortNodesForSubFlowRuntime([nextGroupNode, ...nextNodes]),
    };
}

/**
 * @function ungroupCanvasDocument
 * @description 移除一个分组节点，并将其成员节点恢复为顶层节点。
 * @param document 当前运行时文档。
 * @param groupId 目标分组 ID。
 * @returns 更新后的文档。
 */
export function ungroupCanvasDocument(document: CanvasDocument, groupId: string): CanvasDocument {
    const groupNode = document.nodes.find((node) => node.id === groupId && node.data.kind === "group");
    if (!groupNode) {
        return document;
    }

    const groupAbsolutePositions = buildAbsolutePositionMap(document.nodes);
    const groupAbsolutePosition = groupAbsolutePositions.get(groupId);
    if (!groupAbsolutePosition) {
        return document;
    }

    const nextNodes = document.nodes
        .filter((node) => node.id !== groupId)
        .map((node) => {
            if (node.parentId !== groupId) {
                return node;
            }

            return {
                ...node,
                parentId: undefined,
                extent: undefined,
                position: {
                    x: groupAbsolutePosition.x + node.position.x,
                    y: groupAbsolutePosition.y + node.position.y,
                },
            } satisfies CanvasFlowNode;
        });

    return {
        ...document,
        nodes: sortNodesForSubFlowRuntime(nextNodes),
    };
}

function toFlowNode(
    node: ObsidianCanvasNode,
    absolutePositions: Map<string, { x: number; y: number }>,
): CanvasFlowNode {
    const parentId = normalizeParentId(node.parentId);
    const absoluteX = Number.isFinite(node.x) ? node.x : 0;
    const absoluteY = Number.isFinite(node.y) ? node.y : 0;
    const parentAbsolutePosition = parentId ? absolutePositions.get(parentId) : undefined;
    const common = {
        id: node.id,
        type: node.type === "group" ? "group" as const : "ofiveCanvasNode" as const,
        position: {
            x: parentAbsolutePosition ? absoluteX - parentAbsolutePosition.x : absoluteX,
            y: parentAbsolutePosition ? absoluteY - parentAbsolutePosition.y : absoluteY,
        },
        style: {
            width: Number.isFinite(node.width) ? node.width : DEFAULT_NODE_WIDTH,
            height: Number.isFinite(node.height) ? node.height : DEFAULT_NODE_HEIGHT,
        },
        parentId,
        extent: parentId ? "parent" as const : undefined,
    };

    if (node.type === "file") {
        const {
            id: _id,
            type: _type,
            x: _x,
            y: _y,
            width: _width,
            height: _height,
            file,
            color,
            parentId: _parentId,
            ...extraFields
        } = node;
        const filePath = typeof file === "string" ? file : "";
        return {
            ...common,
            data: {
                kind: "file",
                label: filePath.split("/").pop() ?? filePath,
                filePath,
                color,
                extraFields,
            },
        };
    }

    if (node.type === "group") {
        const {
            id: _id,
            type: _type,
            x: _x,
            y: _y,
            width: _width,
            height: _height,
            label,
            color,
            background,
            parentId: _parentId,
            ...extraFields
        } = node;
        return {
            ...common,
            className: "canvas-tab__group-node",
            data: {
                kind: "group",
                label: typeof label === "string" && label.trim() ? label : "Group",
                color,
                background,
                extraFields,
            },
        };
    }

    const {
        id: _id,
        type: _type,
        x: _x,
        y: _y,
        width: _width,
        height: _height,
        text,
        color,
        parentId: _parentId,
        ...extraFields
    } = node;

    return {
        ...common,
        data: {
            kind: "text",
            label: "Text",
            text: typeof text === "string" ? text : "",
            color,
            extraFields,
        },
    };
}

function toFlowEdge(edge: ObsidianCanvasEdge): CanvasFlowEdge {
    const {
        id,
        fromNode,
        toNode,
        fromSide,
        toSide,
        label,
        color,
        ...extraFields
    } = edge;

    return {
        id,
        source: fromNode,
        target: toNode,
        sourceHandle: normalizeCanvasSide(fromSide),
        targetHandle: normalizeCanvasSide(toSide),
        label,
        style: color ? { stroke: color } : undefined,
        data: {
            label,
            color,
            extraFields,
        },
    };
}

function toObsidianNode(
    node: CanvasFlowNode,
    absolutePositions: Map<string, { x: number; y: number }>,
): ObsidianCanvasNode {
    const width = coerceNumericSize(node.style?.width, node.width, DEFAULT_NODE_WIDTH);
    const height = coerceNumericSize(node.style?.height, node.height, DEFAULT_NODE_HEIGHT);
    const absolutePosition = absolutePositions.get(node.id) ?? node.position;
    const baseNode = {
        ...(node.data.extraFields ?? {}),
        id: node.id,
        type: node.data.kind,
        x: absolutePosition.x,
        y: absolutePosition.y,
        width,
        height,
        parentId: node.parentId,
    };

    if (node.data.kind === "file") {
        return {
            ...baseNode,
            file: node.data.filePath,
            color: node.data.color,
        };
    }

    if (node.data.kind === "group") {
        return {
            ...baseNode,
            label: node.data.label,
            color: node.data.color,
            background: node.data.background,
        };
    }

    return {
        ...baseNode,
        text: node.data.text ?? "",
        color: node.data.color,
    };
}

function toObsidianEdge(edge: CanvasFlowEdge): ObsidianCanvasEdge {
    return {
        ...(edge.data?.extraFields ?? {}),
        id: edge.id,
        fromNode: edge.source,
        toNode: edge.target,
        fromSide: normalizeCanvasSide(edge.sourceHandle),
        toSide: normalizeCanvasSide(edge.targetHandle),
        label: edge.data?.label ?? (typeof edge.label === "string" ? edge.label : undefined),
        color: edge.data?.color,
    };
}

/**
 * @function sortNodesForSubFlowRuntime
 * @description 确保父节点出现在子节点之前，以满足 xyflow sub-flow 的处理顺序要求。
 * @param nodes 节点列表。
 * @returns 重新排序后的节点列表。
 */
function sortNodesForSubFlowRuntime(nodes: CanvasFlowNode[]): CanvasFlowNode[] {
    return [...nodes].sort((left, right) => {
        const leftRank = left.parentId ? 1 : 0;
        const rightRank = right.parentId ? 1 : 0;

        if (leftRank !== rightRank) {
            return leftRank - rightRank;
        }

        return left.id.localeCompare(right.id);
    });
}

/**
 * @function buildAbsolutePositionMap
 * @description 基于运行时节点构建绝对坐标映射，用于 sub-flow 的读写转换。
 * @param nodes 节点列表。
 * @returns 节点绝对坐标表。
 */
function buildAbsolutePositionMap(nodes: CanvasFlowNode[]): Map<string, { x: number; y: number }> {
    const absolutePositions = new Map<string, { x: number; y: number }>();

    sortNodesForSubFlowRuntime(nodes).forEach((node) => {
        const parentAbsolutePosition = node.parentId
            ? absolutePositions.get(node.parentId)
            : undefined;

        absolutePositions.set(node.id, {
            x: parentAbsolutePosition ? parentAbsolutePosition.x + node.position.x : node.position.x,
            y: parentAbsolutePosition ? parentAbsolutePosition.y + node.position.y : node.position.y,
        });
    });

    return absolutePositions;
}

/**
 * @function getBoundsForNodes
 * @description 计算一组节点在绝对坐标系下的外接矩形。
 * @param nodes 节点列表。
 * @param absolutePositions 节点绝对坐标表。
 * @returns 外接矩形。
 */
function getBoundsForNodes(
    nodes: CanvasFlowNode[],
    absolutePositions: Map<string, { x: number; y: number }>,
): CanvasRect {
    const rects = nodes.map((node) => getAbsoluteNodeRect(node, absolutePositions));
    const left = Math.min(...rects.map((rect) => rect.x));
    const top = Math.min(...rects.map((rect) => rect.y));
    const right = Math.max(...rects.map((rect) => rect.x + rect.width));
    const bottom = Math.max(...rects.map((rect) => rect.y + rect.height));

    return {
        x: left,
        y: top,
        width: right - left,
        height: bottom - top,
    };
}

/**
 * @function getAbsoluteNodeRect
 * @description 提取节点在绝对坐标系中的几何矩形。
 * @param node 运行时节点。
 * @param absolutePositions 节点绝对坐标表。
 * @returns 节点矩形。
 */
function getAbsoluteNodeRect(
    node: CanvasFlowNode,
    absolutePositions: Map<string, { x: number; y: number }>,
): CanvasRect {
    const position = absolutePositions.get(node.id) ?? node.position;

    return {
        x: position.x,
        y: position.y,
        width: coerceNumericSize(node.style?.width, node.width, DEFAULT_NODE_WIDTH),
        height: coerceNumericSize(node.style?.height, node.height, DEFAULT_NODE_HEIGHT),
    };
}

function normalizeParentId(parentId: unknown): string | undefined {
    return typeof parentId === "string" && parentId.trim() ? parentId : undefined;
}

function normalizeCanvasSide(side: unknown): CanvasSide {
    switch (side) {
    case "top":
    case "right":
    case "bottom":
    case "left":
        return side;
    default:
        return "right";
    }
}

function coerceNumericSize(
    styleValue: unknown,
    fallbackValue: unknown,
    defaultValue: number,
): number {
    if (typeof styleValue === "number" && Number.isFinite(styleValue)) {
        return styleValue;
    }

    if (typeof fallbackValue === "number" && Number.isFinite(fallbackValue)) {
        return fallbackValue;
    }

    return defaultValue;
}