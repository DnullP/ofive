/**
 * @module plugins/architecture-devtools/architectureDevtoolsPlugin
 * @description 架构可视化 DevTools 插件：向 activity bar 注册入口，
 *   并向主区注册架构可视化 tab。
 *
 *   该插件同时注册内置架构 slice，使未来外部插件可以继续通过
 *   architectureRegistry 增量扩展架构图。
 *
 * @dependencies
 *   - lucide-react
 *   - ../../host/commands/commandSystem
 *   - ../../host/registry/activityRegistry
 *   - ../../host/registry/tabComponentRegistry
 *   - ./architectureRegistry
 *   - ./architectureDiscovery
 *   - ./ArchitectureDevtoolsTab
 *   - ../../i18n
 *
 * @exports
 *   - activatePlugin 注册并返回清理函数
 */

import { Workflow } from "lucide-react";
import i18n from "../../i18n";
import { registerCommand } from "../../host/commands/commandSystem";
import { registerActivity } from "../../host/registry/activityRegistry";
import { registerTabComponent } from "../../host/registry/tabComponentRegistry";
import { ArchitectureDevtoolsTab } from "./ArchitectureDevtoolsTab";
import { createAutoDiscoveredArchitectureSlice } from "./architectureDiscovery";
import { registerArchitectureSlice } from "./architectureRegistry";

const ARCHITECTURE_TAB_ID = "architecture-devtools";
const OPEN_ARCHITECTURE_DEVTOOLS_COMMAND_ID = "architectureDevtools.open";

/**
 * @function activatePlugin
 * @description 注册架构 DevTools 的架构切片、命令、活动与 Tab 组件。
 * @returns 插件清理函数。
 */
export function activatePlugin(): () => void {
    const unregisterArchitectureSlice = registerArchitectureSlice(
        createAutoDiscoveredArchitectureSlice(),
    );

    const unregisterCommand = registerCommand({
        id: OPEN_ARCHITECTURE_DEVTOOLS_COMMAND_ID,
        title: "architectureDevtools.openCommand",
        execute: (context) => {
            if (!context.openTab) {
                console.warn("[architectureDevtoolsPlugin] open command skipped: openTab missing");
                return;
            }

            context.openTab({
                id: ARCHITECTURE_TAB_ID,
                title: i18n.t("architectureDevtools.title"),
                component: ARCHITECTURE_TAB_ID,
            });
        },
    });

    const unregisterTabComponent = registerTabComponent({
        id: ARCHITECTURE_TAB_ID,
        component: ArchitectureDevtoolsTab,
    });

    const unregisterActivity = registerActivity({
        type: "callback",
        id: ARCHITECTURE_TAB_ID,
        title: () => i18n.t("architectureDevtools.title"),
        icon: <Workflow size={18} strokeWidth={1.8} />,
        defaultSection: "top",
        defaultBar: "left",
        defaultOrder: 5,
        onActivate: (context) => {
            context.openTab({
                id: ARCHITECTURE_TAB_ID,
                title: i18n.t("architectureDevtools.title"),
                component: ARCHITECTURE_TAB_ID,
            });
        },
    });

    console.info("[architectureDevtoolsPlugin] registered architecture devtools plugin");

    return () => {
        unregisterActivity();
        unregisterTabComponent();
        unregisterCommand();
        unregisterArchitectureSlice();
        console.info("[architectureDevtoolsPlugin] unregistered architecture devtools plugin");
    };
}