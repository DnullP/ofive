/**
 * @module plugins/quick-switcher/quickSwitcherPlugin
 * @description Quick Switcher 插件：注册全局打开命令与 overlay 渲染入口。
 *   该插件负责：
 *   - 注册 `quickSwitcher.open` 命令
 *   - 注册 Quick Switcher overlay
 *   - 提供跨模块打开 Quick Switcher 的事件桥接
 *
 * @dependencies
 *   - ../../host/commands/commandSystem
 *   - ../../host/registry
 *   - ./quickSwitcherEvents
 *   - ./overlay/QuickSwitcherOverlay
 *
 * @exports
 *   - activatePlugin 注册并返回清理函数
 */

import React from "react";
import { registerCommands } from "../../host/commands/commandSystem";
import { registerOverlay } from "../../host/registry";
import { QuickSwitcherOverlay } from "./overlay/QuickSwitcherOverlay";
import { notifyQuickSwitcherOpenRequested } from "./quickSwitcherEvents";

const QUICK_SWITCHER_COMMAND_ID = "quickSwitcher.open";
const OPEN_NOTE_IN_NEW_TAB_COMMAND_ID = "note.openInNewTab";
const QUICK_SWITCHER_OVERLAY_ID = "quick-switcher";

/**
 * @function activatePlugin
 * @description 注册 Quick Switcher 插件所需的命令与 overlay。
 * @returns 插件清理函数。
 */
export function activatePlugin(): () => void {
    const unregisterCommands = registerCommands([
        {
            id: QUICK_SWITCHER_COMMAND_ID,
            title: "commands.quickSwitcher",
            shortcut: {
                defaultBinding: "Cmd+O",
                editableInSettings: true,
            },
            execute() {
                notifyQuickSwitcherOpenRequested();
                console.info("[quick-switcher-plugin] quick switcher opened by command");
            },
        },
        {
            id: OPEN_NOTE_IN_NEW_TAB_COMMAND_ID,
            title: "commands.openNoteInNewTab",
            shortcut: {
                defaultBinding: "Cmd+Shift+N",
                editableInSettings: true,
            },
            execute() {
                notifyQuickSwitcherOpenRequested({ openMode: "new-tab" });
                console.info("[quick-switcher-plugin] open note in new tab requested by command");
            },
        },
    ]);

    const unregisterOverlay = registerOverlay({
        id: QUICK_SWITCHER_OVERLAY_ID,
        order: 20,
        render: (context) => React.createElement(QuickSwitcherOverlay, { context }),
    });

    console.info("[quick-switcher-plugin] registered quick switcher plugin");

    return () => {
        unregisterOverlay();
        unregisterCommands();
        console.info("[quick-switcher-plugin] unregistered quick switcher plugin");
    };
}
