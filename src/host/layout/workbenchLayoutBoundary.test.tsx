import { describe, expect, test } from "bun:test";
import type { WorkbenchApi } from "layout-v2";
import {
    buildActivityDefaults,
    closeWorkbenchFileTabsByPath,
    createWorkbenchContainerApi,
    mapActivitiesToDefinitions,
    mapPanelsToDefinitions,
} from "./workbenchLayoutBoundary";
import { SETTINGS_ACTIVITY_ID } from "./activityBarStore";
import type { ActivityDescriptor, PanelDescriptor } from "../registry";

describe("workbenchLayoutBoundary", () => {
    test("projects ofive activities and panels into layout-v2 definitions", () => {
        const activities: ActivityDescriptor[] = [
            {
                type: "panel-container",
                id: "files",
                title: "Files",
                icon: "F",
                defaultSection: "top",
                defaultBar: "left",
                defaultOrder: 10,
            },
            {
                type: "callback",
                id: "graph",
                title: () => "Graph",
                icon: "G",
                defaultSection: "bottom",
                defaultBar: "right",
                defaultOrder: 20,
                onActivate: () => { },
            },
        ];
        const panels: PanelDescriptor[] = [
            {
                id: "files-panel",
                title: () => "Files",
                activityId: "files",
                defaultPosition: "left",
                defaultOrder: 1,
                render: () => null,
            },
        ];

        expect(buildActivityDefaults(activities)).toEqual([
            { id: "files", section: "top", bar: "left" },
            { id: "graph", section: "bottom", bar: "right" },
            { id: SETTINGS_ACTIVITY_ID, section: "bottom", bar: "left" },
        ]);
        expect(mapActivitiesToDefinitions(activities, [
            { id: "files", section: "top", bar: "left", visible: true },
            { id: "graph", section: "bottom", bar: "right", visible: true },
            { id: "hidden", section: "top", bar: "left", visible: false },
        ])).toMatchObject([
            { id: "files", label: "Files", activationMode: "focus" },
            { id: "graph", label: "Graph", activationMode: "action" },
        ]);
        expect(mapPanelsToDefinitions(panels)).toEqual([
            {
                id: "files-panel",
                label: "Files",
                icon: undefined,
                activityId: "files",
                position: "left",
                order: 1,
            },
        ]);
    });

    test("adapts layout-v2 WorkbenchApi to ofive container API", () => {
        const opened: unknown[] = [];
        const updates: unknown[] = [];
        const focused: string[] = [];
        const api = {
            getTab: (tabId: string) => tabId === "note"
                ? { id: "note", title: "Note", component: "codemirror", params: { path: "note.md" } }
                : null,
            getTabs: () => [
                { id: "note", title: "Note", component: "codemirror", params: { path: "note.md" } },
            ],
            openTab: (tab: unknown) => opened.push(tab),
            updateTab: (tabId: string, updatesValue: unknown) => updates.push([tabId, updatesValue]),
            setActiveTab: (tabId: string) => focused.push(tabId),
            closeTab: () => { },
        } as unknown as WorkbenchApi;

        const containerApi = createWorkbenchContainerApi(
            api,
            () => "note",
            (tab) => ({ ...tab, params: { ...(tab.params ?? {}), decorated: true } }),
        );

        expect(containerApi.activePanelId).toBe("note");
        expect(containerApi.getPanel("note")?.params).toEqual({ path: "note.md" });
        containerApi.addPanel({ id: "next", title: "Next", component: "codemirror" });
        containerApi.replacePanel?.("note", { id: "replacement", title: "Replacement", component: "codemirror" });

        expect(opened).toEqual([
            { id: "next", title: "Next", component: "codemirror", params: { decorated: true } },
        ]);
        expect(updates).toEqual([
            ["note", { id: "replacement", title: "Replacement", component: "codemirror", params: { decorated: true } }],
        ]);
        expect(focused).toEqual(["replacement"]);
    });

    test("closes file tabs by normalized path", () => {
        const closed: string[] = [];
        const api = {
            getTabs: () => [
                { id: "a", title: "A", component: "codemirror", params: { path: "notes/example.md" } },
                { id: "b", title: "B", component: "codemirror", params: { path: "other.md" } },
            ],
            closeTab: (tabId: string) => closed.push(tabId),
        } as unknown as WorkbenchApi;

        closeWorkbenchFileTabsByPath(api, "notes\\example.md");

        expect(closed).toEqual(["a"]);
    });
});
