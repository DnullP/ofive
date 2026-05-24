/**
 * @module host/editor/persistedMarkdownContentSync.test
 * @description 外部 Markdown 保存同步测试：覆盖已打开编辑器 params、editor context 和持久态事件。
 * @dependencies
 *  - bun:test
 *  - ./persistedMarkdownContentSync
 */

import { describe, expect, it } from "bun:test";
import { subscribePersistedContentUpdatedEvent } from "../events/appEventBus";
import type { WorkbenchContainerApi, WorkbenchPanelHandle } from "../layout/workbenchContracts";
import {
    getArticleSnapshotById,
    reportArticleContent,
    resetEditorContext,
} from "./editorContextStore";
import {
    savePersistedMarkdownContent,
    syncPersistedMarkdownContentToOpenEditors,
} from "./persistedMarkdownContentSync";

describe("syncPersistedMarkdownContentToOpenEditors", () => {
    it("should refresh matching open editor params and article snapshots", () => {
        resetEditorContext();

        const relativePath = "notes/task.md";
        const nextContent = "# Task\n\n- [ ] Ship it !low";
        reportArticleContent({
            articleId: "file:notes/task.md",
            path: relativePath,
            content: "# Task\n\n- [ ] Ship it !high",
        });

        const panel: WorkbenchPanelHandle = {
            id: "file:notes/task.md",
            title: "task.md",
            component: "codemirror",
            params: {
                path: relativePath,
                content: "# Task\n\n- [ ] Ship it !high",
            },
            api: {
                setActive: () => undefined,
                updateParameters: (params) => {
                    panel.params = params;
                },
            },
        };
        const containerApi: WorkbenchContainerApi = {
            getPanel: (panelId) => panelId === panel.id ? panel : null,
            panels: [panel],
            addPanel: () => undefined,
        };
        const persistedEvents: Array<{ relativePath: string; source: string }> = [];
        const unlisten = subscribePersistedContentUpdatedEvent((event) => {
            persistedEvents.push({
                relativePath: event.relativePath,
                source: event.source,
            });
        });

        const result = syncPersistedMarkdownContentToOpenEditors({
            containerApi,
            relativePath,
            content: nextContent,
        });
        unlisten();

        expect(result.updatedPanelCount).toBe(1);
        expect(panel.params?.content).toBe(nextContent);
        expect(getArticleSnapshotById("file:notes/task.md")?.content).toBe(nextContent);
        expect(persistedEvents).toEqual([{
            relativePath,
            source: "save",
        }]);
    });

    it("should save markdown through the persisted content service without a workbench container", async () => {
        resetEditorContext();

        const relativePath = "notes/service-save.md";
        const nextContent = "# Service Save\n\nsaved through coordinator";
        reportArticleContent({
            articleId: "file:notes/service-save.md",
            path: relativePath,
            content: "# old",
        });

        const persistedEvents: Array<{ relativePath: string; source: string }> = [];
        const unlisten = subscribePersistedContentUpdatedEvent((event) => {
            persistedEvents.push({
                relativePath: event.relativePath,
                source: event.source,
            });
        });

        await savePersistedMarkdownContent({
            relativePath,
            content: nextContent,
        });
        unlisten();

        expect(getArticleSnapshotById("file:notes/service-save.md")?.content).toBe(nextContent);
        expect(persistedEvents).toEqual([{
            relativePath,
            source: "save",
        }]);
    });
});
