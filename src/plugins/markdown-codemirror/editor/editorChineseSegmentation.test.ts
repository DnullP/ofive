/**
 * @module plugins/markdown-codemirror/editor/editorChineseSegmentation.test
 * @description editorChineseSegmentation 单元测试：验证行级分词缓存与请求去重语义。
 */

import { describe, expect, test } from "bun:test";

import { createEditorChineseSegmentationController } from "./editorChineseSegmentation";

describe("createEditorChineseSegmentationController", () => {
    test("should reuse cached segmentation result for the same line text", async () => {
        let callCount = 0;
        const controller = createEditorChineseSegmentationController({
            articleId: "file:test",
            segmentLine: async (lineText) => {
                callCount += 1;
                return [{ word: lineText, start: 0, end: lineText.length }];
            },
        });

        const first = await controller.prefetchLineSegmentation(3, "中文测试");
        const second = await controller.prefetchLineSegmentation(3, "中文测试");

        expect(callCount).toBe(1);
        expect(first).toEqual(second);
        expect(controller.getLineTokens(3, "中文测试")).toEqual(first);
    });

    test("should deduplicate in-flight segmentation requests for the same line", async () => {
        let callCount = 0;
        let resolveRequest!: () => void;
        const controller = createEditorChineseSegmentationController({
            articleId: "file:test",
            segmentLine: (lineText) => {
                callCount += 1;
                return new Promise((resolve) => {
                    resolveRequest = () => resolve([{ word: lineText, start: 0, end: lineText.length }]);
                });
            },
        });

        const firstPromise = controller.prefetchLineSegmentation(8, "中文请求");
        const secondPromise = controller.prefetchLineSegmentation(8, "中文请求");

        expect(callCount).toBe(1);
        expect(firstPromise).toBe(secondPromise);

        resolveRequest();
        await expect(firstPromise).resolves.toEqual([{ word: "中文请求", start: 0, end: 4 }]);
    });

    test("should skip segmentation for non-Chinese lines", async () => {
        let callCount = 0;
        const controller = createEditorChineseSegmentationController({
            articleId: "file:test",
            segmentLine: async () => {
                callCount += 1;
                return [];
            },
        });

        await expect(controller.prefetchLineSegmentation(1, "plain english")).resolves.toBeNull();
        expect(callCount).toBe(0);
        expect(controller.getLineTokens(1, "plain english")).toBeNull();
    });
});