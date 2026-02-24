/**
 * @module layout/knowledgeGraphInteractions
 * @description 知识图谱交互回调工厂：统一封装拖拽补能与标签同步回调，避免构造期时序错误。
 * @dependencies
 *  - 无外部运行时依赖（纯函数）
 *
 * @example
 *   const callbacks = createKnowledgeGraphInteractionCallbacks({ ...deps });
 *   const graph = new Graph(host, { ...config, ...callbacks });
 *
 * @exports
 *  - createKnowledgeGraphInteractionCallbacks: 生成 Graph 交互回调
 */

/**
 * @interface GraphRuntimeLike
 * @description 交互回调所需的最小 Graph 运行时能力。
 */
export interface GraphRuntimeLike {
    /**
     * @function start
     * @description 启动或补能仿真。
     * @param alpha 补能强度。
     */
    start(alpha?: number): void;
}

/**
 * @interface GraphRuntimeRef
 * @description Graph 运行时引用。
 */
export interface GraphRuntimeRef {
    /** 当前 Graph 实例，未初始化时为 null。 */
    current: GraphRuntimeLike | null;
}

/**
 * @interface NumberRef
 * @description 数值引用容器。
 */
export interface NumberRef {
    /** 当前数值 */
    current: number;
}

/**
 * @interface TimeoutRef
 * @description 定时器句柄引用容器。
 */
export interface TimeoutRef {
    /** 当前定时器句柄 */
    current: ReturnType<typeof setTimeout> | null;
}

/**
 * @interface DragReheatConfig
 * @description 拖拽补能参数配置。
 */
export interface DragReheatConfig {
    /** 拖拽开始补能 */
    startAlpha: number;
    /** 拖拽移动补能 */
    moveAlpha: number;
    /** 拖拽结束补能 */
    endAlpha: number;
    /** 拖拽移动补能节流间隔 */
    moveIntervalMs: number;
    /** 拖拽结束补能延迟 */
    endDelayMs: number;
}

/**
 * @interface InteractionCallbackDeps
 * @description 回调工厂依赖项。
 */
export interface InteractionCallbackDeps {
    /** Graph 实例引用 */
    graphRef: GraphRuntimeRef;
    /** 拖拽尾波补能定时器引用 */
    dragTailTimerRef: TimeoutRef;
    /** 上次移动补能时间戳引用 */
    lastDragReheatTimeRef: NumberRef;
    /** 标签布局更新调度器 */
    scheduleLabelLayoutUpdate: (graph: GraphRuntimeLike) => void;
    /** 拖拽补能配置 */
    dragReheatConfig: DragReheatConfig;
    /** 获取当前时间（可注入以便测试） */
    now?: () => number;
    /** setTimeout 实现（可注入以便测试） */
    setTimeoutImpl?: typeof setTimeout;
    /** clearTimeout 实现（可注入以便测试） */
    clearTimeoutImpl?: typeof clearTimeout;
}

/**
 * @interface GraphInteractionCallbacks
 * @description 供 GraphConfig 使用的交互回调集合。
 */
export interface GraphInteractionCallbacks {
    /** 仿真 tick 回调 */
    onSimulationTick: () => void;
    /** 缩放回调 */
    onZoom: () => void;
    /** 拖拽开始回调 */
    onDragStart: () => void;
    /** 拖拽中回调 */
    onDrag: () => void;
    /** 拖拽结束回调 */
    onDragEnd: () => void;
}

/**
 * @function createKnowledgeGraphInteractionCallbacks
 * @description 创建知识图谱交互回调，确保所有回调都通过 graphRef 懒获取实例。
 * @param deps 回调工厂依赖。
 * @returns 可直接挂载到 GraphConfig 的回调对象。
 */
export function createKnowledgeGraphInteractionCallbacks(
    deps: InteractionCallbackDeps,
): GraphInteractionCallbacks {
    const now = deps.now ?? Date.now;
    const setTimeoutImpl = deps.setTimeoutImpl ?? setTimeout;
    const clearTimeoutImpl = deps.clearTimeoutImpl ?? clearTimeout;
    const {
        graphRef,
        dragTailTimerRef,
        lastDragReheatTimeRef,
        scheduleLabelLayoutUpdate,
        dragReheatConfig,
    } = deps;

    /**
     * @function withGraphInstance
     * @description 在 Graph 实例可用时执行逻辑。
     * @param task 需要执行的任务。
     */
    const withGraphInstance = (task: (graph: GraphRuntimeLike) => void): void => {
        const graph = graphRef.current;
        if (!graph) {
            return;
        }
        task(graph);
    };

    return {
        onSimulationTick: () => {
            withGraphInstance((graph) => {
                scheduleLabelLayoutUpdate(graph);
            });
        },
        onZoom: () => {
            withGraphInstance((graph) => {
                scheduleLabelLayoutUpdate(graph);
            });
        },
        onDragStart: () => {
            withGraphInstance((graph) => {
                if (dragTailTimerRef.current !== null) {
                    clearTimeoutImpl(dragTailTimerRef.current);
                    dragTailTimerRef.current = null;
                }

                graph.start(dragReheatConfig.startAlpha);
                scheduleLabelLayoutUpdate(graph);
            });
        },
        onDrag: () => {
            withGraphInstance((graph) => {
                const currentTime = now();
                if (currentTime - lastDragReheatTimeRef.current < dragReheatConfig.moveIntervalMs) {
                    scheduleLabelLayoutUpdate(graph);
                    return;
                }

                lastDragReheatTimeRef.current = currentTime;
                graph.start(dragReheatConfig.moveAlpha);
                scheduleLabelLayoutUpdate(graph);
            });
        },
        onDragEnd: () => {
            withGraphInstance((graph) => {
                if (dragTailTimerRef.current !== null) {
                    clearTimeoutImpl(dragTailTimerRef.current);
                }

                dragTailTimerRef.current = setTimeoutImpl(() => {
                    const currentGraph = graphRef.current;
                    if (currentGraph) {
                        currentGraph.start(dragReheatConfig.endAlpha);
                    }
                    dragTailTimerRef.current = null;
                }, dragReheatConfig.endDelayMs);

                scheduleLabelLayoutUpdate(graph);
            });
        },
    };
}

/**
 * @interface InteractionCallbackDepsFor
 * @description 针对具体 Graph 类型的依赖约束。
 */
export interface InteractionCallbackDepsFor<TGraph extends GraphRuntimeLike>
    extends Omit<InteractionCallbackDeps, "graphRef" | "scheduleLabelLayoutUpdate"> {
    /** Graph 实例引用 */
    graphRef: { current: TGraph | null };
    /** 标签布局更新调度器 */
    scheduleLabelLayoutUpdate: (graph: TGraph) => void;
}

/**
 * @function createKnowledgeGraphInteractionCallbacksFor
 * @description 针对具体 Graph 类型创建交互回调，避免函数参数逆变导致的类型不兼容。
 * @param deps 回调工厂依赖。
 * @returns 可直接挂载到 GraphConfig 的回调对象。
 */
export function createKnowledgeGraphInteractionCallbacksFor<TGraph extends GraphRuntimeLike>(
    deps: InteractionCallbackDepsFor<TGraph>,
): GraphInteractionCallbacks {
    const now = deps.now ?? Date.now;
    const setTimeoutImpl = deps.setTimeoutImpl ?? setTimeout;
    const clearTimeoutImpl = deps.clearTimeoutImpl ?? clearTimeout;
    const {
        graphRef,
        dragTailTimerRef,
        lastDragReheatTimeRef,
        scheduleLabelLayoutUpdate,
        dragReheatConfig,
    } = deps;

    const withGraphInstance = (task: (graph: TGraph) => void): void => {
        const graph = graphRef.current;
        if (!graph) {
            return;
        }
        task(graph);
    };

    return {
        onSimulationTick: () => {
            withGraphInstance((graph) => {
                scheduleLabelLayoutUpdate(graph);
            });
        },
        onZoom: () => {
            withGraphInstance((graph) => {
                scheduleLabelLayoutUpdate(graph);
            });
        },
        onDragStart: () => {
            withGraphInstance((graph) => {
                if (dragTailTimerRef.current !== null) {
                    clearTimeoutImpl(dragTailTimerRef.current);
                    dragTailTimerRef.current = null;
                }

                graph.start(dragReheatConfig.startAlpha);
                scheduleLabelLayoutUpdate(graph);
            });
        },
        onDrag: () => {
            withGraphInstance((graph) => {
                const currentTime = now();
                if (currentTime - lastDragReheatTimeRef.current < dragReheatConfig.moveIntervalMs) {
                    scheduleLabelLayoutUpdate(graph);
                    return;
                }

                lastDragReheatTimeRef.current = currentTime;
                graph.start(dragReheatConfig.moveAlpha);
                scheduleLabelLayoutUpdate(graph);
            });
        },
        onDragEnd: () => {
            withGraphInstance((graph) => {
                if (dragTailTimerRef.current !== null) {
                    clearTimeoutImpl(dragTailTimerRef.current);
                }

                dragTailTimerRef.current = setTimeoutImpl(() => {
                    const currentGraph = graphRef.current;
                    if (currentGraph) {
                        currentGraph.start(dragReheatConfig.endAlpha);
                    }
                    dragTailTimerRef.current = null;
                }, dragReheatConfig.endDelayMs);

                scheduleLabelLayoutUpdate(graph);
            });
        },
    };
}
