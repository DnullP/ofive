/**
 * @module layout/KnowledgeGraphTab
 * @description 应用内知识图谱 Tab：展示基于 Markdown 文件与链接关系构建的图结构。
 * @dependencies
 *  - react
 *  - @cosmos.gl/graph
 *  - ../../../api/vaultApi
 *  - ./KnowledgeGraphTab.css
 *
 * @example
 *   通过活动栏图谱图标打开知识图谱 Tab。
 *
 * @exports
 *  - KnowledgeGraphTab: 图谱渲染组件
 */

import { Graph, type GraphConfigInterface } from "@cosmos.gl/graph";
import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import type { WorkbenchTabProps } from "../../../host/layout/workbenchContracts";
import { getCurrentVaultMarkdownGraph } from "../../../api/vaultApi";
import { createKnowledgeGraphInteractionCallbacksFor } from "./knowledgeGraphInteractions";
import { buildKnowledgeGraphConfig } from "./knowledgeGraphSettings";
import type { GraphLabelItem, VisibleGraphLabel } from "./knowledgeGraphLabelSelector";
import { KnowledgeGraphCanvasLabelRenderer } from "./knowledgeGraphCanvasLabelRenderer";
import {
    useGraphSettingsState,
    useGraphSettingsSync,
} from "../store/graphSettingsStore";
import { useThemeState } from "../../../host/theme/themeStore";
import { useVaultState } from "../../../host/vault/vaultStore";
import { openFileInWorkbench } from "../../../host/layout/openFileService";
import "./KnowledgeGraphTab.css";

/**
 * @interface GraphTabState
 * @description 图谱组件运行状态。
 */
interface GraphTabState {
    loading: boolean;
    error: string | null;
    nodeCount: number;
    edgeCount: number;
}

/**
 * @interface KnowledgeGraphPerfTestHook
 * @description 图谱性能测试钩子：为前端 perf 场景提供缩放和标签状态读取能力。
 */
interface KnowledgeGraphPerfTestHook {
    /** 获取当前缩放级别。 */
    getZoomLevel: () => number;
    /** 获取当前标签显示阈值。 */
    getLabelVisibleZoomLevel: () => number;
    /** 设置当前缩放级别。 */
    setZoomLevel: (zoomLevel: number) => void;
    /** 读取标签层当前可见性摘要。 */
    getLabelStats: () => {
        totalLabelCount: number;
        visibleLabelCount: number;
        opacity: number;
        swapCount: number;
        maxSwapCount: number;
    };
}

interface SpaceBounds {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
}

declare global {
    interface Window {
        /** 知识图谱性能测试钩子，仅用于 perf 场景驱动连续缩放。 */
        __OFIVE_KNOWLEDGE_GRAPH_PERF_HOOK__?: KnowledgeGraphPerfTestHook;
    }
}

/**
 * @constant DRAG_START_REHEAT_ALPHA
 * @description 拖拽起始注入能量，保证整体联动。
 */
const DRAG_START_REHEAT_ALPHA = 0.24;

/**
 * @constant DRAG_MOVE_REHEAT_ALPHA
 * @description 拖拽过程中补充能量，避免图谱“拖不动”。
 */
const DRAG_MOVE_REHEAT_ALPHA = 0.08;

/**
 * @constant DRAG_END_REHEAT_ALPHA
 * @description 拖拽释放后的尾波能量，形成自然回弹后静止。
 */
const DRAG_END_REHEAT_ALPHA = 0.12;

/**
 * @constant DRAG_MOVE_REHEAT_INTERVAL_MS
 * @description 拖拽过程中补能节流间隔。
 */
const DRAG_MOVE_REHEAT_INTERVAL_MS = 120;

/**
 * @constant LABEL_Y_OFFSET_PX
 * @description 标签在节点上方的偏移像素。
 */
const LABEL_Y_OFFSET_PX = 14;

/**
 * @constant LABEL_VIEW_PADDING_PX
 * @description 标签视口裁剪的屏幕外扩距离。
 */
const LABEL_VIEW_PADDING_PX = 24;

/**
 * @constant LABEL_FADE_RANGE
 * @description 标签从透明到完全可见的缩放过渡区间宽度（相对于阈值的比例）。
 * 当缩放在 [threshold, threshold + LABEL_FADE_RANGE] 区间时标签逐渐显现。
 */
const LABEL_FADE_RANGE = 0.15;

/**
 * @constant ZOOM_IN_SCALE_AFTER_FIT
 * @description fitView 后额外放大的缩放倍率。
 */
const ZOOM_IN_SCALE_AFTER_FIT = 1.2;

/**
 * @function createSeededRandom
 * @description 创建可复现随机数生成器。
 * @param seed 随机种子。
 * @returns 随机函数。
 */
function createSeededRandom(seed: number): () => number {
    let current = seed % 2147483647;
    if (current <= 0) {
        current += 2147483646;
    }

    return () => {
        current = (current * 16807) % 2147483647;
        return (current - 1) / 2147483646;
    };
}

/**
 * @function createInitialPositions
 * @description 按圆盘布局生成节点初始坐标，避免首帧偏移。
 * @param nodeCount 节点数量。
 * @param centerX 相机中心 X。
 * @param centerY 相机中心 Y。
 * @returns 点位数组。
 */
function createInitialPositions(nodeCount: number, centerX: number, centerY: number): Float32Array {
    const random = createSeededRandom(17);
    const goldenAngle = Math.PI * (3 - Math.sqrt(5));
    const baseRadius = Math.max(24, 16 + Math.sqrt(nodeCount) * 6);
    const positions = new Float32Array(nodeCount * 2);

    for (let index = 0; index < nodeCount; index += 1) {
        const normalized = Math.sqrt((index + 0.5) / Math.max(1, nodeCount));
        const jitter = 0.9 + random() * 0.2;
        const radius = baseRadius * normalized * jitter;
        const angle = index * goldenAngle + random() * 0.08;
        positions[index * 2] = centerX + Math.cos(angle) * radius;
        positions[index * 2 + 1] = centerY + Math.sin(angle) * radius;
    }

    return positions;
}

/**
 * @function getNodeLabelText
 * @description 生成节点显示文本，优先使用 md 文件名。
 * @param path 节点相对路径。
 * @param title 节点标题。
 * @returns 节点标签。
 */
function getNodeLabelText(path: string, title: string): string {
    const fileName = path.split("/").pop()?.trim() ?? "";
    if (fileName.length > 0) {
        return fileName;
    }

    const fallbackTitle = title.trim();
    if (fallbackTitle.length > 0) {
        return fallbackTitle;
    }

    return path;
}

/**
 * @function computeLabelOpacity
 * @description 根据当前缩放级别和阈值计算标签透明度。
 * @param currentZoom 当前缩放级别。
 * @param threshold 标签开始显现的最低缩放阈值。
 * @returns 0 到 1 之间的透明度值。
 */
function computeLabelOpacity(currentZoom: number, threshold: number): number {
    if (currentZoom >= threshold + LABEL_FADE_RANGE) {
        return 1;
    }
    if (currentZoom <= threshold) {
        return 0;
    }
    return (currentZoom - threshold) / LABEL_FADE_RANGE;
}

/**
 * @function createVisibleSpaceBounds
 * @description 根据当前屏幕视口生成图谱空间内的可见边界。
 * @param graph Graph 实例。
 * @param viewWidth 视口宽度。
 * @param viewHeight 视口高度。
 * @returns 当前可见空间边界。
 */
function createVisibleSpaceBounds(
    graph: Graph,
    viewWidth: number,
    viewHeight: number,
): SpaceBounds {
    const topLeft = graph.screenToSpacePosition([
        -LABEL_VIEW_PADDING_PX,
        -LABEL_VIEW_PADDING_PX,
    ]);
    const bottomRight = graph.screenToSpacePosition([
        viewWidth + LABEL_VIEW_PADDING_PX,
        viewHeight + LABEL_VIEW_PADDING_PX,
    ]);

    return {
        minX: Math.min(topLeft[0], bottomRight[0]),
        maxX: Math.max(topLeft[0], bottomRight[0]),
        minY: Math.min(topLeft[1], bottomRight[1]),
        maxY: Math.max(topLeft[1], bottomRight[1]),
    };
}

/**
 * @function KnowledgeGraphTab
 * @description 渲染知识图谱并与后端图数据接口同步。
 *   支持缩放级别驱动的标签渐显、单击节点跳转笔记、Cmd+单击在新 Tab 打开笔记。
 * @param props Dockview 面板属性，通过 containerApi 操控 Tab。
 * @returns Dockview Tab 组件。
 */
export function KnowledgeGraphTab(
    props: WorkbenchTabProps<Record<string, unknown>>,
): ReactElement {
    const { t } = useTranslation();
    const { currentVaultPath } = useVaultState();
    useGraphSettingsSync(currentVaultPath, true);
    const { themeMode } = useThemeState();
    const { settings: graphSettings } = useGraphSettingsState();
    const hostRef = useRef<HTMLDivElement | null>(null);
    const graphRef = useRef<Graph | null>(null);
    const labelLayerRef = useRef<HTMLDivElement | null>(null);
    const labelRendererRef = useRef<KnowledgeGraphCanvasLabelRenderer | null>(null);
    const labelItemsRef = useRef<GraphLabelItem[]>([]);
    const dragTailTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const labelRafRef = useRef<number | null>(null);
    const lastDragReheatTimeRef = useRef<number>(0);
    /** 节点索引到相对路径的映射表，用于点击节点时打开对应笔记 */
    const nodePathsByIndexRef = useRef<Map<number, string>>(new Map());
    /** 标签显示缩放阈值引用，供交互回调闭包读取最新值 */
    const labelVisibleZoomLevelRef = useRef<number>(graphSettings.labelVisibleZoomLevel);
    const [state, setState] = useState<GraphTabState>({
        loading: true,
        error: null,
        nodeCount: 0,
        edgeCount: 0,
    });

    const graphConfig: GraphConfigInterface = useMemo(
        () => buildKnowledgeGraphConfig(graphSettings),
        [graphSettings, themeMode],
    );

    /**
     * @function registerPerfTestHook
     * @description 注册图谱性能测试钩子，供 Playwright 场景驱动连续缩放。
     * @param graph Graph 实例。
     */
    const registerPerfTestHook = (graph: Graph): void => {
        if (typeof window === "undefined") {
            return;
        }

        window.__OFIVE_KNOWLEDGE_GRAPH_PERF_HOOK__ = {
            getZoomLevel: () => graph.getZoomLevel(),
            getLabelVisibleZoomLevel: () => labelVisibleZoomLevelRef.current,
            setZoomLevel: (zoomLevel: number) => {
                graph.setZoomLevel(zoomLevel, 0);
                scheduleLabelLayoutUpdate(graph);
            },
            getLabelStats: () => labelRendererRef.current?.getStats() ?? {
                totalLabelCount: labelItemsRef.current.length,
                visibleLabelCount: 0,
                opacity: 0,
                swapCount: 0,
                maxSwapCount: 0,
            },
        };
    };

    /**
     * @function unregisterPerfTestHook
     * @description 清理图谱性能测试钩子。
     */
    const unregisterPerfTestHook = (): void => {
        if (typeof window === "undefined") {
            return;
        }

        delete window.__OFIVE_KNOWLEDGE_GRAPH_PERF_HOOK__;
    };

    /**
     * @function scheduleLabelLayoutUpdate
     * @description 通过 RAF 节流同步标签屏幕坐标并根据缩放级别控制标签整体透明度。
     * @param graph Graph 实例。
     */
    const scheduleLabelLayoutUpdate = (graph: Graph): void => {
        if (labelRafRef.current !== null) {
            return;
        }

        labelRafRef.current = window.requestAnimationFrame(() => {
            labelRafRef.current = null;

            const labelLayerElement = labelLayerRef.current;
            const hostElement = hostRef.current;
            if (!labelLayerElement || !hostElement) {
                console.warn("[knowledge-graph] skip label layout update because host or layer is null");
                return;
            }

            if (!labelRendererRef.current) {
                labelRendererRef.current = new KnowledgeGraphCanvasLabelRenderer(labelLayerElement);
            }

            const labelRenderer = labelRendererRef.current;
            labelRenderer.setTotalLabelCount(labelItemsRef.current.length);

            const currentZoom = graph.getZoomLevel();
            const threshold = labelVisibleZoomLevelRef.current;
            const opacity = computeLabelOpacity(currentZoom, threshold);

            if (opacity <= 0) {
                labelRenderer.reset();
                return;
            }

            const labelItems = labelItemsRef.current;
            if (labelItems.length === 0) {
                labelRenderer.reset();
                return;
            }

            const pointPositions = graph.getPointPositions();
            const viewWidth = hostElement.clientWidth;
            const viewHeight = hostElement.clientHeight;
            const visibleSpaceBounds = createVisibleSpaceBounds(
                graph,
                viewWidth,
                viewHeight,
            );
            const nextVisibleLabels: VisibleGraphLabel[] = [];

            labelItems.forEach((item) => {
                const x = pointPositions[item.index * 2];
                const y = pointPositions[item.index * 2 + 1];
                if (x === undefined || y === undefined) {
                    return;
                }

                const isInsideVisibleSpace =
                    x >= visibleSpaceBounds.minX &&
                    x <= visibleSpaceBounds.maxX &&
                    y >= visibleSpaceBounds.minY &&
                    y <= visibleSpaceBounds.maxY;
                if (!isInsideVisibleSpace) {
                    return;
                }

                const [screenX, rawScreenY] = graph.spaceToScreenPosition([x, y]);
                const screenY = rawScreenY - LABEL_Y_OFFSET_PX;
                const isInsideView =
                    Number.isFinite(screenX) &&
                    Number.isFinite(screenY) &&
                    screenX >= -LABEL_VIEW_PADDING_PX &&
                    screenX <= viewWidth + LABEL_VIEW_PADDING_PX &&
                    screenY >= -LABEL_VIEW_PADDING_PX &&
                    screenY <= viewHeight + LABEL_VIEW_PADDING_PX;
                if (!isInsideView) {
                    return;
                }

                nextVisibleLabels.push({
                    index: item.index,
                    text: item.text,
                    screenX,
                    screenY,
                });
            });

            labelRenderer.render(nextVisibleLabels, opacity, viewWidth, viewHeight);
        });
    };

    /**
     * @function handleNodeClick
     * @description 处理图谱节点点击事件：打开对应笔记 Tab，若已存在则跳转激活。
     * @param index 节点索引。
     * @param _pointPosition 节点在仿真空间中的坐标（未使用）。
     * @param _event 鼠标事件（未使用）。
     */
    const handleNodeClick = async (
        index: number,
        _pointPosition: [number, number],
        _event: MouseEvent,
    ): Promise<void> => {
        const relativePath = nodePathsByIndexRef.current.get(index);
        if (!relativePath) {
            console.warn("[knowledge-graph] clicked node has no path mapping", { index });
            return;
        }

        console.info("[knowledge-graph] node clicked", { index, relativePath });

        try {
            await openFileInWorkbench({
                containerApi: props.containerApi,
                currentVaultPath,
                relativePath,
            });
            console.info("[knowledge-graph] opened note from graph node", { relativePath });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            console.error("[knowledge-graph] failed to open note from graph node", {
                relativePath,
                message,
            });
        }
    };

    useEffect(() => {
        const hostElement = hostRef.current;
        if (!hostElement) {
            console.warn("[knowledge-graph] canvas host is null on init");
            return;
        }

        const graph = new Graph(hostElement, {
            ...graphConfig,
            onSimulationStart: () => {
                console.debug("[knowledge-graph] simulation started");
            },
            onSimulationEnd: () => {
                console.debug("[knowledge-graph] simulation ended");
            },
            ...createKnowledgeGraphInteractionCallbacksFor<Graph>({
                graphRef,
                dragTailTimerRef,
                lastDragReheatTimeRef,
                scheduleLabelLayoutUpdate,
                dragReheatConfig: {
                    startAlpha: DRAG_START_REHEAT_ALPHA,
                    moveAlpha: DRAG_MOVE_REHEAT_ALPHA,
                    endAlpha: DRAG_END_REHEAT_ALPHA,
                    moveIntervalMs: DRAG_MOVE_REHEAT_INTERVAL_MS,
                    endDelayMs: 80,
                },
                now: () => Date.now(),
                setTimeoutImpl: window.setTimeout,
                clearTimeoutImpl: window.clearTimeout,
            }),
            onPointClick: (
                index: number,
                pointPosition: [number, number],
                event: MouseEvent,
            ) => {
                void handleNodeClick(index, pointPosition, event);
            },
        });

        graphRef.current = graph;
        if (labelLayerRef.current) {
            labelRendererRef.current = new KnowledgeGraphCanvasLabelRenderer(labelLayerRef.current);
        }
        registerPerfTestHook(graph);
        console.info("[knowledge-graph] graph instance initialized");

        return () => {
            if (dragTailTimerRef.current !== null) {
                window.clearTimeout(dragTailTimerRef.current);
            }
            if (labelRafRef.current !== null) {
                window.cancelAnimationFrame(labelRafRef.current);
                labelRafRef.current = null;
            }
            labelRendererRef.current?.dispose();
            labelRendererRef.current = null;
            labelItemsRef.current = [];
            graph.destroy();
            graphRef.current = null;
            unregisterPerfTestHook();
            console.info("[knowledge-graph] graph instance destroyed");
        };
    }, []);

    useEffect(() => {
        const graph = graphRef.current;
        if (!graph) {
            return;
        }

        graph.setConfig(graphConfig);
        scheduleLabelLayoutUpdate(graph);
        console.info("[knowledge-graph] graph config updated by settings");
    }, [graphConfig]);

    /* ── 标签阈值变化时同步 ref 并触发重绘 ── */
    useEffect(() => {
        labelVisibleZoomLevelRef.current = graphSettings.labelVisibleZoomLevel;
        const graph = graphRef.current;
        if (graph) {
            registerPerfTestHook(graph);
            scheduleLabelLayoutUpdate(graph);
            console.info("[knowledge-graph] labelVisibleZoomLevel updated", {
                labelVisibleZoomLevel: graphSettings.labelVisibleZoomLevel,
            });
        }
    }, [graphSettings.labelVisibleZoomLevel]);

    useEffect(() => {
        const graph = graphRef.current;
        const hostElement = hostRef.current;
        if (!graph || !hostElement) {
            return;
        }

        let canceled = false;

        const loadGraph = async (): Promise<void> => {
            setState((previous) => ({ ...previous, loading: true, error: null }));
            console.info("[knowledge-graph] loading markdown graph data");

            try {
                const response = await getCurrentVaultMarkdownGraph();
                if (canceled) {
                    return;
                }

                const indexByPath = new Map<string, number>();
                response.nodes.forEach((node, index) => {
                    indexByPath.set(node.path, index);
                });

                const linksArray: number[] = [];
                response.edges.forEach((edge) => {
                    const sourceIndex = indexByPath.get(edge.sourcePath);
                    const targetIndex = indexByPath.get(edge.targetPath);
                    if (sourceIndex === undefined || targetIndex === undefined) {
                        return;
                    }
                    linksArray.push(sourceIndex, targetIndex);
                });

                const cameraCenter = graph.screenToSpacePosition([
                    hostElement.clientWidth / 2,
                    hostElement.clientHeight / 2,
                ]);
                const positions = createInitialPositions(
                    response.nodes.length,
                    cameraCenter[0],
                    cameraCenter[1],
                );

                /* 缓存节点索引到路径的映射，供点击回调使用 */
                const nextPathsByIndex = new Map<number, string>();
                response.nodes.forEach((node, index) => {
                    nextPathsByIndex.set(index, node.path);
                });
                nodePathsByIndexRef.current = nextPathsByIndex;

                const nextLabels = response.nodes.map((node, index) => ({
                    index,
                    text: getNodeLabelText(node.path, node.title),
                }));
                labelItemsRef.current = nextLabels;
                labelRendererRef.current?.setTotalLabelCount(nextLabels.length);

                graph.stop();
                graph.setPointPositions(positions);
                graph.setLinks(new Float32Array(linksArray));
                graph.render(0.12);
                graph.start(0.12);
                if (response.nodes.length > 0) {
                    graph.fitView(0, 0.08);
                    const zoomLevelAfterFit = graph.getZoomLevel();
                    graph.setZoomLevel(zoomLevelAfterFit * ZOOM_IN_SCALE_AFTER_FIT, 0);
                }

                registerPerfTestHook(graph);
                scheduleLabelLayoutUpdate(graph);

                setState({
                    loading: false,
                    error: null,
                    nodeCount: response.nodes.length,
                    edgeCount: linksArray.length / 2,
                });

                console.info("[knowledge-graph] state updated after graph load", {
                    loading: false,
                    hasError: false,
                });

                console.info("[knowledge-graph] graph data loaded", {
                    nodeCount: response.nodes.length,
                    edgeCount: linksArray.length / 2,
                });
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                console.error("[knowledge-graph] failed to load graph data", { message });
                if (canceled) {
                    return;
                }
                labelItemsRef.current = [];
                labelRendererRef.current?.setTotalLabelCount(0);
                labelRendererRef.current?.reset();
                setState((previous) => ({
                    ...previous,
                    loading: false,
                    error: message,
                }));
                console.warn("[knowledge-graph] state updated after graph load failure", {
                    loading: false,
                    hasError: true,
                });
            }
        };

        void loadGraph();

        return () => {
            canceled = true;
        };
    }, []);

    return (
        <div className="knowledge-graph-tab">
            {/* 样式映射：stats 作为浮动摘要展示节点与边数量，不再占据独立工具栏高度。 */}
            {(state.nodeCount > 0 || state.edgeCount > 0) && (
                <span className="knowledge-graph-tab__stats">
                    nodes: {state.nodeCount} | edges: {state.edgeCount}
                </span>
            )}

            {/* 样式映射：canvas-wrap/canvas-host/empty 用于图画布区域和空态提示。 */}
            <div className="knowledge-graph-tab__canvas-wrap">
                <div ref={hostRef} className="knowledge-graph-tab__canvas-host" />
                <div ref={labelLayerRef} className="knowledge-graph-tab__labels-layer" />
                {state.loading && (
                    <div className="knowledge-graph-tab__empty knowledge-graph-tab__empty--status">
                        {t("graph.loadingGraph")}
                    </div>
                )}
                {state.error && (
                    <div className="knowledge-graph-tab__empty knowledge-graph-tab__empty--status">
                        {t("graph.loadFailed", { message: state.error })}
                    </div>
                )}
                {!state.loading && !state.error && state.nodeCount === 0 && (
                    <div className="knowledge-graph-tab__empty">{t("graph.noMarkdownNodes")}</div>
                )}
            </div>
        </div>
    );
}
