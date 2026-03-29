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
}

/**
 * @type CanvasFlowNode
 * @description xyflow 运行时节点类型。
 */
export type CanvasFlowNode = Node<CanvasNodeData, "ofiveCanvasNode">;

/**
 * @interface CanvasEdgeData
 * @description 前端运行时边数据。
 */
export interface CanvasEdgeData extends Record<string, unknown> {
    /** 边标签。 */
    label?: string;
    /** 边颜色。 */
    color?: string;
}

/**
 * @type CanvasFlowEdge
 * @description xyflow 运行时边类型。
 */
export type CanvasFlowEdge = Edge<CanvasEdgeData>;

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
    metadata?: {
        /** 文档标题。 */
        title?: string;
    };
}

interface ObsidianCanvasTextNode {
    id: string;
    type: "text";
    x: number;
    y: number;
    width: number;
    height: number;
    text?: string;
    color?: string;
}

interface ObsidianCanvasFileNode {
    id: string;
    type: "file";
    x: number;
    y: number;
    width: number;
    height: number;
    file?: string;
    color?: string;
}

interface ObsidianCanvasGroupNode {
    id: string;
    type: "group";
    x: number;
    y: number;
    width: number;
    height: number;
    label?: string;
    color?: string;
    background?: string;
}

type ObsidianCanvasNode =
    | ObsidianCanvasTextNode
    | ObsidianCanvasFileNode
    | ObsidianCanvasGroupNode;

interface ObsidianCanvasEdge {
    id: string;
    fromNode: string;
    toNode: string;
    fromSide?: string;
    toSide?: string;
    label?: string;
    color?: string;
}

interface ObsidianCanvasDocument {
    nodes?: ObsidianCanvasNode[];
    edges?: ObsidianCanvasEdge[];
    metadata?: {
        title?: string;
    };
}

const DEFAULT_NODE_WIDTH = 260;
const DEFAULT_NODE_HEIGHT = 160;

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

    const nodes = Array.isArray(parsed.nodes)
        ? parsed.nodes.map((node) => toFlowNode(node))
        : [];
    const edges = Array.isArray(parsed.edges)
        ? parsed.edges.map((edge) => toFlowEdge(edge))
        : [];

    return {
        nodes,
        edges,
        metadata: parsed.metadata,
    };
}

/**
 * @function serializeCanvasDocument
 * @description 将运行时文档序列化为 `.canvas` JSON。
 * @param document 当前文档。
 * @returns 标准化 JSON 文本。
 */
export function serializeCanvasDocument(document: CanvasDocument): string {
    const serialized: ObsidianCanvasDocument = {
        nodes: document.nodes.map((node) => toObsidianNode(node)),
        edges: document.edges.map((edge) => toObsidianEdge(edge)),
    };

    if (document.metadata?.title) {
        serialized.metadata = {
            title: document.metadata.title,
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
        type: "ofiveCanvasNode",
        position: { x, y },
        style: {
            width: 360,
            height: 220,
        },
        data: {
            kind: "group",
            label: "Group",
            color: "var(--canvas-node-group-accent)",
            background: "var(--canvas-node-group-surface)",
        },
    };
}

function toFlowNode(node: ObsidianCanvasNode): CanvasFlowNode {
    const common = {
        id: node.id,
        type: "ofiveCanvasNode" as const,
        position: {
            x: Number.isFinite(node.x) ? node.x : 0,
            y: Number.isFinite(node.y) ? node.y : 0,
        },
        style: {
            width: Number.isFinite(node.width) ? node.width : DEFAULT_NODE_WIDTH,
            height: Number.isFinite(node.height) ? node.height : DEFAULT_NODE_HEIGHT,
        },
    };

    if (node.type === "file") {
        const filePath = typeof node.file === "string" ? node.file : "";
        return {
            ...common,
            data: {
                kind: "file",
                label: filePath.split("/").pop() ?? filePath,
                filePath,
                color: node.color,
            },
        };
    }

    if (node.type === "group") {
        return {
            ...common,
            data: {
                kind: "group",
                label: node.label ?? "Group",
                color: node.color,
                background: node.background,
            },
        };
    }

    return {
        ...common,
        data: {
            kind: "text",
            label: "Text",
            text: node.text ?? "",
            color: node.color,
        },
    };
}

function toFlowEdge(edge: ObsidianCanvasEdge): CanvasFlowEdge {
    return {
        id: edge.id,
        source: edge.fromNode,
        target: edge.toNode,
        sourceHandle: normalizeCanvasSide(edge.fromSide),
        targetHandle: normalizeCanvasSide(edge.toSide),
        label: edge.label,
        style: edge.color ? { stroke: edge.color } : undefined,
        data: {
            label: edge.label,
            color: edge.color,
        },
    };
}

function toObsidianNode(node: CanvasFlowNode): ObsidianCanvasNode {
    const width = coerceNumericSize(node.style?.width, node.width, DEFAULT_NODE_WIDTH);
    const height = coerceNumericSize(node.style?.height, node.height, DEFAULT_NODE_HEIGHT);

    if (node.data.kind === "file") {
        return {
            id: node.id,
            type: "file",
            x: node.position.x,
            y: node.position.y,
            width,
            height,
            file: node.data.filePath,
            color: node.data.color,
        };
    }

    if (node.data.kind === "group") {
        return {
            id: node.id,
            type: "group",
            x: node.position.x,
            y: node.position.y,
            width,
            height,
            label: node.data.label,
            color: node.data.color,
            background: node.data.background,
        };
    }

    return {
        id: node.id,
        type: "text",
        x: node.position.x,
        y: node.position.y,
        width,
        height,
        text: node.data.text ?? "",
        color: node.data.color,
    };
}

function toObsidianEdge(edge: CanvasFlowEdge): ObsidianCanvasEdge {
    return {
        id: edge.id,
        fromNode: edge.source,
        toNode: edge.target,
        fromSide: normalizeCanvasSide(edge.sourceHandle),
        toSide: normalizeCanvasSide(edge.targetHandle),
        label: edge.data?.label ?? (typeof edge.label === "string" ? edge.label : undefined),
        color: edge.data?.color,
    };
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