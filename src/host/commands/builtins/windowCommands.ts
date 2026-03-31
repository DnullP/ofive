/**
 * @module host/commands/builtins/windowCommands
 * @description 内置窗口级命令：标签页关闭、应用退出与侧边栏切换。
 * @dependencies
 *  - ../commandTypes
 *
 * @example
 *   WINDOW_COMMAND_DEFINITIONS["tab.closeFocused"].execute(context);
 *
 * @exports
 *   - WINDOW_COMMAND_DEFINITIONS 窗口级内置命令集合
 */

import type { CommandDefinition } from "../commandTypes";

/**
 * @constant WINDOW_COMMAND_DEFINITIONS
 * @description 窗口级内置命令集合。
 */
export const WINDOW_COMMAND_DEFINITIONS = {
    "tab.closeFocused": {
        id: "tab.closeFocused",
        title: "commands.closeCurrentTab",
        routeClass: "frontend-window",
        shortcut: {
            defaultBinding: "Ctrl+W",
            editableInSettings: true,
            bindingPolicy: "prefer-system-reserved",
        },
        execute(context) {
            if (!context.activeTabId) {
                console.warn("[command-system] closeFocused skipped: no active tab");
                return;
            }
            context.closeTab(context.activeTabId);
        },
    },
    "app.quit": {
        id: "app.quit",
        title: "commands.exitApp",
        routeClass: "native-reserved",
        shortcut: {
            defaultBinding: "Cmd+Q",
            editableInSettings: false,
            bindingPolicy: "system-reserved",
        },
        execute(context) {
            if (!context.quitApplication) {
                console.warn("[command-system] app.quit skipped: quit capability missing");
                return;
            }

            const result = context.quitApplication();
            if (result instanceof Promise) {
                void result.catch((error) => {
                    console.error("[command-system] app.quit failed", {
                        error: error instanceof Error ? error.message : String(error),
                    });
                });
            }
        },
    },
    "sidebar.left.toggle": {
        id: "sidebar.left.toggle",
        title: "commands.toggleLeftSidebar",
        shortcut: {
            defaultBinding: "Cmd+Shift+J",
            editableInSettings: true,
        },
        execute(context) {
            if (!context.toggleLeftSidebarVisibility) {
                console.warn("[command-system] sidebar.left.toggle skipped: toggle capability missing");
                return;
            }

            context.toggleLeftSidebarVisibility();
        },
    },
    "sidebar.right.toggle": {
        id: "sidebar.right.toggle",
        title: "commands.toggleRightSidebar",
        shortcut: {
            defaultBinding: "Cmd+Shift+K",
            editableInSettings: true,
        },
        execute(context) {
            if (!context.toggleRightSidebarVisibility) {
                console.warn("[command-system] sidebar.right.toggle skipped: toggle capability missing");
                return;
            }

            context.toggleRightSidebarVisibility();
        },
    },
} satisfies Record<string, CommandDefinition>;