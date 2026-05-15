/**
 * @module host/layout/openFileService.test
 * @description 文件打开服务测试，覆盖解析出的 tab 生命周期元数据。
 * @dependencies
 *  - bun:test
 *  - ./openFileService
 *
 * @example
 *   bun test src/host/layout/openFileService.test.ts
 */

import { afterEach, describe, expect, it } from "bun:test";
import {
    registerFileOpener,
    unregisterFileOpener,
} from "../registry/fileOpenerRegistry";
import {
    registerTabComponent,
    unregisterTabComponent,
} from "../registry/tabComponentRegistry";
import {
    TAB_COMPONENT_ID_PARAM,
    TAB_LIFECYCLE_SCOPE_PARAM,
} from "./vaultTabScope";
import {
    buildFileTabId,
    openFileInWorkbench,
    resolveFileTabDefinition,
    TAB_NAVIGATION_HISTORY_PARAM,
} from "./openFileService";
import type { WorkbenchContainerApi, WorkbenchPanelHandle } from "./workbenchContracts";

describe("openFileService", () => {
    afterEach(() => {
        unregisterFileOpener("test.markdown");
        unregisterTabComponent("codemirror");
    });

    /**
     * @function should_decorate_resolved_file_tabs_with_registered_lifecycle_scope
     * @description 通过 opener 解析出来的文件 tab 应带上组件 ID 与 vault 生命周期元数据。
     */
    it("should decorate resolved file tabs with registered lifecycle scope", async () => {
        registerTabComponent({
            id: "codemirror",
            component: () => null,
            lifecycleScope: "vault",
        });

        registerFileOpener({
            id: "test.markdown",
            label: "Test Markdown",
            kind: "markdown",
            priority: 100,
            matches: ({ relativePath }) => relativePath.endsWith(".md"),
            resolveTab: async ({ relativePath }) => ({
                id: buildFileTabId(relativePath),
                title: relativePath.split("/").pop() ?? relativePath,
                component: "codemirror",
                params: {
                    path: relativePath,
                    content: "# Test",
                },
            }),
        });

        const tab = await resolveFileTabDefinition({
            relativePath: "notes/demo.md",
            tabParams: {
                autoFocus: true,
            },
        });

        expect(tab?.params?.path).toBe("notes/demo.md");
        expect(tab?.params?.autoFocus).toBe(true);
        expect(tab?.params?.[TAB_COMPONENT_ID_PARAM]).toBe("codemirror");
        expect(tab?.params?.[TAB_LIFECYCLE_SCOPE_PARAM]).toBe("vault");
    });

    /**
     * @function should_record_navigation_history_when_replacing_active_file_tab
     * @description replace-active-tab 模式应把当前文件与新文件写入同一个 tab 的浏览历史，供左右方向按钮导航。
     */
    it("should record navigation history when replacing the active file tab", async () => {
        registerTabComponent({
            id: "codemirror",
            component: () => null,
            lifecycleScope: "vault",
        });

        registerFileOpener({
            id: "test.markdown",
            label: "Test Markdown",
            kind: "markdown",
            priority: 100,
            matches: ({ relativePath }) => relativePath.endsWith(".md"),
            resolveTab: async ({ relativePath }) => ({
                id: buildFileTabId(relativePath),
                title: relativePath.split("/").pop() ?? relativePath,
                component: "codemirror",
                params: {
                    path: relativePath,
                    content: `# ${relativePath}`,
                },
            }),
        });

        let activePanelId = buildFileTabId("notes/a.md");
        const panels = new Map<string, WorkbenchPanelHandle>([
            [activePanelId, {
                id: activePanelId,
                title: "a.md",
                component: "codemirror",
                params: { path: "notes/a.md", content: "# A" },
                api: {
                    setActive: () => {
                        activePanelId = buildFileTabId("notes/b.md");
                    },
                },
            }],
        ]);
        const containerApi: WorkbenchContainerApi = {
            get activePanelId() {
                return activePanelId;
            },
            getPanel: (panelId) => panels.get(panelId) ?? null,
            addPanel: () => {
                throw new Error("replace-active-tab should not add a panel");
            },
            replacePanel: (panelId, options) => {
                panels.delete(panelId);
                panels.set(options.id, {
                    id: options.id,
                    title: options.title,
                    component: options.component,
                    params: options.params,
                    api: {
                        setActive: () => {
                            activePanelId = options.id;
                        },
                    },
                });
            },
        };

        await openFileInWorkbench({
            relativePath: "notes/b.md",
            containerApi,
            openMode: "replace-active-tab",
        });

        const nextPanel = panels.get(buildFileTabId("notes/b.md"));
        const history = nextPanel?.params?.[TAB_NAVIGATION_HISTORY_PARAM] as
            | { entries: Array<{ id: string; params?: Record<string, unknown> }>; index: number }
            | undefined;

        expect(history?.index).toBe(1);
        expect(history?.entries.map((entry) => entry.id)).toEqual([
            buildFileTabId("notes/a.md"),
            buildFileTabId("notes/b.md"),
        ]);
        expect(history?.entries[0]?.params?.[TAB_NAVIGATION_HISTORY_PARAM]).toBeUndefined();
    });
});
