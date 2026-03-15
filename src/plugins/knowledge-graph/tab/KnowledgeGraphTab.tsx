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
import type { IDockviewPanelProps } from "dockview";
import { getCurrentVaultMarkdownGraph } from "../../../api/vaultApi";
import { createKnowledgeGraphInteractionCallbacksFor } from "./knowledgeGraphInteractions";
import { buildKnowledgeGraphConfig, DEFAULT_KNOWLEDGE_GRAPH_SETTINGS } from "./knowledgeGraphSettings";
import {
    useGraphSettingsState,
    useGraphSettingsSync,
} from "../store/graphSettingsStore";
import { useThemeState } from "../../../host/store/themeStore";
import { useVaultState } from "../../../host/store/vaultStore";
import { openFileInDockview } from "../../../host/layout/openFileService";
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
 * @interface GraphLabelItem
 * @description 图谱节点标签数据。
 */
interface GraphLabelItem {
    /** 节点索引 */
    index: number;
    /** 节点标签文本 */
    text: string;
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
 * @constant LEGACY_THEME_BACKGROUND_COLORS
 * @description 识别历史默认背景值，用于在主题切换时自动跟随新主题色。
 */
const LEGACY_THEME_BACKGROUND_COLORS = new Set<string>([
    DEFAULT_KNOWLEDGE_GRAPH_SETTINGS.backgroundColor.toLowerCase(),
    "#f8fafc",
]);

/**
 * @function readThemeGraphBackgroundColor
 * @description 读取当前主题下的图谱背景色 token。
 * @returns 背景色字符串；读取失败时返回 null。
 */
function readThemeGraphBackgroundColor(): string | null {
    if (typeof window === "undefined") {
        return null;
    }

    const rootStyle = window.getComputedStyle(document.documentElement);
    const value = rootStyle.getPropertyValue("--graph-bg-primary").trim();
    return value.length > 0 ? value : null;
}

/**
 * @function resolveGraphBackgroundColor
 * @description 解析最终图谱背景色：用户未自定义时跟随主题变量。
 * @param configuredColor 当前图谱设置中的背景色。
 * @returns 最终用于 GraphConfig 的背景色。
 */
function resolveGraphBackgroundColor(configuredColor: string): string {
    const normalizedConfigured = configuredColor.trim().toLowerCase();
    const themeColor = readThemeGraphBackgroundColor();
    if (!themeColor) {
        return configuredColor;
    }

    if (normalizedConfigured.length === 0 || LEGACY_THEME_BACKGROUND_COLORS.has(normalizedConfigured)) {
        return themeColor;
    }

    return configuredColor;
}

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
 * @function KnowledgeGraphTab
 * @description 渲染知识图谱并与后端图数据接口同步。
 *   支持缩放级别驱动的标签渐显、单击节点跳转笔记、Cmd+单击在新 Tab 打开笔记。
 * @param props Dockview 面板属性，通过 containerApi 操控 Tab。
 * @returns Dockview Tab 组件。
 */
export function KnowledgeGraphTab(
    props: IDockviewPanelProps<Record<string, unknown>>,
): ReactElement {
    const { t } = useTranslation();
    const { currentVaultPath } = useVaultState();
    useGraphSettingsSync(currentVaultPath, true);
    const { themeMode } = useThemeState();
    const { settings: graphSettings } = useGraphSettingsState();
    const hostRef = useRef<HTMLDivElement | null>(null);
    const graphRef = useRef<Graph | null>(null);
    const labelLayerRef = useRef<HTMLDivElement | null>(null);
    const labelElementMapRef = useRef<Map<number, HTMLDivElement>>(new Map());
    const dragTailTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const labelRafRef = useRef<number | null>(null);
    const lastDragReheatTimeRef = useRef<number>(0);
    /** 节点索引到相对路径的映射表，用于点击节点时打开对应笔记 */
    const nodePathsByIndexRef = useRef<Map<number, string>>(new Map());
    /** 标签显示缩放阈值引用，供交互回调闭包读取最新值 */
    const labelVisibleZoomLevelRef = useRef<number>(graphSettings.labelVisibleZoomLevel);
    const [labels, setLabels] = useState<GraphLabelItem[]>([]);
    const [state, setState] = useState<GraphTabState>({
        loading: true,
        error: null,
        nodeCount: 0,
        edgeCount: 0,
    });

    const graphConfig: GraphConfigInterface = useMemo(
        () => buildKnowledgeGraphConfig({
            ...graphSettings,
            backgroundColor: resolveGraphBackgroundColor(graphSettings.backgroundColor) as never,
        }),
        [graphSettings, themeMode],
    );

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

            /* ── 缩放驱动标签透明度 ── */
            const currentZoom = graph.getZoomLevel();
            const threshold = labelVisibleZoomLevelRef.current;
            const opacity = computeLabelOpacity(currentZoom, threshold);
            labelLayerElement.style.opacity = String(opacity);
            labelLayerElement.style.pointerEvents = opacity <= 0 ? "none" : "none";

            /* 当标签完全不可见时跳过位置计算以节省性能 */
            if (opacity <= 0) {
                return;
            }

            const trackedPositions = graph.getTrackedPointPositionsMap();
            const viewWidth = hostElement.clientWidth;
            const viewHeight = hostElement.clientHeight;

            const applyLabelLayout = (index: number, spacePosition: [number, number]): void => {
                const labelElement = labelElementMapRef.current.get(index);
                if (!labelElement) {
                    return;
                }

                const [screenX, screenY] = graph.spaceToScreenPosition(spacePosition);
                const isInsideView =
                    Number.isFinite(screenX) &&
                    Number.isFinite(screenY) &&
                    screenX >= -24 &&
                    screenX <= viewWidth + 24 &&
                    screenY >= -24 &&
                    screenY <= viewHeight + 24;

                if (!isInsideView) {
                    labelElement.style.display = "none";
                    return;
                }

                labelElement.style.display = "block";
                labelElement.style.transform = `translate(${screenX}px, ${screenY - LABEL_Y_OFFSET_PX}px) translate(-50%, -100%)`;
            };

            if (trackedPositions.size === 0) {
                const pointPositions = graph.getPointPositions();
                labelElementMapRef.current.forEach((_element, index) => {
                    const x = pointPositions[index * 2];
                    const y = pointPositions[index * 2 + 1];
                    if (x === undefined || y === undefined) {
                        return;
                    }
                    applyLabelLayout(index, [x, y]);
                });
                return;
            }

            trackedPositions.forEach((position, index) => {
                applyLabelLayout(index, position);
            });
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
            await openFileInDockview({
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
        console.info("[knowledge-graph] graph instance initialized");

        return () => {
            if (dragTailTimerRef.current !== null) {
                window.clearTimeout(dragTailTimerRef.current);
            }
            if (labelRafRef.current !== null) {
                window.cancelAnimationFrame(labelRafRef.current);
                labelRafRef.current = null;
            }
            graph.destroy();
            graphRef.current = null;
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

    useEffect(() => {
        const graph = graphRef.current;
        if (!graph || labels.length === 0) {
            return;
        }

        scheduleLabelLayoutUpdate(graph);
    }, [labels]);

    /* ── 标签阈值变化时同步 ref 并触发重绘 ── */
    useEffect(() => {
        labelVisibleZoomLevelRef.current = graphSettings.labelVisibleZoomLevel;
        const graph = graphRef.current;
        if (graph) {
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

                graph.stop();
                graph.setPointPositions(positions);
                graph.setLinks(new Float32Array(linksArray));
                graph.trackPointPositionsByIndices(nextLabels.map((item) => item.index));
                graph.render(0.12);
                graph.start(0.12);
                if (response.nodes.length > 0) {
                    graph.fitView(0, 0.08);
                    const zoomLevelAfterFit = graph.getZoomLevel();
                    graph.setZoomLevel(zoomLevelAfterFit * ZOOM_IN_SCALE_AFTER_FIT, 0);
                }

                setLabels(nextLabels);
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

    const statusText = state.loading
        ? t("graph.loadingGraph")
        : state.error
            ? t("graph.loadFailed", { message: state.error })
            : t("graph.graphReady");

    return (
        <div className="knowledge-graph-tab">
            {/* 样式映射：toolbar/status/stats 用于顶部状态和统计信息展示。 */}
            <header className="knowledge-graph-tab__toolbar">
                <span className="knowledge-graph-tab__status">{statusText}</span>
                <span className="knowledge-graph-tab__stats">
                    nodes: {state.nodeCount} | edges: {state.edgeCount}
                </span>
            </header>

            {/* 样式映射：canvas-wrap/canvas-host/empty 用于图画布区域和空态提示。 */}
            <div className="knowledge-graph-tab__canvas-wrap">
                <div ref={hostRef} className="knowledge-graph-tab__canvas-host" />
                <div ref={labelLayerRef} className="knowledge-graph-tab__labels-layer">
                    {labels.map((item) => (
                        <div
                            key={item.index}
                            ref={(element) => {
                                if (element) {
                                    labelElementMapRef.current.set(item.index, element);
                                } else {
                                    labelElementMapRef.current.delete(item.index);
                                }
                            }}
                            className="knowledge-graph-tab__label"
                        >
                            {item.text}
                        </div>
                    ))}
                </div>
                {!state.loading && !state.error && state.nodeCount === 0 && (
                    <div className="knowledge-graph-tab__empty">{t("graph.noMarkdownNodes")}</div>
                )}
            </div>
        </div>
    );
}
