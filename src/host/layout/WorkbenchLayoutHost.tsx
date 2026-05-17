import React, {
    memo,
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type MutableRefObject,
    type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, FilePlus2, FolderOpen, Search, Settings, Shuffle } from "lucide-react";
import {
    readWorkbenchTabPayload,
    WORKBENCH_LEFT_ACTIVITY_BAR_ID,
    WORKBENCH_RIGHT_ACTIVITY_BAR_ID,
    VSCodeWorkbench,
    type ActivityBarsState,
    type TabDragPreviewContentRenderContext,
    type PanelSectionPanelDefinition,
    type TabSectionTabDefinition,
    type WorkbenchActivityDefinition,
    type WorkbenchApi,
    type WorkbenchExternalTabDragResolver,
    type WorkbenchLayoutSnapshot,
    type WorkbenchPanelContext,
    type WorkbenchPanelDefinition,
    type WorkbenchPanelLayoutSnapshot,
    type WorkbenchSidebarState,
    type WorkbenchTabDefinition,
} from "layout-v2";
import {
    type PanelRenderContext,
    type TabInstanceDefinition,
    type WorkbenchContainerApi,
    type WorkbenchTabProps,
} from "./workbenchContracts";
import {
    SETTINGS_ACTIVITY_ID,
    ensureActivityBarConfigLoaded,
    mergeActivityBarConfig,
    projectActivityBarConfigFromRuntime,
    updateActivityBarConfig,
    useActivityBarConfig,
    type DefaultActivityItemInfo,
} from "./activityBarStore";
import {
    showRegisteredContextMenu,
    useContextMenuProvider,
    type NativeContextMenuItem,
} from "./contextMenuCenter";
import {
    emitCustomActivityRemovalRequestedEvent,
    emitEditorCommandRequestedEvent,
    subscribeVaultBeforeChangeEvent,
} from "../events/appEventBus";
import { clearActiveEditor, getActiveEditorSnapshot, reportActiveEditor } from "../editor/activeEditorStore";
import {
    clearActiveBacklinkTarget,
    reportMarkdownBacklinkTarget,
    reportProjectSourceBacklinkTarget,
} from "../editor/activeBacklinkTargetStore";
import { resetEditorContext } from "../editor/editorContextStore";
import { requestApplicationQuit } from "../commands/systemShortcutSubsystem";
import {
    getSidebarLayoutFromVaultConfig,
    saveSidebarLayoutSnapshot,
    type SidebarLayoutSnapshot,
} from "./sidebarLayoutPersistence";
import {
    setRightSidebarVisibilitySnapshot,
    subscribeRightSidebarToggleRequest,
} from "./rightSidebarVisibilityBridge";
import {
    openFileInWorkbench,
    resolveFileTabDefinition,
    TAB_NAVIGATION_HISTORY_PARAM,
    type TabNavigationHistoryState,
} from "./openFileService";
import { useConfigState, type FileOpenMode } from "../config/configStore";
import {
    hasWorkspaceFileDragPayloadFiles,
    readWorkspaceFileDragPayload,
} from "./workspaceFileDragPayload";
import {
    buildWorkspaceLayoutConfigValue,
    countWorkspaceLayoutTabs,
    getWorkspaceLayoutFromVaultConfig,
    hydrateWorkspaceLayoutSnapshot,
    saveWorkspaceLayoutSnapshot,
} from "./workspaceLayoutPersistence";
import {
    resolveActivityTitle,
    resolveTitle,
    useActivities,
    useOverlays,
    usePanels,
    useTabComponents,
    type ActivityDescriptor,
    type PanelDescriptor,
    type TabComponentDescriptor,
} from "../registry";
import { useVaultState } from "../vault/vaultStore";
import { openVaultWithSystemPicker } from "../vault/openVaultDialog";
import {
    executeCommand,
    getCommandDefinitions,
    type CommandContext,
    type CreateEntryDraftRequest,
    type CommandId,
} from "../commands/commandSystem";
import { requestVaultDeleteConfirmation } from "../commands/deleteConfirmation";
import {
    decorateTabParamsWithLifecycle,
    shouldCloseTabOnVaultChange,
} from "./vaultTabScope";

const WORKBENCH_ACTIVITY_ITEM_CONTEXT_MENU_ID = "workbench-v2.activity.item";
const WORKBENCH_ACTIVITY_BACKGROUND_CONTEXT_MENU_ID = "workbench-v2.activity.background";
let nextWorkbenchContextMenuInstanceId = 0;

interface WorkbenchContextMenuPayload {
    menuItems: NativeContextMenuItem[];
    handleAction: (selectedId: string) => void | Promise<void>;
}
import {
    detectFocusedComponentFromEvent,
    PANEL_ID_DATA_ATTR,
    TAB_COMPONENT_DATA_ATTR,
} from "../commands/focusContext";
import {
    notifyTabCloseShortcutTriggered,
} from "../commands/shortcutEvents";
import {
    ensureShortcutBindingsLoaded,
    useShortcutState,
} from "../commands/shortcutStore";
import { dispatchShortcut } from "../commands/shortcutDispatcher";
import { createConditionContext } from "../conditions/conditionEvaluator";
import i18n from "../../i18n";
import { CreateEntryModal } from "./CreateEntryModal";
import { CodeMirrorEditorPreviewMirror } from "../../plugins/markdown-codemirror/editor/CodeMirrorEditorPreviewMirror";
import "../../../node_modules/layout-v2/dist/layout-v2.css";
import "./WorkbenchLayoutHost.tokens.css";
import "./WorkbenchLayoutHost.css";

/* ────────── Constants ────────── */

const DEFAULT_LEFT_RAIL_WIDTH = 280;
const DEFAULT_RIGHT_RAIL_WIDTH = 260;
const CUSTOM_ACTIVITY_REGISTRATION_PREFIX = "custom-activity:";
const CUSTOM_ACTIVITY_CREATE_COMMAND_ID = "customActivity.create";
const KEEP_ALIVE_INACTIVE_TAB_COMPONENT_IDS = new Set(["knowledgegraph"]);
const WORKBENCH_TITLEBAR_OFFSET_ATTR = "data-workbench-titlebar-offset";
const WORKBENCH_MAC_LEFT_TITLEBAR_OFFSET = "mac-left";

function waitForWorkbenchLayoutCommit(): Promise<void> {
    return new Promise((resolve) => {
        window.requestAnimationFrame(() => {
            window.requestAnimationFrame(() => resolve());
        });
    });
}

function closeVaultScopedWorkbenchTabs(api: WorkbenchApi): number {
    let closedCount = 0;

    for (let pass = 0; pass < 3; pass += 1) {
        const tabs = api.getTabs()
            .filter((tab) => shouldCloseTabOnVaultChange({ panelId: tab.id, panelParams: tab.params }));

        if (tabs.length === 0) {
            break;
        }

        tabs.reverse().forEach((tab) => {
            api.closeTab(tab.id);
            closedCount += 1;
        });
    }

    return closedCount;
}

function syncWorkbenchTitlebarOffsetTarget(root: HTMLElement): void {
    const strips = Array.from(root.querySelectorAll<HTMLElement>(".layout-v2-tab-section__strip"));
    for (const strip of strips) {
        strip.removeAttribute(WORKBENCH_TITLEBAR_OFFSET_ATTR);
    }

    const target = strips
        .map((strip) => ({ strip, rect: strip.getBoundingClientRect() }))
        .filter(({ rect }) => rect.width > 0 && rect.height > 0)
        .sort((left, right) => {
            const topDelta = left.rect.top - right.rect.top;
            if (Math.abs(topDelta) > 2) {
                return topDelta;
            }

            return left.rect.left - right.rect.left;
        })[0]?.strip ?? null;

    target?.setAttribute(WORKBENCH_TITLEBAR_OFFSET_ATTR, WORKBENCH_MAC_LEFT_TITLEBAR_OFFSET);
}

function getFocusedFileTreeElement(): HTMLElement | null {
    if (typeof document === "undefined") {
        return null;
    }

    const activeEl = document.activeElement as HTMLElement | null;
    if (!activeEl?.closest(".file-tree")) {
        return null;
    }

    return activeEl.closest("[data-tree-path]") as HTMLElement | null;
}

function resolveFocusedFileTreeSelectedItem(): { path: string; isDir: boolean } | null {
    const treeItemEl = getFocusedFileTreeElement();
    if (!treeItemEl) {
        return null;
    }

    const path = treeItemEl.getAttribute("data-tree-path");
    if (!path) {
        return null;
    }

    return {
        path,
        isDir: treeItemEl.getAttribute("data-tree-is-dir") === "true",
    };
}

function resolveFocusedFileTreePasteTargetDirectory(): string {
    const selectedItem = resolveFocusedFileTreeSelectedItem();
    if (!selectedItem) {
        return "";
    }

    if (selectedItem.isDir) {
        return selectedItem.path;
    }

    const splitIndex = selectedItem.path.lastIndexOf("/");
    return splitIndex >= 0 ? selectedItem.path.slice(0, splitIndex) : "";
}

/* ────────── Props ────────── */

export interface WorkbenchLayoutHostProps {
    initialTabs?: TabInstanceDefinition[];
    initialActivePanelId?: string;
}

/* ────────── Mapping helpers ────────── */

function buildActivityDefaults(activities: ActivityDescriptor[]): DefaultActivityItemInfo[] {
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

function mapActivitiesToDefinitions(
    activities: ActivityDescriptor[],
    mergedItems: Array<{ id: string; section: "top" | "bottom"; visible: boolean; bar: "left" | "right" }>,
): WorkbenchActivityDefinition[] {
    const activitiesById = new Map(activities.map((a) => [a.id, a]));

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
                    icon: React.createElement(Settings, { size: 18, strokeWidth: 1.8 }),
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

function mapPanelsToDefinitions(panels: PanelDescriptor[]): WorkbenchPanelDefinition[] {
    return panels.map((panel) => ({
        id: panel.id,
        label: resolveTitle(panel.title),
        icon: panel.icon,
        activityId: panel.activityId,
        position: panel.defaultPosition,
        order: panel.defaultOrder,
    }));
}

type DecorateWorkbenchTabDefinition = (tab: WorkbenchTabDefinition) => WorkbenchTabDefinition;

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

function mapInitialTabs(
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

function countInitialWorkbenchTabs(initialTabs: TabInstanceDefinition[] | undefined): number {
    return initialTabs?.filter((tab) => tab.component !== "home").length ?? 0;
}

function createWorkbenchContainerApi(
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

function isMarkdownFilePath(path: string): boolean {
    const normalizedPath = path.toLowerCase();
    return normalizedPath.endsWith(".md") || normalizedPath.endsWith(".markdown");
}

function resolveVaultDisplayName(vaultPath: string): string {
    if (!vaultPath.trim()) {
        return i18n.t("app.homeNoVault");
    }

    const normalizedPath = vaultPath.replace(/\\/g, "/").replace(/\/+$/g, "");
    return normalizedPath.split("/").filter(Boolean).pop() ?? normalizedPath;
}

interface WorkbenchHomeEmptyStateProps {
    vaultLabel: string;
    markdownNoteCount: number;
    isVaultLoading: boolean;
    canCreateNote: boolean;
    canOpenRandomNote: boolean;
    onCreateNote: () => void;
    onOpenRandomNote: () => void;
    onOpenVault: () => void;
}

function WorkbenchHomeEmptyState(props: WorkbenchHomeEmptyStateProps): ReactNode {
    const noteCountLabel = props.markdownNoteCount === 1
        ? i18n.t("app.homeNoteCountOne")
        : i18n.t("app.homeNoteCount", { count: props.markdownNoteCount });

    return (
        <div className="workbench-home-empty" role="region" aria-label={i18n.t("app.homeAriaLabel")}>
            <div className="workbench-home-empty__inner">
                <div className="workbench-home-empty__hero">
                    <div className="workbench-home-empty__eyebrow">{i18n.t("app.homeEyebrow")}</div>
                    <h1>{i18n.t("app.homeTitle")}</h1>
                    <p>{i18n.t("app.homeDescription")}</p>
                    <div className="workbench-home-empty__actions" aria-label={i18n.t("app.homeQuickStartLabel")}>
                        <button
                            type="button"
                            className="workbench-home-empty__button workbench-home-empty__button--primary"
                            onClick={props.onCreateNote}
                            disabled={!props.canCreateNote}
                        >
                            <FilePlus2 size={16} strokeWidth={1.9} aria-hidden="true" />
                            <span>{i18n.t("app.homeCreateNote")}</span>
                        </button>
                        <button
                            type="button"
                            className="workbench-home-empty__button"
                            onClick={props.onOpenRandomNote}
                            disabled={!props.canOpenRandomNote}
                        >
                            <Shuffle size={16} strokeWidth={1.9} aria-hidden="true" />
                            <span>{i18n.t("app.homeRandomNote")}</span>
                        </button>
                        <button
                            type="button"
                            className="workbench-home-empty__button"
                            onClick={props.onOpenVault}
                        >
                            <FolderOpen size={16} strokeWidth={1.9} aria-hidden="true" />
                            <span>{i18n.t("app.homeOpenVault")}</span>
                        </button>
                    </div>
                    <div className="workbench-home-empty__status" aria-live="polite">
                        <span>{props.vaultLabel}</span>
                        <span>{props.isVaultLoading ? i18n.t("app.homeLoadingVault") : noteCountLabel}</span>
                    </div>
                </div>
                <div className="workbench-home-empty__guide" aria-label={i18n.t("app.homeGuideLabel")}>
                    <div className="workbench-home-empty__guide-item">
                        <FolderOpen size={17} strokeWidth={1.8} aria-hidden="true" />
                        <div>
                            <strong>{i18n.t("app.homeGuideOpenTitle")}</strong>
                            <span>{i18n.t("app.homeGuideOpenDesc")}</span>
                        </div>
                    </div>
                    <div className="workbench-home-empty__guide-item">
                        <FilePlus2 size={17} strokeWidth={1.8} aria-hidden="true" />
                        <div>
                            <strong>{i18n.t("app.homeGuideWriteTitle")}</strong>
                            <span>{i18n.t("app.homeGuideWriteDesc")}</span>
                        </div>
                    </div>
                    <div className="workbench-home-empty__guide-item">
                        <Search size={17} strokeWidth={1.8} aria-hidden="true" />
                        <div>
                            <strong>{i18n.t("app.homeGuideExploreTitle")}</strong>
                            <span>{i18n.t("app.homeGuideExploreDesc")}</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

function buildPanelRenderContext(
    workbenchContext: WorkbenchPanelContext,
    workbenchApiRef: MutableRefObject<WorkbenchApi | null>,
    openFileHelper: (options: {
        relativePath: string;
        contentOverride?: string;
        preferredOpenerId?: string;
        tabParams?: Record<string, unknown>;
        openMode?: FileOpenMode;
    }) => Promise<void>,
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

/* ────────── Stable tab component wrapper ────────── */

/**
 * Wraps a registered tab component with a stable `containerApi` reference.
 * Without this wrapper, every render of the tab section creates a new `containerApi`
 * object literal, which triggers the CodeMirror editor to fully destroy and recreate
 * its EditorView on each resize, producing log spam and wasting resources.
 */
const StableTabComponentWrapper = memo(function StableTabComponentWrapper(props: {
    Component: (props: Record<string, unknown>) => ReactNode;
    params: Record<string, unknown>;
    api: { id: string; close: () => void; setActive: () => void; markContentReady?: () => void };
    workbenchApiRef: MutableRefObject<WorkbenchApi | null>;
    decorateTabDefinition: DecorateWorkbenchTabDefinition;
}): ReactNode {
    const { Component, params, api, workbenchApiRef, decorateTabDefinition } = props;
    const navigationHistory = readTabNavigationHistory(params);
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
    }), [api.id, api.close, api.setActive, api.markContentReady]);

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

    const navigateHistory = (direction: -1 | 1): void => {
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
    };

    return (
        <div className="workbench-layout-v2__tab-shell">
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
            <Component {...({ params, api: stableApi, containerApi } satisfies WorkbenchTabProps<Record<string, unknown>>)} />
        </div>
    );
});

/* ────────── Main component ────────── */

function LayoutV2WorkbenchHost(props: WorkbenchLayoutHostProps): ReactNode {
    const registeredActivities = useActivities();
    const registeredPanels = usePanels();
    const registeredTabComponents = useTabComponents();
    const registeredOverlays = useOverlays();
    const activityBarConfigState = useActivityBarConfig();
    const configState = useConfigState();
    const vaultState = useVaultState();
    const shortcutState = useShortcutState();
    const [contextMenuIds] = useState(() => {
        const instanceId = String(++nextWorkbenchContextMenuInstanceId);
        return {
            activityItem: `${WORKBENCH_ACTIVITY_ITEM_CONTEXT_MENU_ID}:${instanceId}`,
            activityBackground: `${WORKBENCH_ACTIVITY_BACKGROUND_CONTEXT_MENU_ID}:${instanceId}`,
        };
    });

    const sidebarSnapshot = useMemo(
        () => {
            if (!configState.featureSettings.restoreWorkspaceLayout) return null;
            return getSidebarLayoutFromVaultConfig(configState.backendConfig);
        },
        [configState.backendConfig, configState.featureSettings.restoreWorkspaceLayout],
    );

    const workspaceSnapshot = useMemo(
        () => {
            if (!configState.featureSettings.restoreWorkspaceLayout) return null;
            return getWorkspaceLayoutFromVaultConfig(configState.backendConfig);
        },
        [configState.backendConfig, configState.featureSettings.restoreWorkspaceLayout],
    );
    const [hydratedWorkspaceSnapshot, setHydratedWorkspaceSnapshot] = useState<WorkbenchLayoutSnapshot | null>(null);
    const [workspaceLayoutHydrationComplete, setWorkspaceLayoutHydrationComplete] = useState(false);

    const hasRightSidebar = useMemo(
        () =>
            registeredPanels.some((panel) => panel.defaultPosition === "right") ||
            registeredActivities.some((activity) => activity.defaultBar === "right"),
        [registeredActivities, registeredPanels],
    );

    const activitiesById = useMemo(
        () => new Map(registeredActivities.map((a) => [a.id, a])),
        [registeredActivities],
    );

    const panelsById = useMemo(
        () => new Map(registeredPanels.map((p) => [p.id, p])),
        [registeredPanels],
    );

    const mergedActivityItems = useMemo(
        () => mergeActivityBarConfig(buildActivityDefaults(registeredActivities), activityBarConfigState.config),
        [activityBarConfigState.config, registeredActivities],
    );

    /* ── Map registry data to layout-v2 definitions ── */

    const activityDefinitions = useMemo(
        () => mapActivitiesToDefinitions(registeredActivities, mergedActivityItems),
        [registeredActivities, mergedActivityItems],
    );

    const panelDefinitions = useMemo(
        () => mapPanelsToDefinitions(registeredPanels),
        [registeredPanels],
    );

    const deferredPresentationTabComponentIds = useMemo(
        () => new Set(
            registeredTabComponents
                .filter((descriptor) => descriptor.deferPresentationUntilReady)
                .map((descriptor) => descriptor.id),
        ),
        [registeredTabComponents],
    );

    const deferredPresentationPanelIds = useMemo(
        () => new Set(
            registeredPanels
                .filter((descriptor) => descriptor.deferPresentationUntilReady)
                .map((descriptor) => descriptor.id),
        ),
        [registeredPanels],
    );

    const tabComponentsById = useMemo(
        () => new Map<string, TabComponentDescriptor>(
            registeredTabComponents.map((descriptor) => [descriptor.id, descriptor]),
        ),
        [registeredTabComponents],
    );

    const decorateTabDefinition = useCallback((tab: WorkbenchTabDefinition): WorkbenchTabDefinition => {
        const descriptor = tabComponentsById.get(tab.component);
        return {
            ...tab,
            params: decorateTabParamsWithLifecycle({
                componentId: tab.component,
                lifecycleScope: descriptor?.lifecycleScope ?? "global",
                params: tab.params,
            }),
        };
    }, [tabComponentsById]);

    const tabComponents = useMemo(() => {
        const result: Record<string, (props: { params: Record<string, unknown>; api: { id: string; close: () => void; setActive: () => void; markContentReady?: () => void } }) => ReactNode> = {};
        for (const descriptor of registeredTabComponents) {
            const Component = descriptor.component as unknown as (props: Record<string, unknown>) => ReactNode;
            result[descriptor.id] = ({ params, api }) => (
                <div
                    className="workbench-layout-v2__tab-focus-scope"
                    {...{ [TAB_COMPONENT_DATA_ATTR]: descriptor.id }}
                >
                    <StableTabComponentWrapper
                        Component={Component}
                        params={params}
                        api={api}
                        workbenchApiRef={workbenchApiRef}
                        decorateTabDefinition={decorateTabDefinition}
                    />
                </div>
            );
        }
        return result;
    }, [decorateTabDefinition, registeredTabComponents]);

    const initialTabs = useMemo(
        () => mapInitialTabs(props.initialTabs, decorateTabDefinition),
        [decorateTabDefinition, props.initialTabs],
    );

    /* ── Initial sidebar state from persisted snapshot ── */

    const initialSidebarState = useMemo((): WorkbenchSidebarState => ({
        left: {
            visible: sidebarSnapshot?.left.visible ?? true,
            activeActivityId: sidebarSnapshot?.left.activeActivityId ?? props.initialActivePanelId ?? null,
            activePanelId: sidebarSnapshot?.left.activePanelId ?? props.initialActivePanelId ?? null,
        },
        right: {
            visible: sidebarSnapshot?.right.visible ?? true,
            activeActivityId: sidebarSnapshot?.right.activeActivityId ?? null,
            activePanelId: sidebarSnapshot?.right.activePanelId ?? null,
        },
    }), [sidebarSnapshot, props.initialActivePanelId]);

    /* ── Workbench API ref ── */

    const workbenchApiRef = useRef<WorkbenchApi | null>(null);
    const persistedSnapshotRef = useRef<string | null>(null);
    const leftSidebarVisibleRef = useRef(initialSidebarState.left.visible);
    const rightSidebarVisibleRef = useRef(initialSidebarState.right.visible);
    const sectionRatiosRef = useRef<Record<string, number> | undefined>(sidebarSnapshot?.sectionRatios);
    const panelLayoutSnapshotRef = useRef<WorkbenchPanelLayoutSnapshot | undefined>(sidebarSnapshot?.panelLayout);
    const sidebarSnapshotRef = useRef(sidebarSnapshot);
    const syncedPanelLayoutSidebarSnapshotRef = useRef(sidebarSnapshot);
    const persistedWorkspaceLayoutRef = useRef<string | null>(null);
    const workspaceLayoutRestorePendingRef = useRef(false);
    const workspaceLayoutInitialDecisionVaultPathRef = useRef<string | null>(null);
    const workspaceLayoutBlockedVaultPathRef = useRef<string | null>(null);
    const layoutRootRef = useRef<HTMLDivElement | null>(null);
    const [openTabCount, setOpenTabCount] = useState(() => countInitialWorkbenchTabs(props.initialTabs));
    const [homeEmptyStateTarget, setHomeEmptyStateTarget] = useState<HTMLElement | null>(null);
    const [createEntryDraftRequest, setCreateEntryDraftRequest] = useState<{
        kind: CreateEntryDraftRequest["kind"];
        baseDirectory: string;
        title: string;
        placeholder: string;
        initialValue: string;
        resolve: (value: string | null) => void;
    } | null>(null);
    sidebarSnapshotRef.current = sidebarSnapshot;
    if (sidebarSnapshot !== syncedPanelLayoutSidebarSnapshotRef.current) {
        syncedPanelLayoutSidebarSnapshotRef.current = sidebarSnapshot;
        panelLayoutSnapshotRef.current = sidebarSnapshot?.panelLayout;
    }

    const syncOpenTabCountFromApi = useCallback((): void => {
        const nextCount = workbenchApiRef.current?.getTabs().length ?? 0;
        setOpenTabCount((currentCount) => currentCount === nextCount ? currentCount : nextCount);
    }, []);

    useEffect(() => {
        if (hydratedWorkspaceSnapshot) {
            setOpenTabCount(countWorkspaceLayoutTabs(hydratedWorkspaceSnapshot));
            return;
        }

        setOpenTabCount(countInitialWorkbenchTabs(props.initialTabs));
    }, [hydratedWorkspaceSnapshot, props.initialTabs]);

    useEffect(() => {
        persistedWorkspaceLayoutRef.current = workspaceSnapshot
            ? JSON.stringify(buildWorkspaceLayoutConfigValue(workspaceSnapshot))
            : null;
    }, [workspaceSnapshot]);

    useEffect(() => {
        const root = layoutRootRef.current;
        if (!root) {
            return undefined;
        }

        let frameId: number | null = null;
        const scheduleSync = () => {
            if (frameId !== null) {
                return;
            }

            frameId = window.requestAnimationFrame(() => {
                frameId = null;
                syncWorkbenchTitlebarOffsetTarget(root);
            });
        };

        scheduleSync();

        const mutationObserver = new MutationObserver(scheduleSync);
        mutationObserver.observe(root, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ["class", "style", "data-testid", "data-section-id", "data-tab-section-id"],
        });

        const resizeObserver = typeof ResizeObserver === "undefined"
            ? null
            : new ResizeObserver(scheduleSync);
        resizeObserver?.observe(root);

        return () => {
            mutationObserver.disconnect();
            resizeObserver?.disconnect();
            if (frameId !== null) {
                window.cancelAnimationFrame(frameId);
            }
        };
    }, []);

    /* ── Open file helper ── */

    const openFileHelper = useCallback(
        async (options: {
            relativePath: string;
            contentOverride?: string;
            preferredOpenerId?: string;
            tabParams?: Record<string, unknown>;
            openMode?: FileOpenMode;
        }) => {
            const api = workbenchApiRef.current;
            if (!api) return;
            await openFileInWorkbench({
                relativePath: options.relativePath,
                currentVaultPath: vaultState.currentVaultPath || configState.loadedVaultPath || undefined,
                contentOverride: options.contentOverride,
                preferredOpenerId: options.preferredOpenerId,
                tabParams: options.tabParams,
                openMode: options.openMode,
                containerApi: createWorkbenchContainerApi(api, () => activeTabIdRef.current, decorateTabDefinition),
            });
        },
        [configState.loadedVaultPath, decorateTabDefinition, vaultState.currentVaultPath],
    );

    const workspaceFileExternalTabDragResolver = useMemo<WorkbenchExternalTabDragResolver>(() => ({
        canAccept: (event) => {
            const target = event.target as HTMLElement | null;
            if (target?.closest("[data-workspace-file-drop-scope='local']")) {
                return false;
            }
            return hasWorkspaceFileDragPayloadFiles(event.dataTransfer);
        },
        resolveTab: async (event) => {
            const targetItem = readWorkspaceFileDragPayload(event.dataTransfer)
                .find((item) => !item.isDir);
            if (!targetItem) {
                return null;
            }

            return resolveFileTabDefinition({
                relativePath: targetItem.path,
                currentVaultPath: vaultState.currentVaultPath || configState.loadedVaultPath || undefined,
            });
        },
    }), [configState.loadedVaultPath, vaultState.currentVaultPath]);

    useEffect(() => {
        let cancelled = false;
        const currentVaultPath = vaultState.currentVaultPath || configState.loadedVaultPath || null;

        if (
            currentVaultPath
            && workspaceLayoutBlockedVaultPathRef.current === currentVaultPath
            && configState.loadedVaultPath === currentVaultPath
        ) {
            workspaceLayoutBlockedVaultPathRef.current = null;
        }

        const blockedByVaultSwitch = Boolean(
            currentVaultPath
            && workspaceLayoutBlockedVaultPathRef.current === currentVaultPath
            && configState.loadedVaultPath !== currentVaultPath,
        );

        if (
            !currentVaultPath
            || !configState.backendConfig
            || blockedByVaultSwitch
            || !configState.featureSettings.restoreWorkspaceLayout
        ) {
            workspaceLayoutInitialDecisionVaultPathRef.current = null;
            workspaceLayoutRestorePendingRef.current = false;
            setWorkspaceLayoutHydrationComplete(false);
            setHydratedWorkspaceSnapshot(null);
            return () => {
                cancelled = true;
            };
        }

        if (workspaceLayoutInitialDecisionVaultPathRef.current === currentVaultPath) {
            return () => {
                cancelled = true;
            };
        }

        workspaceLayoutInitialDecisionVaultPathRef.current = currentVaultPath;

        if (!workspaceSnapshot) {
            workspaceLayoutRestorePendingRef.current = false;
            setWorkspaceLayoutHydrationComplete(true);
            setHydratedWorkspaceSnapshot(null);
            return () => {
                cancelled = true;
            };
        }

        workspaceLayoutRestorePendingRef.current = true;
        setWorkspaceLayoutHydrationComplete(false);
        void hydrateWorkspaceLayoutSnapshot(workspaceSnapshot, async (tab) => {
            if (tab.component === "home") {
                return null;
            }

            const relativePath = typeof tab.params?.path === "string"
                ? tab.params.path.replace(/\\/g, "/")
                : null;
            if (!relativePath) {
                return tab;
            }

            const resolvedTab = await resolveFileTabDefinition({
                relativePath,
                currentVaultPath,
            });
            if (!resolvedTab) {
                return null;
            }

            return {
                id: resolvedTab.id,
                title: resolvedTab.title,
                component: resolvedTab.component,
                params: resolvedTab.params,
            };
        }).then((snapshot) => {
            if (cancelled) {
                return;
            }

            workspaceLayoutRestorePendingRef.current = false;
            setWorkspaceLayoutHydrationComplete(true);
            setHydratedWorkspaceSnapshot(
                countWorkspaceLayoutTabs(snapshot) > 0 ? snapshot : null,
            );
        }).catch((error) => {
            if (cancelled) {
                return;
            }

            workspaceLayoutRestorePendingRef.current = false;
            setWorkspaceLayoutHydrationComplete(true);
            console.warn("[workbench-layout-host] workspace layout hydration failed", {
                message: error instanceof Error ? error.message : String(error),
            });
            setHydratedWorkspaceSnapshot(null);
        });

        return () => {
            cancelled = true;
        };
    }, [
        workspaceSnapshot,
        configState.featureSettings.restoreWorkspaceLayout,
        configState.backendConfig,
        configState.loadedVaultPath,
        vaultState.currentVaultPath,
    ]);

    /* ── Activity bar config loading ── */

    useEffect(() => {
        const currentVaultPath = vaultState.currentVaultPath || configState.loadedVaultPath;
        if (!currentVaultPath || !vaultState.backendReady) return;
        void ensureActivityBarConfigLoaded(currentVaultPath);
        void ensureShortcutBindingsLoaded(currentVaultPath);
    }, [configState.loadedVaultPath, vaultState.currentVaultPath, vaultState.backendReady]);

    const settleCreateEntryDraftRequest = useCallback((value: string | null): void => {
        setCreateEntryDraftRequest((currentRequest) => {
            if (!currentRequest) {
                return null;
            }

            window.setTimeout(() => {
                currentRequest.resolve(value);
            }, 0);
            return null;
        });
    }, []);

    const requestCreateEntryDraft = useCallback(
        (request: CreateEntryDraftRequest) =>
            new Promise<string | null>((resolve) => {
                setCreateEntryDraftRequest((currentRequest) => {
                    if (currentRequest) {
                        window.setTimeout(() => {
                            currentRequest.resolve(null);
                        }, 0);
                    }

                    console.info("[workbench-layout-host] open create-entry modal", {
                        kind: request.kind,
                        baseDirectory: request.baseDirectory,
                    });

                    return {
                        ...request,
                        resolve,
                    };
                });
            }),
        [],
    );

    /* ── Build command context helper ── */

    const activeTabIdRef = useRef<string | null>(null);

    const buildCommandContext = useCallback((): CommandContext => ({
        activeTabId: activeTabIdRef.current,
        closeTab: (tabId: string) => workbenchApiRef.current?.closeTab(tabId),
        openFileTab: (relativePath, content, tabParams) => {
            void openFileHelper({ relativePath, contentOverride: content, tabParams });
        },
        openTab: (tab) => {
            workbenchApiRef.current?.openTab(decorateTabDefinition({
                id: tab.id,
                title: tab.title,
                component: tab.component,
                params: tab.params,
            }));
        },
        getExistingMarkdownPaths: () => [],
        activatePanel: (panelId: string) => workbenchApiRef.current?.activatePanel(panelId),
        toggleLeftSidebarVisibility: () => {
            workbenchApiRef.current?.toggleLeftSidebarVisible();
        },
        toggleRightSidebarVisibility: () => {
            workbenchApiRef.current?.toggleRightSidebarVisible();
        },
        executeEditorNativeCommand: (commandId) => {
            const activeEditor = getActiveEditorSnapshot();
            if (!activeEditor) {
                console.warn("[layout] editor command skipped: no active editor", { commandId });
                return false;
            }
            emitEditorCommandRequestedEvent({ articleId: activeEditor.articleId, commandId });
            return true;
        },
        quitApplication: () => requestApplicationQuit(),
        getFileTreeSelectedItem: resolveFocusedFileTreeSelectedItem,
        getFileTreePasteTargetDirectory: resolveFocusedFileTreePasteTargetDirectory,
        requestDeleteConfirmation: requestVaultDeleteConfirmation,
        requestCreateEntryDraft,
    }), [decorateTabDefinition, openFileHelper, requestCreateEntryDraft]);

    const markdownNotePaths = useMemo(
        () => vaultState.files
            .filter((file) => !file.isDir && isMarkdownFilePath(file.path))
            .map((file) => file.path)
            .sort((left, right) => left.localeCompare(right)),
        [vaultState.files],
    );

    const homeVaultLabel = useMemo(
        () => resolveVaultDisplayName(vaultState.currentVaultPath || configState.loadedVaultPath || ""),
        [configState.loadedVaultPath, vaultState.currentVaultPath],
    );

    const canCreateHomeNote = Boolean(
        (vaultState.currentVaultPath || configState.loadedVaultPath) &&
        vaultState.backendReady &&
        !vaultState.isLoadingTree &&
        !vaultState.error,
    );
    const canOpenRandomHomeNote = markdownNotePaths.length > 0 && !vaultState.isLoadingTree;
    const shouldWaitForWorkspaceRestore = Boolean(
        configState.featureSettings.restoreWorkspaceLayout &&
        (vaultState.currentVaultPath || configState.loadedVaultPath) &&
        configState.backendConfig &&
        !workspaceLayoutHydrationComplete,
    );
    const shouldShowHomeEmptyState = openTabCount === 0 && !shouldWaitForWorkspaceRestore;

    const handleCreateHomeNote = useCallback((): void => {
        executeCommand("note.createNew", buildCommandContext());
    }, [buildCommandContext]);

    const handleOpenRandomHomeNote = useCallback((): void => {
        if (markdownNotePaths.length === 0) {
            return;
        }

        const randomIndex = Math.floor(Math.random() * markdownNotePaths.length);
        const relativePath = markdownNotePaths[randomIndex];
        if (!relativePath) {
            return;
        }

        void openFileHelper({ relativePath });
    }, [markdownNotePaths, openFileHelper]);

    const handleOpenHomeVault = useCallback((): void => {
        void openVaultWithSystemPicker().then((selectedPath) => {
            if (selectedPath) {
                workbenchApiRef.current?.activatePanel("files");
            }
        });
    }, []);

    useEffect(() => {
        if (!shouldShowHomeEmptyState) {
            setHomeEmptyStateTarget(null);
            return undefined;
        }

        const root = layoutRootRef.current;
        if (!root) {
            setHomeEmptyStateTarget(null);
            return undefined;
        }

        let frameId: number | null = null;
        const syncTarget = (): void => {
            const target = root.querySelector<HTMLElement>(".layout-v2-tab-section__content");
            setHomeEmptyStateTarget((currentTarget) => currentTarget === target ? currentTarget : target);
        };
        const scheduleSync = (): void => {
            if (frameId !== null) {
                return;
            }

            frameId = window.requestAnimationFrame(() => {
                frameId = null;
                syncTarget();
            });
        };

        scheduleSync();
        const mutationObserver = new MutationObserver(scheduleSync);
        mutationObserver.observe(root, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ["class", "data-section-id", "data-tab-section-id"],
        });

        return () => {
            mutationObserver.disconnect();
            if (frameId !== null) {
                window.cancelAnimationFrame(frameId);
            }
        };
    }, [shouldShowHomeEmptyState]);

    /* ── Active tab → active editor sync ── */

    const handleActiveTabChange = useCallback((tabId: string | null) => {
        syncOpenTabCountFromApi();
        activeTabIdRef.current = tabId;
        if (!tabId) {
            clearActiveEditor();
            clearActiveBacklinkTarget();
            return;
        }
        const tab = workbenchApiRef.current?.getTab(tabId);
        if (
            typeof tab?.params?.projectId === "string"
            && typeof tab.params.projectName === "string"
            && typeof tab.params.rootPath === "string"
            && typeof tab.params.relativePath === "string"
        ) {
            const projectId = typeof tab.params?.projectId === "string" ? tab.params.projectId : null;
            const projectName = typeof tab.params?.projectName === "string" ? tab.params.projectName : null;
            const rootPath = typeof tab.params?.rootPath === "string" ? tab.params.rootPath : null;
            const relativePath = typeof tab.params?.relativePath === "string"
                ? tab.params.relativePath.replace(/\\/g, "/")
                : null;
            if (!projectId || !projectName || !rootPath || !relativePath) {
                clearActiveEditor();
                clearActiveBacklinkTarget();
                return;
            }
            clearActiveEditor();
            reportProjectSourceBacklinkTarget({
                tabId,
                projectId,
                projectName,
                rootPath,
                relativePath,
            });
            return;
        }
        const path = typeof tab?.params?.path === "string"
            ? tab.params.path.replace(/\\/g, "/")
            : null;
        if (!path || !(path.toLowerCase().endsWith(".md") || path.toLowerCase().endsWith(".markdown"))) {
            clearActiveEditor();
            clearActiveBacklinkTarget();
            return;
        }
        reportActiveEditor({ articleId: tabId, path });
        reportMarkdownBacklinkTarget({ articleId: tabId, path });
    }, [syncOpenTabCountFromApi]);

    /* ── Global keyboard shortcut dispatcher ── */

    useEffect(() => {
        const bindings = shortcutState.bindings;
        const handleKeydown = (event: KeyboardEvent): void => {
            const target = event.target as HTMLElement | null;
            const isCodeMirrorTarget = Boolean(target?.closest(".cm-editor"));
            const isTypingTarget =
                target instanceof HTMLInputElement ||
                target instanceof HTMLTextAreaElement ||
                target?.isContentEditable === true;

            if (isTypingTarget && !isCodeMirrorTarget) return;

            const resolution = dispatchShortcut({
                event,
                bindings,
                source: "global",
                conditionContext: createConditionContext({
                    focusedComponent: detectFocusedComponentFromEvent(event),
                    activeTabId: activeTabIdRef.current,
                    currentVaultPath: vaultState.currentVaultPath || configState.loadedVaultPath || undefined,
                }),
            });

            if (resolution.kind !== "execute" || !resolution.commandId) return;
            if (resolution.shouldPreventDefault) event.preventDefault();
            if (resolution.shouldStopPropagation) event.stopPropagation();
            if (resolution.notifyTabClose) notifyTabCloseShortcutTriggered();

            executeCommand(resolution.commandId, buildCommandContext());
        };

        window.addEventListener("keydown", handleKeydown, { capture: true });
        return () => {
            window.removeEventListener("keydown", handleKeydown, { capture: true });
        };
    }, [shortcutState.bindings, buildCommandContext, vaultState.currentVaultPath, configState.loadedVaultPath]);

    /* ── Overlay render context ── */

    const overlayRenderContext = useMemo(() => ({
        activeTabId: activeTabIdRef.current,
        workbenchApi: null,
        hostPanelId: null,
        convertibleView: null,
        openTab: (tab: TabInstanceDefinition) => {
            workbenchApiRef.current?.openTab(decorateTabDefinition({
                id: tab.id,
                title: tab.title,
                component: tab.component,
                params: tab.params,
            }));
        },
        openFile: openFileHelper,
        closeTab: (tabId: string) => workbenchApiRef.current?.closeTab(tabId),
        setActiveTab: (tabId: string) => workbenchApiRef.current?.setActiveTab(tabId),
        activatePanel: (panelId: string) => workbenchApiRef.current?.activatePanel(panelId),
        executeCommand: (commandId: string) => {
            executeCommand(commandId as CommandId, buildCommandContext());
        },
        getCommandDefinitions: () => getCommandDefinitions(),
        requestMoveFileToDirectory: (_relativePath: string) => {
            /* not wired yet */
        },
    }), [buildCommandContext, decorateTabDefinition, openFileHelper]);

    /* ── Right sidebar toggle bridge ── */

    useEffect(() => {
        return subscribeRightSidebarToggleRequest(() => {
            workbenchApiRef.current?.toggleRightSidebarVisible();
        });
    }, []);

    /* ── Sidebar state change → persistence ── */

    const handleSidebarStateChange = useCallback(
        (state: WorkbenchSidebarState) => {
            // Keep visibility refs in sync for toggle commands
            leftSidebarVisibleRef.current = state.left.visible;
            rightSidebarVisibleRef.current = state.right.visible;

            // Sync right sidebar visibility bridge
            setRightSidebarVisibilitySnapshot(hasRightSidebar && state.right.visible);

            const currentVaultPath = vaultState.currentVaultPath || configState.loadedVaultPath;
            if (!currentVaultPath || !configState.backendConfig) return;
            if (workspaceLayoutBlockedVaultPathRef.current === currentVaultPath && configState.loadedVaultPath !== currentVaultPath) return;
            if (!configState.featureSettings.restoreWorkspaceLayout) return;

            const snap = sidebarSnapshotRef.current;
            const snapshot: SidebarLayoutSnapshot = {
                version: 1,
                left: {
                    width: snap?.left.width ?? DEFAULT_LEFT_RAIL_WIDTH,
                    visible: state.left.visible,
                    activeActivityId: state.left.activeActivityId,
                    activePanelId: state.left.activePanelId,
                },
                right: {
                    width: snap?.right.width ?? DEFAULT_RIGHT_RAIL_WIDTH,
                    visible: hasRightSidebar ? state.right.visible : false,
                    activeActivityId: state.right.activeActivityId,
                    activePanelId: state.right.activePanelId,
                },
                panelStates: snap?.panelStates ?? [],
                paneStates: snap?.paneStates ?? [],
                convertiblePanelStates: snap?.convertiblePanelStates ?? [],
                sectionRatios: sectionRatiosRef.current,
                panelLayout: panelLayoutSnapshotRef.current,
            };

            const serializedSnapshot = JSON.stringify(snapshot);
            if (persistedSnapshotRef.current === serializedSnapshot) return;

            persistedSnapshotRef.current = serializedSnapshot;
            void saveSidebarLayoutSnapshot(snapshot);
        },
        [
            hasRightSidebar,
            configState.backendConfig,
            configState.loadedVaultPath,
            configState.featureSettings.restoreWorkspaceLayout,
            vaultState.currentVaultPath,
        ],
    );

    /* ── Section ratio persistence (debounced) ── */

    const sectionRatioPersistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const panelLayoutPersistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const workspaceLayoutPersistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const clearLayoutPersistTimers = useCallback((): void => {
        if (sectionRatioPersistTimerRef.current) {
            clearTimeout(sectionRatioPersistTimerRef.current);
            sectionRatioPersistTimerRef.current = null;
        }
        if (panelLayoutPersistTimerRef.current) {
            clearTimeout(panelLayoutPersistTimerRef.current);
            panelLayoutPersistTimerRef.current = null;
        }
        if (workspaceLayoutPersistTimerRef.current) {
            clearTimeout(workspaceLayoutPersistTimerRef.current);
            workspaceLayoutPersistTimerRef.current = null;
        }
    }, []);

    useEffect(() => {
        return () => {
            clearLayoutPersistTimers();
        };
    }, [clearLayoutPersistTimers]);

    useEffect(() => {
        return subscribeVaultBeforeChangeEvent(async (payload) => {
            clearLayoutPersistTimers();
            settleCreateEntryDraftRequest(null);

            const api = workbenchApiRef.current;
            if (api) {
                closeVaultScopedWorkbenchTabs(api);
                setOpenTabCount(api.getTabs().length);
            }

            workspaceLayoutBlockedVaultPathRef.current = payload.nextVaultPath;
            activeTabIdRef.current = null;
            clearActiveEditor();
            clearActiveBacklinkTarget();
            resetEditorContext();

            workspaceLayoutRestorePendingRef.current = false;
            workspaceLayoutInitialDecisionVaultPathRef.current = null;
            persistedWorkspaceLayoutRef.current = null;
            persistedSnapshotRef.current = null;
            setWorkspaceLayoutHydrationComplete(false);
            setHydratedWorkspaceSnapshot(null);

            console.info("[workbench-layout-host] cleared vault scoped runtime before vault switch", {
                eventId: payload.eventId,
                currentVaultPath: payload.currentVaultPath,
                nextVaultPath: payload.nextVaultPath,
            });

            await waitForWorkbenchLayoutCommit();
        });
    }, [clearLayoutPersistTimers, settleCreateEntryDraftRequest]);

    const handleSectionRatioChange = useCallback(
        (ratios: Record<string, number>) => {
            sectionRatiosRef.current = ratios;

            if (sectionRatioPersistTimerRef.current) {
                clearTimeout(sectionRatioPersistTimerRef.current);
            }

            sectionRatioPersistTimerRef.current = setTimeout(() => {
                sectionRatioPersistTimerRef.current = null;

                const currentVaultPath = vaultState.currentVaultPath || configState.loadedVaultPath;
                if (!currentVaultPath || !configState.backendConfig) return;
                if (workspaceLayoutBlockedVaultPathRef.current === currentVaultPath && configState.loadedVaultPath !== currentVaultPath) return;
                if (!configState.featureSettings.restoreWorkspaceLayout) return;

                const snap = sidebarSnapshotRef.current;
                const snapshot: SidebarLayoutSnapshot = {
                    version: 1,
                    left: {
                        width: snap?.left.width ?? DEFAULT_LEFT_RAIL_WIDTH,
                        visible: leftSidebarVisibleRef.current,
                        activeActivityId: snap?.left.activeActivityId ?? null,
                        activePanelId: snap?.left.activePanelId ?? null,
                    },
                    right: {
                        width: snap?.right.width ?? DEFAULT_RIGHT_RAIL_WIDTH,
                        visible: hasRightSidebar ? rightSidebarVisibleRef.current : false,
                        activeActivityId: snap?.right.activeActivityId ?? null,
                        activePanelId: snap?.right.activePanelId ?? null,
                    },
                    panelStates: snap?.panelStates ?? [],
                    paneStates: snap?.paneStates ?? [],
                    convertiblePanelStates: snap?.convertiblePanelStates ?? [],
                    sectionRatios: sectionRatiosRef.current,
                    panelLayout: panelLayoutSnapshotRef.current,
                };

                const serializedSnapshot = JSON.stringify(snapshot);
                if (persistedSnapshotRef.current === serializedSnapshot) return;

                persistedSnapshotRef.current = serializedSnapshot;
                void saveSidebarLayoutSnapshot(snapshot);
            }, 300);
        },
        [
            hasRightSidebar,
            configState.backendConfig,
            configState.loadedVaultPath,
            configState.featureSettings.restoreWorkspaceLayout,
            vaultState.currentVaultPath,
        ],
    );

    const handlePanelLayoutChange = useCallback(
        (panelLayout: WorkbenchPanelLayoutSnapshot) => {
            const currentVaultPath = vaultState.currentVaultPath || configState.loadedVaultPath;
            if (!currentVaultPath || !configState.backendConfig) return;
            if (workspaceLayoutBlockedVaultPathRef.current === currentVaultPath && configState.loadedVaultPath !== currentVaultPath) return;
            if (!configState.featureSettings.restoreWorkspaceLayout) return;

            panelLayoutSnapshotRef.current = panelLayout;

            if (panelLayoutPersistTimerRef.current) {
                clearTimeout(panelLayoutPersistTimerRef.current);
            }

            panelLayoutPersistTimerRef.current = setTimeout(() => {
                panelLayoutPersistTimerRef.current = null;

                const snap = sidebarSnapshotRef.current;
                const snapshot: SidebarLayoutSnapshot = {
                    version: 1,
                    left: {
                        width: snap?.left.width ?? DEFAULT_LEFT_RAIL_WIDTH,
                        visible: leftSidebarVisibleRef.current,
                        activeActivityId: snap?.left.activeActivityId ?? null,
                        activePanelId: snap?.left.activePanelId ?? null,
                    },
                    right: {
                        width: snap?.right.width ?? DEFAULT_RIGHT_RAIL_WIDTH,
                        visible: hasRightSidebar ? rightSidebarVisibleRef.current : false,
                        activeActivityId: snap?.right.activeActivityId ?? null,
                        activePanelId: snap?.right.activePanelId ?? null,
                    },
                    panelStates: snap?.panelStates ?? [],
                    paneStates: snap?.paneStates ?? [],
                    convertiblePanelStates: snap?.convertiblePanelStates ?? [],
                    sectionRatios: sectionRatiosRef.current,
                    panelLayout,
                };

                const serializedSnapshot = JSON.stringify(snapshot);
                if (persistedSnapshotRef.current === serializedSnapshot) return;

                persistedSnapshotRef.current = serializedSnapshot;
                void saveSidebarLayoutSnapshot(snapshot);
            }, 300);
        },
        [
            hasRightSidebar,
            configState.backendConfig,
            configState.loadedVaultPath,
            configState.featureSettings.restoreWorkspaceLayout,
            vaultState.currentVaultPath,
        ],
    );

    const handleWorkspaceLayoutSnapshotChange = useCallback(
        (snapshot: WorkbenchLayoutSnapshot) => {
            setOpenTabCount(countWorkspaceLayoutTabs(snapshot));

            const currentVaultPath = vaultState.currentVaultPath || configState.loadedVaultPath;
            if (!currentVaultPath || !configState.backendConfig) return;
            if (workspaceLayoutBlockedVaultPathRef.current === currentVaultPath && configState.loadedVaultPath !== currentVaultPath) return;
            if (!configState.featureSettings.restoreWorkspaceLayout) return;
            if (workspaceSnapshot && !workspaceLayoutHydrationComplete) return;
            if (workspaceLayoutRestorePendingRef.current) return;

            const serializedSnapshot = JSON.stringify(buildWorkspaceLayoutConfigValue(snapshot));
            if (persistedWorkspaceLayoutRef.current === serializedSnapshot) return;

            persistedWorkspaceLayoutRef.current = serializedSnapshot;

            if (workspaceLayoutPersistTimerRef.current) {
                clearTimeout(workspaceLayoutPersistTimerRef.current);
            }

            workspaceLayoutPersistTimerRef.current = setTimeout(() => {
                workspaceLayoutPersistTimerRef.current = null;
                void saveWorkspaceLayoutSnapshot(snapshot).catch((error) => {
                    console.warn("[workbench-layout-host] workspace layout save failed", {
                        message: error instanceof Error ? error.message : String(error),
                    });
                });
            }, 300);
        },
        [
            configState.backendConfig,
            configState.loadedVaultPath,
            configState.featureSettings.restoreWorkspaceLayout,
            vaultState.currentVaultPath,
            workspaceLayoutHydrationComplete,
            workspaceSnapshot,
        ],
    );

    /* ── Callbacks ── */

    const handleActivateActivity = useCallback(
        (activityId: string, context: WorkbenchPanelContext) => {
            activeTabIdRef.current = context.activeTabId;

            // Settings icon opens a settings tab directly
            if (activityId === SETTINGS_ACTIVITY_ID) {
                workbenchApiRef.current?.openTab(decorateTabDefinition({
                    id: "settings",
                    title: i18n.t("workbenchLayout.settingsTooltip"),
                    component: "settings",
                }));
                return;
            }

            const activity = activitiesById.get(activityId);
            if (!activity || activity.type !== "callback") return;
            activity.onActivate(buildPanelRenderContext(context, workbenchApiRef, openFileHelper, buildCommandContext, decorateTabDefinition));
        },
        [activitiesById, decorateTabDefinition, openFileHelper, buildCommandContext],
    );

    const renderPanelContent = useCallback(
        (panelId: string, context: WorkbenchPanelContext): ReactNode => {
            activeTabIdRef.current = context.activeTabId;
            const panel = panelsById.get(panelId);
            if (!panel) {
                return (
                    <div className="workbench-layout-v2__content-card">
                        <div className="workbench-layout-v2__content-eyebrow">{panelId}</div>
                        <p>{i18n.t("workbenchLayout.noRegisteredPanel")}</p>
                    </div>
                );
            }
            return (
                <div
                    className="workbench-layout-v2__panel-focus-scope"
                    {...{ [PANEL_ID_DATA_ATTR]: panelId }}
                >
                    {panel.render(buildPanelRenderContext(context, workbenchApiRef, openFileHelper, buildCommandContext, decorateTabDefinition))}
                </div>
            );
        },
        [panelsById, openFileHelper, buildCommandContext, decorateTabDefinition],
    );

    const renderActivityIcon = useCallback(
        (activity: WorkbenchActivityDefinition): ReactNode => {
            return activity.icon ?? (
                <span className="workbench-layout-v2__activity-symbol">
                    {(activity.label.trim()[0] ?? "?").toUpperCase()}
                </span>
            );
        },
        [],
    );

    /**
     * @function renderTabDragPreviewContent
     * @description 为 layout-v2 split preview 渲染宿主侧轻量内容；Markdown editor 在 overlay 预览树中使用 DOM 镜像而不是重新挂载 EditorView。
     * @param tab layout-v2 当前 preview tab 定义。
     * @param context layout-v2 preview 内容上下文。
     * @returns preview 内容；非 CodeMirror tab 返回 undefined 以使用 layout-v2 默认占位。
     */
    const renderTabDragPreviewContent = useCallback((
        tab: TabSectionTabDefinition,
        context: TabDragPreviewContentRenderContext,
    ): ReactNode => {
        const payload = readWorkbenchTabPayload(tab);
        if (payload.component !== "codemirror" || (context.renderMode !== "overlay" && !context.isPreviewTabSection)) {
            return undefined;
        }

        return (
            <CodeMirrorEditorPreviewMirror
                articleId={tab.id}
                title={tab.title}
            />
        );
    }, []);

    /**
     * @function shouldRenderInactiveTabContent
     * @description 只为需要保留运行态的轻量 tab 保持 inactive 内容挂载，避免图谱切换后重新加载。
     * @param tab layout-v2 tab 定义。
     * @returns 该 tab 处于非激活状态时是否继续渲染内容。
     */
    const shouldRenderInactiveTabContent = useCallback((tab: TabSectionTabDefinition): boolean => {
        const payload = readWorkbenchTabPayload(tab);
        return KEEP_ALIVE_INACTIVE_TAB_COMPONENT_IDS.has(payload.component);
    }, []);

    /**
     * @function shouldDeferTabContentPresentation
     * @description 判断 tab 首次展示是否需要等待组件自行提交 ready。
     * @param tab layout-v2 tab 定义。
     * @returns 该 tab 是否进入提交展示流程。
     */
    const shouldDeferTabContentPresentation = useCallback((tab: TabSectionTabDefinition): boolean => {
        const payload = readWorkbenchTabPayload(tab);
        return deferredPresentationTabComponentIds.has(payload.component);
    }, [deferredPresentationTabComponentIds]);

    /**
     * @function shouldDeferPanelContentPresentation
     * @description 判断 panel 首次展示是否需要等待面板自行提交 ready。
     * @param panel layout-v2 panel 定义。
     * @returns 该 panel 是否进入提交展示流程。
     */
    const shouldDeferPanelContentPresentation = useCallback((panel: PanelSectionPanelDefinition): boolean => {
        return deferredPresentationPanelIds.has(panel.id);
    }, [deferredPresentationPanelIds]);

    /* ── Activity bar context menus ── */

    useContextMenuProvider<WorkbenchContextMenuPayload>({
        id: contextMenuIds.activityItem,
        buildMenu: (payload) => payload.menuItems,
        handleAction: (selectedId, payload) => payload.handleAction(selectedId),
    });

    useContextMenuProvider<WorkbenchContextMenuPayload>({
        id: contextMenuIds.activityBackground,
        buildMenu: (payload) => payload.menuItems,
        handleAction: (selectedId, payload) => payload.handleAction(selectedId),
    });

    const handleActivityIconContextMenu = useCallback(
        async (iconId: string, _event: { clientX: number; clientY: number }) => {
            const item = mergedActivityItems.find((i) => i.id === iconId);
            if (!item) return;

            const menuItems: NativeContextMenuItem[] = [];
            if (item.section !== "top") {
                menuItems.push({ id: "align-top", text: i18n.t("workbenchLayout.activityAlignTop") });
            }
            if (item.section !== "bottom") {
                menuItems.push({ id: "align-bottom", text: i18n.t("workbenchLayout.activityAlignBottom") });
            }
            menuItems.push({ id: "hide", text: i18n.t("workbenchLayout.activityHide") });
            if (iconId.startsWith(CUSTOM_ACTIVITY_REGISTRATION_PREFIX)) {
                menuItems.push({ id: "delete-custom-activity", text: i18n.t("workbenchLayout.activityDeleteCustom") });
            }
            menuItems.push({ id: "create-custom-activity", text: i18n.t("workbenchLayout.activityCreateCustom") });

            await showRegisteredContextMenu(contextMenuIds.activityItem, _event, {
                menuItems,
                handleAction: (selectedId: string) => {
            if (selectedId === "align-top" || selectedId === "align-bottom") {
                const newSection = selectedId === "align-top" ? "top" : "bottom";
                const withoutItem = mergedActivityItems.filter((i) => i.id !== iconId);
                const topItems = withoutItem.filter((i) => i.section === "top");
                const bottomItems = withoutItem.filter((i) => i.section === "bottom");
                const moved = { ...item, section: newSection as "top" | "bottom" };
                if (newSection === "top") {
                    topItems.push(moved);
                } else {
                    bottomItems.push(moved);
                }
                const merged = [...topItems, ...bottomItems];
                updateActivityBarConfig({
                    items: merged.map((i) => ({ id: i.id, section: i.section, visible: i.visible, bar: i.bar })),
                });
            } else if (selectedId === "hide") {
                const updated = mergedActivityItems.map((i) =>
                    i.id === iconId ? { ...i, visible: false } : i,
                );
                updateActivityBarConfig({
                    items: updated.map((i) => ({ id: i.id, section: i.section, visible: i.visible, bar: i.bar })),
                });
            } else if (selectedId === "delete-custom-activity") {
                const configId = iconId.slice(CUSTOM_ACTIVITY_REGISTRATION_PREFIX.length);
                updateActivityBarConfig({
                    items: mergedActivityItems
                        .filter((i) => i.id !== iconId)
                        .map((i) => ({ id: i.id, section: i.section, visible: i.visible, bar: i.bar })),
                });
                emitCustomActivityRemovalRequestedEvent({ activityConfigId: configId });
            } else if (selectedId === "create-custom-activity") {
                executeCommand(CUSTOM_ACTIVITY_CREATE_COMMAND_ID as CommandId, buildCommandContext());
            }
                },
            });
        },
        [mergedActivityItems, buildCommandContext],
    );

    const handleActivityBarBackgroundContextMenu = useCallback(
        async (_event: { clientX: number; clientY: number }) => {
            const menuItems: NativeContextMenuItem[] = [
                { id: "create-custom-activity", text: i18n.t("workbenchLayout.activityCreateCustom") },
            ];
            for (const item of mergedActivityItems) {
                const activity = activitiesById.get(item.id);
                const title = activity ? resolveActivityTitle(activity.title) : item.id;
                menuItems.push({
                    id: item.id,
                    text: title,
                    checked: item.visible,
                });
            }

            await showRegisteredContextMenu(contextMenuIds.activityBackground, _event, {
                menuItems,
                handleAction: (selectedId: string) => {
            if (selectedId === "create-custom-activity") {
                executeCommand(CUSTOM_ACTIVITY_CREATE_COMMAND_ID as CommandId, buildCommandContext());
                return;
            }

            const updated = mergedActivityItems.map((i) =>
                i.id === selectedId ? { ...i, visible: !i.visible } : i,
            );
            updateActivityBarConfig({
                items: updated.map((i) => ({ id: i.id, section: i.section, visible: i.visible, bar: i.bar })),
            });
                },
            });
        },
        [mergedActivityItems, activitiesById, buildCommandContext],
    );

    const handleActivityBarsChange = useCallback((activityBars: ActivityBarsState) => {
        updateActivityBarConfig(
            projectActivityBarConfigFromRuntime(mergedActivityItems, {
                left: activityBars.bars[WORKBENCH_LEFT_ACTIVITY_BAR_ID]?.icons.map((icon) => icon.id) ?? [],
                right: activityBars.bars[WORKBENCH_RIGHT_ACTIVITY_BAR_ID]?.icons.map((icon) => icon.id) ?? [],
            }),
        );
    }, [mergedActivityItems]);

    return (
        <div
            ref={layoutRootRef}
            className={[
                "workbench-layout-v2",
                shouldShowHomeEmptyState ? "workbench-layout-v2--home-empty" : "",
            ].filter(Boolean).join(" ")}
            data-workbench-layout-mode="layout-v2"
        >
            <VSCodeWorkbench
                activities={activityDefinitions}
                panels={panelDefinitions}
                tabComponents={tabComponents}
                initialTabs={initialTabs}
                hasRightSidebar={hasRightSidebar}
                initialSidebarState={initialSidebarState}
                initialSectionRatios={sidebarSnapshot?.sectionRatios}
                initialPanelLayoutSnapshot={sidebarSnapshot?.panelLayout}
                initialLayoutSnapshot={hydratedWorkspaceSnapshot}
                hideEmptyPanelBar
                renderInactiveTabContent={shouldRenderInactiveTabContent}
                deferTabContentPresentation={shouldDeferTabContentPresentation}
                deferPanelContentPresentation={shouldDeferPanelContentPresentation}
                tabDragPreviewRenderMode="overlay"
                preserveActiveTabContentDuringDrag
                renderTabContentInDragPreviewLayout={false}
                renderPanelContentInDragPreviewLayout={false}
                renderTabDragPreviewContent={renderTabDragPreviewContent}
                externalTabDragResolver={workspaceFileExternalTabDragResolver}
                renderActivityIcon={renderActivityIcon}
                renderPanelContent={renderPanelContent}
                onActivateActivity={handleActivateActivity}
                onSidebarStateChange={handleSidebarStateChange}
                onSectionRatioChange={handleSectionRatioChange}
                onPanelLayoutChange={handlePanelLayoutChange}
                onLayoutSnapshotChange={handleWorkspaceLayoutSnapshotChange}
                onActivityIconContextMenu={handleActivityIconContextMenu}
                onActivityBarsChange={handleActivityBarsChange}
                onActiveTabChange={handleActiveTabChange}
                onActivityBarBackgroundContextMenu={handleActivityBarBackgroundContextMenu}
                apiRef={workbenchApiRef}
                className="workbench-layout-v2__layout"
            />
            {shouldShowHomeEmptyState && homeEmptyStateTarget ? createPortal(
                <WorkbenchHomeEmptyState
                    vaultLabel={homeVaultLabel}
                    markdownNoteCount={markdownNotePaths.length}
                    isVaultLoading={vaultState.isLoadingTree}
                    canCreateNote={canCreateHomeNote}
                    canOpenRandomNote={canOpenRandomHomeNote}
                    onCreateNote={handleCreateHomeNote}
                    onOpenRandomNote={handleOpenRandomHomeNote}
                    onOpenVault={handleOpenHomeVault}
                />,
                homeEmptyStateTarget,
            ) : null}
            {registeredOverlays.map((overlay) => (
                <div key={overlay.id} data-overlay-id={overlay.id}>
                    {overlay.render(overlayRenderContext)}
                </div>
            ))}
            <CreateEntryModal
                isOpen={createEntryDraftRequest !== null}
                kind={createEntryDraftRequest?.kind ?? "file"}
                baseDirectory={createEntryDraftRequest?.baseDirectory ?? ""}
                title={createEntryDraftRequest?.title ?? ""}
                placeholder={createEntryDraftRequest?.placeholder ?? ""}
                initialValue={createEntryDraftRequest?.initialValue ?? ""}
                onClose={() => {
                    console.info("[workbench-layout-host] close create-entry modal");
                    settleCreateEntryDraftRequest(null);
                }}
                onConfirm={(draftName) => {
                    console.info("[workbench-layout-host] confirm create-entry modal", {
                        kind: createEntryDraftRequest?.kind,
                        baseDirectory: createEntryDraftRequest?.baseDirectory,
                        draftName,
                    });
                    settleCreateEntryDraftRequest(draftName);
                }}
            />
        </div>
    );
}

export function WorkbenchLayoutHost(props: WorkbenchLayoutHostProps): ReactNode {
    return <LayoutV2WorkbenchHost {...props} />;
}
