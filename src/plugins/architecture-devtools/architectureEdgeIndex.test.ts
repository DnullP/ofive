/**
 * @module plugins/architecture-devtools/architectureEdgeIndex.test
 * @description 架构边索引单元测试：验证按节点读取关联边与高亮节点集合的行为。
 * @dependencies
 *   - bun:test
 *   - ./architectureEdgeIndex
 */

import { describe, expect, it } from "bun:test";
import {
    buildArchitectureEdgeAdjacencyIndex,
    collectArchitectureHighlightedNodeIds,
    getArchitectureNodeRelatedEdges,
} from "./architectureEdgeIndex";
import type { ArchitectureEdge } from "./architectureRegistry";

describe("architectureEdgeIndex", () => {
    it("按节点返回关联边，避免 render 期间全量扫描", () => {
        const edges: ArchitectureEdge[] = [
            {
                from: "plugin:fileTree",
                to: "ui-module:fileTreeTab",
                kind: "registers-ui",
            },
            {
                from: "ui-module:fileTreeTab",
                to: "store:fileTree",
                kind: "reads-state",
            },
            {
                from: "ui-module:fileTreeTab",
                to: "event:fileTreeOpened",
                kind: "emits-event",
            },
        ];

        const index = buildArchitectureEdgeAdjacencyIndex(edges);

        expect(getArchitectureNodeRelatedEdges(index, "ui-module:fileTreeTab")).toHaveLength(3);
        expect(getArchitectureNodeRelatedEdges(index, "plugin:fileTree")).toHaveLength(1);
        expect(getArchitectureNodeRelatedEdges(index, null)).toEqual([]);
    });

    it("从关联边提取聚焦高亮节点集合", () => {
        const edges: ArchitectureEdge[] = [
            {
                from: "ui-module:fileTreeTab",
                to: "store:fileTree",
                kind: "reads-state",
            },
            {
                from: "event:fileTreeOpened",
                to: "ui-module:fileTreeTab",
                kind: "subscribes-event",
            },
        ];

        const highlighted = collectArchitectureHighlightedNodeIds(
            "ui-module:fileTreeTab",
            edges,
        );

        expect(Array.from(highlighted).sort()).toEqual([
            "event:fileTreeOpened",
            "store:fileTree",
            "ui-module:fileTreeTab",
        ]);
    });
});