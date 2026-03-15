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
 * @exports 无导出（纯副作用模块）
 */

import React from "react";
import { registerCommand } from "../../host/commands/commandSystem";
import { registerOverlay } from "../../host/registry";
import { QuickSwitcherOverlay } from "./overlay/QuickSwitcherOverlay";
import { notifyQuickSwitcherOpenRequested } from "./quickSwitcherEvents";

const QUICK_SWITCHER_COMMAND_ID = "quickSwitcher.open";
const QUICK_SWITCHER_OVERLAY_ID = "quick-switcher";

registerCommand({
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
});

registerOverlay({
    id: QUICK_SWITCHER_OVERLAY_ID,
    order: 20,
    render: (context) => React.createElement(QuickSwitcherOverlay, { context }),
});

console.info("[quick-switcher-plugin] registered quick switcher plugin");