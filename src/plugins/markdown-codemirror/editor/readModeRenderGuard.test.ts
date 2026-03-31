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

    test("should allow read mode when markdown uses all registered enhanced features", () => {
        const result = evaluateReadModeRenderGuard("---\ntitle: demo\n---\n\n==highlight==\n\n#tag\n\n$E=mc^2$\n\n![[demo.png]]\n");

        expect(result.canRenderReadMode).toBe(true);
        expect(result.unsupportedFeatures).toEqual([]);
    });

    test("should detect block latex and ignore inline tokens inside code fences", () => {
        const features = detectUsedEnhancedRenderFeatures("```md\n==no==\n#tag\n$math$\n![[image.png]]\n```\n\n$$\na+b\n$$\n");
        expect(features).toEqual(["latex-block"]);
    });

    test("should detect single-line block latex", () => {
        const features = detectUsedEnhancedRenderFeatures("$$a+b$$\n");
        expect(features).toEqual(["latex-block"]);
    });
});