/**
 * @module playground/CosmosGraphPlayground
 * @description Cosmos 图组件测试页：用于在 Web 页面中高密度调参与交互验证，便于后续集成前做参数探索。
 * @dependencies
 *  - react
 *  - @cosmos.gl/graph
 *  - ./CosmosGraphPlayground.css
 *
 * @example
 *   <CosmosGraphPlayground />
 *
 * @exports
 *  - CosmosGraphPlayground: Cosmos 图组件调参测试页面
 */

import { Graph, type GraphConfigInterface } from "@cosmos.gl/graph";
import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import "./CosmosGraphPlayground.css";

declare global {
  interface Window {
    __OFIVE_COSMOS_MONITOR__?: {
      sample: () => {
        nodeCount: number;
        zoomLevel: number;
        cameraSpaceCenter: [number, number];
        centroid: [number, number];
        meanRadius: number;
        radiusStdDev: number;
        bbox: {
          minX: number;
          maxX: number;
          minY: number;
          maxY: number;
        };
        sampledPointCount: number;
      };
      getPointPositions: () => number[];
    };
  }
}

/**
 * @interface PlaygroundState
 * @description 页面可调参数状态。
 */
interface PlaygroundState {
  nodeCount: number;
  avgDegree: number;
  backgroundColor: string;
  pointDefaultColor: string;
  pointDefaultSize: number;
  pointSizeScale: number;
  pointOpacity: number;
  linkDefaultColor: string;
  linkDefaultWidth: number;
  linkWidthScale: number;
  linkOpacity: number;
  curvedLinks: boolean;
  curvedLinkSegments: number;
  curvedLinkWeight: number;
  curvedLinkControlPointDistance: number;
  linkDefaultArrows: boolean;
  simulationDecay: number;
  simulationGravity: number;
  simulationCenter: number;
  simulationRepulsion: number;
  simulationRepulsionTheta: number;
  simulationLinkSpring: number;
  simulationLinkDistance: number;
  simulationRepulsionFromMouse: number;
  simulationFriction: number;
  simulationCluster: number;
  enableRightClickRepulsion: boolean;
  enableZoom: boolean;
  enableDrag: boolean;
  enableSimulationDuringZoom: boolean;
  fitViewOnInit: boolean;
  fitViewDelay: number;
  fitViewPadding: number;
  fitViewDuration: number;
  pixelRatio: number;
  scalePointsOnZoom: boolean;
  scaleLinksOnZoom: boolean;
  pointSamplingDistance: number;
  showFPSMonitor: boolean;
  spaceSize: number;
  rescalePositions: boolean;
  autoRefitWhenOutOfView: boolean;
}

/**
 * @constant INITIAL_STATE
 * @description Cosmos playground 初始参数。
 */
const INITIAL_STATE: PlaygroundState = {
  nodeCount: 320,
  avgDegree: 4,
  backgroundColor: "#020617",
  pointDefaultColor: "#60a5fa",
  pointDefaultSize: 3,
  pointSizeScale: 1,
  pointOpacity: 0.95,
  linkDefaultColor: "#64748b",
  linkDefaultWidth: 1,
  linkWidthScale: 1,
  linkOpacity: 0.35,
  curvedLinks: false,
  curvedLinkSegments: 19,
  curvedLinkWeight: 0.8,
  curvedLinkControlPointDistance: 0.5,
  linkDefaultArrows: false,
  simulationDecay: 3200,
  simulationGravity: 0,
  simulationCenter: 0.36,
  simulationRepulsion: 0.3,
  simulationRepulsionTheta: 1.15,
  simulationLinkSpring: 0.52,
  simulationLinkDistance: 22,
  simulationRepulsionFromMouse: 2,
  simulationFriction: 0.978,
  simulationCluster: 0.1,
  enableRightClickRepulsion: false,
  enableZoom: true,
  enableDrag: true,
  enableSimulationDuringZoom: false,
  fitViewOnInit: false,
  fitViewDelay: 0,
  fitViewPadding: 0.2,
  fitViewDuration: 0,
  pixelRatio: 2,
  scalePointsOnZoom: false,
  scaleLinksOnZoom: false,
  pointSamplingDistance: 150,
  showFPSMonitor: false,
  spaceSize: 2048,
  rescalePositions: false,
  autoRefitWhenOutOfView: false,
};

/**
 * @constant DRAG_START_REHEAT_ALPHA
 * @description 拖拽开始时注入的模拟能量，保证邻近节点产生联动。
 */
const DRAG_START_REHEAT_ALPHA = 0.24;

/**
 * @constant DRAG_MOVE_REHEAT_ALPHA
 * @description 连续拖拽过程中的补充能量，防止图在拖拽中“僵住”。
 */
const DRAG_MOVE_REHEAT_ALPHA = 0.08;

/**
 * @constant DRAG_END_REHEAT_ALPHA
 * @description 拖拽释放后的惯性回弹能量，模拟 Obsidian 风格松手后余振。
 */
const DRAG_END_REHEAT_ALPHA = 0.12;

/**
 * @constant DRAG_MOVE_REHEAT_INTERVAL_MS
 * @description 连续拖拽补充能量的最小时间间隔（毫秒）。
 */
const DRAG_MOVE_REHEAT_INTERVAL_MS = 120;

/**
 * @function createMonitorSnapshot
 * @description 生成当前图状态采样，包含节点几何分布与相机中心空间坐标。
 * @param graph Cosmos 图实例。
 * @param hostElement 图容器元素。
 * @returns 采样结果。
 */
function createMonitorSnapshot(graph: Graph, hostElement: HTMLDivElement): {
  nodeCount: number;
  zoomLevel: number;
  cameraSpaceCenter: [number, number];
  centroid: [number, number];
  meanRadius: number;
  radiusStdDev: number;
  bbox: {
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
  };
  sampledPointCount: number;
} {
  const positions = graph.getPointPositions();
  const nodeCount = Math.floor(positions.length / 2);

  if (nodeCount <= 0) {
    const center = graph.screenToSpacePosition([
      hostElement.clientWidth / 2,
      hostElement.clientHeight / 2,
    ]);
    return {
      nodeCount: 0,
      zoomLevel: graph.getZoomLevel(),
      cameraSpaceCenter: center,
      centroid: [0, 0],
      meanRadius: 0,
      radiusStdDev: 0,
      bbox: {
        minX: 0,
        maxX: 0,
        minY: 0,
        maxY: 0,
      },
      sampledPointCount: graph.getSampledPoints().indices.length,
    };
  }

  let sumX = 0;
  let sumY = 0;
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (let index = 0; index < nodeCount; index += 1) {
    const x = positions[index * 2] ?? 0;
    const y = positions[index * 2 + 1] ?? 0;
    sumX += x;
    sumY += y;
    if (x < minX) {
      minX = x;
    }
    if (x > maxX) {
      maxX = x;
    }
    if (y < minY) {
      minY = y;
    }
    if (y > maxY) {
      maxY = y;
    }
  }

  const centroidX = sumX / nodeCount;
  const centroidY = sumY / nodeCount;
  let radiusSum = 0;
  let radiusSquaredDiffSum = 0;
  const radii: number[] = [];

  for (let index = 0; index < nodeCount; index += 1) {
    const x = positions[index * 2] ?? 0;
    const y = positions[index * 2 + 1] ?? 0;
    const radius = Math.hypot(x - centroidX, y - centroidY);
    radii.push(radius);
    radiusSum += radius;
  }

  const meanRadius = radiusSum / nodeCount;
  for (const radius of radii) {
    const diff = radius - meanRadius;
    radiusSquaredDiffSum += diff * diff;
  }

  const radiusStdDev = Math.sqrt(radiusSquaredDiffSum / nodeCount);
  const cameraSpaceCenter = graph.screenToSpacePosition([
    hostElement.clientWidth / 2,
    hostElement.clientHeight / 2,
  ]);

  return {
    nodeCount,
    zoomLevel: graph.getZoomLevel(),
    cameraSpaceCenter,
    centroid: [centroidX, centroidY],
    meanRadius,
    radiusStdDev,
    bbox: {
      minX,
      maxX,
      minY,
      maxY,
    },
    sampledPointCount: graph.getSampledPoints().indices.length,
  };
}

/**
 * @function createSeededRandom
 * @description 生成可复现的伪随机函数，用于稳定复现图数据。
 * @param seed 随机种子。
 * @returns 一个返回 [0,1) 浮点值的随机函数。
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
 * @function buildGraphData
 * @description 基于节点数和平均度生成 positions 与 links 数据。
 * @param nodeCount 节点数量。
 * @param avgDegree 平均度（近似）。
 * @param seed 随机种子。
 * @returns positions 与 links 的 TypedArray 结构。
 */
function buildGraphData(
  nodeCount: number,
  avgDegree: number,
  seed: number,
  centerX: number,
  centerY: number,
  baseRadius: number,
): { positions: Float32Array; links: Float32Array } {
  const random = createSeededRandom(seed);
  const positions = new Float32Array(nodeCount * 2);
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));

  for (let index = 0; index < nodeCount; index += 1) {
    const normalized = Math.sqrt((index + 0.5) / nodeCount);
    const jitter = 0.9 + random() * 0.2;
    const radius = baseRadius * normalized * jitter;
    const angle = index * goldenAngle + random() * 0.08;
    positions[index * 2] = centerX + Math.cos(angle) * radius;
    positions[index * 2 + 1] = centerY + Math.sin(angle) * radius;
  }

  const estimatedEdgeCount = Math.max(1, Math.floor((nodeCount * avgDegree) / 2));
  const edges: number[] = [];
  const exists = new Set<string>();

  for (let edgeIndex = 0; edgeIndex < estimatedEdgeCount; edgeIndex += 1) {
    const source = Math.floor(random() * nodeCount);
    const target = Math.floor(random() * nodeCount);
    if (source === target) {
      continue;
    }

    const key = source < target ? `${source}-${target}` : `${target}-${source}`;
    if (exists.has(key)) {
      continue;
    }

    exists.add(key);
    edges.push(source, target);
  }

  return {
    positions,
    links: new Float32Array(edges),
  };
}

/**
 * @function createConfigFromState
 * @description 将页面状态转换为 Cosmos 的配置结构。
 * @param state 页面调参状态。
 * @returns 可用于 graph.setConfig 的配置对象。
 */
function createConfigFromState(state: PlaygroundState): Partial<GraphConfigInterface> {
  return {
    backgroundColor: state.backgroundColor,
    pointDefaultColor: state.pointDefaultColor,
    pointDefaultSize: state.pointDefaultSize,
    pointSizeScale: state.pointSizeScale,
    pointOpacity: state.pointOpacity,
    linkDefaultColor: state.linkDefaultColor,
    linkDefaultWidth: state.linkDefaultWidth,
    linkWidthScale: state.linkWidthScale,
    linkOpacity: state.linkOpacity,
    curvedLinks: state.curvedLinks,
    curvedLinkSegments: state.curvedLinkSegments,
    curvedLinkWeight: state.curvedLinkWeight,
    curvedLinkControlPointDistance: state.curvedLinkControlPointDistance,
    linkDefaultArrows: state.linkDefaultArrows,
    simulationDecay: state.simulationDecay,
    simulationGravity: state.simulationGravity,
    simulationCenter: state.simulationCenter,
    simulationRepulsion: state.simulationRepulsion,
    simulationRepulsionTheta: state.simulationRepulsionTheta,
    simulationLinkSpring: state.simulationLinkSpring,
    simulationLinkDistance: state.simulationLinkDistance,
    simulationRepulsionFromMouse: state.simulationRepulsionFromMouse,
    simulationFriction: state.simulationFriction,
    simulationCluster: state.simulationCluster,
    enableRightClickRepulsion: state.enableRightClickRepulsion,
    enableZoom: state.enableZoom,
    enableDrag: state.enableDrag,
    enableSimulationDuringZoom: state.enableSimulationDuringZoom,
    fitViewOnInit: state.fitViewOnInit,
    fitViewDelay: state.fitViewDelay,
    fitViewPadding: state.fitViewPadding,
    fitViewDuration: state.fitViewDuration,
    pixelRatio: state.pixelRatio,
    scalePointsOnZoom: state.scalePointsOnZoom,
    scaleLinksOnZoom: state.scaleLinksOnZoom,
    pointSamplingDistance: state.pointSamplingDistance,
    showFPSMonitor: state.showFPSMonitor,
    spaceSize: state.spaceSize,
    rescalePositions: state.rescalePositions,
  };
}

/**
 * @function CosmosGraphPlayground
 * @description Cosmos 图谱测试页组件，提供图参数和模拟行为的实时调节。
 * @returns React 组件。
 */
export function CosmosGraphPlayground(): ReactElement {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const graphRef = useRef<Graph | null>(null);
  const stateRef = useRef<PlaygroundState>(INITIAL_STATE);
  const visibilityCheckTickRef = useRef<number>(0);
  const dragTailTimerRef = useRef<number | null>(null);
  const lastDragReheatTimeRef = useRef<number>(0);
  const [state, setState] = useState<PlaygroundState>(INITIAL_STATE);
  const [seed, setSeed] = useState<number>(7);
  const [selectedCount, setSelectedCount] = useState<number>(0);
  const [isRunning, setIsRunning] = useState<boolean>(true);
  const [alphaProgress, setAlphaProgress] = useState<number>(0);

  const config = useMemo(() => createConfigFromState(state), [state]);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  /**
   * @function fitViewSafely
   * @description 统一执行 fitView，并在关键路径输出日志。
   * @param reason 触发 fitView 的原因。
   */
  function fitViewSafely(reason: string): void {
    const graph = graphRef.current;
    if (!graph) {
      console.warn("[cosmos-playground] graph is null while fitting view", { reason });
      return;
    }

    const nextState = stateRef.current;
    graph.fitView(nextState.fitViewDuration, nextState.fitViewPadding);
    console.info("[cosmos-playground] fit view executed", {
      reason,
      fitViewDuration: nextState.fitViewDuration,
      fitViewPadding: nextState.fitViewPadding,
    });
  }

  /**
   * @function reheatSimulation
   * @description 以指定 alpha 重新激活模拟，让拖拽交互始终可驱动全图运动。
   * @param graph Cosmos 图实例。
   * @param alpha 注入能量值。
   * @param reason 触发原因。
   */
  function reheatSimulation(graph: Graph, alpha: number, reason: string): void {
    graph.start(alpha);
    console.debug("[cosmos-playground] simulation reheated", {
      alpha,
      reason,
    });
  }

  /**
   * @function updateState
   * @description 更新单个调参字段，并记录状态变更日志。
   * @param key 字段名。
   * @param value 新值。
   */
  function updateState<Key extends keyof PlaygroundState>(key: Key, value: PlaygroundState[Key]): void {
    setState((previousState) => {
      const nextState = {
        ...previousState,
        [key]: value,
      };
      console.debug("[cosmos-playground] state updated", {
        key,
        previousValue: previousState[key],
        nextValue: value,
      });
      return nextState;
    });
  }

  useEffect(() => {
    const hostElement = hostRef.current;
    if (!hostElement) {
      console.warn("[cosmos-playground] canvas host is null during init");
      return;
    }

    console.info("[cosmos-playground] graph init start", { config });
    const graph = new Graph(hostElement, {
      ...config,
      onSimulationStart: () => {
        console.info("[cosmos-playground] simulation start");
        setIsRunning(true);
      },
      onSimulationPause: () => {
        console.info("[cosmos-playground] simulation pause");
        setIsRunning(false);
      },
      onSimulationUnpause: () => {
        console.info("[cosmos-playground] simulation unpause");
        setIsRunning(true);
      },
      onSimulationEnd: () => {
        console.info("[cosmos-playground] simulation end");
        setIsRunning(false);
      },
      onSimulationTick: (alpha) => {
        setAlphaProgress(alpha);

        visibilityCheckTickRef.current += 1;
        const nextState = stateRef.current;
        if (!nextState.autoRefitWhenOutOfView) {
          return;
        }

        if (visibilityCheckTickRef.current % 30 !== 0) {
          return;
        }

        const sampled = graph.getSampledPoints();
        if (sampled.indices.length > 0) {
          return;
        }

        if (nextState.nodeCount <= 0) {
          console.warn("[cosmos-playground] sampled points empty while nodeCount is zero");
          return;
        }

        console.warn("[cosmos-playground] sampled points are empty, attempting auto refit", {
          nodeCount: nextState.nodeCount,
          alpha,
        });
        fitViewSafely("auto-refit-empty-sampled");
      },
      onClick: (index) => {
        if (index === undefined) {
          console.debug("[cosmos-playground] background clicked");
          return;
        }
        console.info("[cosmos-playground] point clicked", { index });
      },
      onZoomEnd: (_, userDriven) => {
        console.debug("[cosmos-playground] zoom end", { userDriven });
      },
      onDragStart: () => {
        if (dragTailTimerRef.current !== null) {
          window.clearTimeout(dragTailTimerRef.current);
          dragTailTimerRef.current = null;
        }
        reheatSimulation(graph, DRAG_START_REHEAT_ALPHA, "drag-start");
      },
      onDrag: () => {
        const currentTime = Date.now();
        if (currentTime - lastDragReheatTimeRef.current < DRAG_MOVE_REHEAT_INTERVAL_MS) {
          return;
        }
        lastDragReheatTimeRef.current = currentTime;
        reheatSimulation(graph, DRAG_MOVE_REHEAT_ALPHA, "drag-move");
      },
      onDragEnd: () => {
        if (dragTailTimerRef.current !== null) {
          window.clearTimeout(dragTailTimerRef.current);
          dragTailTimerRef.current = null;
        }
        dragTailTimerRef.current = window.setTimeout(() => {
          reheatSimulation(graph, DRAG_END_REHEAT_ALPHA, "drag-end-tail");
          dragTailTimerRef.current = null;
        }, 80);
      },
    });

    graphRef.current = graph;
    window.__OFIVE_COSMOS_MONITOR__ = {
      sample: () => createMonitorSnapshot(graph, hostElement),
      getPointPositions: () => graph.getPointPositions(),
    };
    console.info("[cosmos-playground] graph init success");

    return () => {
      console.info("[cosmos-playground] graph destroy");
      if (dragTailTimerRef.current !== null) {
        window.clearTimeout(dragTailTimerRef.current);
      }
      delete window.__OFIVE_COSMOS_MONITOR__;
      graph.destroy();
      graphRef.current = null;
    };
  }, []);

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) {
      console.warn("[cosmos-playground] graph instance is null while applying config");
      return;
    }

    console.info("[cosmos-playground] applying config", config);
    graph.setConfig(config);
    graph.render();
  }, [config]);

  useEffect(() => {
    const graph = graphRef.current;
    const hostElement = hostRef.current;
    if (!graph) {
      console.warn("[cosmos-playground] graph instance is null while rebuilding graph data");
      return;
    }
    if (!hostElement) {
      console.warn("[cosmos-playground] canvas host is null while rebuilding graph data");
      return;
    }

    const cameraSpaceCenter = graph.screenToSpacePosition([
      hostElement.clientWidth / 2,
      hostElement.clientHeight / 2,
    ]);
    const baseRadius = Math.max(
      24,
      Math.min(state.spaceSize * 0.18, 16 + Math.sqrt(state.nodeCount) * 6),
    );

    const { positions, links } = buildGraphData(
      state.nodeCount,
      state.avgDegree,
      seed,
      cameraSpaceCenter[0],
      cameraSpaceCenter[1],
      baseRadius,
    );
    console.info("[cosmos-playground] rebuilding graph data", {
      nodeCount: state.nodeCount,
      avgDegree: state.avgDegree,
      generatedLinkCount: links.length / 2,
      seed,
      cameraSpaceCenter,
      baseRadius,
    });

    graph.stop();
    graph.setPointPositions(positions);
    graph.setLinks(links);
    graph.render(0.12);
    graph.start(0.12);
  }, [seed, state.nodeCount, state.avgDegree, state.fitViewDuration, state.fitViewPadding]);

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) {
      return;
    }

    const selectedIndices = graph.getSelectedIndices();
    const nextSelectedCount = selectedIndices?.length ?? 0;
    setSelectedCount(nextSelectedCount);
  }, [alphaProgress]);

  return (
    <div className="cosmos-playground">
      {/* 样式映射：cosmos-panel/header/section 系列用于左侧控制面板结构与视觉分组。 */}
      <aside className="cosmos-panel">
        <header className="cosmos-header">
          <h1 className="cosmos-title">Cosmos Graph Playground</h1>
          <p className="cosmos-subtitle">
            通过滑条和开关实时调节渲染/布局参数，先在 Web 上找到合适参数区间。
          </p>
          <div className="cosmos-status">
            simulation: {isRunning ? "running" : "paused"} | alpha: {alphaProgress.toFixed(4)} |
            selected: {selectedCount}
          </div>
        </header>

        <section className="cosmos-section">
          <h2 className="cosmos-section-title">Graph Data</h2>
          <label className="cosmos-control-row">
            <span className="cosmos-label">Node Count</span>
            <span className="cosmos-value">{state.nodeCount}</span>
            <input
              className="cosmos-range"
              type="range"
              min={20}
              max={4000}
              step={10}
              value={state.nodeCount}
              onChange={(event) => updateState("nodeCount", Number(event.target.value))}
            />
          </label>
          <label className="cosmos-control-row">
            <span className="cosmos-label">Avg Degree</span>
            <span className="cosmos-value">{state.avgDegree.toFixed(1)}</span>
            <input
              className="cosmos-range"
              type="range"
              min={1}
              max={20}
              step={0.5}
              value={state.avgDegree}
              onChange={(event) => updateState("avgDegree", Number(event.target.value))}
            />
          </label>
          <label className="cosmos-control-row">
            <span className="cosmos-label">Seed</span>
            <span className="cosmos-value">{seed}</span>
            <input
              className="cosmos-range"
              type="range"
              min={1}
              max={1000}
              step={1}
              value={seed}
              onChange={(event) => setSeed(Number(event.target.value))}
            />
          </label>
        </section>

        <section className="cosmos-section">
          <h2 className="cosmos-section-title">Render</h2>
          <label className="cosmos-control-row">
            <span className="cosmos-label">Background</span>
            <input
              className="cosmos-input"
              type="color"
              value={state.backgroundColor}
              onChange={(event) => updateState("backgroundColor", event.target.value)}
            />
          </label>
          <label className="cosmos-control-row">
            <span className="cosmos-label">Point Color</span>
            <input
              className="cosmos-input"
              type="color"
              value={state.pointDefaultColor}
              onChange={(event) => updateState("pointDefaultColor", event.target.value)}
            />
          </label>
          <label className="cosmos-control-row">
            <span className="cosmos-label">Point Size</span>
            <span className="cosmos-value">{state.pointDefaultSize.toFixed(1)}</span>
            <input
              className="cosmos-range"
              type="range"
              min={1}
              max={20}
              step={0.5}
              value={state.pointDefaultSize}
              onChange={(event) => updateState("pointDefaultSize", Number(event.target.value))}
            />
          </label>
          <label className="cosmos-control-row">
            <span className="cosmos-label">Point Size Scale</span>
            <span className="cosmos-value">{state.pointSizeScale.toFixed(2)}</span>
            <input
              className="cosmos-range"
              type="range"
              min={0.1}
              max={4}
              step={0.05}
              value={state.pointSizeScale}
              onChange={(event) => updateState("pointSizeScale", Number(event.target.value))}
            />
          </label>
          <label className="cosmos-control-row">
            <span className="cosmos-label">Point Opacity</span>
            <span className="cosmos-value">{state.pointOpacity.toFixed(2)}</span>
            <input
              className="cosmos-range"
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={state.pointOpacity}
              onChange={(event) => updateState("pointOpacity", Number(event.target.value))}
            />
          </label>
          <label className="cosmos-control-row">
            <span className="cosmos-label">Link Color</span>
            <input
              className="cosmos-input"
              type="color"
              value={state.linkDefaultColor}
              onChange={(event) => updateState("linkDefaultColor", event.target.value)}
            />
          </label>
          <label className="cosmos-control-row">
            <span className="cosmos-label">Link Width</span>
            <span className="cosmos-value">{state.linkDefaultWidth.toFixed(2)}</span>
            <input
              className="cosmos-range"
              type="range"
              min={0.1}
              max={10}
              step={0.1}
              value={state.linkDefaultWidth}
              onChange={(event) => updateState("linkDefaultWidth", Number(event.target.value))}
            />
          </label>
          <label className="cosmos-control-row">
            <span className="cosmos-label">Link Width Scale</span>
            <span className="cosmos-value">{state.linkWidthScale.toFixed(2)}</span>
            <input
              className="cosmos-range"
              type="range"
              min={0.1}
              max={5}
              step={0.05}
              value={state.linkWidthScale}
              onChange={(event) => updateState("linkWidthScale", Number(event.target.value))}
            />
          </label>
          <label className="cosmos-control-row">
            <span className="cosmos-label">Link Opacity</span>
            <span className="cosmos-value">{state.linkOpacity.toFixed(2)}</span>
            <input
              className="cosmos-range"
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={state.linkOpacity}
              onChange={(event) => updateState("linkOpacity", Number(event.target.value))}
            />
          </label>
          <label className="cosmos-check-row">
            <input
              type="checkbox"
              checked={state.curvedLinks}
              onChange={(event) => updateState("curvedLinks", event.target.checked)}
            />
            Curved Links
          </label>
          <label className="cosmos-control-row">
            <span className="cosmos-label">Curve Segments</span>
            <span className="cosmos-value">{state.curvedLinkSegments}</span>
            <input
              className="cosmos-range"
              type="range"
              min={3}
              max={60}
              step={1}
              value={state.curvedLinkSegments}
              onChange={(event) => updateState("curvedLinkSegments", Number(event.target.value))}
            />
          </label>
          <label className="cosmos-control-row">
            <span className="cosmos-label">Curve Weight</span>
            <span className="cosmos-value">{state.curvedLinkWeight.toFixed(2)}</span>
            <input
              className="cosmos-range"
              type="range"
              min={0}
              max={2}
              step={0.05}
              value={state.curvedLinkWeight}
              onChange={(event) => updateState("curvedLinkWeight", Number(event.target.value))}
            />
          </label>
          <label className="cosmos-control-row">
            <span className="cosmos-label">Curve Distance</span>
            <span className="cosmos-value">{state.curvedLinkControlPointDistance.toFixed(2)}</span>
            <input
              className="cosmos-range"
              type="range"
              min={0}
              max={2}
              step={0.05}
              value={state.curvedLinkControlPointDistance}
              onChange={(event) =>
                updateState("curvedLinkControlPointDistance", Number(event.target.value))
              }
            />
          </label>
          <label className="cosmos-check-row">
            <input
              type="checkbox"
              checked={state.linkDefaultArrows}
              onChange={(event) => updateState("linkDefaultArrows", event.target.checked)}
            />
            Link Arrows
          </label>
          <label className="cosmos-check-row">
            <input
              type="checkbox"
              checked={state.scalePointsOnZoom}
              onChange={(event) => updateState("scalePointsOnZoom", event.target.checked)}
            />
            Scale Points On Zoom
          </label>
          <label className="cosmos-check-row">
            <input
              type="checkbox"
              checked={state.scaleLinksOnZoom}
              onChange={(event) => updateState("scaleLinksOnZoom", event.target.checked)}
            />
            Scale Links On Zoom
          </label>
          <label className="cosmos-check-row">
            <input
              type="checkbox"
              checked={state.showFPSMonitor}
              onChange={(event) => updateState("showFPSMonitor", event.target.checked)}
            />
            Show FPS Monitor
          </label>
        </section>

        <section className="cosmos-section">
          <h2 className="cosmos-section-title">Simulation</h2>
          <label className="cosmos-control-row">
            <span className="cosmos-label">Decay</span>
            <span className="cosmos-value">{state.simulationDecay.toFixed(0)}</span>
            <input
              className="cosmos-range"
              type="range"
              min={200}
              max={10000}
              step={50}
              value={state.simulationDecay}
              onChange={(event) => updateState("simulationDecay", Number(event.target.value))}
            />
          </label>
          <label className="cosmos-control-row">
            <span className="cosmos-label">Gravity</span>
            <span className="cosmos-value">{state.simulationGravity.toFixed(2)}</span>
            <input
              className="cosmos-range"
              type="range"
              min={-2}
              max={2}
              step={0.01}
              value={state.simulationGravity}
              onChange={(event) => updateState("simulationGravity", Number(event.target.value))}
            />
          </label>
          <label className="cosmos-control-row">
            <span className="cosmos-label">Center</span>
            <span className="cosmos-value">{state.simulationCenter.toFixed(2)}</span>
            <input
              className="cosmos-range"
              type="range"
              min={-2}
              max={2}
              step={0.01}
              value={state.simulationCenter}
              onChange={(event) => updateState("simulationCenter", Number(event.target.value))}
            />
          </label>
          <label className="cosmos-control-row">
            <span className="cosmos-label">Repulsion</span>
            <span className="cosmos-value">{state.simulationRepulsion.toFixed(2)}</span>
            <input
              className="cosmos-range"
              type="range"
              min={0}
              max={5}
              step={0.01}
              value={state.simulationRepulsion}
              onChange={(event) => updateState("simulationRepulsion", Number(event.target.value))}
            />
          </label>
          <label className="cosmos-control-row">
            <span className="cosmos-label">Repulsion Theta</span>
            <span className="cosmos-value">{state.simulationRepulsionTheta.toFixed(2)}</span>
            <input
              className="cosmos-range"
              type="range"
              min={0.1}
              max={3}
              step={0.01}
              value={state.simulationRepulsionTheta}
              onChange={(event) => updateState("simulationRepulsionTheta", Number(event.target.value))}
            />
          </label>
          <label className="cosmos-control-row">
            <span className="cosmos-label">Link Spring</span>
            <span className="cosmos-value">{state.simulationLinkSpring.toFixed(2)}</span>
            <input
              className="cosmos-range"
              type="range"
              min={0}
              max={3}
              step={0.01}
              value={state.simulationLinkSpring}
              onChange={(event) => updateState("simulationLinkSpring", Number(event.target.value))}
            />
          </label>
          <label className="cosmos-control-row">
            <span className="cosmos-label">Link Distance</span>
            <span className="cosmos-value">{state.simulationLinkDistance.toFixed(1)}</span>
            <input
              className="cosmos-range"
              type="range"
              min={1}
              max={100}
              step={1}
              value={state.simulationLinkDistance}
              onChange={(event) => updateState("simulationLinkDistance", Number(event.target.value))}
            />
          </label>
          <label className="cosmos-control-row">
            <span className="cosmos-label">Mouse Repulsion</span>
            <span className="cosmos-value">{state.simulationRepulsionFromMouse.toFixed(2)}</span>
            <input
              className="cosmos-range"
              type="range"
              min={0}
              max={10}
              step={0.05}
              value={state.simulationRepulsionFromMouse}
              onChange={(event) =>
                updateState("simulationRepulsionFromMouse", Number(event.target.value))
              }
            />
          </label>
          <label className="cosmos-control-row">
            <span className="cosmos-label">Friction</span>
            <span className="cosmos-value">{state.simulationFriction.toFixed(3)}</span>
            <input
              className="cosmos-range"
              type="range"
              min={0}
              max={1}
              step={0.001}
              value={state.simulationFriction}
              onChange={(event) => updateState("simulationFriction", Number(event.target.value))}
            />
          </label>
          <label className="cosmos-control-row">
            <span className="cosmos-label">Cluster</span>
            <span className="cosmos-value">{state.simulationCluster.toFixed(3)}</span>
            <input
              className="cosmos-range"
              type="range"
              min={0}
              max={1}
              step={0.001}
              value={state.simulationCluster}
              onChange={(event) => updateState("simulationCluster", Number(event.target.value))}
            />
          </label>
          <label className="cosmos-check-row">
            <input
              type="checkbox"
              checked={state.enableRightClickRepulsion}
              onChange={(event) =>
                updateState("enableRightClickRepulsion", event.target.checked)
              }
            />
            Right Click Repulsion
          </label>
        </section>

        <section className="cosmos-section">
          <h2 className="cosmos-section-title">View & Interaction</h2>
          <label className="cosmos-control-row">
            <span className="cosmos-label">Space Size</span>
            <span className="cosmos-value">{state.spaceSize}</span>
            <input
              className="cosmos-range"
              type="range"
              min={256}
              max={8192}
              step={64}
              value={state.spaceSize}
              onChange={(event) => updateState("spaceSize", Number(event.target.value))}
            />
          </label>
          <label className="cosmos-control-row">
            <span className="cosmos-label">Pixel Ratio</span>
            <span className="cosmos-value">{state.pixelRatio.toFixed(2)}</span>
            <input
              className="cosmos-range"
              type="range"
              min={0.5}
              max={3}
              step={0.05}
              value={state.pixelRatio}
              onChange={(event) => updateState("pixelRatio", Number(event.target.value))}
            />
          </label>
          <label className="cosmos-control-row">
            <span className="cosmos-label">Fit Delay</span>
            <span className="cosmos-value">{state.fitViewDelay}</span>
            <input
              className="cosmos-range"
              type="range"
              min={0}
              max={2000}
              step={25}
              value={state.fitViewDelay}
              onChange={(event) => updateState("fitViewDelay", Number(event.target.value))}
            />
          </label>
          <label className="cosmos-control-row">
            <span className="cosmos-label">Fit Padding</span>
            <span className="cosmos-value">{state.fitViewPadding.toFixed(2)}</span>
            <input
              className="cosmos-range"
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={state.fitViewPadding}
              onChange={(event) => updateState("fitViewPadding", Number(event.target.value))}
            />
          </label>
          <label className="cosmos-control-row">
            <span className="cosmos-label">Fit Duration</span>
            <span className="cosmos-value">{state.fitViewDuration}</span>
            <input
              className="cosmos-range"
              type="range"
              min={0}
              max={2000}
              step={25}
              value={state.fitViewDuration}
              onChange={(event) => updateState("fitViewDuration", Number(event.target.value))}
            />
          </label>
          <label className="cosmos-control-row">
            <span className="cosmos-label">Point Sampling Distance</span>
            <span className="cosmos-value">{state.pointSamplingDistance}</span>
            <input
              className="cosmos-range"
              type="range"
              min={20}
              max={500}
              step={5}
              value={state.pointSamplingDistance}
              onChange={(event) =>
                updateState("pointSamplingDistance", Number(event.target.value))
              }
            />
          </label>
          <label className="cosmos-check-row">
            <input
              type="checkbox"
              checked={state.enableZoom}
              onChange={(event) => updateState("enableZoom", event.target.checked)}
            />
            Enable Zoom
          </label>
          <label className="cosmos-check-row">
            <input
              type="checkbox"
              checked={state.enableDrag}
              onChange={(event) => updateState("enableDrag", event.target.checked)}
            />
            Enable Drag
          </label>
          <label className="cosmos-check-row">
            <input
              type="checkbox"
              checked={state.enableSimulationDuringZoom}
              onChange={(event) =>
                updateState("enableSimulationDuringZoom", event.target.checked)
              }
            />
            Simulation During Zoom
          </label>
          <label className="cosmos-check-row">
            <input
              type="checkbox"
              checked={state.fitViewOnInit}
              onChange={(event) => updateState("fitViewOnInit", event.target.checked)}
            />
            Fit View On Init
          </label>
          <label className="cosmos-check-row">
            <input
              type="checkbox"
              checked={state.rescalePositions}
              onChange={(event) => updateState("rescalePositions", event.target.checked)}
            />
            Rescale Positions
          </label>
          <label className="cosmos-check-row">
            <input
              type="checkbox"
              checked={state.autoRefitWhenOutOfView}
              onChange={(event) =>
                updateState("autoRefitWhenOutOfView", event.target.checked)
              }
            />
            Auto Refit When Out Of View
          </label>
        </section>

        {/* 样式映射：cosmos-actions/cosmos-button 用于操作区按钮布局和交互态。 */}
        <section className="cosmos-section">
          <h2 className="cosmos-section-title">Actions</h2>
          <div className="cosmos-actions">
            <button className="cosmos-button" onClick={() => setSeed((prev) => prev + 1)}>
              Regenerate Data
            </button>
            <button
              className="cosmos-button"
              onClick={() => {
                console.info("[cosmos-playground] reset state to initial");
                setState(INITIAL_STATE);
                setSeed(7);
              }}
            >
              Reset Params
            </button>
            <button
              className="cosmos-button"
              onClick={() => {
                const graph = graphRef.current;
                if (!graph) {
                  console.warn("[cosmos-playground] graph is null when fitView requested");
                  return;
                }
                fitViewSafely("manual-fit-view");
              }}
            >
              Fit View
            </button>
            <button
              className="cosmos-button"
              onClick={() => {
                const graph = graphRef.current;
                if (!graph) {
                  console.warn("[cosmos-playground] graph is null when selecting all");
                  return;
                }
                const indices = Array.from({ length: state.nodeCount }, (_, index) => index);
                graph.selectPointsByIndices(indices);
                console.info("[cosmos-playground] selected all points", {
                  count: indices.length,
                });
              }}
            >
              Select All
            </button>
            <button
              className="cosmos-button"
              onClick={() => {
                const graph = graphRef.current;
                if (!graph) {
                  console.warn("[cosmos-playground] graph is null when unselecting");
                  return;
                }
                graph.unselectPoints();
              }}
            >
              Unselect
            </button>
            <button
              className="cosmos-button"
              onClick={() => {
                const graph = graphRef.current;
                if (!graph) {
                  console.warn("[cosmos-playground] graph is null when start requested");
                  return;
                }
                graph.start(0.12);
              }}
            >
              Start
            </button>
            <button
              className="cosmos-button"
              onClick={() => {
                const graph = graphRef.current;
                if (!graph) {
                  console.warn("[cosmos-playground] graph is null when pause requested");
                  return;
                }
                graph.pause();
              }}
            >
              Pause
            </button>
            <button
              className="cosmos-button"
              onClick={() => {
                const graph = graphRef.current;
                if (!graph) {
                  console.warn("[cosmos-playground] graph is null when unpause requested");
                  return;
                }
                graph.unpause();
              }}
            >
              Unpause
            </button>
            <button
              className="cosmos-button"
              onClick={() => {
                const graph = graphRef.current;
                if (!graph) {
                  console.warn("[cosmos-playground] graph is null when stop requested");
                  return;
                }
                graph.stop();
              }}
            >
              Stop
            </button>
          </div>
        </section>
      </aside>

      {/* 样式映射：cosmos-canvas-wrap/host/tip 用于图画布区域和右上角提示。 */}
      <main className="cosmos-canvas-wrap">
        <div ref={hostRef} className="cosmos-canvas-host" />
        <div className="cosmos-tip">
          Left click: select point | Right click hold: mouse repulsion | Wheel: zoom
        </div>
      </main>
    </div>
  );
}
