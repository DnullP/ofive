/**
 * @module plugins/calendar/calendarPlugin
 * @description 日历插件：注册 activity icon、命令和日历 tab 组件。
 *   点击 activity icon 或执行命令都会直接打开日历 tab。
 * @dependencies
 *  - react
 *  - lucide-react
 *  - ../../host/commands/commandSystem
 *  - ../../host/registry/activityRegistry
 *  - ../../host/registry/panelRegistry
 *  - ../../host/registry/tabComponentRegistry
 *  - ../../host/registry/convertibleViewRegistry
 *  - ../../i18n
 *  - ./CalendarTab
 *  - ./CalendarPanel
 *
 * @exports
 *  - activatePlugin
 */

import React from "react";
import { CalendarDays } from "lucide-react";
import i18n from "../../i18n";
import { registerCommand } from "../../host/commands/commandSystem";
import { registerActivity } from "../../host/registry/activityRegistry";
import { registerPanel } from "../../host/registry/panelRegistry";
import { registerTabComponent } from "../../host/registry/tabComponentRegistry";
import {
    buildConvertibleViewTabParams,
    registerConvertibleView,
} from "../../host/registry";
import { CalendarTab } from "./CalendarTab";
import { CalendarPanel } from "./CalendarPanel";

const CALENDAR_TAB_COMPONENT_ID = "calendar-tab";
const CALENDAR_PANEL_ID = "calendar-panel";
const CALENDAR_CONVERTIBLE_ID = "calendar";
const CALENDAR_ACTIVITY_ID = "calendar";
const CALENDAR_COMMAND_ID = "calendar.open";

/**
 * @function openCalendarTab
 * @description 统一打开日历 tab，供命令与 activity icon 复用。
 * @param openTab 宿主打开 tab 能力。
 */
function openCalendarTab(
    openTab: ((tab: { id: string; title: string; component: string; params?: Record<string, unknown> }) => void) | undefined,
): void {
    if (!openTab) {
        console.warn("[calendarPlugin] open skipped: openTab missing");
        return;
    }

    openTab({
        id: CALENDAR_ACTIVITY_ID,
        title: i18n.t("app.calendar"),
        component: CALENDAR_TAB_COMPONENT_ID,
        params: buildConvertibleViewTabParams({
            descriptorId: CALENDAR_CONVERTIBLE_ID,
            stateKey: CALENDAR_CONVERTIBLE_ID,
        }),
    });
}

/**
 * @function activatePlugin
 * @description 注册日历插件的命令、activity icon 和 tab 组件。
 * @returns 清理函数。
 */
export function activatePlugin(): () => void {
    const unregisterCommand = registerCommand({
        id: CALENDAR_COMMAND_ID,
        title: "calendar.openCommand",
        execute: (context) => {
            openCalendarTab(context.openTab);
        },
    });

    const unregisterTabComponent = registerTabComponent({
        id: CALENDAR_TAB_COMPONENT_ID,
        component: CalendarTab,
    });

    const unregisterPanel = registerPanel({
        id: CALENDAR_PANEL_ID,
        title: () => i18n.t("app.calendar"),
        activityId: CALENDAR_ACTIVITY_ID,
        defaultPosition: "right",
        defaultOrder: 2,
        render: (context) => React.createElement(CalendarPanel, context),
    });

    const unregisterConvertibleView = registerConvertibleView({
        id: CALENDAR_CONVERTIBLE_ID,
        tabComponentId: CALENDAR_TAB_COMPONENT_ID,
        panelId: CALENDAR_PANEL_ID,
        defaultMode: "tab",
        buildTabInstance: ({ stateKey, params }) => ({
            id: CALENDAR_ACTIVITY_ID,
            title: i18n.t("app.calendar"),
            component: CALENDAR_TAB_COMPONENT_ID,
            params: buildConvertibleViewTabParams({
                descriptorId: CALENDAR_CONVERTIBLE_ID,
                stateKey,
            }, params),
        }),
    });

    const unregisterActivity = registerActivity({
        type: "callback",
        id: CALENDAR_ACTIVITY_ID,
        title: () => i18n.t("app.calendar"),
        icon: React.createElement(CalendarDays, { size: 18, strokeWidth: 1.8 }),
        defaultSection: "top",
        defaultBar: "left",
        defaultOrder: 4,
        onActivate: (context) => {
            openCalendarTab(context.openTab);
        },
    });

    console.info("[calendarPlugin] registered calendar plugin");

    return () => {
        unregisterActivity();
        unregisterConvertibleView();
        unregisterPanel();
        unregisterTabComponent();
        unregisterCommand();
        console.info("[calendarPlugin] unregistered calendar plugin");
    };
}