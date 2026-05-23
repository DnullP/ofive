/**
 * @module plugins/knowledge-graph/tab/knowledgeGraphHoverHighlight.test
 * @description 验证知识图谱 hover 高亮的一跳邻居与边样式计算。
 */

import { describe, expect, test } from "bun:test";
import {
    buildKnowledgeGraphHoverLinkStyle,
    buildKnowledgeGraphHoverSelection,
} from "./knowledgeGraphHoverHighlight";

function rounded(values: Float32Array): number[] {
    return Array.from(values).map((value) => Math.round(value * 1000) / 1000);
}

describe("knowledgeGraphHoverHighlight", () => {
    test("hover 选择包含当前节点和所有直接相连节点", () => {
        const selection = buildKnowledgeGraphHoverSelection(
            6,
            [
                0, 1,
                1, 2,
                1, 3,
                3, 4,
                5, 0,
            ],
            1,
        );

        expect(selection.sort((left, right) => left - right)).toEqual([0, 1, 2, 3]);
    });

    test("hover 边样式只增强与当前节点直接相连的边", () => {
        const style = buildKnowledgeGraphHoverLinkStyle({
            links: [
                0, 1,
                1, 2,
                2, 3,
                3, 4,
            ],
            hoveredNodeIndex: 2,
            baseLinkWidth: 1.5,
            defaultLinkColor: [0.2, 0.3, 0.4, 1],
            activeLinkColor: [0.8, 0.7, 0.6, 1],
            dimLinkAlpha: 0.2,
            activeLinkAlpha: 1,
            activeLinkWidthMultiplier: 2,
        });

        expect(style.incidentLinkCount).toBe(2);
        expect(Array.from(style.linkWidths)).toEqual([1.5, 3, 3, 1.5]);
        expect(rounded(style.linkColors.slice(0, 4))).toEqual([0.2, 0.3, 0.4, 0.2]);
        expect(rounded(style.linkColors.slice(4, 8))).toEqual([0.8, 0.7, 0.6, 1]);
        expect(rounded(style.linkColors.slice(8, 12))).toEqual([0.8, 0.7, 0.6, 1]);
        expect(rounded(style.linkColors.slice(12, 16))).toEqual([0.2, 0.3, 0.4, 0.2]);
    });
});
