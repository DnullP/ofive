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
 *  - ../../host/commands/commandSystem
 *  - ./TaskBoardTab
 *  - ./taskBoardPluginRuntime
 *
 * @exports
 *  - activatePlugin
 */

import { registerCommand } from "../../host/commands/commandSystem";
import { TaskBoardTab } from "./TaskBoardTab";
import { activateTaskBoardPluginRuntime } from "./taskBoardPluginRuntime";

/**
 * @function activatePlugin
 * @description 注册任务看板插件，并返回清理函数。
 * @returns 插件清理函数。
 */
export function activatePlugin(): () => void {
    return activateTaskBoardPluginRuntime(TaskBoardTab, {
        registerCommand,
    });
}