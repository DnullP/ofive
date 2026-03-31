/**
 * @module plugins/architecture-devtools/ArchitectureDagEdgeCanvas
 * @description 架构 DevTools DAG 边层：使用单个 canvas 批量绘制连线，
 *   以减少大量 SVG path 节点带来的 DOM 与样式计算开销。
 *
 * @dependencies
 *   - react
 *   - ./architectureRegistry
 *
 * @example
 *   <ArchitectureDagEdgeCanvas
 *     width={layout.width}
 *     height={layout.height}
 *     edges={visibleEdges}
 *     positions={layout.positions}
 *     focusedNodeId={focusedNodeId}
 *     reverseModuleDependencyEdgeIds={reverseEdgeIds}
 *   />
 *
 * @exports
 *   - ArchitectureDagEdgeCanvas
 */

import { memo, useLayoutEffect, useRef, type ReactElement } from "react";
import type { ArchitectureEdge } from "./architectureRegistry";

interface EdgeCanvasNodePosition {
    x: number;
    y: number;
}

interface ArchitectureDagEdgeCanvasProps {
    width: number;
    height: number;
    nodeWidth: number;
    nodeHeight: number;
    edges: ArchitectureEdge[];
    focusedEdges: ArchitectureEdge[];
    positions: Map<string, EdgeCanvasNodePosition>;
    focusedNodeId: string | null;
    reverseModuleDependencyEdgeIds: ReadonlySet<string>;
    getEdgeKey: (edge: ArchitectureEdge) => string;
}

interface ArchitectureEdgePalette {
    dim: string;
    highlight: string;
    reverse: string;
}

/**
 * @function readPalette
 * @description 从当前主题 CSS 变量读取边绘制颜色。
 * @param canvasElement 画布元素。
 * @returns 边绘制配色。
 */
function readPalette(canvasElement: HTMLCanvasElement): ArchitectureEdgePalette {
    const styles = getComputedStyle(canvasElement);
    return {
        dim: styles.getPropertyValue("--architecture-edge-dim").trim() || "rgba(122, 122, 122, 0.22)",
        highlight: styles.getPropertyValue("--architecture-edge-highlight").trim() || "rgba(59, 130, 246, 1)",
        reverse: styles.getPropertyValue("--error-color").trim() || "rgba(220, 38, 38, 1)",
    };
}

/**
 * @function drawEdgeCurve
 * @description 在 canvas 上绘制单条边的贝塞尔曲线。
 * @param context 2D 绘图上下文。
 * @param from 起点位置。
 * @param to 终点位置。
 * @param nodeWidth 节点宽度。
 * @param nodeHeight 节点高度。
 */
function drawEdgeCurve(
    context: CanvasRenderingContext2D,
    from: EdgeCanvasNodePosition,
    to: EdgeCanvasNodePosition,
    nodeWidth: number,
    nodeHeight: number,
): void {
    const startX = from.x + nodeWidth;
    const startY = from.y + nodeHeight / 2;
    const endX = to.x;
    const endY = to.y + nodeHeight / 2;
    const controlOffset = Math.max(48, (endX - startX) / 2);

    context.beginPath();
    context.moveTo(startX, startY);
    context.bezierCurveTo(
        startX + controlOffset,
        startY,
        endX - controlOffset,
        endY,
        endX,
        endY,
    );
    context.stroke();
}

/**
 * @function prepareCanvasContext
 * @description 根据逻辑尺寸和设备像素比初始化画布上下文。
 * @param canvasElement 目标画布。
 * @param width 逻辑宽度。
 * @param height 逻辑高度。
 * @returns 已按设备像素比对齐的 2D 上下文；不可用时返回 null。
 */
function prepareCanvasContext(
    canvasElement: HTMLCanvasElement,
    width: number,
    height: number,
): CanvasRenderingContext2D | null {
    const pixelRatio = typeof window === "undefined"
        ? 1
        : Math.max(1, window.devicePixelRatio || 1);
    const nextWidth = Math.max(1, Math.round(width * pixelRatio));
    const nextHeight = Math.max(1, Math.round(height * pixelRatio));

    if (canvasElement.width !== nextWidth) {
        canvasElement.width = nextWidth;
    }
    if (canvasElement.height !== nextHeight) {
        canvasElement.height = nextHeight;
    }

    const context = canvasElement.getContext("2d");
    if (!context) {
        return null;
    }

    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, width, height);
    context.lineCap = "round";
    context.lineJoin = "round";
    context.lineWidth = 2;
    return context;
}

/**
 * @function drawEdgesIntoCanvas
 * @description 使用给定样式将边集合批量绘制到指定画布上下文。
 * @param context 目标画布上下文。
 * @param edges 待绘制边集合。
 * @param positions 节点位置映射。
 * @param nodeWidth 节点宽度。
 * @param nodeHeight 节点高度。
 * @param reverseModuleDependencyEdgeIds 反向依赖边集合。
 * @param getEdgeKey 架构边稳定键生成器。
 * @param palette 当前主题配色。
 * @param styleMode 绘制样式模式。
 */
function drawEdgesIntoCanvas(
    context: CanvasRenderingContext2D,
    edges: ArchitectureEdge[],
    positions: Map<string, EdgeCanvasNodePosition>,
    nodeWidth: number,
    nodeHeight: number,
    reverseModuleDependencyEdgeIds: ReadonlySet<string>,
    getEdgeKey: (edge: ArchitectureEdge) => string,
    palette: ArchitectureEdgePalette,
    styleMode: "unfocused" | "dimmed" | "highlighted",
): void {
    edges.forEach((edge) => {
        const from = positions.get(edge.from);
        const to = positions.get(edge.to);
        if (!from || !to) {
            return;
        }

        const isReverseModuleDependency = reverseModuleDependencyEdgeIds.has(getEdgeKey(edge));

        if (styleMode === "highlighted") {
            context.strokeStyle = isReverseModuleDependency ? palette.reverse : palette.highlight;
            context.globalAlpha = 1;
        } else if (styleMode === "dimmed") {
            context.strokeStyle = isReverseModuleDependency ? palette.reverse : palette.dim;
            context.globalAlpha = isReverseModuleDependency ? 0.7 : 0.4;
        } else {
            context.strokeStyle = isReverseModuleDependency ? palette.reverse : palette.dim;
            context.globalAlpha = isReverseModuleDependency ? 0.92 : 0.72;
        }

        drawEdgeCurve(context, from, to, nodeWidth, nodeHeight);
    });

    context.globalAlpha = 1;
}

/**
 * @function ArchitectureDagEdgeCanvas
 * @description 使用单画布绘制当前可见边，减少大量 SVG path 的 DOM 开销。
 * @param props 边层绘制参数。
 * @returns DAG 边画布图层。
 */
function ArchitectureDagEdgeCanvasComponent(
    props: ArchitectureDagEdgeCanvasProps,
): ReactElement {
    const baseCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const dimmedCanvasRef = useRef<HTMLCanvasElement | null>(null);
    const highlightCanvasRef = useRef<HTMLCanvasElement | null>(null);

    useLayoutEffect(() => {
        const baseCanvasElement = baseCanvasRef.current;
        const dimmedCanvasElement = dimmedCanvasRef.current;
        if (!baseCanvasElement || !dimmedCanvasElement) {
            return;
        }

        const baseContext = prepareCanvasContext(
            baseCanvasElement,
            props.width,
            props.height,
        );
        const dimmedContext = prepareCanvasContext(
            dimmedCanvasElement,
            props.width,
            props.height,
        );
        if (!baseContext || !dimmedContext) {
            return;
        }

        const palette = readPalette(baseCanvasElement);
        drawEdgesIntoCanvas(
            baseContext,
            props.edges,
            props.positions,
            props.nodeWidth,
            props.nodeHeight,
            props.reverseModuleDependencyEdgeIds,
            props.getEdgeKey,
            palette,
            "unfocused",
        );
        drawEdgesIntoCanvas(
            dimmedContext,
            props.edges,
            props.positions,
            props.nodeWidth,
            props.nodeHeight,
            props.reverseModuleDependencyEdgeIds,
            props.getEdgeKey,
            palette,
            "dimmed",
        );
    }, [props.edges, props.getEdgeKey, props.height, props.nodeHeight, props.nodeWidth, props.positions, props.reverseModuleDependencyEdgeIds, props.width]);

    useLayoutEffect(() => {
        const highlightCanvasElement = highlightCanvasRef.current;
        if (!highlightCanvasElement) {
            return;
        }

        const highlightContext = prepareCanvasContext(
            highlightCanvasElement,
            props.width,
            props.height,
        );
        if (!highlightContext) {
            return;
        }

        if (props.focusedNodeId === null || props.focusedEdges.length === 0) {
            return;
        }

        const palette = readPalette(highlightCanvasElement);
        drawEdgesIntoCanvas(
            highlightContext,
            props.focusedEdges,
            props.positions,
            props.nodeWidth,
            props.nodeHeight,
            props.reverseModuleDependencyEdgeIds,
            props.getEdgeKey,
            palette,
            "highlighted",
        );
    }, [props.focusedEdges, props.focusedNodeId, props.getEdgeKey, props.height, props.nodeHeight, props.nodeWidth, props.positions, props.reverseModuleDependencyEdgeIds, props.width]);

    return (
        <>
            <canvas
                aria-hidden="true"
                className="architecture-dag-edge-canvas"
                ref={baseCanvasRef}
                style={{
                    opacity: props.focusedNodeId === null ? 1 : 0,
                    width: `${String(props.width)}px`,
                    height: `${String(props.height)}px`,
                }}
            />
            <canvas
                aria-hidden="true"
                className="architecture-dag-edge-canvas"
                ref={dimmedCanvasRef}
                style={{
                    opacity: props.focusedNodeId === null ? 0 : 1,
                    width: `${String(props.width)}px`,
                    height: `${String(props.height)}px`,
                }}
            />
            <canvas
                aria-hidden="true"
                className="architecture-dag-edge-canvas architecture-dag-edge-canvas--highlight"
                ref={highlightCanvasRef}
                style={{
                    opacity: props.focusedNodeId === null ? 0 : 1,
                    width: `${String(props.width)}px`,
                    height: `${String(props.height)}px`,
                }}
            />
        </>
    );
}

export const ArchitectureDagEdgeCanvas = memo(ArchitectureDagEdgeCanvasComponent);