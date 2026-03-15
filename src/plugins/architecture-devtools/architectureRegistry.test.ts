/**
 * @module plugins/architecture-devtools/architectureRegistry.test
 * @description 架构注册中心单元测试：覆盖注册、覆盖、注销、去重与订阅逻辑。
 * @dependencies
 *   - bun:test
 *   - ./architectureRegistry
 *
 * @example
 *   bun test src/plugins/architecture-devtools/architectureRegistry.test.ts
 */

import { afterEach, describe, expect, it } from "bun:test";
import {
    getArchitectureSnapshot,
    registerArchitectureSlice,
    subscribeArchitecture,
    unregisterArchitectureSlice,
    type ArchitectureSlice,
} from "./architectureRegistry";

/**
 * @function createSlice
 * @description 创建测试用架构切片。
 * @param id 切片 ID。
 * @returns 架构切片。
 */
function createSlice(id: string): ArchitectureSlice {
    return {
        id,
        title: id,
        nodes: [
            {
                id: `node:${id}`,
                title: `Node ${id}`,
                kind: "plugin",
                summary: `Slice ${id}`,
            },
        ],
        edges: [],
    };
}

describe("architectureRegistry", () => {
    const cleanupFns: Array<() => void> = [];

    afterEach(() => {
        cleanupFns.forEach((cleanup) => cleanup());
        cleanupFns.length = 0;

        getArchitectureSnapshot().slices.forEach((slice) => {
            unregisterArchitectureSlice(slice.id);
        });
    });

    it("应注册架构切片", () => {
        cleanupFns.push(registerArchitectureSlice(createSlice("demo")));

        const snapshot = getArchitectureSnapshot();
        expect(snapshot.slices).toHaveLength(1);
        expect(snapshot.nodes).toHaveLength(1);
        expect(snapshot.nodes[0]?.id).toBe("node:demo");
    });

    it("相同 id 注册应覆盖旧切片", () => {
        cleanupFns.push(registerArchitectureSlice(createSlice("demo")));
        cleanupFns.push(registerArchitectureSlice({
            id: "demo",
            title: "demo",
            nodes: [
                {
                    id: "node:demo:new",
                    title: "Node demo new",
                    kind: "store",
                    summary: "override",
                },
            ],
            edges: [],
        }));

        const snapshot = getArchitectureSnapshot();
        expect(snapshot.slices).toHaveLength(1);
        expect(snapshot.nodes).toHaveLength(1);
        expect(snapshot.nodes[0]?.id).toBe("node:demo:new");
    });

    it("应对重复边去重", () => {
        cleanupFns.push(registerArchitectureSlice({
            id: "a",
            title: "A",
            nodes: [
                {
                    id: "node:a",
                    title: "A",
                    kind: "plugin",
                    summary: "A",
                },
                {
                    id: "node:b",
                    title: "B",
                    kind: "store",
                    summary: "B",
                },
            ],
            edges: [
                {
                    from: "node:a",
                    to: "node:b",
                    kind: "reads-state",
                    label: "same",
                },
            ],
        }));
        cleanupFns.push(registerArchitectureSlice({
            id: "b",
            title: "B",
            nodes: [],
            edges: [
                {
                    from: "node:a",
                    to: "node:b",
                    kind: "reads-state",
                    label: "same",
                },
            ],
        }));

        expect(getArchitectureSnapshot().edges).toHaveLength(1);
    });

    it("取消注册后应移除切片", () => {
        const unregister = registerArchitectureSlice(createSlice("demo"));
        expect(getArchitectureSnapshot().slices).toHaveLength(1);

        unregister();
        expect(getArchitectureSnapshot().slices).toHaveLength(0);
    });

    it("应在变化时通知监听器", () => {
        let notifyCount = 0;
        const unsubscribe = subscribeArchitecture(() => {
            notifyCount += 1;
        });

        cleanupFns.push(unsubscribe);
        cleanupFns.push(registerArchitectureSlice(createSlice("demo")));

        expect(notifyCount).toBe(1);
    });
});