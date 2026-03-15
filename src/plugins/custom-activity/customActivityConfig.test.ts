/**
 * @module plugins/custom-activity/customActivityConfig.test
 * @description 自定义 activity 配置模型测试。
 *
 * @dependencies
 *   - bun:test
 *   - ./customActivityConfig
 *
 * @example
 *   bun test src/plugins/custom-activity/customActivityConfig.test.ts
 */

import { describe, expect, it } from "bun:test";
import {
    createCustomActivityDefinition,
    parseCustomActivitiesConfig,
    removeCustomActivityFromEntries,
} from "./customActivityConfig";

describe("customActivityConfig", () => {
    it("应解析合法的 panel-container 定义", () => {
        const result = parseCustomActivitiesConfig({
            customActivities: {
                items: [{
                    id: "custom-1",
                    name: "My Panel",
                    iconKey: "calendar",
                    kind: "panel-container",
                    defaultOrder: 1000,
                }],
            },
        });

        expect(result).toHaveLength(1);
        expect(result[0]?.kind).toBe("panel-container");
        expect(result[0]?.panelPosition).toBe("left");
    });

    it("应过滤缺少 commandId 的 callback 定义", () => {
        const result = parseCustomActivitiesConfig({
            customActivities: {
                items: [{
                    id: "custom-2",
                    name: "My Callback",
                    iconKey: "search",
                    kind: "callback",
                }],
            },
        });

        expect(result).toHaveLength(0);
    });

    it("应创建规范化的新定义", () => {
        const result = createCustomActivityDefinition({
            name: "  My Action  ",
            iconKey: "zap",
            kind: "callback",
            commandId: "commandPalette.open",
        }, 1004);

        expect(result.name).toBe("My Action");
        expect(result.kind).toBe("callback");
        expect(result.commandId).toBe("commandPalette.open");
        expect(result.defaultOrder).toBe(1004);
        expect(result.id.startsWith("custom-my-action-")).toBe(true);
    });

    it("应删除指定的自定义 activity 定义", () => {
        const result = removeCustomActivityFromEntries({
            customActivities: {
                items: [
                    {
                        id: "custom-1",
                        name: "My Panel",
                        iconKey: "calendar",
                        kind: "panel-container",
                        defaultOrder: 1000,
                    },
                    {
                        id: "custom-2",
                        name: "My Callback",
                        iconKey: "zap",
                        kind: "callback",
                        commandId: "commandPalette.open",
                        defaultOrder: 1001,
                    },
                ],
            },
        }, "custom-1");

        expect(parseCustomActivitiesConfig(result)).toEqual([
            {
                id: "custom-2",
                name: "My Callback",
                iconKey: "zap",
                kind: "callback",
                commandId: "commandPalette.open",
                defaultBar: "left",
                defaultSection: "top",
                defaultOrder: 1001,
                panelPosition: "left",
            },
        ]);
    });

    it("应同时清理 activityBar 与 sidebarLayout 中对已删除容器的引用", () => {
        const result = removeCustomActivityFromEntries({
            customActivities: {
                items: [
                    {
                        id: "custom-calendar",
                        name: "Calendar Container",
                        iconKey: "calendar",
                        kind: "panel-container",
                        defaultOrder: 1000,
                    },
                ],
            },
            activityBar: {
                items: [
                    {
                        id: "custom-activity:custom-calendar",
                        section: "top",
                        visible: true,
                        bar: "right",
                    },
                    {
                        id: "calendar",
                        section: "top",
                        visible: true,
                        bar: "left",
                    },
                ],
            },
            sidebarLayout: {
                left: {
                    width: 280,
                    visible: true,
                    activeActivityId: null,
                    activePanelId: null,
                },
                right: {
                    width: 260,
                    visible: true,
                    activeActivityId: "custom-activity:custom-calendar",
                    activePanelId: null,
                },
                panelStates: [
                    {
                        id: "custom-panel:custom-calendar",
                        position: "right",
                        order: 0,
                        activityId: "custom-activity:custom-calendar",
                    },
                    {
                        id: "calendar-panel",
                        position: "right",
                        order: 1,
                        activityId: "custom-activity:custom-calendar",
                    },
                ],
                paneStates: [
                    {
                        id: "custom-panel:custom-calendar",
                        size: 220,
                        expanded: true,
                    },
                ],
                convertiblePanelStates: [],
            },
        }, "custom-calendar", [
            {
                id: "calendar-panel",
                activityId: "calendar",
                position: "right",
                order: 1,
            },
        ]);

        expect(result.activityBar).toEqual({
            items: [
                {
                    id: "calendar",
                    section: "top",
                    visible: true,
                    bar: "left",
                },
            ],
        });
        expect(result.sidebarLayout).toEqual({
            version: 1,
            left: {
                width: 280,
                visible: true,
                activeActivityId: null,
                activePanelId: null,
            },
            right: {
                width: 260,
                visible: true,
                activeActivityId: null,
                activePanelId: null,
            },
            panelStates: [
                {
                    id: "calendar-panel",
                    position: "right",
                    order: 1,
                    activityId: "calendar",
                },
            ],
            paneStates: [],
            convertiblePanelStates: [],
        });
    });
});