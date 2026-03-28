/**
 * @module api/vaultApi.runtime-boundary.test
 * @description 校验 vaultApi 在 Bun 单测运行时的模块边界，确保导入共享 API 时不会在顶层解析浏览器 mock Markdown fixture。
 * @dependencies
 *  - bun:test
 *  - ./vaultApi
 *
 * @example
 *   bun test src/api/vaultApi.runtime-boundary.test.ts
 */

import { describe, expect, it } from "bun:test";

describe("vaultApi runtime boundary", () => {
    /**
     * @description 在无浏览器窗口对象的 Bun 运行时中，导入 vaultApi 不应因浏览器 mock fixture 解析而失败。
     */
    it("should import and return an empty fallback tree in bun runtime", async () => {
        const vaultApi = await import("./vaultApi");
        const tree = await vaultApi.getCurrentVaultTree();

        expect(tree.vaultPath).toBe("");
        expect(tree.entries).toEqual([]);
    });
});