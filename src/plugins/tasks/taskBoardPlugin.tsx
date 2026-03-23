/**
 * @module plugins/tasks/taskBoardPlugin
 * @description 任务看板插件：注册任务 activity icon、打开命令和看板 tab 组件。
 * @dependencies
 *  - react
 *  - lucide-react
 *  - ../../host/commands/commandSystem
 *  - ../../host/registry/activityRegistry
 *  - ../../host/registry/tabComponentRegistry
 *  - ../../i18n
 *  - ../../task-board/TaskBoardTab
 *
 * @exports
 *  - activatePlugin
 */

import React from "react";
import { CheckSquare } from "lucide-react";
import i18n from "../../i18n";
import { registerCommand } from "../../host/commands/commandSystem";
import { registerActivity } from "../../host/registry/activityRegistry";
import { registerTabComponent } from "../../host/registry/tabComponentRegistry";
import { TaskBoardTab } from "../../task-board/TaskBoardTab";

const TASK_BOARD_TAB_ID = "task-board-tab";
const TASK_BOARD_ACTIVITY_ID = "task-board";
const TASK_BOARD_COMMAND_ID = "taskBoard.open";

/**
 * @function openTaskBoardTab
 * @description 统一打开任务看板 tab，供命令和 activity icon 复用。
 * @param openTab 宿主打开 tab 的能力。
 */
function openTaskBoardTab(
    openTab: ((tab: { id: string; title: string; component: string }) => void) | undefined,
): void {
    if (!openTab) {
        console.warn("[taskBoardPlugin] open skipped: openTab missing");
        return;
    }

    openTab({
        id: TASK_BOARD_ACTIVITY_ID,
        title: i18n.t("taskBoard.title"),
        component: TASK_BOARD_TAB_ID,
    });
}

/**
 * @function activatePlugin
 * @description 注册任务看板插件，并返回清理函数。
 * @returns 插件清理函数。
 */
export function activatePlugin(): () => void {
    const unregisterCommand = registerCommand({
        id: TASK_BOARD_COMMAND_ID,
        title: "taskBoard.title",
        execute: (context) => {
            openTaskBoardTab(context.openTab);
        },
    });

    const unregisterTabComponent = registerTabComponent({
        id: TASK_BOARD_TAB_ID,
        component: TaskBoardTab,
        lifecycleScope: "vault",
    });

    const unregisterActivity = registerActivity({
        type: "callback",
        id: TASK_BOARD_ACTIVITY_ID,
        title: () => i18n.t("taskBoard.title"),
        icon: React.createElement(CheckSquare, { size: 18, strokeWidth: 1.8 }),
        defaultSection: "top",
        defaultBar: "left",
        defaultOrder: 6,
        onActivate: (context) => {
            openTaskBoardTab(context.openTab);
        },
    });

    console.info("[taskBoardPlugin] registered task board plugin");

    return () => {
        unregisterActivity();
        unregisterTabComponent();
        unregisterCommand();
        console.info("[taskBoardPlugin] unregistered task board plugin");
    };
}