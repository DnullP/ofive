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
import { syncConfigStateForVault, updateBackendConfig } from "../config/configStore";
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
    buildFileViewTabId,
    buildUniqueFileViewTabId,
    buildFileTabId,
    openFileInWorkbench,
    resolveFileTabDefinition,
    TAB_NAVIGATION_HISTORY_PARAM,
} from "./openFileService";
import type { WorkbenchContainerApi, WorkbenchPanelHandle } from "./workbenchContracts";

describe("openFileService", () => {
    afterEach(async () => {
        unregisterFileOpener("test.markdown");
        unregisterTabComponent("codemirror");
        await syncConfigStateForVault("", true);
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

    it("should pass tab params when opening a file in the workbench", async () => {
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

        let openedPanel: WorkbenchPanelHandle | null = null;
        let openedParams: Record<string, unknown> | undefined;
        const containerApi: WorkbenchContainerApi = {
            getPanel: (panelId) => openedPanel?.id === panelId ? openedPanel : null,
            addPanel: (options) => {
                openedParams = options.params;
                openedPanel = {
                    id: options.id,
                    title: options.title,
                    component: options.component,
                    params: options.params,
                    api: {
                        setActive: () => undefined,
                    },
                };
            },
        };

        await openFileInWorkbench({
            relativePath: "notes/demo.md",
            containerApi,
            tabParams: {
                initialCursorOffset: 12,
                initialRevealLine: 3,
            },
        });

        expect(openedPanel).not.toBeNull();
        expect(openedParams?.initialCursorOffset).toBe(12);
        expect(openedParams?.initialRevealLine).toBe(3);
    });

    it("should merge tab params into an existing file panel before activation", async () => {
        const tabId = buildFileTabId("notes/demo.md");
        let activePanelId = "";
        const panel: WorkbenchPanelHandle = {
            id: tabId,
            title: "demo.md",
            component: "codemirror",
            params: {
                path: "notes/demo.md",
                content: "# Demo",
            },
            api: {
                setActive: () => {
                    activePanelId = tabId;
                },
                updateParameters: (params) => {
                    panel.params = params;
                },
            },
        };
        const containerApi: WorkbenchContainerApi = {
            getPanel: (panelId) => panelId === tabId ? panel : null,
            addPanel: () => {
                throw new Error("existing file panel should be reused");
            },
        };

        await openFileInWorkbench({
            relativePath: "notes/demo.md",
            containerApi,
            tabParams: {
                initialCursorOffset: 24,
                initialRevealLine: 5,
                autoFocus: true,
            },
        });

        expect(activePanelId).toBe(tabId);
        expect(panel.params?.content).toBe("# Demo");
        expect(panel.params?.initialCursorOffset).toBe(24);
        expect(panel.params?.initialRevealLine).toBe(5);
        expect(panel.params?.autoFocus).toBe(true);
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

    it("should add a panel when new-tab mode is explicitly requested with an active file tab", async () => {
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

        const activePanelId = buildFileTabId("notes/a.md");
        const panels = new Map<string, WorkbenchPanelHandle>([
            [activePanelId, {
                id: activePanelId,
                title: "a.md",
                component: "codemirror",
                params: { path: "notes/a.md", content: "# A" },
                api: {
                    setActive: () => undefined,
                },
            }],
        ]);
        let replacedPanel = false;
        const containerApi: WorkbenchContainerApi = {
            get activePanelId() {
                return activePanelId;
            },
            getPanel: (panelId) => panels.get(panelId) ?? null,
            addPanel: (options) => {
                panels.set(options.id, {
                    id: options.id,
                    title: options.title,
                    component: options.component,
                    params: options.params,
                    api: {
                        setActive: () => undefined,
                    },
                });
            },
            replacePanel: () => {
                replacedPanel = true;
            },
        };

        await openFileInWorkbench({
            relativePath: "notes/b.md",
            containerApi,
            openMode: "new-tab",
        });

        expect(replacedPanel).toBe(false);
        expect(panels.has(buildFileTabId("notes/a.md"))).toBe(true);
        expect(panels.has(buildFileTabId("notes/b.md"))).toBe(true);
    });

    it("should assign a unique view tab id when new-tab mode opens the same file path", async () => {
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

        const baseTabId = buildFileTabId("notes/split.md");
        const panels = new Map<string, WorkbenchPanelHandle>([
            [baseTabId, {
                id: baseTabId,
                title: "split.md",
                component: "codemirror",
                params: { path: "notes/split.md", content: "# split" },
                api: {
                    setActive: () => undefined,
                },
            }],
        ]);
        let activatedPanelId = "";
        const containerApi: WorkbenchContainerApi = {
            getPanel: (panelId) => panels.get(panelId) ?? null,
            get panels() {
                return Array.from(panels.values());
            },
            addPanel: (options) => {
                panels.set(options.id, {
                    id: options.id,
                    title: options.title,
                    component: options.component,
                    params: options.params,
                    api: {
                        setActive: () => {
                            activatedPanelId = options.id;
                        },
                    },
                });
            },
        };

        const tab = await openFileInWorkbench({
            relativePath: "notes/split.md",
            containerApi,
            openMode: "new-tab",
        });

        const expectedViewId = buildFileViewTabId(baseTabId, 2);
        expect(tab?.id).toBe(expectedViewId);
        expect(panels.has(baseTabId)).toBe(true);
        expect(panels.get(expectedViewId)?.params?.path).toBe("notes/split.md");
        expect(activatedPanelId).toBe(expectedViewId);
    });

    it("should assign a unique view tab id when configured new-tab mode opens the same file path", async () => {
        await syncConfigStateForVault("/tmp/open-file-service-new-tab-mode", true);

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

        await updateBackendConfig((config) => ({
            ...config,
            entries: {
                ...config.entries,
                features: {
                    ...(
                        config.entries.features
                        && typeof config.entries.features === "object"
                        && !Array.isArray(config.entries.features)
                            ? config.entries.features
                            : {}
                    ),
                    fileOpenMode: "new-tab",
                },
            },
        }));

        const baseTabId = buildFileTabId("notes/configured.md");
        const panels = new Map<string, WorkbenchPanelHandle>([
            [baseTabId, {
                id: baseTabId,
                title: "configured.md",
                component: "codemirror",
                params: { path: "notes/configured.md", content: "# configured" },
                api: {
                    setActive: () => undefined,
                },
            }],
        ]);
        const containerApi: WorkbenchContainerApi = {
            getPanel: (panelId) => panels.get(panelId) ?? null,
            get panels() {
                return Array.from(panels.values());
            },
            addPanel: (options) => {
                panels.set(options.id, {
                    id: options.id,
                    title: options.title,
                    component: options.component,
                    params: options.params,
                    api: {
                        setActive: () => undefined,
                    },
                });
            },
        };

        const tab = await openFileInWorkbench({
            relativePath: "notes/configured.md",
            containerApi,
        });

        expect(tab?.id).toBe(buildFileViewTabId(baseTabId, 2));
        expect(panels.has(baseTabId)).toBe(true);
        expect(panels.has(buildFileViewTabId(baseTabId, 2))).toBe(true);
    });

    it("should resolve the next available file view tab id", () => {
        const baseTabId = buildFileTabId("notes/split.md");
        const secondViewId = buildFileViewTabId(baseTabId, 2);
        const thirdViewId = buildFileViewTabId(baseTabId, 3);
        const panels: WorkbenchPanelHandle[] = [
            { id: baseTabId, api: { setActive: () => undefined } },
            { id: secondViewId, api: { setActive: () => undefined } },
        ];

        expect(buildUniqueFileViewTabId({
            baseTabId,
            containerApi: {
                panels,
                getPanel: (panelId) => panels.find((panel) => panel.id === panelId) ?? null,
            },
        })).toBe(thirdViewId);
    });
});
