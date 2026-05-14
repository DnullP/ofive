/**
 * @module plugins/knowledge-graph/tab/knowledgeGraphColorQuerySuggestions.test
 * @description 知识图谱颜色组查询补全测试。
 *
 * @example
 *   bun test src/plugins/knowledge-graph/tab/knowledgeGraphColorQuerySuggestions.test.ts
 */

import { describe, expect, it } from "bun:test";
import { buildKnowledgeGraphColorQuerySuggestions } from "./knowledgeGraphColorQuerySuggestions";
import type { VaultMarkdownGraphNode } from "../../../api/vaultApi";

const nodes: VaultMarkdownGraphNode[] = [
    { path: "projects/math/algebra.md", title: "Algebra", tags: ["project", "math"] },
    { path: "areas/math/history.md", title: "History", tags: ["area", "math"] },
    { path: "archive/literature/novel.md", title: "Novel", tags: ["book"] },
];

describe("knowledgeGraphColorQuerySuggestions", () => {
    it("空输入时应建议 tag 分组和目录分组", () => {
        const suggestions = buildKnowledgeGraphColorQuerySuggestions(nodes, "");

        expect(suggestions.map((suggestion) => suggestion.value)).toEqual(["tag:", "path:"]);
    });

    it("输入 tag 前缀时应按当前图谱标签补全", () => {
        const suggestions = buildKnowledgeGraphColorQuerySuggestions(nodes, "tag:#ma");

        expect(suggestions.map((suggestion) => suggestion.value)).toEqual(["tag:#math"]);
    });

    it("输入目录前缀时应按当前图谱目录补全", () => {
        const suggestions = buildKnowledgeGraphColorQuerySuggestions(nodes, "path:pro");

        expect(suggestions[0]?.value).toBe("path:projects");
        expect(suggestions.some((suggestion) => suggestion.value === "path:projects/math")).toBe(true);
    });

    it("dir 查询应复用目录建议并保留 dir 前缀", () => {
        const suggestions = buildKnowledgeGraphColorQuerySuggestions(nodes, "dir:mat");

        expect(suggestions[0]?.value).toBe("dir:math");
    });
});
