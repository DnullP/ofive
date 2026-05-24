/**
 * @module tests/knowledgeGraphInteractions.test
 * @description 验证知识图谱交互回调的时序安全性与拖拽补能行为。
 */

import { describe, expect, test } from "bun:test";
import {
    createKnowledgeGraphInteractionCallbacksFor,
    type GraphRuntimeLike,
} from "../src/plugins/knowledge-graph/tab/knowledgeGraphInteractions";

/**
 * @function createMockGraph
 * @description 创建 Graph 运行时 mock。
 * @returns 含 start 调用记录的 mock 实例。
 */
function createMockGraph(): { graph: GraphRuntimeLike; starts: number[] } {
    const starts: number[] = [];
    return {
        graph: {
            start(alpha?: number) {
                starts.push(alpha ?? 0);
            },
        },
        starts,
    };
}

function createMockRenderableGraph(): {
    graph: GraphRuntimeLike;
    starts: number[];
    renders: number[];
} {
    const starts: number[] = [];
    const renders: number[] = [];
    return {
        graph: {
            start(alpha?: number) {
                starts.push(alpha ?? 0);
            },
            render(alpha?: number) {
                renders.push(alpha ?? 0);
            },
        },
        starts,
        renders,
    };
}

describe("createKnowledgeGraphInteractionCallbacksFor", () => {
    test("graph 未就绪时回调不抛错且不执行补能", () => {
        const graphRef = { current: null as GraphRuntimeLike | null };
        const dragTailTimerRef = { current: null as ReturnType<typeof setTimeout> | null };
        const lastDragReheatTimeRef = { current: 0 };
        const updatedGraphs: GraphRuntimeLike[] = [];

        const callbacks = createKnowledgeGraphInteractionCallbacksFor({
            graphRef,
            dragTailTimerRef,
            lastDragReheatTimeRef,
            scheduleLabelLayoutUpdate: (graph) => {
                updatedGraphs.push(graph);
            },
            dragReheatConfig: {
                startAlpha: 0.24,
                moveAlpha: 0.08,
                endAlpha: 0.12,
                moveIntervalMs: 120,
                endDelayMs: 80,
            },
            now: () => 1000,
            setTimeoutImpl: (() => 1) as unknown as typeof setTimeout,
            clearTimeoutImpl: (() => { }) as typeof clearTimeout,
        });

        expect(() => callbacks.onSimulationTick()).not.toThrow();
        expect(() => callbacks.onZoom()).not.toThrow();
        expect(() => callbacks.onDragStart()).not.toThrow();
        expect(() => callbacks.onDrag()).not.toThrow();
        expect(() => callbacks.onDragEnd()).not.toThrow();

        expect(updatedGraphs.length).toBe(0);
        expect(dragTailTimerRef.current).toBeNull();
        expect(lastDragReheatTimeRef.current).toBe(0);
    });

    test("graph 就绪时按配置执行拖拽补能与标签更新", () => {
        const { graph, starts } = createMockGraph();
        const graphRef = { current: graph as GraphRuntimeLike | null };
        const dragTailTimerRef = { current: null as ReturnType<typeof setTimeout> | null };
        const lastDragReheatTimeRef = { current: 0 };
        const updatedGraphs: GraphRuntimeLike[] = [];
        const clearedTimers: Array<ReturnType<typeof setTimeout>> = [];
        const scheduled: Array<{ id: ReturnType<typeof setTimeout>; task: () => void }> = [];
        let nowValue = 1000;

        const callbacks = createKnowledgeGraphInteractionCallbacksFor({
            graphRef,
            dragTailTimerRef,
            lastDragReheatTimeRef,
            scheduleLabelLayoutUpdate: (instance) => {
                updatedGraphs.push(instance);
            },
            dragReheatConfig: {
                startAlpha: 0.24,
                moveAlpha: 0.08,
                endAlpha: 0.12,
                moveIntervalMs: 120,
                endDelayMs: 80,
            },
            now: () => nowValue,
            setTimeoutImpl: ((task: () => void) => {
                const id = (scheduled.length + 1) as unknown as ReturnType<typeof setTimeout>;
                scheduled.push({ id, task });
                return id;
            }) as unknown as typeof setTimeout,
            clearTimeoutImpl: ((id: ReturnType<typeof setTimeout>) => {
                clearedTimers.push(id);
            }) as typeof clearTimeout,
        });

        callbacks.onDragStart();
        expect(starts).toEqual([0.24]);
        expect(updatedGraphs.length).toBe(1);

        callbacks.onDrag();
        expect(starts).toEqual([0.24, 0.08]);
        expect(lastDragReheatTimeRef.current).toBe(1000);
        expect(updatedGraphs.length).toBe(2);

        nowValue = 1050;
        callbacks.onDrag();
        expect(starts).toEqual([0.24, 0.08]);
        expect(updatedGraphs.length).toBe(3);

        callbacks.onDragEnd();
        expect(scheduled.length).toBe(1);
        expect(dragTailTimerRef.current).toBe(scheduled[0]?.id);

        callbacks.onDragStart();
        expect(clearedTimers.length).toBe(1);
        expect(clearedTimers[0]).toBe(scheduled[0]?.id);

        scheduled[0]?.task();
        expect(starts.includes(0.12)).toBeTrue();
        expect(dragTailTimerRef.current).toBeNull();
    });

    test("hover 静态模式下拖拽只同步标签不补能且不重绘", () => {
        const { graph, starts, renders } = createMockRenderableGraph();
        const graphRef = { current: graph as GraphRuntimeLike | null };
        const dragTailTimerRef = { current: null as ReturnType<typeof setTimeout> | null };
        const lastDragReheatTimeRef = { current: 0 };
        const updatedGraphs: GraphRuntimeLike[] = [];

        const callbacks = createKnowledgeGraphInteractionCallbacksFor({
            graphRef,
            dragTailTimerRef,
            lastDragReheatTimeRef,
            scheduleLabelLayoutUpdate: (instance) => {
                updatedGraphs.push(instance);
            },
            shouldKeepDragStatic: () => true,
            dragReheatConfig: {
                startAlpha: 0.24,
                moveAlpha: 0.08,
                endAlpha: 0.12,
                moveIntervalMs: 120,
                endDelayMs: 80,
            },
            now: () => 1000,
            setTimeoutImpl: (() => 1) as unknown as typeof setTimeout,
            clearTimeoutImpl: (() => { }) as typeof clearTimeout,
        });

        callbacks.onDragStart();
        callbacks.onDrag();
        callbacks.onDragEnd();

        expect(starts).toEqual([]);
        expect(renders).toEqual([]);
        expect(updatedGraphs.length).toBe(3);
        expect(dragTailTimerRef.current).toBeNull();
        expect(lastDragReheatTimeRef.current).toBe(0);
    });
});
