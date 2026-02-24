/**
 * @module layout/editor/editorPasteImageHandler.test
 * @description 粘贴图片处理器纯函数测试：
 *   验证文件名生成、路径拼接与嵌入语法构建的正确性。
 * @dependencies
 *  - bun:test
 *  - ./editorPasteImageHandler
 *
 * @example
 *   bun test src/layout/editor/editorPasteImageHandler.test.ts
 */

import { describe, expect, it } from "bun:test";
import {
    buildImageEmbedSyntax,
    generatePastedImageFileName,
    resolveImageRelativePath,
} from "./editorPasteImageHandler";

describe("editorPasteImageHandler", () => {
    // ────────── generatePastedImageFileName ──────────

    /**
     * PNG 类型应生成 .png 扩展名。
     */
    it("should generate .png extension for image/png", () => {
        const name = generatePastedImageFileName("image/png");
        expect(name).toMatch(/^pasted-image-\d{8}-\d{6}-[a-z0-9]+\.png$/);
    });

    /**
     * JPEG 类型应生成 .jpg 扩展名。
     */
    it("should generate .jpg extension for image/jpeg", () => {
        const name = generatePastedImageFileName("image/jpeg");
        expect(name.endsWith(".jpg")).toBe(true);
    });

    /**
     * GIF 类型应生成 .gif 扩展名。
     */
    it("should generate .gif extension for image/gif", () => {
        const name = generatePastedImageFileName("image/gif");
        expect(name.endsWith(".gif")).toBe(true);
    });

    /**
     * WebP 类型应生成 .webp 扩展名。
     */
    it("should generate .webp extension for image/webp", () => {
        const name = generatePastedImageFileName("image/webp");
        expect(name.endsWith(".webp")).toBe(true);
    });

    /**
     * 未知 MIME 类型应降级为 .png。
     */
    it("should fallback to .png for unknown MIME types", () => {
        const name = generatePastedImageFileName("application/octet-stream");
        expect(name.endsWith(".png")).toBe(true);
    });

    /**
     * 每次调用应生成不同的文件名（随机后缀不同）。
     */
    it("should generate unique file names across calls", () => {
        const names = new Set(
            Array.from({ length: 20 }, () => generatePastedImageFileName("image/png")),
        );
        expect(names.size).toBe(20);
    });

    // ────────── resolveImageRelativePath ──────────

    /**
     * 应将文件名放入 Images 目录。
     */
    it("should prefix fileName with Images directory", () => {
        const result = resolveImageRelativePath("test.png");
        expect(result).toBe("Images/test.png");
    });

    // ────────── buildImageEmbedSyntax ──────────

    /**
     * 应构建正确的 ![[...]] 语法。
     */
    it("should build ![[path]] syntax", () => {
        const result = buildImageEmbedSyntax("Images/my-image.png");
        expect(result).toBe("![[Images/my-image.png]]");
    });

    /**
     * 端到端：从 MIME 到嵌入语法的完整流程。
     */
    it("should produce valid embed syntax from MIME type end-to-end", () => {
        const fileName = generatePastedImageFileName("image/png");
        const relativePath = resolveImageRelativePath(fileName);
        const syntax = buildImageEmbedSyntax(relativePath);

        expect(syntax.startsWith("![[Images/pasted-image-")).toBe(true);
        expect(syntax.endsWith(".png]]")).toBe(true);
    });
});
