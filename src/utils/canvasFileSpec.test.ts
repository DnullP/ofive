/**
 * @module utils/canvasFileSpec.test
 * @description Canvas 文件规则单元测试。
 */

import { describe, expect, test } from "bun:test";
import {
    buildCreatedCanvasInitialContent,
    isCanvasPath,
    resolveCreatedCanvasPath,
} from "./canvasFileSpec";

describe("canvasFileSpec", () => {
    test("resolveCreatedCanvasPath should append extension and normalize directory", () => {
        expect(resolveCreatedCanvasPath("boards", "roadmap")).toBe("boards/roadmap.canvas");
        expect(resolveCreatedCanvasPath("/boards/2026/", "roadmap.canvas")).toBe("boards/2026/roadmap.canvas");
        expect(resolveCreatedCanvasPath("", "overview")).toBe("overview.canvas");
        expect(resolveCreatedCanvasPath("boards", "   ")).toBeNull();
    });

    test("buildCreatedCanvasInitialContent should derive title from file name", () => {
        expect(buildCreatedCanvasInitialContent("boards/roadmap.canvas")).toContain('"title": "roadmap"');
        expect(buildCreatedCanvasInitialContent("overview.canvas")).toContain('"nodes": []');
    });

    test("isCanvasPath should detect canvas extension case-insensitively", () => {
        expect(isCanvasPath("boards/roadmap.canvas")).toBe(true);
        expect(isCanvasPath("boards/ROADMAP.CANVAS")).toBe(true);
        expect(isCanvasPath("boards/roadmap.md")).toBe(false);
    });
});