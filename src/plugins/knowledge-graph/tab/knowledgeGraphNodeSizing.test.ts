/**
 * @module plugins/knowledge-graph/tab/knowledgeGraphNodeSizing.test
 * @description 知识图谱节点尺寸计算测试。
 *
 * @example
 *   bun test src/plugins/knowledge-graph/tab/knowledgeGraphNodeSizing.test.ts
 */

import { describe, expect, it } from "bun:test";
import { buildKnowledgeGraphPointSizes } from "./knowledgeGraphNodeSizing";

describe("knowledgeGraphNodeSizing", () => {
    it("应按入边和出边总数放大高连接节点", () => {
        const sizes = buildKnowledgeGraphPointSizes(
            4,
            [
                0, 1,
                0, 2,
                3, 0,
            ],
            2.5,
        );

        expect(sizes[0]).toBeGreaterThan(sizes[1] ?? 0);
        expect(sizes[0]).toBeGreaterThan(sizes[2] ?? 0);
        expect(sizes[0]).toBeGreaterThan(sizes[3] ?? 0);
        expect(sizes[1]).toBeCloseTo(sizes[2] ?? 0, 4);
        expect(sizes[1]).toBeCloseTo(sizes[3] ?? 0, 4);
    });

    it("孤立节点应保持基础尺寸", () => {
        const sizes = buildKnowledgeGraphPointSizes(
            3,
            [
                0, 1,
            ],
            2.5,
        );

        expect(sizes[2]).toBe(2.5);
    });

    it("应使用饱和指数曲线并限制超级 hub 的最大尺寸", () => {
        const links: number[] = [];
        for (let index = 1; index <= 100; index += 1) {
            links.push(0, index);
        }

        const sizes = buildKnowledgeGraphPointSizes(101, links, 2.5);

        expect(sizes[0]).toBeLessThanOrEqual(5.5);
        expect(sizes[0]).toBeGreaterThan(sizes[1] ?? 0);
        expect((sizes[0] ?? 0) / (sizes[1] ?? 1)).toBeLessThan(2.2);
    });

    it("低连接节点增长应比旧 log 曲线更克制", () => {
        const sizes = buildKnowledgeGraphPointSizes(
            6,
            [
                0, 1,
                0, 2,
                0, 3,
                0, 4,
                0, 5,
            ],
            2.5,
        );

        expect(sizes[0]).toBeLessThan(3.1);
    });

    it("应忽略越界边端点", () => {
        const sizes = buildKnowledgeGraphPointSizes(
            2,
            [
                0, 1,
                0, 99,
                -1, 1,
            ],
            2.5,
        );

        expect(sizes[0]).toBeCloseTo(sizes[1] ?? 0, 4);
    });
});
