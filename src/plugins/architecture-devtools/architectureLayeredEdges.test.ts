/**
 * @module plugins/architecture-devtools/architectureLayeredEdges.test
 * @description 架构分层边过滤单元测试：验证模块回头边会被保留，非模块回头边仍会被过滤。
 * @dependencies
 *   - bun:test
 *   - ./architectureLayeredEdges
 *   - ./architectureRegistry
 */

import { describe, expect, it } from "bun:test";
import { buildLayeredEdges } from "./architectureLayeredEdges";
import type { ArchitectureEdge, ArchitectureNode, ArchitectureNodeKind } from "./architectureRegistry";

const SAMPLE_NODES: ArchitectureNode[] = [
    {
        id: "ui-module:left",
        title: "leftModule",
        kind: "ui-module",
        moduleLayer: "plugin-logic",
        summary: "左侧模块",
    },
    {
        id: "ui-module:right",
        title: "rightModule",
        kind: "ui-module",
        moduleLayer: "plugin-logic",
        summary: "右侧模块",
    },
    {
        id: "store:left",
        title: "leftStore",
        kind: "store",
        summary: "左侧状态",
    },
    {
        id: "store:right",
        title: "rightStore",
        kind: "store",
        summary: "右侧状态",
    },
];

function createKindLayerMaps(): Map<ArchitectureNodeKind, Map<string, number>> {
    return new Map<ArchitectureNodeKind, Map<string, number>>([
        [
            "ui-module",
            new Map([
                ["ui-module:left", 0],
                ["ui-module:right", 1],
            ]),
        ],
        [
            "store",
            new Map([
                ["store:left", 0],
                ["store:right", 1],
            ]),
        ],
        ["plugin", new Map()],
        ["event", new Map()],
        ["frontend-api", new Map()],
        ["backend-api", new Map()],
        ["backend-event", new Map()],
        ["backend-module", new Map()],
    ]);
}

describe("architectureLayeredEdges", () => {
    it("保留模块的回头边，供红色反向依赖显示", () => {
        const edges: ArchitectureEdge[] = [
            {
                from: "ui-module:right",
                to: "ui-module:left",
                kind: "registers-ui",
                label: "reverse module edge",
            },
        ];

        const result = buildLayeredEdges(SAMPLE_NODES, edges, createKindLayerMaps());

        expect(result).toHaveLength(1);
        expect(result[0]?.label).toBe("reverse module edge");
    });

    it("继续过滤非模块节点的回头边", () => {
        const edges: ArchitectureEdge[] = [
            {
                from: "store:right",
                to: "store:left",
                kind: "reads-state",
                label: "reverse store edge",
            },
        ];

        const result = buildLayeredEdges(SAMPLE_NODES, edges, createKindLayerMaps());

        expect(result).toHaveLength(0);
    });
});