/**
 * @module plugins/outline/outlineStore
 * @description Outline state owner: derives the active article outline from canonical editor content, with persisted vault outline fallback.
 */

import { useSyncExternalStore } from "react";
import type { OutlineHeading, OutlineResponse } from "../../api/vaultApi";
import { getVaultMarkdownOutline } from "../../api/vaultApi";
import type { ActiveEditorState } from "../../host/editor/activeEditorStore";
import {
    getActiveEditorSnapshot,
    subscribeActiveEditor,
} from "../../host/editor/activeEditorStore";
import {
    getMarkdownContentOutlineSnapshot,
    overlayMarkdownContentOutlineSnapshot,
} from "../../host/editor/markdownContentOutlineSnapshots";
import {
    subscribeEditorContentBusEvent,
    subscribePersistedContentUpdatedEvent,
    type PersistedContentUpdatedBusEvent,
} from "../../host/events/appEventBus";

export interface OutlineStoreSnapshot {
    activeEditor: ActiveEditorState | null;
    headings: OutlineHeading[];
    loading: boolean;
    error: string | null;
    relativePath: string | null;
}

const EMPTY_SNAPSHOT: OutlineStoreSnapshot = {
    activeEditor: null,
    headings: [],
    loading: false,
    error: null,
    relativePath: null,
};

const REFRESH_DEBOUNCE_MS = 200;

function normalizeRelativePath(path: string): string {
    return path.replace(/\\/g, "/");
}

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

class OutlineStore {
    private snapshot: OutlineStoreSnapshot = EMPTY_SNAPSHOT;
    private readonly listeners = new Set<() => void>();
    private activeEditorUnlisten: (() => void) | null = null;
    private editorContentUnlisten: (() => void) | null = null;
    private persistedContentUnlisten: (() => void) | null = null;
    private refreshTimer: ReturnType<typeof setTimeout> | null = null;
    private refreshRequestId = 0;
    private started = false;

    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        this.start();

        return () => {
            this.listeners.delete(listener);
        };
    }

    getSnapshot(): OutlineStoreSnapshot {
        return this.snapshot;
    }

    start(): void {
        if (this.started) {
            return;
        }

        this.started = true;
        this.activeEditorUnlisten = subscribeActiveEditor(() => {
            this.handleActiveEditorChanged();
        });
        this.editorContentUnlisten = subscribeEditorContentBusEvent((event) => {
            const currentPath = this.snapshot.relativePath;
            if (!currentPath || normalizeRelativePath(event.path) !== currentPath) {
                return;
            }

            console.info("[outlineStore] editor content updated, refreshing outline", {
                eventId: event.eventId,
                relativePath: event.path,
            });
            this.refresh(currentPath);
        });
        this.persistedContentUnlisten = subscribePersistedContentUpdatedEvent((event) => {
            this.handlePersistedContentUpdated(event);
        });
        this.handleActiveEditorChanged();
    }

    stopForTest(): void {
        this.activeEditorUnlisten?.();
        this.editorContentUnlisten?.();
        this.persistedContentUnlisten?.();
        this.activeEditorUnlisten = null;
        this.editorContentUnlisten = null;
        this.persistedContentUnlisten = null;
        this.started = false;

        if (this.refreshTimer !== null) {
            clearTimeout(this.refreshTimer);
            this.refreshTimer = null;
        }
    }

    resetForTest(): void {
        this.stopForTest();
        this.refreshRequestId += 1;
        this.snapshot = EMPTY_SNAPSHOT;
        this.emit();
    }

    private emit(): void {
        this.listeners.forEach((listener) => listener());
    }

    private setSnapshot(nextSnapshot: OutlineStoreSnapshot): void {
        this.snapshot = nextSnapshot;
        this.emit();
    }

    private handleActiveEditorChanged(): void {
        const activeEditor = getActiveEditorSnapshot();
        const relativePath = activeEditor?.path ? normalizeRelativePath(activeEditor.path) : null;
        if (!activeEditor || !relativePath) {
            this.refreshRequestId += 1;
            this.setSnapshot(EMPTY_SNAPSHOT);
            return;
        }

        if (
            this.snapshot.activeEditor?.articleId === activeEditor.articleId
            && this.snapshot.relativePath === relativePath
        ) {
            return;
        }

        this.setSnapshot({
            ...this.snapshot,
            activeEditor,
            relativePath,
            error: null,
        });
        this.refresh(relativePath);
    }

    private handlePersistedContentUpdated(event: PersistedContentUpdatedBusEvent): void {
        const currentPath = this.snapshot.relativePath;
        if (!currentPath || normalizeRelativePath(event.relativePath) !== currentPath) {
            return;
        }

        console.info("[outlineStore] persisted content updated, refreshing outline", {
            eventId: event.eventId,
            source: event.source,
            relativePath: event.relativePath,
        });
        this.refresh(currentPath);
    }

    private refresh(relativePath: string): void {
        if (this.refreshTimer !== null) {
            clearTimeout(this.refreshTimer);
            this.refreshTimer = null;
        }

        const normalizedPath = normalizeRelativePath(relativePath);
        const contentOutline = getMarkdownContentOutlineSnapshot(normalizedPath);
        if (contentOutline) {
            this.refreshRequestId += 1;
            this.applyOutline(contentOutline, {
                loading: false,
                error: null,
            });
            return;
        }

        const requestId = this.refreshRequestId + 1;
        this.refreshRequestId = requestId;
        this.setSnapshot({
            ...this.snapshot,
            loading: true,
            error: null,
            relativePath: normalizedPath,
        });

        this.refreshTimer = setTimeout(() => {
            this.refreshTimer = null;
            void this.loadPersistedOutline(normalizedPath, requestId);
        }, REFRESH_DEBOUNCE_MS);
    }

    private applyOutline(
        outline: OutlineResponse,
        patch: Pick<OutlineStoreSnapshot, "loading" | "error">,
    ): void {
        const relativePath = normalizeRelativePath(outline.relativePath);
        if (this.snapshot.relativePath !== relativePath) {
            return;
        }

        this.setSnapshot({
            ...this.snapshot,
            headings: outline.headings,
            relativePath,
            loading: patch.loading,
            error: patch.error,
        });
    }

    private async loadPersistedOutline(relativePath: string, requestId: number): Promise<void> {
        console.info("[outlineStore] loading outline for", { relativePath });

        try {
            const persistedOutline = await getVaultMarkdownOutline(relativePath);
            if (this.refreshRequestId !== requestId) {
                return;
            }

            const resolvedOutline = overlayMarkdownContentOutlineSnapshot(persistedOutline);
            this.applyOutline(resolvedOutline, {
                loading: false,
                error: null,
            });
            console.info("[outlineStore] outline state updated", {
                relativePath,
                count: resolvedOutline.headings.length,
            });
        } catch (error) {
            if (this.refreshRequestId !== requestId) {
                return;
            }

            const message = getErrorMessage(error);
            this.setSnapshot({
                ...this.snapshot,
                loading: false,
                error: message,
            });
            console.error("[outlineStore] failed to load outline", {
                relativePath,
                error: message,
            });
        }
    }
}

const outlineStore = new OutlineStore();

export function ensureOutlineStoreStarted(): void {
    outlineStore.start();
}

export function subscribeOutlineSnapshot(listener: () => void): () => void {
    return outlineStore.subscribe(listener);
}

export function getOutlineSnapshot(): OutlineStoreSnapshot {
    return outlineStore.getSnapshot();
}

export function useOutlineSnapshot(): OutlineStoreSnapshot {
    return useSyncExternalStore(
        subscribeOutlineSnapshot,
        getOutlineSnapshot,
        getOutlineSnapshot,
    );
}

export function __resetOutlineStoreForTests(): void {
    outlineStore.resetForTest();
}
