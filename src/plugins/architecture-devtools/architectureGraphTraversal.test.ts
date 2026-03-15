/**
 * @module plugins/architecture-devtools/architectureGraphTraversal.test
 * @description 架构图遍历单元测试：验证依赖树、被依赖树与双向关系模式的传递展开行为。
 * @dependencies
 *   - bun:test
 *   - ./architectureGraphTraversal
 */

import { describe, expect, it } from "bun:test";
import { buildTransitiveVisibleNodeIds } from "./architectureGraphTraversal";
import type { ArchitectureEdge } from "./architectureRegistry";

const SAMPLE_NODE_IDS = ["plugin:A", "module:B", "api:C", "plugin:D", "event:E"];

const SAMPLE_EDGES: ArchitectureEdge[] = [
    { from: "plugin:A", to: "module:B", kind: "registers-ui" },
    { from: "module:B", to: "api:C", kind: "calls-api" },
    { from: "plugin:D", to: "module:B", kind: "registers-ui" },
    { from: "event:E", to: "plugin:A", kind: "bridges-event" },
];

describe("architectureGraphTraversal", () => {
    it("应按下游依赖模式展开间接依赖树", () => {
        const visible = buildTransitiveVisibleNodeIds(
            SAMPLE_NODE_IDS,
            SAMPLE_EDGES,
            ["plugin:A"],
            "dependencies",
        );

        expect(Array.from(visible).sort()).toEqual(["api:C", "module:B", "plugin:A"]);
    });

    it("应按上游被依赖模式展开间接入边", () => {
        const visible = buildTransitiveVisibleNodeIds(
            SAMPLE_NODE_IDS,
            SAMPLE_EDGES,
            ["api:C"],
            "dependents",
        );

        expect(Array.from(visible).sort()).toEqual(["api:C", "event:E", "module:B", "plugin:A", "plugin:D"]);
    });

    it("应按双向模式合并上下游节点", () => {
        const visible = buildTransitiveVisibleNodeIds(
            SAMPLE_NODE_IDS,
            SAMPLE_EDGES,
            ["module:B"],
            "neighbors",
        );

        expect(Array.from(visible).sort()).toEqual(["api:C", "event:E", "module:B", "plugin:A", "plugin:D"]);
    });

    it("命中为空时应返回空集合", () => {
        const visible = buildTransitiveVisibleNodeIds(
            SAMPLE_NODE_IDS,
            SAMPLE_EDGES,
            [],
            "dependencies",
        );

        expect(visible.size).toBe(0);
    });
});