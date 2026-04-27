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
import { Settings } from "lucide-react";
import {
    readWorkbenchTabPayload,
    VSCodeWorkbench,
    type TabDragPreviewContentRenderContext,
    type PanelSectionPanelDefinition,
    type TabSectionTabDefinition,
    type WorkbenchActivityDefinition,
    type WorkbenchApi,
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
    type WorkbenchTabProps,
} from "./workbenchContracts";
import {
    SETTINGS_ACTIVITY_ID,
    ensureActivityBarConfigLoaded,
    mergeActivityBarConfig,
    updateActivityBarConfig,
    useActivityBarConfig,
    type DefaultActivityItemInfo,
} from "./activityBarStore";
import {
    showRegisteredContextMenu,
    useContextMenuProvider,
    type NativeContextMenuItem,
} from "./contextMenuCenter";
import { emitCustomActivityRemovalRequestedEvent, emitEditorCommandRequestedEvent } from "../events/appEventBus";
import { clearActiveEditor, getActiveEditorSnapshot, reportActiveEditor } from "../editor/activeEditorStore";
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
import { openFileWithResolver, resolveFileTabDefinition } from "./openFileService";
import { useConfigState } from "../config/configStore";
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
} from "../registry";
import { useVaultState } from "../vault/vaultStore";
import {
    executeCommand,
    getCommandDefinitions,
    type CommandContext,
    type CreateEntryDraftRequest,
    type CommandId,
} from "../commands/commandSystem";
import { requestVaultDeleteConfirmation } from "../commands/deleteConfirmation";

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
                    label: i18n.t("dockview.settingsTooltip"),
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
        activityId: panel.activityId,
        position: panel.defaultPosition,
        order: panel.defaultOrder,
    }));
}

function mapInitialTabs(initialTabs?: TabInstanceDefinition[]): WorkbenchTabDefinition[] | undefined {
    if (!initialTabs || initialTabs.length === 0) return undefined;
    return initialTabs.map((tab) => ({
        id: tab.id,
        title: tab.title,
        component: tab.component,
        params: tab.params,
    }));
}

function buildPanelRenderContext(
    workbenchContext: WorkbenchPanelContext,
    openFileHelper: (options: {
        relativePath: string;
        contentOverride?: string;
        preferredOpenerId?: string;
    }) => Promise<void>,
    buildCommandContext: () => CommandContext,
): PanelRenderContext {
    return {
        activeTabId: workbenchContext.activeTabId,
        workbenchApi: null,
        hostPanelId: workbenchContext.hostPanelId,
        convertibleView: null,
        openTab: (tab: TabInstanceDefinition) => {
            workbenchContext.openTab({
                id: tab.id,
                title: tab.title,
                component: tab.component,
                params: tab.params,
            });
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
}): ReactNode {
    const { Component, params, api, workbenchApiRef } = props;

    const stableApi = useMemo(() => ({
        id: api.id,
        close: api.close,
        setActive: api.setActive,
        setTitle: (title: string) => workbenchApiRef.current?.updateTab(api.id, { title }),
        markContentReady: api.markContentReady,
    }), [api.id, api.close, api.setActive, api.markContentReady]);

    const containerApi = useMemo(() => ({
        getPanel: (tabId: string) => {
            const tab = workbenchApiRef.current?.getTab(tabId);
            if (!tab) return null;
            return {
                id: tab.id,
                params: tab.params,
                api: {
                    close: () => workbenchApiRef.current?.closeTab(tabId),
                    setActive: () => workbenchApiRef.current?.setActiveTab(tabId),
                    setTitle: (title: string) => workbenchApiRef.current?.updateTab(tabId, { title }),
                    updateParameters: (params: Record<string, unknown>) => {
                        workbenchApiRef.current?.updateTab(tabId, { params });
                    },
                },
            };
        },
        get panels() {
            return (workbenchApiRef.current?.getTabs() ?? []).map((t) => ({
                id: t.id,
                params: t.params,
                api: {
                    setActive: () => workbenchApiRef.current?.setActiveTab(t.id),
                    setTitle: (title: string) => workbenchApiRef.current?.updateTab(t.id, { title }),
                    updateParameters: (params: Record<string, unknown>) => {
                        workbenchApiRef.current?.updateTab(t.id, { params });
                    },
                },
            }));
        },
        addPanel: (options: { id: string; title: string; component: string; params?: Record<string, unknown> }) => {
            workbenchApiRef.current?.openTab({
                id: options.id,
                title: options.title,
                component: options.component,
                params: options.params,
            });
        },
    }), [workbenchApiRef]);

    return <Component {...({ params, api: stableApi, containerApi } satisfies WorkbenchTabProps<Record<string, unknown>>)} />;
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
                    />
                </div>
            );
        }
        return result;
    }, [registeredTabComponents]);

    const initialTabs = useMemo(() => mapInitialTabs(props.initialTabs), [props.initialTabs]);

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

    useEffect(() => {
        persistedWorkspaceLayoutRef.current = workspaceSnapshot
            ? JSON.stringify(buildWorkspaceLayoutConfigValue(workspaceSnapshot))
            : null;
    }, [workspaceSnapshot]);

    /* ── Open file helper ── */

    const openFileHelper = useCallback(
        async (options: { relativePath: string; contentOverride?: string; preferredOpenerId?: string }) => {
            const api = workbenchApiRef.current;
            if (!api) return;
            await openFileWithResolver({
                relativePath: options.relativePath,
                currentVaultPath: vaultState.currentVaultPath || configState.loadedVaultPath || undefined,
                contentOverride: options.contentOverride,
                preferredOpenerId: options.preferredOpenerId,
                openTab: (tab: TabInstanceDefinition) => {
                    api.openTab({
                        id: tab.id,
                        title: tab.title,
                        component: tab.component,
                        params: tab.params,
                    });
                },
            });
        },
        [vaultState.currentVaultPath, configState.loadedVaultPath],
    );

    useEffect(() => {
        let cancelled = false;

        if (!workspaceSnapshot || !configState.featureSettings.restoreWorkspaceLayout) {
            workspaceLayoutRestorePendingRef.current = false;
            setWorkspaceLayoutHydrationComplete(false);
            setHydratedWorkspaceSnapshot(null);
            return () => {
                cancelled = true;
            };
        }

        workspaceLayoutRestorePendingRef.current = true;
        setWorkspaceLayoutHydrationComplete(false);
        const currentVaultPath = vaultState.currentVaultPath || configState.loadedVaultPath || undefined;
        void hydrateWorkspaceLayoutSnapshot(workspaceSnapshot, async (tab) => {
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
            void openFileHelper({ relativePath, contentOverride: content, ...tabParams });
        },
        openTab: (tab) => {
            workbenchApiRef.current?.openTab({
                id: tab.id,
                title: tab.title,
                component: tab.component,
                params: tab.params,
            });
        },
        getExistingMarkdownPaths: () => [],
        activatePanel: (panelId: string) => workbenchApiRef.current?.activatePanel(panelId),
        toggleLeftSidebarVisibility: () => {
            leftSidebarVisibleRef.current = !leftSidebarVisibleRef.current;
            workbenchApiRef.current?.setLeftSidebarVisible(leftSidebarVisibleRef.current);
        },
        toggleRightSidebarVisibility: () => {
            rightSidebarVisibleRef.current = !rightSidebarVisibleRef.current;
            workbenchApiRef.current?.setRightSidebarVisible(rightSidebarVisibleRef.current);
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
    }), [openFileHelper, requestCreateEntryDraft]);

    /* ── Active tab → active editor sync ── */

    const handleActiveTabChange = useCallback((tabId: string | null) => {
        activeTabIdRef.current = tabId;
        if (!tabId) {
            clearActiveEditor();
            return;
        }
        const tab = workbenchApiRef.current?.getTab(tabId);
        const path = typeof tab?.params?.path === "string"
            ? tab.params.path.replace(/\\/g, "/")
            : null;
        if (!path || !(path.toLowerCase().endsWith(".md") || path.toLowerCase().endsWith(".markdown"))) {
            clearActiveEditor();
            return;
        }
        reportActiveEditor({ articleId: tabId, path });
    }, []);

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
            workbenchApiRef.current?.openTab({
                id: tab.id,
                title: tab.title,
                component: tab.component,
                params: tab.params,
            });
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
    }), [buildCommandContext, openFileHelper]);

    /* ── Right sidebar toggle bridge ── */

    useEffect(() => {
        return subscribeRightSidebarToggleRequest(() => {
            rightSidebarVisibleRef.current = !rightSidebarVisibleRef.current;
            workbenchApiRef.current?.setRightSidebarVisible(rightSidebarVisibleRef.current);
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

    useEffect(() => {
        return () => {
            if (sectionRatioPersistTimerRef.current) {
                clearTimeout(sectionRatioPersistTimerRef.current);
            }
            if (panelLayoutPersistTimerRef.current) {
                clearTimeout(panelLayoutPersistTimerRef.current);
            }
            if (workspaceLayoutPersistTimerRef.current) {
                clearTimeout(workspaceLayoutPersistTimerRef.current);
            }
        };
    }, []);

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
            const currentVaultPath = vaultState.currentVaultPath || configState.loadedVaultPath;
            if (!currentVaultPath || !configState.backendConfig) return;
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
                workbenchApiRef.current?.openTab({
                    id: "settings",
                    title: i18n.t("dockview.settingsTooltip"),
                    component: "settings",
                });
                return;
            }

            const activity = activitiesById.get(activityId);
            if (!activity || activity.type !== "callback") return;
            activity.onActivate(buildPanelRenderContext(context, openFileHelper, buildCommandContext));
        },
        [activitiesById, openFileHelper, buildCommandContext],
    );

    const renderPanelContent = useCallback(
        (panelId: string, context: WorkbenchPanelContext): ReactNode => {
            activeTabIdRef.current = context.activeTabId;
            const panel = panelsById.get(panelId);
            if (!panel) {
                return (
                    <div className="workbench-layout-v2__content-card">
                        <div className="workbench-layout-v2__content-eyebrow">{panelId}</div>
                        <p>{i18n.t("dockview.noRegisteredPanel")}</p>
                    </div>
                );
            }
            return (
                <div
                    className="workbench-layout-v2__panel-focus-scope"
                    {...{ [PANEL_ID_DATA_ATTR]: panelId }}
                >
                    {panel.render(buildPanelRenderContext(context, openFileHelper, buildCommandContext))}
                </div>
            );
        },
        [panelsById, openFileHelper, buildCommandContext],
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
                menuItems.push({ id: "align-top", text: i18n.t("dockview.activityAlignTop") });
            }
            if (item.section !== "bottom") {
                menuItems.push({ id: "align-bottom", text: i18n.t("dockview.activityAlignBottom") });
            }
            menuItems.push({ id: "hide", text: i18n.t("dockview.activityHide") });
            if (iconId.startsWith(CUSTOM_ACTIVITY_REGISTRATION_PREFIX)) {
                menuItems.push({ id: "delete-custom-activity", text: i18n.t("dockview.activityDeleteCustom") });
            }
            menuItems.push({ id: "create-custom-activity", text: i18n.t("dockview.activityCreateCustom") });

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
                { id: "create-custom-activity", text: i18n.t("dockview.activityCreateCustom") },
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

    return (
        <div className="workbench-layout-v2" data-workbench-layout-mode="layout-v2">
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
                renderActivityIcon={renderActivityIcon}
                renderPanelContent={renderPanelContent}
                onActivateActivity={handleActivateActivity}
                onSidebarStateChange={handleSidebarStateChange}
                onSectionRatioChange={handleSectionRatioChange}
                onPanelLayoutChange={handlePanelLayoutChange}
                onLayoutSnapshotChange={handleWorkspaceLayoutSnapshotChange}
                onActivityIconContextMenu={handleActivityIconContextMenu}
                onActiveTabChange={handleActiveTabChange}
                onActivityBarBackgroundContextMenu={handleActivityBarBackgroundContextMenu}
                apiRef={workbenchApiRef}
                className="workbench-layout-v2__layout"
            />
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
