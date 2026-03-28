/**
 * @module layout/knowledgeGraphDomLabelRenderer
 * @description 知识图谱 DOM 标签渲染器：使用固定 DOM 池承载当前可见标签，
 *   避免 React 为全部节点标签维护常驻 DOM 节点。
 * @dependencies
 *  - ./knowledgeGraphLabelSelector
 *
 * @example
 *   const renderer = new KnowledgeGraphDomLabelRenderer(layerElement);
 *   renderer.setTotalLabelCount(1800);
 *   renderer.render(labels, 1);
 *
 * @exports
 *  - KnowledgeGraphDomLabelRenderer
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

/**
 * @class KnowledgeGraphDomLabelRenderer
 * @description 使用固定数量的 DOM 节点渲染知识图谱标签。
 *   该渲染器只维护当前可见标签的元素池，并复用节点以降低布局与 GC 压力。
 */
export class KnowledgeGraphDomLabelRenderer {
    /** 标签图层根节点。 */
    private readonly layerElement: HTMLDivElement;

    /** 可复用的空闲标签元素池。 */
    private readonly idleElements: HTMLDivElement[] = [];

    /** 当前活跃标签元素。 */
    private readonly activeElements = new Map<number, HTMLDivElement>();

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

    /**
     * @constructor
     * @description 创建 DOM 标签渲染器。
     * @param layerElement 标签图层元素。
     */
    constructor(layerElement: HTMLDivElement) {
        this.layerElement = layerElement;
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
     * @description 渲染当前可见标签集合。
     * @param labels 当前可见标签。
     * @param opacity 图层透明度。
     */
    render(labels: VisibleGraphLabel[], opacity: number): void {
        this.opacity = Number.isFinite(opacity) ? opacity : 0;
        this.layerElement.style.opacity = String(this.opacity);
        this.layerElement.style.pointerEvents = "none";

        const nextVisibleIndices = new Set(labels.map((label) => label.index));
        let swaps = 0;

        this.visibleIndices.forEach((index) => {
            if (!nextVisibleIndices.has(index)) {
                const element = this.activeElements.get(index);
                if (element) {
                    element.style.display = "none";
                    this.activeElements.delete(index);
                    this.idleElements.push(element);
                }
                swaps += 1;
            }
        });

        labels.forEach((label) => {
            let element = this.activeElements.get(label.index);
            if (!element) {
                element = this.idleElements.pop() ?? this.createElement();
                this.activeElements.set(label.index, element);
                element.dataset.labelIndex = String(label.index);
                element.textContent = label.text;
                swaps += 1;
            }

            if (element.dataset.labelIndex !== String(label.index)) {
                element.dataset.labelIndex = String(label.index);
            }
            if (element.textContent !== label.text) {
                element.textContent = label.text;
            }

            element.style.display = "block";
            element.style.transform =
                `translate3d(${label.screenX}px, ${label.screenY}px, 0) ` +
                "translate(-50%, -100%)";
        });

        this.visibleIndices = nextVisibleIndices;
        this.visibleLabelCount = labels.length;
        this.swapCount = swaps;
        this.maxSwapCount = Math.max(this.maxSwapCount, swaps);
    }

    /**
     * @function reset
     * @description 清空当前可见标签并重置透明度。
     */
    reset(): void {
        this.render([], 0);
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
     * @description 销毁渲染器并清理 DOM 节点。
     */
    dispose(): void {
        this.activeElements.forEach((element) => {
            element.remove();
        });
        this.idleElements.forEach((element) => {
            element.remove();
        });
        this.idleElements.length = 0;
        this.activeElements.clear();
        this.visibleIndices = new Set<number>();
        this.totalLabelCount = 0;
        this.visibleLabelCount = 0;
        this.opacity = 0;
        this.swapCount = 0;
        this.maxSwapCount = 0;
    }

    /**
     * @function createElement
     * @description 创建新的标签 DOM 元素。
     * @returns 新标签元素。
     */
    private createElement(): HTMLDivElement {
        const element = document.createElement("div");
        element.className = "knowledge-graph-tab__label";
        element.style.display = "none";
        this.layerElement.appendChild(element);
        return element;
    }
}