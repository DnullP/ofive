/**
 * @module plugins/markdown-codemirror/editor/readModeRenderGuard.test
 * @description readModeRenderGuard 模块单元测试。
 * @dependencies
 *  - bun:test
 *  - ./readModeRenderGuard
 */

import { describe, expect, test } from "bun:test";
import {
    detectUsedEnhancedRenderFeatures,
    evaluateReadModeRenderGuard,
} from "./readModeRenderGuard";

describe("readModeRenderGuard", () => {
    test("should allow read mode when markdown only uses shared basic features", () => {
        expect(evaluateReadModeRenderGuard("# Title\n\n- item\n\n[[Note]]").canRenderReadMode).toBe(true);
    });

    test("should block read mode when markdown uses unmatched enhanced features", () => {
        const result = evaluateReadModeRenderGuard("---\ntitle: demo\n---\n\n==highlight==\n\n#tag\n\n$E=mc^2$\n\n![[demo.png]]\n");

        expect(result.canRenderReadMode).toBe(false);
        expect(result.unsupportedFeatures).toEqual([
            "frontmatter",
            "inline-highlight",
            "inline-tag",
            "latex-inline",
            "image-embed",
        ]);
    });

    test("should detect block latex and ignore inline tokens inside code fences", () => {
        const features = detectUsedEnhancedRenderFeatures("```md\n==no==\n#tag\n$math$\n![[image.png]]\n```\n\n$$\na+b\n$$\n");
        expect(features).toEqual(["latex-block"]);
    });
});