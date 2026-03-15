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
 * @exports 无导出（纯副作用模块）
 */

import React from "react";
import { registerCommand } from "../../host/commands/commandSystem";
import { registerOverlay } from "../../host/registry";
import { notifyCommandPaletteOpenRequested } from "./commandPaletteEvents";
import { CommandPaletteOverlay } from "./overlay/CommandPaletteOverlay";

const COMMAND_PALETTE_COMMAND_ID = "commandPalette.open";
const COMMAND_PALETTE_OVERLAY_ID = "command-palette";

registerCommand({
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

registerOverlay({
    id: COMMAND_PALETTE_OVERLAY_ID,
    order: 10,
    render: (context) => React.createElement(CommandPaletteOverlay, { context }),
});

console.info("[command-palette-plugin] registered command palette plugin");