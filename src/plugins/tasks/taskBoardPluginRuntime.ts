/**
 * @module plugins/tasks/taskBoardPluginRuntime
 * @description 任务看板插件运行时：负责注册任务看板的命令、activity 和 tab 组件。
 * @dependencies
 *  - react
 *  - lucide-react
 *  - ../../host/registry/activityRegistry
 *  - ../../host/registry/tabComponentRegistry
 *  - ../../i18n
 *
 * @exports
 *  - activateTaskBoardPluginRuntime
 */

import React from "react";
import { CheckSquare } from "lucide-react";
import type { ReactNode } from "react";
import type { IDockviewPanelProps } from "dockview";
import i18n from "../../i18n";
import type { CommandDefinition } from "../../host/commands/commandSystem";
import { registerActivity } from "../../host/registry/activityRegistry";
import { registerTabComponent } from "../../host/registry/tabComponentRegistry";

const TASK_BOARD_TAB_ID = "task-board-tab";
const TASK_BOARD_ACTIVITY_ID = "task-board";
const TASK_BOARD_COMMAND_ID = "taskBoard.open";

/**
 * @type TaskBoardTabComponent
 * @description 任务看板 Tab 组件类型。
 */
export type TaskBoardTabComponent = (
    props: IDockviewPanelProps<Record<string, unknown>>,
) => ReactNode;

/**
 * @interface TaskBoardPluginRuntimeDependencies
 * @description 任务看板插件运行时依赖。
 * @field registerCommand 命令注册函数。
 */
export interface TaskBoardPluginRuntimeDependencies {
    /** 命令注册函数。 */
    registerCommand: (definition: CommandDefinition) => () => void;
}

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
 * @function activateTaskBoardPluginRuntime
 * @description 使用给定的任务看板组件注册插件运行时。
 * @param taskBoardComponent 任务看板 tab 组件。
 * @returns 插件清理函数。
 */
export function activateTaskBoardPluginRuntime(
    taskBoardComponent: TaskBoardTabComponent,
    dependencies: TaskBoardPluginRuntimeDependencies,
): () => void {
    const unregisterCommand = dependencies.registerCommand({
        id: TASK_BOARD_COMMAND_ID,
        title: "taskBoard.title",
        execute: (context) => {
            openTaskBoardTab(context.openTab);
        },
    });

    const unregisterTabComponent = registerTabComponent({
        id: TASK_BOARD_TAB_ID,
        component: taskBoardComponent,
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