/**
 * @module host/vault/vaultStore.test
 * @description Vault store 生命周期测试，覆盖切换仓库前必须等待清理事件完成。
 * @dependencies
 *  - bun:test
 *  - ./vaultStore
 *
 * @example
 *   bun test src/host/vault/vaultStore.test.ts
 */

import { describe, expect, it, mock } from "bun:test";
import { createMockVaultApi } from "../../test-support/mockVaultApi";

mock.module("../../api/vaultApi", () => createMockVaultApi());

const {
    subscribeVaultBeforeChangeEvent,
} = await import("../events/appEventBus");

const {
    getVaultStateSnapshot,
    setCurrentVaultPath,
} = await import("./vaultStore");

describe("vaultStore", () => {
    /**
     * @description setCurrentVaultPath 应先等待 vault.before-change 清理完成，再更新当前仓库路径。
     */
    it("should wait for vault before-change cleanup before switching current path", async () => {
        const nextVaultPath = `/tmp/ofive-next-vault-${Date.now()}`;
        let releaseCleanup: () => void = () => undefined;
        let cleanupStarted = false;

        const cleanupFinished = new Promise<void>((resolve) => {
            releaseCleanup = resolve;
        });

        const unlisten = subscribeVaultBeforeChangeEvent(async () => {
            cleanupStarted = true;
            await cleanupFinished;
        });

        try {
            const switchPromise = setCurrentVaultPath(nextVaultPath);

            await Promise.resolve();
            expect(cleanupStarted).toBe(true);
            expect(getVaultStateSnapshot().currentVaultPath).not.toBe(nextVaultPath);

            releaseCleanup();
            await switchPromise;

            expect(getVaultStateSnapshot().currentVaultPath).toBe(nextVaultPath);
        } finally {
            unlisten();
        }
    });
});
