/**
 * @module plugins/knowledge-graph/tab/knowledgeGraphNodeColoring.test
 * @description 知识图谱节点染色规则测试。
 *
 * @example
 *   bun test src/plugins/knowledge-graph/tab/knowledgeGraphNodeColoring.test.ts
 */

import { describe, expect, it } from "bun:test";
import { buildKnowledgeGraphPointColors } from "./knowledgeGraphNodeColoring";

function colorAt(colors: Float32Array, index: number): number[] {
    return Array.from(colors.slice(index * 4, index * 4 + 4))
        .map((value) => Number.isNaN(value) ? value : Math.round(value * 1000) / 1000);
}

describe("knowledgeGraphNodeColoring", () => {
    it("无颜色组时应交由主题色处理", () => {
        expect(buildKnowledgeGraphPointColors([{ path: "A.md" }], []).length).toBe(0);
    });

    it("应按 tag 查询使用用户选择的颜色", () => {
        const colors = buildKnowledgeGraphPointColors([
            { path: "projects/A.md", tags: ["project"] },
            { path: "areas/B.md", tags: ["project"] },
            { path: "areas/C.md", tags: ["area"] },
        ], [
            { id: "project", query: "tag:#project", color: "#ff0000" },
            { id: "area", query: "tag:#area", color: "#00ff00" },
        ]);

        expect(colorAt(colors, 0)).toEqual(colorAt(colors, 1));
        expect(colorAt(colors, 0)).toEqual([1, 0, 0, 1]);
        expect(colorAt(colors, 2)).toEqual([0, 1, 0, 1]);
    });

    it("应支持 path、dir 和 file 查询", () => {
        const colors = buildKnowledgeGraphPointColors([
            { path: "projects/A.md", tags: ["alpha"] },
            { path: "projects/B.md", tags: ["beta"] },
            { path: "areas/C.md", tags: ["alpha"] },
            { path: "archive/areas/D.md", tags: ["delta"] },
        ], [
            { id: "projects", query: "path:projects", color: "#111111" },
            { id: "areas", query: "dir:areas", color: "#333333" },
            { id: "file-c", query: "file:C.md", color: "#222222" },
        ]);

        expect(colorAt(colors, 0)).toEqual(colorAt(colors, 1));
        expect(colorAt(colors, 0)).toEqual([0.067, 0.067, 0.067, 1]);
        expect(colorAt(colors, 2)).toEqual([0.2, 0.2, 0.2, 1]);
        expect(colorAt(colors, 3)).toEqual([0.2, 0.2, 0.2, 1]);
    });

    it("未命中颜色组的节点应回退到主题默认色", () => {
        const colors = buildKnowledgeGraphPointColors([
            { path: "projects/A.md", tags: ["project"] },
            { path: "areas/B.md", tags: ["area"] },
        ], [
            { id: "project", query: "tag:#project", color: "#ff0000" },
        ]);

        expect(colorAt(colors, 0)).toEqual([1, 0, 0, 1]);
        expect(colorAt(colors, 1).every((value) => Number.isNaN(value))).toBe(true);
    });
});
