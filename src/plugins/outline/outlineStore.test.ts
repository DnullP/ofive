/**
 * @module plugins/outline/outlineStore.test
 * @description Outline store regression tests for component-independent state ownership.
 */

import { afterEach, describe, expect, it, mock } from "bun:test";
import type { OutlineResponse } from "../../api/vaultApi";
import { createMockVaultApi } from "../../test-support/mockVaultApi";
import { reportActiveEditor } from "../../host/editor/activeEditorStore";
import { reportArticleContent, resetEditorContext } from "../../host/editor/editorContextStore";
import { emitPersistedContentUpdatedEvent } from "../../host/events/appEventBus";

let getVaultMarkdownOutlineImpl = async (relativePath: string): Promise<OutlineResponse> => ({
    relativePath,
    headings: [{ level: 1, text: "Persisted", line: 1 }],
});

const getVaultMarkdownOutlineMock = mock((relativePath: string) =>
    getVaultMarkdownOutlineImpl(relativePath),
);

mock.module("../../api/vaultApi", () => createMockVaultApi({
    getVaultMarkdownOutline: getVaultMarkdownOutlineMock,
}));

const {
    __resetOutlineStoreForTests,
    ensureOutlineStoreStarted,
    getOutlineSnapshot,
    subscribeOutlineSnapshot,
} = await import("./outlineStore");

function waitForOutlineSnapshot(
    predicate: () => boolean,
): Promise<void> {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            unlisten();
            reject(new Error("outline snapshot did not settle"));
        }, 1_000);
        const unlisten = subscribeOutlineSnapshot(() => {
            if (!predicate()) {
                return;
            }

            clearTimeout(timeout);
            unlisten();
            resolve();
        });

        if (predicate()) {
            clearTimeout(timeout);
            unlisten();
            resolve();
        }
    });
}

function waitUntil(predicate: () => boolean): Promise<void> {
    return new Promise((resolve, reject) => {
        const startedAt = Date.now();
        const tick = () => {
            if (predicate()) {
                resolve();
                return;
            }

            if (Date.now() - startedAt > 1_000) {
                reject(new Error("condition did not settle"));
                return;
            }

            setTimeout(tick, 10);
        };
        tick();
    });
}

function createDeferred<T>(): {
    promise: Promise<T>;
    resolve: (value: T) => void;
} {
    let resolveDeferred: (value: T) => void = () => undefined;
    const promise = new Promise<T>((resolve) => {
        resolveDeferred = resolve;
    });
    return {
        promise,
        resolve: resolveDeferred,
    };
}

describe("outlineStore", () => {
    afterEach(() => {
        __resetOutlineStoreForTests();
        resetEditorContext();
        getVaultMarkdownOutlineImpl = async (relativePath: string): Promise<OutlineResponse> => ({
            relativePath,
            headings: [{ level: 1, text: "Persisted", line: 1 }],
        });
        getVaultMarkdownOutlineMock.mockClear();
    });

    it("derives active outline from canonical editor content without loading persisted outline", async () => {
        reportArticleContent({
            articleId: "file:notes/live.md",
            path: "notes/live.md",
            content: "# Live\n\n## Fresh",
        });

        ensureOutlineStoreStarted();
        reportActiveEditor({
            articleId: "file:notes/live.md",
            path: "notes/live.md",
        });

        await waitForOutlineSnapshot(() => getOutlineSnapshot().headings.length === 2);

        expect(getOutlineSnapshot().loading).toBe(false);
        expect(getOutlineSnapshot().headings).toEqual([
            { level: 1, text: "Live", line: 1 },
            { level: 2, text: "Fresh", line: 3 },
        ]);
        expect(getVaultMarkdownOutlineMock).not.toHaveBeenCalled();
    });

    it("keeps a stable snapshot across unsubscribe and remount-like resubscribe", async () => {
        reportArticleContent({
            articleId: "file:notes/remount.md",
            path: "notes/remount.md",
            content: "# Stable",
        });

        ensureOutlineStoreStarted();
        reportActiveEditor({
            articleId: "file:notes/remount.md",
            path: "notes/remount.md",
        });

        await waitForOutlineSnapshot(() => getOutlineSnapshot().headings.length === 1);
        const before = getOutlineSnapshot();
        const unlisten = subscribeOutlineSnapshot(() => undefined);
        unlisten();
        const secondUnlisten = subscribeOutlineSnapshot(() => undefined);
        secondUnlisten();

        expect(getOutlineSnapshot()).toBe(before);
        expect(getOutlineSnapshot().headings).toEqual([
            { level: 1, text: "Stable", line: 1 },
        ]);
        expect(getVaultMarkdownOutlineMock).not.toHaveBeenCalled();
    });

    it("falls back to persisted outline only when canonical content is missing", async () => {
        ensureOutlineStoreStarted();
        reportActiveEditor({
            articleId: "file:notes/persisted.md",
            path: "notes/persisted.md",
        });

        await waitForOutlineSnapshot(() => getOutlineSnapshot().headings.length === 1);

        expect(getOutlineSnapshot().headings).toEqual([
            { level: 1, text: "Persisted", line: 1 },
        ]);
        expect(getVaultMarkdownOutlineMock).toHaveBeenCalledTimes(1);
    });

    it("refreshes from canonical content on persisted update without reloading backend", async () => {
        reportArticleContent({
            articleId: "file:notes/save.md",
            path: "notes/save.md",
            content: "# Before",
        });

        ensureOutlineStoreStarted();
        reportActiveEditor({
            articleId: "file:notes/save.md",
            path: "notes/save.md",
        });
        await waitForOutlineSnapshot(() => getOutlineSnapshot().headings[0]?.text === "Before");

        reportArticleContent({
            articleId: "file:notes/save.md",
            path: "notes/save.md",
            content: "# After",
        });
        emitPersistedContentUpdatedEvent({
            relativePath: "notes/save.md",
            source: "save",
        });

        await waitForOutlineSnapshot(() => getOutlineSnapshot().headings[0]?.text === "After");

        expect(getOutlineSnapshot().headings).toEqual([
            { level: 1, text: "After", line: 1 },
        ]);
        expect(getVaultMarkdownOutlineMock).not.toHaveBeenCalled();
    });

    it("ignores stale persisted fallback responses after the active editor changes", async () => {
        const firstRequest = createDeferred<OutlineResponse>();
        let requestCount = 0;
        getVaultMarkdownOutlineImpl = async (relativePath: string): Promise<OutlineResponse> => {
            requestCount += 1;
            if (requestCount === 1) {
                return firstRequest.promise;
            }

            return {
                relativePath,
                headings: [{ level: 1, text: "Second", line: 1 }],
            };
        };

        ensureOutlineStoreStarted();
        reportActiveEditor({
            articleId: "file:notes/first.md",
            path: "notes/first.md",
        });
        await waitUntil(() => requestCount === 1);

        reportActiveEditor({
            articleId: "file:notes/second.md",
            path: "notes/second.md",
        });

        await waitForOutlineSnapshot(() => getOutlineSnapshot().headings[0]?.text === "Second");
        firstRequest.resolve({
            relativePath: "notes/first.md",
            headings: [{ level: 1, text: "Stale First", line: 1 }],
        });
        await Promise.resolve();

        expect(getOutlineSnapshot().relativePath).toBe("notes/second.md");
        expect(getOutlineSnapshot().headings).toEqual([
            { level: 1, text: "Second", line: 1 },
        ]);
    });
});
