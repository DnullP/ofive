/**
 * @module host/layout/workspaceLayoutPersistence.test
 * @description 主工作区布局持久化模型测试。
 */

import { describe, expect, it } from "bun:test";
import type { WorkbenchLayoutSnapshot } from "layout-v2";
import {
    buildWorkspaceLayoutConfigValue,
    countWorkspaceLayoutTabs,
    hydrateWorkspaceLayoutSnapshot,
    parseWorkspaceLayoutConfig,
    WORKSPACE_LAYOUT_CONFIG_KEY,
} from "./workspaceLayoutPersistence";

const snapshot: WorkbenchLayoutSnapshot = {
    version: 1,
    root: {
        id: "root",
        title: "Workbench Root",
        data: {
            role: "root",
            component: {
                type: "empty",
                props: { label: "Root", description: "workbench root" },
            },
        },
        resizableEdges: { top: true, right: true, bottom: true, left: true },
        split: {
            direction: "horizontal",
            ratio: 0.2,
            children: [
                {
                    id: "left-activity-bar",
                    title: "Left Activity Bar",
                    data: {
                        role: "activity-bar",
                        component: { type: "activity-rail", props: {} },
                    },
                    resizableEdges: { top: true, right: false, bottom: true, left: true },
                    split: null,
                },
                {
                    id: "main-tabs",
                    title: "Main Tabs",
                    data: {
                        role: "main",
                        component: { type: "tab-section", props: { tabSectionId: "main-tabs" } },
                    },
                    resizableEdges: { top: true, right: true, bottom: true, left: true },
                    split: null,
                },
            ],
        },
    },
    tabSections: [
        {
            id: "main-tabs",
            tabs: [
                {
                    id: "file:notes/a.md",
                    title: "a.md",
                    component: "codemirror",
                    params: {
                        path: "notes/a.md",
                        content: "# A",
                        absolutePath: "/tmp/vault/notes/a.md",
                        initialCursorOffset: 3,
                    },
                },
                {
                    id: "settings",
                    title: "Settings",
                    component: "settings",
                },
            ],
            focusedTabId: "file:notes/a.md",
            isRoot: true,
        },
    ],
    activeGroupId: "main-tabs",
};

describe("workspace layout persistence", () => {
    it("写入配置时应移除文件内容和运行时参数", () => {
        const value = buildWorkspaceLayoutConfigValue(snapshot);
        const tab = (value.tabSections as Array<{ tabs: Array<{ params?: Record<string, unknown> }> }>)[0]?.tabs[0];

        expect(tab?.params).toEqual({ path: "notes/a.md" });
    });

    it("应稳定解析合法快照", () => {
        const value = buildWorkspaceLayoutConfigValue(snapshot);
        const parsed = parseWorkspaceLayoutConfig({ [WORKSPACE_LAYOUT_CONFIG_KEY]: value });

        expect(parsed).not.toBeNull();
        expect(countWorkspaceLayoutTabs(parsed)).toBe(2);
        expect(JSON.stringify(buildWorkspaceLayoutConfigValue(parsed!))).toBe(JSON.stringify(value));
    });

    it("hydrate 时应使用 resolver 重建文件 tab，并丢弃无法恢复的文件 tab", async () => {
        const hydrated = await hydrateWorkspaceLayoutSnapshot(snapshot, async (tab) => {
            if (tab.id === "file:notes/a.md") {
                return {
                    ...tab,
                    params: {
                        path: "notes/a.md",
                        content: "# Fresh",
                    },
                };
            }
            if (tab.id.startsWith("file:")) {
                return null;
            }
            return tab;
        });

        expect(hydrated.tabSections[0]?.tabs).toHaveLength(2);
        expect(hydrated.tabSections[0]?.tabs[0]?.params).toEqual({
            path: "notes/a.md",
            content: "# Fresh",
        });
        expect(hydrated.tabSections[0]?.focusedTabId).toBe("file:notes/a.md");
    });
});
