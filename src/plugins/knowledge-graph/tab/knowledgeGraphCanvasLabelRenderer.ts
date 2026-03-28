/**
 * @module layout/knowledgeGraphCanvasLabelRenderer
 * @description 知识图谱 canvas 标签渲染器：使用单画布批量绘制当前可见标签，
 *   避免高密度图谱下为大量标签维护独立 DOM 节点。
 * @dependencies
 *  - ./knowledgeGraphLabelSelector
 *
 * @example
 *   const renderer = new KnowledgeGraphCanvasLabelRenderer(layerElement);
 *   renderer.setTotalLabelCount(1800);
 *   renderer.render(labels, 1, 800, 600);
 *
 * @exports
 *  - KnowledgeGraphCanvasLabelRenderer
 *  - GraphLabelRenderStats
 */

import type { VisibleGraphLabel } from "./knowledgeGraphLabelSelector";

/**
 * @interface GraphLabelRenderStats
 * @description 标签渲染状态摘要。
 */
export interface GraphLabelRenderStats {
    /** 标签总数。 */
    totalLabelCount: number;
    /** 当前可见标签数。 */
    visibleLabelCount: number;
    /** 当前图层透明度。 */
    opacity: number;
    /** 本帧进入或退出可见集的标签数。 */
    swapCount: number;
    /** 历史最大标签切换数。 */
    maxSwapCount: number;
}

interface CanvasLabelStyleSnapshot {
    font: string;
    textColor: string;
    backgroundColor: string;
    shadowColor: string;
    paddingX: number;
    paddingY: number;
    borderRadius: number;
    lineHeightPx: number;
}

/**
 * @class KnowledgeGraphCanvasLabelRenderer
 * @description 使用单画布绘制知识图谱标签。
 *   所有标签共享一个 canvas，从而将大量 DOM 更新收敛为一次批量绘制。
 */
export class KnowledgeGraphCanvasLabelRenderer {
    /** 标签图层根节点。 */
    private readonly layerElement: HTMLDivElement;

    /** 标签绘制画布。 */
    private readonly canvasElement: HTMLCanvasElement;

    /** 2D 绘图上下文。 */
    private readonly context: CanvasRenderingContext2D;

    /** 文本宽度缓存。 */
    private readonly textWidthCache = new Map<string, number>();

    /** 当前可见标签索引。 */
    private visibleIndices = new Set<number>();

    /** 标签总数。 */
    private totalLabelCount = 0;

    /** 当前显示的标签数。 */
    private visibleLabelCount = 0;

    /** 当前透明度。 */
    private opacity = 0;

    /** 上次渲染的标签切换数量。 */
    private swapCount = 0;

    /** 历史最大标签切换数量。 */
    private maxSwapCount = 0;

    /** 上次已应用的画布宽度。 */
    private width = 0;

    /** 上次已应用的画布高度。 */
    private height = 0;

    /** 上次已应用的像素比。 */
    private pixelRatio = 1;

    /** 当前标签绘制样式快照。 */
    private styleSnapshot: CanvasLabelStyleSnapshot | null = null;

    /**
     * @constructor
     * @description 创建 canvas 标签渲染器。
     * @param layerElement 标签图层元素。
     * @throws 当 2D canvas 上下文不可用时抛出异常。
     */
    constructor(layerElement: HTMLDivElement) {
        this.layerElement = layerElement;
        this.canvasElement = document.createElement("canvas");
        this.canvasElement.className = "knowledge-graph-tab__labels-canvas";
        const context = this.canvasElement.getContext("2d");
        if (!context) {
            throw new Error("knowledge graph label canvas 2d context is unavailable");
        }
        this.context = context;
        this.layerElement.appendChild(this.canvasElement);
    }

    /**
     * @function setTotalLabelCount
     * @description 设置当前图谱的标签总数。
     * @param totalLabelCount 标签总数。
     */
    setTotalLabelCount(totalLabelCount: number): void {
        this.totalLabelCount = Math.max(0, totalLabelCount);
    }

    /**
     * @function render
     * @description 批量绘制当前可见标签。
     * @param labels 当前可见标签。
     * @param opacity 图层透明度。
     * @param width 图层宽度。
     * @param height 图层高度。
     */
    render(
        labels: VisibleGraphLabel[],
        opacity: number,
        width: number,
        height: number,
    ): void {
        this.opacity = Number.isFinite(opacity) ? opacity : 0;
        this.layerElement.style.opacity = String(this.opacity);
        this.layerElement.style.pointerEvents = "none";

        this.ensureCanvasSize(width, height);
        this.refreshStyleSnapshot();
        this.clearCanvas();

        const nextVisibleIndices = new Set(labels.map((label) => label.index));
        this.swapCount = this.computeSwapCount(nextVisibleIndices);
        this.maxSwapCount = Math.max(this.maxSwapCount, this.swapCount);
        this.visibleIndices = nextVisibleIndices;
        this.visibleLabelCount = labels.length;

        if (this.opacity <= 0 || labels.length === 0 || !this.styleSnapshot) {
            return;
        }

        const context = this.context;
        const style = this.styleSnapshot;
        context.save();
        context.globalAlpha = this.opacity;
        context.font = style.font;
        context.textAlign = "left";
        context.textBaseline = "middle";
        context.shadowColor = style.shadowColor;
        context.shadowBlur = 10;
        context.shadowOffsetX = 0;
        context.shadowOffsetY = 3;

        labels.forEach((label) => {
            const textWidth = this.measureTextWidth(label.text, style.font);
            const boxWidth = textWidth + style.paddingX * 2;
            const boxHeight = style.lineHeightPx + style.paddingY * 2;
            const boxX = label.screenX - boxWidth / 2;
            const boxY = label.screenY - boxHeight;

            this.drawRoundedRect(
                context,
                boxX,
                boxY,
                boxWidth,
                boxHeight,
                style.borderRadius,
                style.backgroundColor,
            );

            context.shadowColor = "transparent";
            context.fillStyle = style.textColor;
            context.fillText(
                label.text,
                boxX + style.paddingX,
                boxY + boxHeight / 2,
            );
            context.shadowColor = style.shadowColor;
        });

        context.restore();
    }

    /**
     * @function reset
     * @description 清空当前可见标签并重置透明度。
     */
    reset(): void {
        this.visibleIndices = new Set<number>();
        this.visibleLabelCount = 0;
        this.opacity = 0;
        this.swapCount = 0;
        this.layerElement.style.opacity = "0";
        this.clearCanvas();
    }

    /**
     * @function getStats
     * @description 读取标签渲染摘要。
     * @returns 当前标签渲染状态。
     */
    getStats(): GraphLabelRenderStats {
        return {
            totalLabelCount: this.totalLabelCount,
            visibleLabelCount: this.visibleLabelCount,
            opacity: this.opacity,
            swapCount: this.swapCount,
            maxSwapCount: this.maxSwapCount,
        };
    }

    /**
     * @function getVisibleIndices
     * @description 读取当前可见标签索引集合。
     * @returns 当前可见标签索引集合。
     */
    getVisibleIndices(): ReadonlySet<number> {
        return this.visibleIndices;
    }

    /**
     * @function dispose
     * @description 销毁渲染器并清理画布节点。
     */
    dispose(): void {
        this.canvasElement.remove();
        this.visibleIndices = new Set<number>();
        this.textWidthCache.clear();
        this.totalLabelCount = 0;
        this.visibleLabelCount = 0;
        this.opacity = 0;
        this.swapCount = 0;
        this.maxSwapCount = 0;
        this.width = 0;
        this.height = 0;
    }

    /**
     * @function ensureCanvasSize
     * @description 确保 canvas 像素尺寸与容器尺寸同步。
     * @param width 图层宽度。
     * @param height 图层高度。
     */
    private ensureCanvasSize(width: number, height: number): void {
        const safeWidth = Math.max(1, Math.floor(width));
        const safeHeight = Math.max(1, Math.floor(height));
        const nextPixelRatio = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
        if (
            safeWidth === this.width &&
            safeHeight === this.height &&
            nextPixelRatio === this.pixelRatio
        ) {
            return;
        }

        this.width = safeWidth;
        this.height = safeHeight;
        this.pixelRatio = nextPixelRatio;
        this.canvasElement.width = Math.floor(safeWidth * nextPixelRatio);
        this.canvasElement.height = Math.floor(safeHeight * nextPixelRatio);
        this.canvasElement.style.width = `${String(safeWidth)}px`;
        this.canvasElement.style.height = `${String(safeHeight)}px`;
        this.context.setTransform(nextPixelRatio, 0, 0, nextPixelRatio, 0, 0);
    }

    /**
     * @function refreshStyleSnapshot
     * @description 读取当前主题下的标签样式快照。
     */
    private refreshStyleSnapshot(): void {
        const rootStyle = window.getComputedStyle(document.documentElement);
        const layerStyle = window.getComputedStyle(this.layerElement);
        const fontSizePx = 10;
        const fontFamily = layerStyle.fontFamily || rootStyle.fontFamily || "sans-serif";
        this.styleSnapshot = {
            font: `${String(fontSizePx)}px ${fontFamily}`,
            textColor: rootStyle.getPropertyValue("--graph-text-color").trim() || "#ffffff",
            backgroundColor: rootStyle.getPropertyValue("--graph-label-bg").trim() || "rgba(0, 0, 0, 0.72)",
            shadowColor:
                rootStyle.getPropertyValue("--graph-label-shadow-color").trim()
                || rootStyle.getPropertyValue("--chrome-backdrop-shadow").trim(),
            paddingX: 4,
            paddingY: 1,
            borderRadius: 4,
            lineHeightPx: 12,
        };
    }

    /**
     * @function clearCanvas
     * @description 清空当前画布内容。
     */
    private clearCanvas(): void {
        this.context.clearRect(0, 0, this.width, this.height);
    }

    /**
     * @function measureTextWidth
     * @description 测量文本宽度并缓存结果。
     * @param text 文本内容。
     * @param font 当前字体。
     * @returns 文本宽度。
     */
    private measureTextWidth(text: string, font: string): number {
        const cacheKey = `${font}::${text}`;
        const cached = this.textWidthCache.get(cacheKey);
        if (cached !== undefined) {
            return cached;
        }

        this.context.save();
        this.context.font = font;
        const width = this.context.measureText(text).width;
        this.context.restore();
        this.textWidthCache.set(cacheKey, width);
        return width;
    }

    /**
     * @function computeSwapCount
     * @description 计算当前帧与上一帧之间的可见标签切换数量。
     * @param nextVisibleIndices 下一帧可见索引集合。
     * @returns 标签切换数量。
     */
    private computeSwapCount(nextVisibleIndices: ReadonlySet<number>): number {
        let swaps = 0;
        this.visibleIndices.forEach((index) => {
            if (!nextVisibleIndices.has(index)) {
                swaps += 1;
            }
        });
        nextVisibleIndices.forEach((index) => {
            if (!this.visibleIndices.has(index)) {
                swaps += 1;
            }
        });
        return swaps;
    }

    /**
     * @function drawRoundedRect
     * @description 在 canvas 上绘制圆角背景。
     * @param context 绘图上下文。
     * @param x 左上角 X。
     * @param y 左上角 Y。
     * @param width 宽度。
     * @param height 高度。
     * @param radius 圆角半径。
     * @param fillStyle 填充样式。
     */
    private drawRoundedRect(
        context: CanvasRenderingContext2D,
        x: number,
        y: number,
        width: number,
        height: number,
        radius: number,
        fillStyle: string,
    ): void {
        const clampedRadius = Math.max(0, Math.min(radius, width / 2, height / 2));
        context.beginPath();
        context.moveTo(x + clampedRadius, y);
        context.lineTo(x + width - clampedRadius, y);
        context.quadraticCurveTo(x + width, y, x + width, y + clampedRadius);
        context.lineTo(x + width, y + height - clampedRadius);
        context.quadraticCurveTo(x + width, y + height, x + width - clampedRadius, y + height);
        context.lineTo(x + clampedRadius, y + height);
        context.quadraticCurveTo(x, y + height, x, y + height - clampedRadius);
        context.lineTo(x, y + clampedRadius);
        context.quadraticCurveTo(x, y, x + clampedRadius, y);
        context.closePath();
        context.fillStyle = fillStyle;
        context.fill();
    }
}