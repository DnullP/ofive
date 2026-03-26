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

i18n.addResourceBundle("en", "translation", {
    architectureDevtools: {
        kicker: "Architecture Center",
        title: "Architecture DevTools",
        description:
            "Inspect the current plugin surface, state stores, events and backend interfaces in one place.",
        plugins: "Plugins",
        modules: "Modules",
        infrastructureModules: "Infrastructure Modules",
        pluginLogicModules: "Plugin Logic Modules",
        states: "States",
        events: "Events",
        frontendApis: "Frontend APIs",
        backendModules: "Backend Modules",
        backendSurfaces: "Backend Public Surfaces",
        backendBoundaries: "Backend Private Boundaries",
        backendApis: "Backend APIs",
        backendEvents: "Backend Events",
        runtimeExtensions: "Runtime Extensions",
        activities: "Activities",
        panels: "Panels",
        tabs: "Tab Components",
        dagTitle: "Dependency DAG",
        inspector: "Inspector",
        relatedEdges: "Related edges ({{count}})",
        emptySelection: "Select a node in the graph or inventory to inspect it.",
        searchPlaceholder: "Search root nodes, files or details",
        allKinds: "All",
        visibleNodes: "Showing {{visible}} / {{total}} nodes",
        treeMode: "Traversal",
        dependencyTree: "Dependencies",
        dependentTree: "Dependents",
        neighborGraph: "Both Ways",
        treeSummary: "Roots {{matched}} · Expanded {{visible}} / {{total}} nodes",
        viewNodeDependencyTree: "View this node dependency tree",
        inventoryTitle: "Architecture Inventory",
        runtimeSurfaceTitle: "Runtime Surface",
        runtimeSurfaceDescription: "Currently registered activity, panel and tab extensions.",
        noMatches: "No architecture nodes match the current filter.",
        openCommand: "Open Architecture DevTools",
    },
}, true, true);

i18n.addResourceBundle("zh", "translation", {
    architectureDevtools: {
        kicker: "Architecture Center",
        title: "架构 DevTools",
        description:
            "集中查看当前插件注册面、前端状态、事件总线和后端接口依赖关系。",
        plugins: "插件",
        modules: "模块",
        infrastructureModules: "基础设施模块",
        pluginLogicModules: "插件逻辑模块",
        states: "状态",
        events: "事件",
        frontendApis: "前端接口",
        backendModules: "后端模块",
        backendSurfaces: "后端公共依赖面",
        backendBoundaries: "后端私有边界",
        backendApis: "后端接口",
        backendEvents: "后端事件",
        runtimeExtensions: "运行时扩展面",
        activities: "Activity",
        panels: "Panel",
        tabs: "Tab 组件",
        dagTitle: "依赖 DAG",
        inspector: "检查器",
        relatedEdges: "关联边（{{count}}）",
        emptySelection: "从 DAG 或下方清单中选择一个节点以查看详情。",
        searchPlaceholder: "搜索根节点、源码位置或细节",
        allKinds: "全部",
        visibleNodes: "显示 {{visible}} / {{total}} 个节点",
        treeMode: "遍历方式",
        dependencyTree: "下游依赖树",
        dependentTree: "上游被依赖树",
        neighborGraph: "双向关系",
        treeSummary: "根节点 {{matched}} 个 · 展开 {{visible}} / {{total}} 个节点",
        viewNodeDependencyTree: "查看此节点下游依赖树",
        inventoryTitle: "架构清单",
        runtimeSurfaceTitle: "运行时注册面",
        runtimeSurfaceDescription: "当前已注册的 Activity、Panel 和 Tab 扩展。",
        noMatches: "当前过滤条件下没有匹配的架构节点。",
        openCommand: "打开架构 DevTools",
    },
}, true, true);

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