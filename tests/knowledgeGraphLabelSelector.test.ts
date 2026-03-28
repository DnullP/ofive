/**
 * @module tests/knowledgeGraphLabelSelector
 * @description 验证知识图谱标签选择器的视口裁剪、密度限制与稳定排序行为。
 */

import { describe, expect, test } from "bun:test";
import {
    selectVisibleGraphLabels,
    type GraphLabelItem,
} from "../src/plugins/knowledge-graph/tab/knowledgeGraphLabelSelector";

/**
 * @function createLabelItems
 * @description 创建测试用标签列表。
 * @param count 标签数量。
 * @returns 标签数组。
 */
function createLabelItems(count: number): GraphLabelItem[] {
    return Array.from({ length: count }, (_, index) => ({
        index,
        text: `label-${String(index)}`,
    }));
}

describe("selectVisibleGraphLabels", () => {
    test("仅返回视口内标签", () => {
        const items = createLabelItems(3);
        const selected = selectVisibleGraphLabels({
            items,
            getScreenPosition: (index) => {
                if (index === 0) {
                    return [60, 60];
                }
                if (index === 1) {
                    return [180, 80];
                }
                return [640, 640];
            },
            viewWidth: 240,
            viewHeight: 160,
            viewPaddingPx: 24,
            cellWidthPx: 100,
            cellHeightPx: 30,
            maxVisibleLabels: 10,
            labelOffsetYPx: 14,
        });

        expect(selected.map((item) => item.index)).toEqual([1, 0]);
    });

    test("同一网格只保留一个标签", () => {
        const items = createLabelItems(4);
        const positions = new Map<number, [number, number]>([
            [0, [100, 80]],
            [1, [108, 84]],
            [2, [116, 86]],
            [3, [320, 160]],
        ]);
        const selected = selectVisibleGraphLabels({
            items,
            getScreenPosition: (index) => positions.get(index) ?? null,
            viewWidth: 480,
            viewHeight: 320,
            viewPaddingPx: 24,
            cellWidthPx: 100,
            cellHeightPx: 80,
            maxVisibleLabels: 10,
            labelOffsetYPx: 14,
        });

        expect(selected.map((item) => item.index)).toEqual([3, 2]);
    });

    test("按中心优先并受最大数量限制", () => {
        const items = createLabelItems(5);
        const positions = new Map<number, [number, number]>([
            [0, [50, 50]],
            [1, [200, 120]],
            [2, [240, 120]],
            [3, [360, 120]],
            [4, [420, 240]],
        ]);
        const selected = selectVisibleGraphLabels({
            items,
            getScreenPosition: (index) => positions.get(index) ?? null,
            viewWidth: 480,
            viewHeight: 320,
            viewPaddingPx: 24,
            cellWidthPx: 40,
            cellHeightPx: 40,
            maxVisibleLabels: 2,
            labelOffsetYPx: 14,
        });

        expect(selected.map((item) => item.index)).toEqual([2, 1]);
    });

    test("优先保留上一帧已显示标签以降低闪烁", () => {
        const items = createLabelItems(4);
        const positions = new Map<number, [number, number]>([
            [0, [208, 120]],
            [1, [214, 122]],
            [2, [320, 120]],
            [3, [420, 240]],
        ]);

        const selected = selectVisibleGraphLabels({
            items,
            getScreenPosition: (index) => positions.get(index) ?? null,
            viewWidth: 480,
            viewHeight: 320,
            viewPaddingPx: 24,
            cellWidthPx: 120,
            cellHeightPx: 60,
            maxVisibleLabels: 3,
            labelOffsetYPx: 14,
            preferredVisibleIndices: new Set([1]),
            preferredStabilityDistancePx: 80,
        });

        expect(selected.map((item) => item.index)).toEqual([1, 2, 3]);
    });
});