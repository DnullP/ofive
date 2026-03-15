/**
 * @module plugins/command-palette/commandPalettePlugin
 * @description Command Palette 插件：注册全局打开命令与 overlay 渲染入口。
 * @dependencies
 *   - react
 *   - ../../host/commands/commandSystem
 *   - ../../host/registry
 *   - ./commandPaletteEvents
 *   - ./overlay/CommandPaletteOverlay
 *
 * @exports
 *   - activatePlugin 注册并返回清理函数
 */

import React from "react";
import { registerCommand } from "../../host/commands/commandSystem";
import { registerOverlay } from "../../host/registry";
import { notifyCommandPaletteOpenRequested } from "./commandPaletteEvents";
import { CommandPaletteOverlay } from "./overlay/CommandPaletteOverlay";

const COMMAND_PALETTE_COMMAND_ID = "commandPalette.open";
const COMMAND_PALETTE_OVERLAY_ID = "command-palette";

/**
 * @function activatePlugin
 * @description 注册 Command Palette 插件所需的命令与 overlay。
 * @returns 插件清理函数。
 */
export function activatePlugin(): () => void {
    const unregisterCommand = registerCommand({
        id: COMMAND_PALETTE_COMMAND_ID,
        title: "commands.commandPalette",
        shortcut: {
            defaultBinding: "Cmd+J",
            editableInSettings: true,
        },
        execute() {
            notifyCommandPaletteOpenRequested();
            console.info("[command-palette-plugin] command palette opened by command");
        },
    });

    const unregisterOverlay = registerOverlay({
        id: COMMAND_PALETTE_OVERLAY_ID,
        order: 10,
        render: (context) => React.createElement(CommandPaletteOverlay, { context }),
    });

    console.info("[command-palette-plugin] registered command palette plugin");

    return () => {
        unregisterOverlay();
        unregisterCommand();
        console.info("[command-palette-plugin] unregistered command palette plugin");
    };
}