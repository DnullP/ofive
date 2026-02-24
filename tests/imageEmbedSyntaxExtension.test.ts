/**
 * @module tests/imageEmbedSyntaxExtension.test
 * @description 图片嵌入语法插件回归测试：保证异步刷新事务会触发 decoration 重建判定。
 */

import { describe, expect, test } from "bun:test";
import { shouldRebuildImageEmbedDecorations } from "../src/layout/editor/syntaxPlugins/imageEmbedUpdatePolicy";

describe("shouldRebuildImageEmbedDecorations", () => {
    test("当仅有事务触发（无 doc/selection/viewport/focus 变化）时应返回 true", () => {
        const shouldRebuild = shouldRebuildImageEmbedDecorations({
            docChanged: false,
            selectionSet: false,
            viewportChanged: false,
            focusChanged: false,
            transactionCount: 1,
        });

        expect(shouldRebuild).toBe(true);
    });

    test("当所有触发条件都不满足时应返回 false", () => {
        const shouldRebuild = shouldRebuildImageEmbedDecorations({
            docChanged: false,
            selectionSet: false,
            viewportChanged: false,
            focusChanged: false,
            transactionCount: 0,
        });

        expect(shouldRebuild).toBe(false);
    });
});
