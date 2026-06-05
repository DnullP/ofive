import { memo, useMemo, type MutableRefObject, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Settings } from "lucide-react";
import {
    type WorkbenchActivityDefinition,
    type WorkbenchApi,
    type WorkbenchPanelContext,
    type WorkbenchPanelDefinition,
    type WorkbenchTabDefinition,
} from "layout-v2";
import i18n from "../../i18n";
import {
    executeCommand,
    type CommandContext,
    type CommandId,
} from "../commands/commandSystem";
import type { FileOpenMode } from "../config/configStore";
import {
    type ActivityDescriptor,
    type PanelDescriptor,
    resolveActivityTitle,
    resolveTitle,
} from "../registry";
import {
    SETTINGS_ACTIVITY_ID,
    type DefaultActivityItemInfo,
} from "./activityBarStore";
import {
    TAB_NAVIGATION_HISTORY_PARAM,
    normalizeRelativePath,
    type TabNavigationHistoryState,
} from "./openFileService";
import type {
    PanelRenderContext,
    TabInstanceDefinition,
    WorkbenchContainerApi,
    WorkbenchTabProps,
} from "./workbenchContracts";

export type DecorateWorkbenchTabDefinition = (tab: WorkbenchTabDefinition) => WorkbenchTabDefinition;

export interface ActivityBarRuntimeItem {
    id: string;
    section: "top" | "bottom";
    visible: boolean;
    bar: "left" | "right";
}

export interface OpenFileHelperOptions {
    relativePath: string;
    contentOverride?: string;
    preferredOpenerId?: string;
    tabParams?: Record<string, unknown>;
    openMode?: FileOpenMode;
}

export type OpenFileHelper = (options: OpenFileHelperOptions) => Promise<void>;

export function buildActivityDefaults(activities: ActivityDescriptor[]): DefaultActivityItemInfo[] {
    const defaults = activities.map((activity) => ({
        id: activity.id,
        section: activity.defaultSection,
        bar: activity.defaultBar,
    }));

    defaults.push({
        id: SETTINGS_ACTIVITY_ID,
        section: "bottom",
        bar: "left",
    });

    return defaults;
}

export function mapActivitiesToDefinitions(
    activities: ActivityDescriptor[],
    mergedItems: ActivityBarRuntimeItem[],
): WorkbenchActivityDefinition[] {
    const activitiesById = new Map(activities.map((activity) => [activity.id, activity]));

    return mergedItems
        .filter((item) => item.visible)
        .map((item) => {
            if (item.id === SETTINGS_ACTIVITY_ID) {
                return {
                    id: SETTINGS_ACTIVITY_ID,
                    label: i18n.t("workbenchLayout.settingsTooltip"),
                    bar: item.bar,
                    section: item.section,
                    activationMode: "action" as const,
                    icon: <Settings size={18} strokeWidth={1.8} />,
                };
            }

            const activity = activitiesById.get(item.id);
            return {
                id: item.id,
                label: activity ? resolveActivityTitle(activity.title) : item.id,
                bar: item.bar,
                section: item.section,
                activationMode: activity?.type === "callback" ? "action" as const : "focus" as const,
                icon: activity?.icon,
            };
        });
}

export function mapPanelsToDefinitions(panels: PanelDescriptor[]): WorkbenchPanelDefinition[] {
    return panels.map((panel) => ({
        id: panel.id,
        label: resolveTitle(panel.title),
        icon: panel.icon,
        activityId: panel.activityId,
        position: panel.defaultPosition,
        order: panel.defaultOrder,
    }));
}

function readTabNavigationHistory(params: Record<string, unknown>): TabNavigationHistoryState | null {
    const raw = params[TAB_NAVIGATION_HISTORY_PARAM];
    if (!raw || typeof raw !== "object") {
        return null;
    }

    const state = raw as { entries?: unknown; index?: unknown };
    if (!Array.isArray(state.entries) || typeof state.index !== "number") {
        return null;
    }

    const entries = state.entries.filter((entry) => {
        if (!entry || typeof entry !== "object") {
            return false;
        }

        const candidate = entry as { id?: unknown; title?: unknown; component?: unknown };
        return typeof candidate.id === "string" &&
            typeof candidate.title === "string" &&
            typeof candidate.component === "string";
    }) as TabNavigationHistoryState["entries"];

    if (entries.length === 0) {
        return null;
    }

    return {
        entries,
        index: Math.min(Math.max(Math.trunc(state.index), 0), entries.length - 1),
    };
}

function attachTabNavigationHistory(
    tab: WorkbenchTabDefinition,
    history: TabNavigationHistoryState,
): WorkbenchTabDefinition {
    return {
        ...tab,
        params: {
            ...(tab.params ?? {}),
            [TAB_NAVIGATION_HISTORY_PARAM]: history,
        },
    };
}

export function mapInitialTabs(
    initialTabs: TabInstanceDefinition[] | undefined,
    decorateTabDefinition: DecorateWorkbenchTabDefinition,
): WorkbenchTabDefinition[] | undefined {
    if (!initialTabs || initialTabs.length === 0) return undefined;
    const tabs = initialTabs.filter((tab) => tab.component !== "home");
    if (tabs.length === 0) return undefined;
    return tabs.map((tab) => decorateTabDefinition({
        id: tab.id,
        title: tab.title,
        component: tab.component,
        params: tab.params,
    }));
}

export function countInitialWorkbenchTabs(initialTabs: TabInstanceDefinition[] | undefined): number {
    return initialTabs?.filter((tab) => tab.component !== "home").length ?? 0;
}

export function createWorkbenchContainerApi(
    workbenchApi: WorkbenchApi,
    getActivePanelId: () => string | null,
    decorateTabDefinition: DecorateWorkbenchTabDefinition,
): WorkbenchContainerApi {
    const buildPanelHandle = (tabId: string) => {
        const tab = workbenchApi.getTab(tabId);
        if (!tab) return null;
        return {
            id: tab.id,
            title: tab.title,
            component: tab.component,
            params: tab.params,
            api: {
                close: () => workbenchApi.closeTab(tab.id),
                setActive: () => workbenchApi.setActiveTab(tab.id),
                setTitle: (title: string) => workbenchApi.updateTab(tab.id, { title }),
                updateParameters: (params: Record<string, unknown>) => {
                    workbenchApi.updateTab(tab.id, { params });
                },
            },
        };
    };

    return {
        get activePanelId() {
            return getActivePanelId();
        },
        getPanel: buildPanelHandle,
        get panels() {
            return workbenchApi.getTabs().map((tab) => ({
                id: tab.id,
                title: tab.title,
                component: tab.component,
                params: tab.params,
                api: {
                    close: () => workbenchApi.closeTab(tab.id),
                    setActive: () => workbenchApi.setActiveTab(tab.id),
                    setTitle: (title: string) => workbenchApi.updateTab(tab.id, { title }),
                    updateParameters: (params: Record<string, unknown>) => {
                        workbenchApi.updateTab(tab.id, { params });
                    },
                },
            }));
        },
        addPanel: (options) => {
            workbenchApi.openTab(decorateTabDefinition({
                id: options.id,
                title: options.title,
                component: options.component,
                params: options.params,
            }));
        },
        replacePanel: (panelId, options) => {
            workbenchApi.updateTab(panelId, decorateTabDefinition({
                id: options.id,
                title: options.title,
                component: options.component,
                params: options.params,
            }));
            workbenchApi.setActiveTab(options.id);
        },
    };
}

export function closeWorkbenchFileTabsByPath(workbenchApi: WorkbenchApi | null, relativePath: string): void {
    if (!workbenchApi) {
        return;
    }

    const targetPath = normalizeRelativePath(relativePath);
    workbenchApi.getTabs()
        .filter((tab) => normalizeRelativePath(String(tab.params?.path ?? "")) === targetPath)
        .forEach((tab) => {
            workbenchApi.closeTab(tab.id);
        });
}

export function buildPanelRenderContext(
    workbenchContext: WorkbenchPanelContext,
    workbenchApiRef: MutableRefObject<WorkbenchApi | null>,
    openFileHelper: OpenFileHelper,
    buildCommandContext: () => CommandContext,
    decorateTabDefinition: DecorateWorkbenchTabDefinition,
): PanelRenderContext {
    const workbenchApi = workbenchApiRef.current;
    const workbenchContainerApi = workbenchApi
        ? createWorkbenchContainerApi(workbenchApi, () => workbenchContext.activeTabId, decorateTabDefinition)
        : null;

    return {
        activeTabId: workbenchContext.activeTabId,
        workbenchApi: workbenchContainerApi,
        hostPanelId: workbenchContext.hostPanelId,
        convertibleView: null,
        openTab: (tab: TabInstanceDefinition) => {
            workbenchContext.openTab(decorateTabDefinition({
                id: tab.id,
                title: tab.title,
                component: tab.component,
                params: tab.params,
            }));
        },
        openFile: openFileHelper,
        closeTab: workbenchContext.closeTab,
        closeFileTabsByPath: (relativePath) => {
            closeWorkbenchFileTabsByPath(workbenchApi, relativePath);
        },
        setActiveTab: workbenchContext.setActiveTab,
        activatePanel: workbenchContext.activatePanel,
        markContentReady: workbenchContext.markContentReady,
        executeCommand: (commandId) => {
            executeCommand(commandId as CommandId, buildCommandContext());
        },
        requestMoveFileToDirectory: (relativePath) => {
            console.warn("[workbenchLayoutHost] requestMoveFileToDirectory is not wired for layout-v2 yet", { relativePath });
        },
    };
}

export const StableTabComponentWrapper = memo(function StableTabComponentWrapper(props: {
    Component: (props: Record<string, unknown>) => ReactNode;
    params: Record<string, unknown>;
    api: { id: string; close: () => void; setActive: () => void; markContentReady?: () => void };
    workbenchApiRef: MutableRefObject<WorkbenchApi | null>;
    decorateTabDefinition: DecorateWorkbenchTabDefinition;
    showNavigationControls: boolean;
}): ReactNode {
    const { Component, params, api, workbenchApiRef, decorateTabDefinition, showNavigationControls } = props;
    const navigationHistory = readTabNavigationHistory(params);
    const shouldShowNavigationControls = showNavigationControls || navigationHistory !== null;
    const canNavigateBack = Boolean(navigationHistory && navigationHistory.index > 0);
    const canNavigateForward = Boolean(
        navigationHistory && navigationHistory.index < navigationHistory.entries.length - 1,
    );

    const stableApi = useMemo(() => ({
        id: api.id,
        close: api.close,
        setActive: api.setActive,
        setTitle: (title: string) => workbenchApiRef.current?.updateTab(api.id, { title }),
        markContentReady: api.markContentReady,
    }), [api.id, api.close, api.setActive, api.markContentReady, workbenchApiRef]);

    const containerApi = useMemo(() => ({
        get activePanelId() {
            return api.id;
        },
        getPanel: (tabId: string) => {
            const workbenchApi = workbenchApiRef.current;
            return workbenchApi ? createWorkbenchContainerApi(workbenchApi, () => api.id, decorateTabDefinition).getPanel(tabId) : null;
        },
        get panels() {
            const workbenchApi = workbenchApiRef.current;
            return workbenchApi ? createWorkbenchContainerApi(workbenchApi, () => api.id, decorateTabDefinition).panels : [];
        },
        addPanel: (options: { id: string; title: string; component: string; params?: Record<string, unknown> }) => {
            workbenchApiRef.current?.openTab(decorateTabDefinition({
                id: options.id,
                title: options.title,
                component: options.component,
                params: options.params,
            }));
        },
        replacePanel: (panelId: string, options: { id: string; title: string; component: string; params?: Record<string, unknown> }) => {
            workbenchApiRef.current?.updateTab(panelId, decorateTabDefinition({
                id: options.id,
                title: options.title,
                component: options.component,
                params: options.params,
            }));
            workbenchApiRef.current?.setActiveTab(options.id);
        },
    }), [api.id, workbenchApiRef, decorateTabDefinition]);

    function navigateHistory(direction: -1 | 1): void {
        const history = readTabNavigationHistory(params);
        if (!history) {
            return;
        }

        const nextIndex = history.index + direction;
        const entry = history.entries[nextIndex];
        if (!entry) {
            return;
        }

        workbenchApiRef.current?.updateTab(api.id, decorateTabDefinition(attachTabNavigationHistory({
            id: entry.id,
            title: entry.title,
            component: entry.component,
            params: entry.params,
        }, {
            entries: history.entries,
            index: nextIndex,
        })));
        workbenchApiRef.current?.setActiveTab(entry.id);
    }

    return (
        <div className="workbench-layout-v2__tab-shell">
            {shouldShowNavigationControls ? (
                <div className="workbench-layout-v2__tab-navigation" aria-label={i18n.t("workbenchLayout.tabNavigation")}>
                    <button
                        type="button"
                        className="workbench-layout-v2__tab-navigation-button"
                        aria-label={i18n.t("workbenchLayout.navigateBack")}
                        title={i18n.t("workbenchLayout.navigateBack")}
                        disabled={!canNavigateBack}
                        onClick={() => navigateHistory(-1)}
                    >
                        <ChevronLeft size={15} strokeWidth={2} aria-hidden="true" />
                    </button>
                    <button
                        type="button"
                        className="workbench-layout-v2__tab-navigation-button"
                        aria-label={i18n.t("workbenchLayout.navigateForward")}
                        title={i18n.t("workbenchLayout.navigateForward")}
                        disabled={!canNavigateForward}
                        onClick={() => navigateHistory(1)}
                    >
                        <ChevronRight size={15} strokeWidth={2} aria-hidden="true" />
                    </button>
                </div>
            ) : null}
            <Component {...({ params, api: stableApi, containerApi } satisfies WorkbenchTabProps<Record<string, unknown>>)} />
        </div>
    );
});
