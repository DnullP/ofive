import {
    useCallback,
    useEffect,
    useMemo,
    useRef,
    useState,
    type MutableRefObject,
    type ReactNode,
} from "react";
import {
    ActivityBar as LayoutV2ActivityBar,
    PanelSection,
    SectionComponentHost,
    SectionLayoutView,
    TabSection,
    createActivityBarState,
    createRootSection,
    createSectionComponentBinding,
    createSectionComponentRegistry,
    createVSCodeLayoutState,
    createVSCodeLayoutStore,
    destroySectionTree,
    findSectionNode,
    moveTabSectionTab,
    setSectionHidden as setLayoutSectionHidden,
    splitSectionTree,
    useVSCodeLayoutStoreState,
    type ActivityBarDragSession,
    type ActivityBarIconDefinition,
    type ActivityBarStateItem,
    type PanelSectionDragSession,
    type PanelSectionPanelDefinition,
    type PanelSectionStateItem,
    type SectionComponentBinding,
    type SectionComponentData,
    type SectionDraft,
    type SectionNode,
    type SectionSplitDirection,
    type TabSectionDragSession,
    type TabSectionsState,
    type TabSectionStateItem,
    type TabSectionTabDefinition,
    type VSCodeLayoutState,
    type VSCodeLayoutStore,
} from "layout-v2";
import {
    type DockviewLayoutDebugApi,
    type PanelRenderContext,
    type TabInstanceDefinition,
} from "./DockviewLayout";
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
    getSidebarLayoutFromVaultConfig,
    mergePanelStatesWithSidebarLayoutFallback,
    restorePanelStatesFromSidebarLayout,
    saveSidebarLayoutSnapshot,
    type SidebarLayoutSnapshot,
} from "./sidebarLayoutPersistence";
import {
    getVisiblePanelIds,
    type PanelDefinitionInfo,
    type PanelRuntimeState,
} from "./layoutStateReducers";
import {
    setRightSidebarVisibilitySnapshot,
    subscribeRightSidebarToggleRequest,
} from "./rightSidebarVisibilityBridge";
import { openFileWithResolver } from "./openFileService";
import { useConfigState } from "../config/configStore";
import {
    resolveActivityTitle,
    resolveTitle,
    useActivities,
    usePanels,
    useSidebarHeaderActions,
    useTabComponents,
    type ActivityDescriptor,
    type PanelDescriptor,
    type SidebarHeaderActionContext,
} from "../registry";
import { useVaultState } from "../vault/vaultStore";
import "../../../node_modules/layout-v2/dist/layout-v2.css";
import "./sidebar/Sidebar.css";
import { SidebarHeader } from "./sidebar/SidebarHeader";
import { SidebarIconBar } from "./sidebar/SidebarIconBar";
import type { ActivityIconItem, IconDragState, SidebarSide } from "./sidebar/types";
import "./WorkbenchLayoutHost.css";

const MAIN_TAB_SECTION_ID = "main-tabs";
const LEFT_ACTIVITY_BAR_ID = "left-activity-bar";
const RIGHT_ACTIVITY_BAR_ID = "right-activity-bar";
const LEFT_PANEL_SECTION_ID = "left-panel-section";
const RIGHT_PANEL_SECTION_ID = "right-panel-section";
const DEFAULT_LEFT_RAIL_WIDTH = 280;
const DEFAULT_RIGHT_RAIL_WIDTH = 260;
const SIDEBAR_LAYOUT_SAVE_DEBOUNCE_MS = 280;
const TAB_SPLIT_RATIO = 0.5;
const PREVIEW_TAB_SECTION_ID_PREFIX = "preview-tab-section";
const PREVIEW_SECTION_ID_PREFIX = "preview-section";

type WorkbenchSectionRole = "root" | "container" | "activity-bar" | "sidebar" | "main";

interface LayoutV2TabPayload {
    component: string;
    params: Record<string, unknown>;
}

type WorkbenchSectionComponentBinding =
    | SectionComponentBinding<"empty", {
        label: string;
        description: string;
    }>
    | SectionComponentBinding<"activity-rail", Record<string, never>>
    | SectionComponentBinding<"panel-section", {
        panelSectionId: string;
    }>
    | SectionComponentBinding<"tab-section", {
        tabSectionId: string;
    }>
    | SectionComponentBinding<"sidebar-host", {
        side: SidebarSide;
    }>;

interface WorkbenchSectionData extends SectionComponentData<WorkbenchSectionComponentBinding> {
    role: WorkbenchSectionRole;
}

export interface WorkbenchLayoutHostProps {
    initialTabs?: TabInstanceDefinition[];
    initialActivePanelId?: string;
    debugApiRef?: MutableRefObject<DockviewLayoutDebugApi | null>;
}

function createWorkbenchSectionDraft(
    id: string,
    title: string,
    role: WorkbenchSectionRole,
    component: WorkbenchSectionComponentBinding,
    resizableEdges?: SectionDraft<WorkbenchSectionData>["resizableEdges"],
): SectionDraft<WorkbenchSectionData> {
    return {
        id,
        title,
        data: {
            role,
            component,
        },
        resizableEdges,
    };
}

function buildInitialTabs(initialTabs?: TabInstanceDefinition[]): TabSectionTabDefinition[] {
    if (!initialTabs || initialTabs.length === 0) {
        return [
            {
                id: "welcome",
                title: "Welcome",
                type: "workbench-tab",
                payload: {
                    component: "home",
                    params: {},
                } satisfies LayoutV2TabPayload,
                content: "The layout-v2 host is live. Registry, persistence, and real tab components will be migrated next.",
                tone: "blue",
            },
        ];
    }

    return initialTabs.map((tab) => ({
        id: tab.id,
        title: tab.title,
        type: "workbench-tab",
        payload: {
            component: tab.component,
            params: tab.params ?? {},
        } satisfies LayoutV2TabPayload,
        content: `Component: ${tab.component}`,
        tone: "neutral",
    }));
}

function buildPanelDefinitionInfo(panel: PanelDescriptor): PanelDefinitionInfo {
    return {
        id: panel.id,
        activityId: panel.activityId,
        position: panel.defaultPosition,
        order: panel.defaultOrder,
    };
}

function readTabPayload(tab: TabSectionTabDefinition): LayoutV2TabPayload {
    const payload = tab.payload as LayoutV2TabPayload | undefined;
    return {
        component: payload?.component ?? "home",
        params: payload?.params ?? {},
    };
}

function renderPayload(payload: unknown): string {
    if (payload == null) {
        return "{}";
    }

    try {
        return JSON.stringify(payload, null, 2);
    } catch {
        return "<unserializable payload>";
    }
}

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

function resolveSymbolFromLabel(label: string): string {
    const trimmed = label.trim();
    return (trimmed[0] ?? "?").toUpperCase();
}

function buildActivityBarStateItem(
    barId: string,
    items: ActivityIconItem[],
    activitiesById: Map<string, ActivityDescriptor>,
    selectedIconId: string | null,
): ActivityBarStateItem {
    const icons: ActivityBarIconDefinition[] = items.map((item) => ({
        id: item.id,
        label: item.title,
        symbol: resolveSymbolFromLabel(item.title),
        activationMode: activitiesById.get(item.id)?.type === "callback" ? "action" : "focus",
        meta: {
            icon: activitiesById.get(item.id)?.icon ?? null,
            section: item.section,
            bar: item.bar,
        },
    }));

    return {
        id: barId,
        icons,
        selectedIconId,
    };
}

function buildActivityBarRuntimeState(
    items: Array<{
        id: string;
        section: "top" | "bottom";
        visible: boolean;
        bar: "left" | "right";
    }>,
    activitiesById: Map<string, ActivityDescriptor>,
    selectedIconIds: {
        left: string | null;
        right: string | null;
    },
) {
    const leftItems = items.filter((item) => item.visible && item.bar === "left" && item.id !== SETTINGS_ACTIVITY_ID);
    const rightItems = items.filter((item) => item.visible && item.bar === "right");

    return createActivityBarState([
        buildActivityBarStateItem(LEFT_ACTIVITY_BAR_ID, leftItems.map((item) => ({
            id: item.id,
            title: resolveActivityTitle(activitiesById.get(item.id)?.title ?? item.id),
            icon: activitiesById.get(item.id)?.icon ?? null,
            section: item.section,
            visible: item.visible,
            isSettings: false,
            bar: item.bar,
        })), activitiesById, selectedIconIds.left),
        buildActivityBarStateItem(RIGHT_ACTIVITY_BAR_ID, rightItems.map((item) => ({
            id: item.id,
            title: resolveActivityTitle(activitiesById.get(item.id)?.title ?? item.id),
            icon: activitiesById.get(item.id)?.icon ?? null,
            section: item.section,
            visible: item.visible,
            isSettings: false,
            bar: item.bar,
        })), activitiesById, selectedIconIds.right),
    ]);
}

function summarizeActivityBarRuntimeState(state: ReturnType<typeof createActivityBarState>): string {
    return JSON.stringify(
        Object.values(state.bars)
            .map((bar) => ({
                id: bar.id,
                selectedIconId: bar.selectedIconId,
                iconIds: bar.icons.map((icon) => icon.id),
            }))
            .sort((left, right) => left.id.localeCompare(right.id)),
    );
}

function buildPanelSectionPanels(
    panels: PanelDescriptor[],
    activitiesById: Map<string, ActivityDescriptor>,
): PanelSectionPanelDefinition[] {
    return panels.map((panel) => ({
        id: panel.id,
        label: resolveTitle(panel.title),
        symbol: resolveSymbolFromLabel(resolveTitle(panel.title)),
        content: resolveTitle(panel.title),
        tone: "neutral",
        meta: {
            activityId: panel.activityId,
            icon: activitiesById.get(panel.activityId)?.icon ?? null,
        },
    }));
}

function buildPanelSectionStateItem(
    sectionId: string,
    panels: PanelSectionPanelDefinition[],
    preferredPanelId: string | null,
    currentSection: PanelSectionStateItem | null,
): PanelSectionStateItem {
    const focusedPanelId = panels.some((panel) => panel.id === preferredPanelId)
        ? preferredPanelId
        : (panels[0]?.id ?? null);

    return {
        id: sectionId,
        panels,
        focusedPanelId,
        isCollapsed: currentSection?.isCollapsed ?? false,
        isRoot: currentSection?.isRoot ?? sectionId === LEFT_PANEL_SECTION_ID,
        meta: currentSection?.meta,
    };
}

function resolveActiveActivityId(
    preferredActivityId: string | null,
    visibleActivityIds: string[],
    panelActivityIds: Set<string>,
): string | null {
    if (preferredActivityId && visibleActivityIds.includes(preferredActivityId)) {
        if (panelActivityIds.size === 0 || panelActivityIds.has(preferredActivityId)) {
            return preferredActivityId;
        }
    }

    const panelContainerActivity = visibleActivityIds.find((activityId) => panelActivityIds.has(activityId));
    return panelContainerActivity ?? visibleActivityIds[0] ?? null;
}

function resolveFocusedPanelId(preferredPanelId: string | null, visiblePanelIds: string[]): string | null {
    if (preferredPanelId && visiblePanelIds.includes(preferredPanelId)) {
        return preferredPanelId;
    }

    return visiblePanelIds[0] ?? null;
}

function readPaneExpanded(
    paneStates: SidebarLayoutSnapshot["paneStates"],
    panelId: string,
    fallbackExpanded: boolean,
): boolean {
    const paneState = paneStates.find((item) => item.id === panelId);
    return paneState?.expanded ?? fallbackExpanded;
}

function updatePaneExpanded(
    paneStates: SidebarLayoutSnapshot["paneStates"],
    panelId: string,
    expanded: boolean,
): SidebarLayoutSnapshot["paneStates"] {
    const nextPaneStates = [...paneStates];
    const existingIndex = nextPaneStates.findIndex((item) => item.id === panelId);

    if (existingIndex >= 0) {
        nextPaneStates[existingIndex] = {
            ...nextPaneStates[existingIndex],
            expanded,
        };
        return nextPaneStates;
    }

    nextPaneStates.push({
        id: panelId,
        expanded,
    });
    return nextPaneStates;
}

function createActivityIconItem(
    item: { id: string; section: "top" | "bottom"; visible: boolean; bar: "left" | "right" },
    activitiesById: Map<string, ActivityDescriptor>,
): ActivityIconItem | null {
    const activity = activitiesById.get(item.id);
    if (!activity) {
        return null;
    }

    return {
        id: item.id,
        title: resolveActivityTitle(activity.title),
        icon: activity.icon,
        section: item.section,
        visible: item.visible,
        isSettings: false,
        bar: item.bar,
    };
}

function collectAllSectionIds(root: SectionNode<WorkbenchSectionData>): Set<string> {
    const ids = new Set<string>();
    const queue: SectionNode<WorkbenchSectionData>[] = [root];

    while (queue.length > 0) {
        const current = queue.shift();
        if (!current || ids.has(current.id)) {
            continue;
        }

        ids.add(current.id);
        if (current.split) {
            queue.push(current.split.children[0], current.split.children[1]);
        }
    }

    return ids;
}

function createUniqueIdentifier(baseId: string, usedIds: Set<string>): string {
    let candidate = baseId;
    let suffix = 1;

    while (usedIds.has(candidate)) {
        candidate = `${baseId}-${suffix}`;
        suffix += 1;
    }

    usedIds.add(candidate);
    return candidate;
}

function createEmptyTabSectionStateItem(tabSectionId: string): TabSectionStateItem {
    return {
        id: tabSectionId,
        tabs: [],
        focusedTabId: null,
        isRoot: false,
    };
}

function resolveSplitPlan(side: "left" | "right" | "top" | "bottom"): {
    direction: SectionSplitDirection;
    ratio: number;
    originalAt: "first" | "second";
} {
    if (side === "left") {
        return {
            direction: "horizontal",
            ratio: TAB_SPLIT_RATIO,
            originalAt: "second",
        };
    }

    if (side === "right") {
        return {
            direction: "horizontal",
            ratio: TAB_SPLIT_RATIO,
            originalAt: "first",
        };
    }

    if (side === "top") {
        return {
            direction: "vertical",
            ratio: TAB_SPLIT_RATIO,
            originalAt: "second",
        };
    }

    return {
        direction: "vertical",
        ratio: TAB_SPLIT_RATIO,
        originalAt: "first",
    };
}

function buildSectionDraftFromLeaf(
    leaf: SectionNode<WorkbenchSectionData>,
    nextId: string,
): SectionDraft<WorkbenchSectionData> {
    return {
        id: nextId,
        title: leaf.title,
        data: leaf.data,
        resizableEdges: leaf.resizableEdges,
        meta: leaf.meta,
    };
}

function findTabSectionLeafContext(
    root: SectionNode<WorkbenchSectionData>,
    tabSectionId: string,
): {
    leaf: SectionNode<WorkbenchSectionData>;
    parent: SectionNode<WorkbenchSectionData> | null;
} | null {
    const visit = (
        node: SectionNode<WorkbenchSectionData>,
        parent: SectionNode<WorkbenchSectionData> | null,
    ): {
        leaf: SectionNode<WorkbenchSectionData>;
        parent: SectionNode<WorkbenchSectionData> | null;
    } | null => {
        if (!node.split) {
            if (
                node.data.component.type === "tab-section" &&
                node.data.component.props.tabSectionId === tabSectionId
            ) {
                return {
                    leaf: node,
                    parent,
                };
            }

            return null;
        }

        return visit(node.split.children[0], node) ?? visit(node.split.children[1], node);
    };

    return visit(root, null);
}

function promoteRootTabSectionIfNeeded(
    root: SectionNode<WorkbenchSectionData>,
    state: TabSectionsState,
): TabSectionsState {
    const hasRoot = Object.values(state.sections).some((section) => section.isRoot);
    if (hasRoot) {
        return state;
    }

    const queue: SectionNode<WorkbenchSectionData>[] = [root];
    while (queue.length > 0) {
        const current = queue.shift();
        if (!current) {
            continue;
        }

        if (!current.split) {
            if (current.data.component.type === "tab-section") {
                const tabSectionId = current.data.component.props.tabSectionId;
                const tabSection = state.sections[tabSectionId];
                if (tabSection) {
                    return {
                        sections: {
                            ...state.sections,
                            [tabSectionId]: {
                                ...tabSection,
                                isRoot: true,
                            },
                        },
                    };
                }
            }
            continue;
        }

        queue.push(current.split.children[0], current.split.children[1]);
    }

    return state;
}

function cleanupEmptyTabSections(
    root: SectionNode<WorkbenchSectionData>,
    state: TabSectionsState,
): {
    root: SectionNode<WorkbenchSectionData>;
    state: TabSectionsState;
} {
    let nextRoot = root;
    let nextState = state;

    while (true) {
        const emptySectionIds = Object.values(nextState.sections)
            .filter((section) => section.tabs.length === 0)
            .map((section) => section.id);
        let changed = false;

        for (const tabSectionId of emptySectionIds) {
            const tabSection = nextState.sections[tabSectionId];
            if (!tabSection) {
                continue;
            }

            const context = findTabSectionLeafContext(nextRoot, tabSectionId);
            if (!context) {
                if (tabSection.isRoot) {
                    continue;
                }

                const candidateSections = { ...nextState.sections };
                delete candidateSections[tabSectionId];
                nextState = tabSection.isRoot
                    ? promoteRootTabSectionIfNeeded(nextRoot, { sections: candidateSections })
                    : { sections: candidateSections };
                changed = true;
                break;
            }

            if (tabSection.isRoot) {
                continue;
            }

            nextRoot = destroySectionTree(nextRoot, context.leaf.id);
            const candidateSections = { ...nextState.sections };
            delete candidateSections[tabSectionId];
            nextState = tabSection.isRoot
                ? promoteRootTabSectionIfNeeded(nextRoot, { sections: candidateSections })
                : { sections: candidateSections };
            changed = true;
            break;
        }

        if (!changed) {
            break;
        }
    }

    return {
        root: nextRoot,
        state: nextState,
    };
}

function createCommittedTabIdentifiers(
    root: SectionNode<WorkbenchSectionData>,
    state: TabSectionsState,
    anchorLeafSectionId: string,
): {
    tabSectionId: string;
    originalChildSectionId: string;
    newChildSectionId: string;
} {
    const usedSectionIds = collectAllSectionIds(root);
    const usedTabSectionIds = new Set(Object.keys(state.sections));

    return {
        tabSectionId: createUniqueIdentifier(`${anchorLeafSectionId}-tabs`, usedTabSectionIds),
        originalChildSectionId: createUniqueIdentifier(`${anchorLeafSectionId}-section`, usedSectionIds),
        newChildSectionId: createUniqueIdentifier(`${anchorLeafSectionId}-split`, usedSectionIds),
    };
}

function createPreviewTabIdentifiers(anchorLeafSectionId: string): {
    tabSectionId: string;
    originalChildSectionId: string;
    newChildSectionId: string;
} {
    return {
        tabSectionId: `${PREVIEW_TAB_SECTION_ID_PREFIX}-${anchorLeafSectionId}`,
        originalChildSectionId: `${PREVIEW_SECTION_ID_PREFIX}-${anchorLeafSectionId}-original`,
        newChildSectionId: `${PREVIEW_SECTION_ID_PREFIX}-${anchorLeafSectionId}-new`,
    };
}

function resolveCommittedLeafSectionId(
    sectionId: string,
    anchorLeafSectionId?: string,
): string {
    if (sectionId.startsWith(PREVIEW_SECTION_ID_PREFIX) && anchorLeafSectionId) {
        return anchorLeafSectionId;
    }

    return sectionId;
}

function isInteractivePreviewLeaf(sectionId: string, isDragging: boolean): boolean {
    return isDragging && sectionId.startsWith(PREVIEW_SECTION_ID_PREFIX);
}

function buildPreviewTabLayoutState(
    root: SectionNode<WorkbenchSectionData>,
    state: TabSectionsState,
    session: TabSectionDragSession | null,
): {
    root: SectionNode<WorkbenchSectionData>;
    state: TabSectionsState;
} | null {
    if (!session || session.phase !== "dragging") {
        return null;
    }

    if (!session.hoverTarget) {
        const sourceSection = state.sections[session.currentTabSectionId];
        if (!sourceSection || sourceSection.tabs.length !== 1) {
            return null;
        }

        const nextSourceSection: TabSectionStateItem = {
            ...sourceSection,
            tabs: [],
            focusedTabId: null,
        };

        return cleanupEmptyTabSections(root, {
            sections: {
                ...state.sections,
                [session.currentTabSectionId]: nextSourceSection,
            },
        });
    }

    if (session.hoverTarget.area !== "content") {
        return null;
    }

    if (!session.hoverTarget.splitSide) {
        if (session.hoverTarget.tabSectionId === session.currentTabSectionId) {
            return null;
        }

        const targetSection = state.sections[session.hoverTarget.tabSectionId];
        if (!targetSection) {
            return null;
        }

        const mergedPreviewState = moveTabSectionTab(state, {
            sourceSectionId: session.currentTabSectionId,
            targetSectionId: session.hoverTarget.tabSectionId,
            tabId: session.tabId,
            targetIndex: targetSection.tabs.length,
        });

        return cleanupEmptyTabSections(root, mergedPreviewState);
    }

    if (!session.hoverTarget.anchorLeafSectionId) {
        return null;
    }

    const targetLeaf = findSectionNode(root, session.hoverTarget.anchorLeafSectionId);
    if (!targetLeaf || targetLeaf.split || targetLeaf.data.component.type !== "tab-section") {
        return null;
    }

    const previewIds = createPreviewTabIdentifiers(session.hoverTarget.anchorLeafSectionId);
    const splitPlan = resolveSplitPlan(session.hoverTarget.splitSide);
    const originalDraft = buildSectionDraftFromLeaf(targetLeaf, previewIds.originalChildSectionId);
    const newDraft = createWorkbenchSectionDraft(
        previewIds.newChildSectionId,
        session.title,
        targetLeaf.data.role,
        createSectionComponentBinding("tab-section", {
            tabSectionId: previewIds.tabSectionId,
        }),
        targetLeaf.resizableEdges,
    );

    const previewRoot = splitSectionTree(
        root,
        targetLeaf.id,
        splitPlan.direction,
        splitPlan.originalAt === "first"
            ? {
                ratio: splitPlan.ratio,
                first: originalDraft,
                second: newDraft,
            }
            : {
                ratio: splitPlan.ratio,
                first: newDraft,
                second: originalDraft,
            },
    );

    let previewState: TabSectionsState = {
        sections: {
            ...state.sections,
            [previewIds.tabSectionId]: createEmptyTabSectionStateItem(previewIds.tabSectionId),
        },
    };
    previewState = moveTabSectionTab(previewState, {
        sourceSectionId: session.currentTabSectionId,
        targetSectionId: previewIds.tabSectionId,
        tabId: session.tabId,
        targetIndex: 0,
    });

    return cleanupEmptyTabSections(previewRoot, previewState);
}

function resolveActiveTabSectionId(state: VSCodeLayoutState<WorkbenchSectionData>): string | null {
    const preferredId = state.workbench?.activeGroupId ?? null;
    if (preferredId && state.tabSections.sections[preferredId]) {
        return preferredId;
    }

    return Object.keys(state.tabSections.sections)[0] ?? null;
}

function findTabSectionIdByTabId(
    tabSections: TabSectionsState,
    tabId: string,
): string | null {
    for (const section of Object.values(tabSections.sections)) {
        if (section.tabs.some((tab) => tab.id === tabId)) {
            return section.id;
        }
    }

    return null;
}

function commitDraggedTabSession(
    root: SectionNode<WorkbenchSectionData>,
    state: TabSectionsState,
    session: TabSectionDragSession,
): {
    root: SectionNode<WorkbenchSectionData>;
    state: TabSectionsState;
    activeGroupId: string | null;
} | null {
    if (session.phase !== "dragging" || !session.hoverTarget || session.hoverTarget.area !== "content") {
        return null;
    }

    if (!session.hoverTarget.splitSide) {
        if (session.hoverTarget.tabSectionId === session.currentTabSectionId) {
            return null;
        }

        const targetSection = state.sections[session.hoverTarget.tabSectionId];
        if (!targetSection) {
            return null;
        }

        const movedState = moveTabSectionTab(state, {
            sourceSectionId: session.currentTabSectionId,
            targetSectionId: session.hoverTarget.tabSectionId,
            tabId: session.tabId,
            targetIndex: targetSection.tabs.length,
        });
        const cleaned = cleanupEmptyTabSections(root, movedState);
        return {
            root: cleaned.root,
            state: cleaned.state,
            activeGroupId: session.hoverTarget.tabSectionId,
        };
    }

    if (!session.hoverTarget.anchorLeafSectionId) {
        return null;
    }

    const targetLeaf = findSectionNode(root, session.hoverTarget.anchorLeafSectionId);
    if (!targetLeaf || targetLeaf.split || targetLeaf.data.component.type !== "tab-section") {
        return null;
    }

    const committedIds = createCommittedTabIdentifiers(root, state, session.hoverTarget.anchorLeafSectionId);
    const splitPlan = resolveSplitPlan(session.hoverTarget.splitSide);
    const originalDraft = buildSectionDraftFromLeaf(targetLeaf, committedIds.originalChildSectionId);
    const newDraft = createWorkbenchSectionDraft(
        committedIds.newChildSectionId,
        session.title,
        targetLeaf.data.role,
        createSectionComponentBinding("tab-section", {
            tabSectionId: committedIds.tabSectionId,
        }),
        targetLeaf.resizableEdges,
    );

    const committedRoot = splitSectionTree(
        root,
        targetLeaf.id,
        splitPlan.direction,
        splitPlan.originalAt === "first"
            ? {
                ratio: splitPlan.ratio,
                first: originalDraft,
                second: newDraft,
            }
            : {
                ratio: splitPlan.ratio,
                first: newDraft,
                second: originalDraft,
            },
    );

    let committedState: TabSectionsState = {
        sections: {
            ...state.sections,
            [committedIds.tabSectionId]: createEmptyTabSectionStateItem(committedIds.tabSectionId),
        },
    };
    committedState = moveTabSectionTab(committedState, {
        sourceSectionId: session.currentTabSectionId,
        targetSectionId: committedIds.tabSectionId,
        tabId: session.tabId,
        targetIndex: 0,
    });

    const cleaned = cleanupEmptyTabSections(committedRoot, committedState);
    return {
        root: cleaned.root,
        state: cleaned.state,
        activeGroupId: committedIds.tabSectionId,
    };
}

function createWorkbenchRootLayout(hasRightRail: boolean): SectionNode<WorkbenchSectionData> {
    let root = createRootSection(
        createWorkbenchSectionDraft(
            "root",
            "Workbench Root",
            "root",
            createSectionComponentBinding("empty", {
                label: "Root",
                description: "layout-v2 host root",
            }),
        ),
    );

    root = splitSectionTree(root, "root", "horizontal", {
        ratio: 0.04,
        first: createWorkbenchSectionDraft(
            "left-activity-bar",
            "Left Activity Bar",
            "activity-bar",
            createSectionComponentBinding("activity-rail", {}),
            { right: false },
        ),
        second: createWorkbenchSectionDraft(
            "workbench-shell",
            "Workbench Shell",
            "container",
            createSectionComponentBinding("empty", {
                label: "Workbench",
                description: "layout-v2 workbench container",
            }),
        ),
    });

    root = splitSectionTree(root, "workbench-shell", "horizontal", {
        ratio: 0.22,
        first: createWorkbenchSectionDraft(
            "left-sidebar",
            "Left Sidebar",
            "sidebar",
            createSectionComponentBinding("panel-section", {
                panelSectionId: LEFT_PANEL_SECTION_ID,
            }),
        ),
        second: createWorkbenchSectionDraft(
            hasRightRail ? "center-shell" : "main-tabs",
            hasRightRail ? "Center Shell" : "Main Tabs",
            hasRightRail ? "container" : "main",
            hasRightRail
                ? createSectionComponentBinding("empty", {
                    label: "Center Shell",
                    description: "main workbench region",
                })
                : createSectionComponentBinding("tab-section", {
                    tabSectionId: MAIN_TAB_SECTION_ID,
                }),
        ),
    });

    if (!hasRightRail) {
        return root;
    }

    root = splitSectionTree(root, "center-shell", "horizontal", {
        ratio: 0.78,
        first: createWorkbenchSectionDraft(
            "main-tabs",
            "Main Tabs",
            "main",
            createSectionComponentBinding("tab-section", {
                tabSectionId: MAIN_TAB_SECTION_ID,
            }),
        ),
        second: createWorkbenchSectionDraft(
            "right-sidebar",
            "Right Sidebar",
            "sidebar",
            createSectionComponentBinding("panel-section", {
                panelSectionId: RIGHT_PANEL_SECTION_ID,
            }),
        ),
    });

    return root;
}

function createInitialLayoutState(
    props: WorkbenchLayoutHostProps,
    hasRightRail: boolean,
    initialActivityBars?: ReturnType<typeof createActivityBarState>,
): VSCodeLayoutState<WorkbenchSectionData> {
    const mainTabs = buildInitialTabs(props.initialTabs);

    return createVSCodeLayoutState({
        root: createWorkbenchRootLayout(hasRightRail),
        activityBars: initialActivityBars,
        panelSections: [
            {
                id: LEFT_PANEL_SECTION_ID,
                panels: [],
                focusedPanelId: null,
                isCollapsed: false,
                isRoot: true,
            },
            {
                id: RIGHT_PANEL_SECTION_ID,
                panels: [],
                focusedPanelId: null,
                isCollapsed: false,
            },
        ],
        tabSections: {
            sections: {
                [MAIN_TAB_SECTION_ID]: {
                    id: MAIN_TAB_SECTION_ID,
                    tabs: mainTabs,
                    focusedTabId: mainTabs[0]?.id ?? null,
                    isRoot: true,
                },
            },
        },
        workbench: {
            activeGroupId: MAIN_TAB_SECTION_ID,
        },
    });
}

function LayoutV2EmptySection(props: {
    label: string;
    description: string;
}): ReactNode {
    return (
        <div className="workbench-layout-v2__empty-section">
            <strong>{props.label}</strong>
            <span>{props.description}</span>
        </div>
    );
}

function LayoutV2SidebarHost(props: {
    side: SidebarSide;
    visible: boolean;
    activityTitle: string;
    activeActivityId: string | null;
    activePanelId: string | null;
    actions: ReturnType<typeof useSidebarHeaderActions>;
    activityItems: ActivityIconItem[];
    dragState: IconDragState | null;
    panels: PanelDescriptor[];
    paneStates: SidebarLayoutSnapshot["paneStates"];
    onActivityClick: (item: ActivityIconItem) => void;
    onPaneToggle: (panelId: string) => void;
    renderPanel: (panelId: string) => ReactNode;
    buildHeaderActionContext: (panelId: string | null, side: SidebarSide) => SidebarHeaderActionContext | null;
}): ReactNode {
    const {
        side,
        visible,
        activityTitle,
        activeActivityId,
        activePanelId,
        actions,
        activityItems,
        dragState,
        panels,
        paneStates,
        onActivityClick,
        onPaneToggle,
        renderPanel,
        buildHeaderActionContext,
    } = props;

    if (!visible) {
        return (
            <LayoutV2EmptySection
                label={side === "left" ? "Left Sidebar Hidden" : "Right Sidebar Hidden"}
                description="Sidebar visibility is managed by the host and can be restored from the activity rail."
            />
        );
    }

    const header = side === "left"
        ? (
            <SidebarHeader
                title={activityTitle}
                actions={actions}
                actionContext={buildHeaderActionContext(activePanelId, side) ?? {
                    activityId: activeActivityId ?? "",
                    panelId: activePanelId,
                    side,
                    activeTabId: null,
                    dockviewApi: null,
                    hostPanelId: activePanelId,
                    convertibleView: null,
                    openTab: () => undefined,
                    openFile: async () => undefined,
                    closeTab: () => undefined,
                    setActiveTab: () => undefined,
                    activatePanel: () => undefined,
                    executeCommand: () => undefined,
                    requestMoveFileToDirectory: () => undefined,
                }}
            />
        )
        : (
            <div className="sidebar-header">
                <SidebarIconBar
                    items={activityItems}
                    activeItemId={activeActivityId}
                    dragState={dragState}
                    onItemClick={onActivityClick}
                    onDragOver={(event) => {
                        event.preventDefault();
                    }}
                    onDrop={(event) => {
                        event.preventDefault();
                    }}
                    onDragLeave={() => undefined}
                    isDragOver={false}
                    onItemDragStart={() => () => undefined}
                    onItemDragEnd={() => undefined}
                />
            </div>
        );

    return (
        <section
            className={`sidebar sidebar-${side} workbench-layout-v2__sidebar`}
            aria-label={side === "left" ? "Left sidebar" : "Right sidebar"}
            data-motion-state="visible"
        >
            {header}
            <div className="sidebar-content">
                {panels.length === 0 ? (
                    <div className="sidebar-empty-placeholder">
                        No panel is currently assigned to the selected activity.
                    </div>
                ) : (
                    <div className="workbench-layout-v2__sidebar-panes">
                        {panels.map((panel) => {
                            const isExpanded = readPaneExpanded(
                                paneStates,
                                panel.id,
                                panel.id === activePanelId || panels.length === 1,
                            );

                            return (
                                <section
                                    key={panel.id}
                                    className={[
                                        "workbench-layout-v2__sidebar-pane",
                                        isExpanded ? "is-expanded" : "",
                                        panel.id === activePanelId ? "is-active" : "",
                                    ].filter(Boolean).join(" ")}
                                >
                                    <button
                                        type="button"
                                        className="workbench-layout-v2__sidebar-pane-header"
                                        onClick={() => {
                                            onPaneToggle(panel.id);
                                        }}
                                    >
                                        <span className="workbench-layout-v2__sidebar-pane-chevron">
                                            {isExpanded ? "▾" : "▸"}
                                        </span>
                                        <span className="workbench-layout-v2__sidebar-pane-title">
                                            {resolveTitle(panel.title)}
                                        </span>
                                    </button>
                                    {isExpanded ? (
                                        <div className="workbench-layout-v2__sidebar-pane-body">
                                            {renderPanel(panel.id)}
                                        </div>
                                    ) : null}
                                </section>
                            );
                        })}
                    </div>
                )}
            </div>
        </section>
    );
}

function LayoutV2WorkbenchHost(props: WorkbenchLayoutHostProps): ReactNode {
    const registeredActivities = useActivities();
    const registeredPanels = usePanels();
    const registeredTabComponents = useTabComponents();
    const activityBarConfigState = useActivityBarConfig();
    const configState = useConfigState();
    const vaultState = useVaultState();
    const sidebarSnapshot = useMemo(
        () => getSidebarLayoutFromVaultConfig(configState.backendConfig),
        [configState.backendConfig],
    );
    const panelDefinitionInfos = useMemo(
        () => registeredPanels.map((panel) => buildPanelDefinitionInfo(panel)),
        [registeredPanels],
    );
    const hasRightRail = useMemo(
        () => registeredPanels.some((panel) => panel.defaultPosition === "right")
            || registeredActivities.some((activity) => activity.defaultBar === "right"),
        [registeredActivities, registeredPanels],
    );
    const activitiesById = useMemo(
        () => new Map(registeredActivities.map((activity) => [activity.id, activity])),
        [registeredActivities],
    );
    const panelsById = useMemo(
        () => new Map(registeredPanels.map((panel) => [panel.id, panel])),
        [registeredPanels],
    );
    const tabComponentsById = useMemo(
        () => new Map(registeredTabComponents.map((component) => [component.id, component])),
        [registeredTabComponents],
    );
    const panelDefinitionInfoById = useMemo(
        () => new Map(panelDefinitionInfos.map((panel) => [panel.id, panel])),
        [panelDefinitionInfos],
    );
    const [panelStates, setPanelStates] = useState<PanelRuntimeState[]>(() =>
        restorePanelStatesFromSidebarLayout(panelDefinitionInfos, sidebarSnapshot),
    );
    const [leftSidebarVisible, setLeftSidebarVisible] = useState<boolean>(sidebarSnapshot?.left.visible ?? true);
    const [rightSidebarVisible, setRightSidebarVisible] = useState<boolean>(sidebarSnapshot?.right.visible ?? true);
    const [preferredLeftActivityId, setPreferredLeftActivityId] = useState<string | null>(sidebarSnapshot?.left.activeActivityId ?? props.initialActivePanelId ?? null);
    const [preferredRightActivityId, setPreferredRightActivityId] = useState<string | null>(sidebarSnapshot?.right.activeActivityId ?? null);
    const [preferredLeftPanelId, setPreferredLeftPanelId] = useState<string | null>(sidebarSnapshot?.left.activePanelId ?? props.initialActivePanelId ?? null);
    const [preferredRightPanelId, setPreferredRightPanelId] = useState<string | null>(sidebarSnapshot?.right.activePanelId ?? null);
    const [activityDragState] = useState<IconDragState | null>(null);
    const [activityBarDragSession, setActivityBarDragSession] = useState<ActivityBarDragSession | null>(null);
    const [panelDragSession, setPanelDragSession] = useState<PanelSectionDragSession | null>(null);
    const [tabDragSession, setTabDragSession] = useState<TabSectionDragSession | null>(null);
    const [paneStates, setPaneStates] = useState<SidebarLayoutSnapshot["paneStates"]>(() => sidebarSnapshot?.paneStates ?? []);
    const hydratedSnapshotKeyRef = useRef<string | null>(null);
    const persistedSnapshotRef = useRef<string | null>(null);

    const mergedActivityItems = useMemo(
        () => mergeActivityBarConfig(buildActivityDefaults(registeredActivities), activityBarConfigState.config),
        [activityBarConfigState.config, registeredActivities],
    );
    const rightActivityItems = useMemo(
        () => mergedActivityItems.filter((item) => item.visible && item.bar === "right"),
        [mergedActivityItems],
    );
    const initialActivityBars = useMemo(
        () => buildActivityBarRuntimeState(mergedActivityItems, activitiesById, {
            left: sidebarSnapshot?.left.activeActivityId ?? props.initialActivePanelId ?? null,
            right: sidebarSnapshot?.right.activeActivityId ?? null,
        }),
        [activitiesById, mergedActivityItems, props.initialActivePanelId, sidebarSnapshot],
    );
    const storeRef = useRef<VSCodeLayoutStore<WorkbenchSectionData> | null>(null);
    if (!storeRef.current) {
        storeRef.current = createVSCodeLayoutStore({
            initialState: createInitialLayoutState(props, hasRightRail, initialActivityBars),
        });
    }

    const store = storeRef.current;
    const state = useVSCodeLayoutStoreState(store);
    const rightActivityIcons = useMemo(
        () => rightActivityItems
            .map((item) => createActivityIconItem(item, activitiesById))
            .filter((item): item is ActivityIconItem => item !== null),
        [activitiesById, rightActivityItems],
    );
    const leftPanelActivityIds = useMemo(
        () => new Set(panelStates.filter((item) => item.position === "left").map((item) => item.activityId)),
        [panelStates],
    );
    const rightPanelActivityIds = useMemo(
        () => new Set(panelStates.filter((item) => item.position === "right").map((item) => item.activityId)),
        [panelStates],
    );
    const activeLeftActivityId = useMemo(
        () => resolveActiveActivityId(
            preferredLeftActivityId,
            mergedActivityItems
                .filter((item) => item.visible && item.bar === "left" && item.id !== SETTINGS_ACTIVITY_ID)
                .map((item) => item.id),
            leftPanelActivityIds,
        ),
        [leftPanelActivityIds, mergedActivityItems, preferredLeftActivityId],
    );
    const activeRightActivityId = useMemo(
        () => resolveActiveActivityId(preferredRightActivityId, rightActivityItems.map((item) => item.id), rightPanelActivityIds),
        [preferredRightActivityId, rightActivityItems, rightPanelActivityIds],
    );
    const visibleLeftPanelIds = useMemo(
        () => getVisiblePanelIds(panelStates, panelDefinitionInfoById, "left", activeLeftActivityId),
        [activeLeftActivityId, panelDefinitionInfoById, panelStates],
    );
    const visibleRightPanelIds = useMemo(
        () => getVisiblePanelIds(panelStates, panelDefinitionInfoById, "right", activeRightActivityId),
        [activeRightActivityId, panelDefinitionInfoById, panelStates],
    );
    const activeLeftPanelId = useMemo(
        () => resolveFocusedPanelId(preferredLeftPanelId, visibleLeftPanelIds),
        [preferredLeftPanelId, visibleLeftPanelIds],
    );
    const activeRightPanelId = useMemo(
        () => resolveFocusedPanelId(preferredRightPanelId, visibleRightPanelIds),
        [preferredRightPanelId, visibleRightPanelIds],
    );
    const leftPanelDefinitions = useMemo(
        () => visibleLeftPanelIds.map((panelId) => panelsById.get(panelId)).filter((panel): panel is PanelDescriptor => Boolean(panel)),
        [panelsById, visibleLeftPanelIds],
    );
    const rightPanelDefinitions = useMemo(
        () => visibleRightPanelIds.map((panelId) => panelsById.get(panelId)).filter((panel): panel is PanelDescriptor => Boolean(panel)),
        [panelsById, visibleRightPanelIds],
    );
    const leftPanelSectionPanels = useMemo(
        () => buildPanelSectionPanels(leftPanelDefinitions, activitiesById),
        [activitiesById, leftPanelDefinitions],
    );
    const rightPanelSectionPanels = useMemo(
        () => buildPanelSectionPanels(rightPanelDefinitions, activitiesById),
        [activitiesById, rightPanelDefinitions],
    );
    const leftActivityBarState = useMemo(
        () => state.activityBars.bars[LEFT_ACTIVITY_BAR_ID] ?? null,
        [state.activityBars],
    );
    const handleActivityBarMoveIcon = useCallback((move: {
        sourceBarId: string;
        targetBarId: string;
        iconId: string;
        targetIndex: number;
    }): void => {
        store.moveActivityIcon(move);
    }, [store]);
    const activeTabSectionId = useMemo(
        () => resolveActiveTabSectionId(state),
        [state],
    );
    const activeTabSection = activeTabSectionId ? state.tabSections.sections[activeTabSectionId] ?? null : null;
    const activeTabId = activeTabSection?.focusedTabId ?? null;
    const leftSidebarHeaderActions = useSidebarHeaderActions(activeLeftActivityId);
    const tabPreview = useMemo(
        () => buildPreviewTabLayoutState(state.root, state.tabSections, tabDragSession),
        [state.root, state.tabSections, tabDragSession],
    );
    const renderedRoot = tabPreview?.root ?? state.root;
    const renderedTabSections = tabPreview?.state ?? state.tabSections;

    useEffect(() => {
        const currentVaultPath = vaultState.currentVaultPath || configState.loadedVaultPath;
        if (!currentVaultPath) {
            return;
        }

        void ensureActivityBarConfigLoaded(currentVaultPath);
    }, [configState.loadedVaultPath, vaultState.currentVaultPath]);

    useEffect(() => {
        const snapshotKey = `${configState.loadedVaultPath ?? vaultState.currentVaultPath ?? "__default__"}:${sidebarSnapshot ? "snapshot" : "empty"}`;
        if (hydratedSnapshotKeyRef.current !== snapshotKey) {
            hydratedSnapshotKeyRef.current = snapshotKey;
            setPanelStates(restorePanelStatesFromSidebarLayout(panelDefinitionInfos, sidebarSnapshot));
            setLeftSidebarVisible(sidebarSnapshot?.left.visible ?? true);
            setRightSidebarVisible(sidebarSnapshot?.right.visible ?? true);
            setPreferredLeftActivityId(sidebarSnapshot?.left.activeActivityId ?? props.initialActivePanelId ?? null);
            setPreferredRightActivityId(sidebarSnapshot?.right.activeActivityId ?? null);
            setPreferredLeftPanelId(sidebarSnapshot?.left.activePanelId ?? props.initialActivePanelId ?? null);
            setPreferredRightPanelId(sidebarSnapshot?.right.activePanelId ?? null);
            setPaneStates(sidebarSnapshot?.paneStates ?? []);
            persistedSnapshotRef.current = sidebarSnapshot ? JSON.stringify(sidebarSnapshot) : null;
            return;
        }

        setPanelStates((previous) => mergePanelStatesWithSidebarLayoutFallback(previous, panelDefinitionInfos, sidebarSnapshot));
    }, [configState.loadedVaultPath, panelDefinitionInfos, props.initialActivePanelId, sidebarSnapshot, vaultState.currentVaultPath]);

    useEffect(() => {
        const nextActivityBars = buildActivityBarRuntimeState(mergedActivityItems, activitiesById, {
            left: activeLeftActivityId,
            right: activeRightActivityId,
        });
        const currentActivityBars = store.getState().activityBars;

        if (summarizeActivityBarRuntimeState(currentActivityBars) === summarizeActivityBarRuntimeState(nextActivityBars)) {
            return;
        }

        store.resetActivityBars(nextActivityBars);
    }, [activeLeftActivityId, activeRightActivityId, activitiesById, mergedActivityItems, store]);

    useEffect(() => {
        const nextConfig = projectActivityBarConfigFromRuntime(mergedActivityItems, {
            left: state.activityBars.bars[LEFT_ACTIVITY_BAR_ID]?.icons.map((icon) => icon.id) ?? [],
            right: state.activityBars.bars[RIGHT_ACTIVITY_BAR_ID]?.icons.map((icon) => icon.id) ?? [],
        });
        const currentItems = mergedActivityItems.map((item) => ({
            id: item.id,
            section: item.section,
            visible: item.visible,
            bar: item.bar,
        }));

        if (JSON.stringify(nextConfig.items) === JSON.stringify(currentItems)) {
            return;
        }

        updateActivityBarConfig(nextConfig);
    }, [mergedActivityItems, state.activityBars]);

    useEffect(() => {
        store.resetLayout(createWorkbenchRootLayout(hasRightRail));
    }, [hasRightRail, store]);

    useEffect(() => {
        const currentSection = store.getPanelSection(LEFT_PANEL_SECTION_ID);
        store.upsertPanelSection(
            buildPanelSectionStateItem(
                LEFT_PANEL_SECTION_ID,
                leftPanelSectionPanels,
                activeLeftPanelId,
                currentSection,
            ),
        );
    }, [activeLeftPanelId, leftPanelSectionPanels, store]);

    useEffect(() => {
        const currentSection = store.getPanelSection(RIGHT_PANEL_SECTION_ID);
        store.upsertPanelSection(
            buildPanelSectionStateItem(
                RIGHT_PANEL_SECTION_ID,
                rightPanelSectionPanels,
                activeRightPanelId,
                currentSection,
            ),
        );
    }, [activeRightPanelId, rightPanelSectionPanels, store]);

    useEffect(() => {
        store.updateState((currentState) => ({
            ...currentState,
            root: setLayoutSectionHidden(
                currentState.root,
                "left-sidebar",
                !leftSidebarVisible || leftPanelSectionPanels.length === 0,
            ),
        }));
    }, [leftPanelSectionPanels.length, leftSidebarVisible, store]);

    useEffect(() => {
        store.updateState((currentState) => ({
            ...currentState,
            root: setLayoutSectionHidden(
                currentState.root,
                "right-sidebar",
                !hasRightRail || !rightSidebarVisible || rightPanelSectionPanels.length === 0,
            ),
        }));
    }, [hasRightRail, rightPanelSectionPanels.length, rightSidebarVisible, store]);

    useEffect(() => {
        setRightSidebarVisibilitySnapshot(hasRightRail && rightSidebarVisible);
    }, [hasRightRail, rightSidebarVisible]);

    useEffect(() => {
        if (activeLeftPanelId) {
            setPaneStates((previousValue) => updatePaneExpanded(previousValue, activeLeftPanelId, true));
        }
    }, [activeLeftPanelId]);

    useEffect(() => {
        if (activeRightPanelId) {
            setPaneStates((previousValue) => updatePaneExpanded(previousValue, activeRightPanelId, true));
        }
    }, [activeRightPanelId]);

    useEffect(() => {
        return subscribeRightSidebarToggleRequest(() => {
            setRightSidebarVisible((previousValue) => !previousValue);
        });
    }, []);

    useEffect(() => {
        const currentVaultPath = vaultState.currentVaultPath || configState.loadedVaultPath;
        if (!currentVaultPath && !configState.backendConfig) {
            return;
        }

        const snapshot: SidebarLayoutSnapshot = {
            version: 1,
            left: {
                width: sidebarSnapshot?.left.width ?? DEFAULT_LEFT_RAIL_WIDTH,
                visible: leftSidebarVisible,
                activeActivityId: activeLeftActivityId,
                activePanelId: activeLeftPanelId,
            },
            right: {
                width: sidebarSnapshot?.right.width ?? DEFAULT_RIGHT_RAIL_WIDTH,
                visible: hasRightRail ? rightSidebarVisible : false,
                activeActivityId: activeRightActivityId,
                activePanelId: activeRightPanelId,
            },
            panelStates,
            paneStates,
            convertiblePanelStates: sidebarSnapshot?.convertiblePanelStates ?? [],
        };

        const serializedSnapshot = JSON.stringify(snapshot);
        if (persistedSnapshotRef.current === serializedSnapshot) {
            return;
        }

        const timerId = window.setTimeout(() => {
            persistedSnapshotRef.current = serializedSnapshot;
            void saveSidebarLayoutSnapshot(snapshot);
        }, SIDEBAR_LAYOUT_SAVE_DEBOUNCE_MS);

        return () => {
            window.clearTimeout(timerId);
        };
    }, [
        activeLeftActivityId,
        activeLeftPanelId,
        activeRightActivityId,
        activeRightPanelId,
        configState.backendConfig,
        configState.loadedVaultPath,
        hasRightRail,
        leftSidebarVisible,
        panelStates,
        rightSidebarVisible,
        sidebarSnapshot,
        paneStates,
        vaultState.currentVaultPath,
    ]);

    const openTab = (tab: TabInstanceDefinition): void => {
        store.updateState((currentState) => {
            const nextTab: TabSectionTabDefinition = {
                id: tab.id,
                title: tab.title,
                type: "workbench-tab",
                payload: {
                    component: tab.component,
                    params: tab.params ?? {},
                } satisfies LayoutV2TabPayload,
                content: `Component: ${tab.component}`,
                tone: "neutral",
            };
            const targetSectionId = resolveActiveTabSectionId(currentState) ?? MAIN_TAB_SECTION_ID;
            const currentSection = currentState.tabSections.sections[targetSectionId] ?? {
                id: targetSectionId,
                tabs: [] as TabSectionTabDefinition[],
                focusedTabId: null,
                isRoot: targetSectionId === MAIN_TAB_SECTION_ID,
            };
            const existingIndex = currentSection.tabs.findIndex((item) => item.id === tab.id);
            const nextTabs = existingIndex >= 0
                ? currentSection.tabs.map((item, index) => (index === existingIndex ? nextTab : item))
                : [...currentSection.tabs, nextTab];

            return {
                ...currentState,
                tabSections: {
                    sections: {
                        ...currentState.tabSections.sections,
                        [targetSectionId]: {
                            ...currentSection,
                            tabs: nextTabs,
                            focusedTabId: nextTab.id,
                        },
                    },
                },
                workbench: {
                    activeGroupId: targetSectionId,
                },
            };
        });
    };

    const closeTab = (tabId: string): void => {
        store.updateState((currentState) => {
            const sourceSectionId = findTabSectionIdByTabId(currentState.tabSections, tabId);
            if (!sourceSectionId) {
                return currentState;
            }
            const currentSection = currentState.tabSections.sections[sourceSectionId];
            if (!currentSection) {
                return currentState;
            }

            const nextTabs = currentSection.tabs.filter((tab) => tab.id !== tabId);
            if (nextTabs.length === currentSection.tabs.length) {
                return currentState;
            }

            const nextFocusedTabId = currentSection.focusedTabId === tabId
                ? (nextTabs.length > 0 ? nextTabs[nextTabs.length - 1]?.id ?? null : null)
                : currentSection.focusedTabId;
            const cleaned = cleanupEmptyTabSections(currentState.root, {
                sections: {
                    ...currentState.tabSections.sections,
                    [sourceSectionId]: {
                        ...currentSection,
                        tabs: nextTabs,
                        focusedTabId: nextFocusedTabId,
                    },
                },
            });
            const nextActiveGroupId = cleaned.state.sections[sourceSectionId]
                ? sourceSectionId
                : (Object.keys(cleaned.state.sections)[0] ?? null);

            return {
                ...currentState,
                root: cleaned.root,
                tabSections: cleaned.state,
                workbench: {
                    activeGroupId: nextActiveGroupId,
                },
            };
        });
    };

    const setActiveTab = (tabId: string): void => {
        store.updateState((currentState) => {
            const targetSectionId = findTabSectionIdByTabId(currentState.tabSections, tabId);
            if (!targetSectionId) {
                return currentState;
            }
            const currentSection = currentState.tabSections.sections[targetSectionId];
            if (!currentSection || !currentSection.tabs.some((tab) => tab.id === tabId)) {
                return currentState;
            }

            return {
                ...currentState,
                tabSections: {
                    sections: {
                        ...currentState.tabSections.sections,
                        [targetSectionId]: {
                            ...currentSection,
                            focusedTabId: tabId,
                        },
                    },
                },
                workbench: {
                    activeGroupId: targetSectionId,
                },
            };
        });
    };

    const activatePanelById = (panelId: string): void => {
        const runtime = panelStates.find((panel) => panel.id === panelId);
        if (!runtime) {
            return;
        }

        if (runtime.position === "right") {
            setRightSidebarVisible(true);
            setPreferredRightActivityId(runtime.activityId);
            setPreferredRightPanelId(panelId);
            return;
        }

        setLeftSidebarVisible(true);
        setPreferredLeftActivityId(runtime.activityId);
        setPreferredLeftPanelId(panelId);
    };

    const buildPanelContext = (hostPanelId: string | null): PanelRenderContext => ({
        activeTabId,
        dockviewApi: null,
        hostPanelId,
        convertibleView: null,
        openTab,
        openFile: async ({ relativePath, contentOverride, preferredOpenerId }) => {
            await openFileWithResolver({
                relativePath,
                currentVaultPath: vaultState.currentVaultPath || configState.loadedVaultPath || undefined,
                contentOverride,
                preferredOpenerId,
                openTab,
            });
        },
        closeTab,
        setActiveTab,
        activatePanel: activatePanelById,
        executeCommand: (commandId) => {
            console.warn("[workbenchLayoutHost] executeCommand is not wired for layout-v2 yet", { commandId });
        },
        requestMoveFileToDirectory: (relativePath) => {
            console.warn("[workbenchLayoutHost] requestMoveFileToDirectory is not wired for layout-v2 yet", {
                relativePath,
            });
        },
    });

    const buildSidebarHeaderActionContext = (panelId: string | null, side: SidebarSide) => {
        const activityId = side === "right" ? activeRightActivityId : activeLeftActivityId;
        if (!activityId) {
            return null;
        }

        return {
            ...buildPanelContext(panelId),
            activityId,
            panelId,
            side,
        };
    };

    const containerApi = {
        getPanel: (tabId: string) => {
            for (const tabSection of Object.values(store.getState().tabSections.sections)) {
                const tab = tabSection.tabs.find((item) => item.id === tabId);
                if (!tab) {
                    continue;
                }

                return {
                    id: tab.id,
                    params: readTabPayload(tab).params,
                    api: {
                        close: () => closeTab(tabId),
                        setActive: () => setActiveTab(tabId),
                    },
                };
            }

            return null;
        },
    };

    const registry = createSectionComponentRegistry<WorkbenchSectionData>({
        empty: ({ binding }) => {
            const emptyProps = binding.props as {
                label: string;
                description: string;
            };

            return (
                <LayoutV2EmptySection
                    label={emptyProps.label}
                    description={emptyProps.description}
                />
            );
        },
        "activity-rail": () => {
            if (!leftActivityBarState || leftActivityBarState.icons.length === 0) {
                return (
                    <LayoutV2EmptySection
                        label="No Activity"
                        description="This activity bar has no registered items yet."
                    />
                );
            }

            return (
                <LayoutV2ActivityBar
                    bar={leftActivityBarState}
                    dragSession={activityBarDragSession}
                    panelDragSession={panelDragSession}
                    renderIcon={(icon) => (
                        (icon.meta?.icon as ReactNode | undefined) ?? (
                            <span className="workbench-layout-v2__activity-symbol">{icon.symbol}</span>
                        )
                    )}
                    onDragSessionChange={setActivityBarDragSession}
                    onDragSessionEnd={() => {
                        setActivityBarDragSession(null);
                    }}
                    onPanelDragSessionChange={setPanelDragSession}
                    onActivateIcon={(iconId) => {
                        const activity = activitiesById.get(iconId);
                        if (!activity || activity.type !== "callback") {
                            return;
                        }

                        activity.onActivate(buildPanelContext(null));
                    }}
                    onSelectIcon={(iconId) => {
                        const activity = activitiesById.get(iconId);
                        if (!activity || activity.type === "callback") {
                            return;
                        }

                        setLeftSidebarVisible(true);
                        setPreferredLeftActivityId(iconId);
                    }}
                    onMoveIcon={handleActivityBarMoveIcon}
                />
            );
        },
        "panel-section": ({ section, binding }) => {
            const panelSectionProps = binding.props as {
                panelSectionId: string;
            };
            const panelSection = state.panelSections.sections[panelSectionProps.panelSectionId] ?? null;
            const isRightSection = panelSectionProps.panelSectionId === RIGHT_PANEL_SECTION_ID;

            return (
                <PanelSection
                    leafSectionId={section.id}
                    committedLeafSectionId={section.id}
                    panelSectionId={panelSectionProps.panelSectionId}
                    panelSection={panelSection}
                    dragSession={panelDragSession}
                    activityDragSession={activityBarDragSession}
                    renderPanelTab={(panel) => (
                        (panel.meta?.icon as ReactNode | undefined) ?? (
                            <span className="workbench-layout-v2__panel-symbol">{panel.symbol}</span>
                        )
                    )}
                    renderPanelContent={(panel) => panelsById.get(panel.id)?.render(buildPanelContext(panel.id)) ?? (
                        <div className="workbench-layout-v2__content-card">
                            <div className="workbench-layout-v2__content-eyebrow">{panel.id}</div>
                            <p>No registered panel renderer.</p>
                        </div>
                    )}
                    onDragSessionChange={setPanelDragSession}
                    onDragSessionEnd={() => {
                        setPanelDragSession(null);
                    }}
                    onActivityDragSessionChange={setActivityBarDragSession}
                    onActivatePanel={(panelId) => {
                        activatePanelById(panelId);
                    }}
                    onFocusPanel={(panelId) => {
                        store.focusPanel(panelSectionProps.panelSectionId, panelId);
                        if (isRightSection) {
                            setRightSidebarVisible(true);
                            setPreferredRightPanelId(panelId);
                        } else {
                            setLeftSidebarVisible(true);
                            setPreferredLeftPanelId(panelId);
                        }
                    }}
                    onToggleCollapsed={() => {
                        const currentPanelSection = store.getPanelSection(panelSectionProps.panelSectionId);
                        store.setPanelCollapsed(
                            panelSectionProps.panelSectionId,
                            !(currentPanelSection?.isCollapsed ?? false),
                        );
                    }}
                    onMovePanel={(move) => {
                        store.movePanel(move);
                    }}
                />
            );
        },
        "sidebar-host": ({ binding }) => {
            const sidebarProps = binding.props as {
                side: SidebarSide;
            };
            const isRightSection = sidebarProps.side === "right";
            const isSidebarVisible = isRightSection ? rightSidebarVisible : leftSidebarVisible;
            const visiblePanels = isRightSection ? rightPanelDefinitions : leftPanelDefinitions;
            const activeActivityId = isRightSection ? activeRightActivityId : activeLeftActivityId;
            const activePanelId = isRightSection ? activeRightPanelId : activeLeftPanelId;
            const activityTitle = activeActivityId
                ? resolveActivityTitle(activitiesById.get(activeActivityId)?.title ?? activeActivityId)
                : (isRightSection ? "Right Sidebar" : "Sidebar");

            return (
                <LayoutV2SidebarHost
                    side={sidebarProps.side}
                    visible={isSidebarVisible}
                    activityTitle={activityTitle}
                    activeActivityId={activeActivityId}
                    activePanelId={activePanelId}
                    actions={isRightSection ? [] : leftSidebarHeaderActions}
                    activityItems={isRightSection ? rightActivityIcons : []}
                    dragState={activityDragState}
                    panels={visiblePanels}
                    paneStates={paneStates}
                    onActivityClick={(item) => {
                        const activity = activitiesById.get(item.id);
                        if (!activity) {
                            return;
                        }

                        if (activity.type === "callback") {
                            activity.onActivate(buildPanelContext(null));
                            return;
                        }

                        setRightSidebarVisible(true);
                        setPreferredRightActivityId(item.id);
                    }}
                    onPaneToggle={(panelId) => {
                        const expandedNow = readPaneExpanded(
                            paneStates,
                            panelId,
                            panelId === activePanelId || visiblePanels.length === 1,
                        );
                        setPaneStates((previousValue) => updatePaneExpanded(previousValue, panelId, !expandedNow));
                        activatePanelById(panelId);
                    }}
                    renderPanel={(panelId) => panelsById.get(panelId)?.render(buildPanelContext(panelId)) ?? (
                        <div className="workbench-layout-v2__content-card">
                            <div className="workbench-layout-v2__content-eyebrow">{panelId}</div>
                            <p>No registered panel renderer.</p>
                        </div>
                    )}
                    buildHeaderActionContext={buildSidebarHeaderActionContext}
                />
            );
        },
        "tab-section": ({ section, binding }) => {
            const tabSectionProps = binding.props as {
                tabSectionId: string;
            };
            const tabSection = renderedTabSections.sections[tabSectionProps.tabSectionId] ?? null;

            if (!tabSection || tabSection.tabs.length === 0) {
                return (
                    <LayoutV2EmptySection
                        label="No Tabs"
                        description="The main workbench group has no open tabs. Activities and panels can open new tabs through the host adapter."
                    />
                );
            }

            return (
                <TabSection
                    leafSectionId={section.id}
                    committedLeafSectionId={resolveCommittedLeafSectionId(
                        section.id,
                        tabDragSession?.hoverTarget?.anchorLeafSectionId,
                    )}
                    tabSectionId={tabSectionProps.tabSectionId}
                    tabSection={tabSection}
                    dragSession={tabDragSession}
                    interactive={!isInteractivePreviewLeaf(section.id, Boolean(tabDragSession))}
                    allowContentPreview={isInteractivePreviewLeaf(section.id, Boolean(tabDragSession))}
                    renderTabTitle={(tab) => (
                        <span className="workbench-layout-v2__tab-title">{tab.title}</span>
                    )}
                    renderTabContent={(tab) => {
                        const payload = readTabPayload(tab);
                        const descriptor = tabComponentsById.get(payload.component);

                        if (!descriptor) {
                            return (
                                <div className="workbench-layout-v2__content-card workbench-layout-v2__content-card--main">
                                    <div className="workbench-layout-v2__content-eyebrow">{tab.title}</div>
                                    <h3>Unregistered tab component</h3>
                                    <p>{payload.component}</p>
                                    <pre>{renderPayload(payload.params)}</pre>
                                </div>
                            );
                        }

                        const Component = descriptor.component as unknown as (props: Record<string, unknown>) => ReactNode;
                        return (
                            <Component
                                params={payload.params}
                                api={{
                                    id: tab.id,
                                    close: () => closeTab(tab.id),
                                    setActive: () => setActiveTab(tab.id),
                                    setTitle: () => undefined,
                                }}
                                containerApi={containerApi}
                            />
                        );
                    }}
                    onDragSessionChange={setTabDragSession}
                    onDragSessionEnd={(session) => {
                        setTabDragSession(null);

                        const committed = commitDraggedTabSession(store.getState().root, store.getState().tabSections, session);
                        if (!committed) {
                            return;
                        }

                        store.replaceState({
                            ...store.getState(),
                            root: committed.root,
                            tabSections: committed.state,
                            workbench: {
                                activeGroupId: committed.activeGroupId,
                            },
                        });
                    }}
                    onFocusTab={setActiveTab}
                    onCloseTab={closeTab}
                    onMoveTab={(move) => store.moveTab(move)}
                />
            );
        },
    });

    return (
        <div className="workbench-layout-v2" data-workbench-layout-mode="layout-v2">
            <SectionLayoutView
                root={renderedRoot}
                renderSection={(section: SectionNode<WorkbenchSectionData>) => (
                    <SectionComponentHost
                        section={section}
                        registry={registry}
                    />
                )}
                onResizeSection={(sectionId, ratio) => store.resizeSection(sectionId, ratio)}
                className="workbench-layout-v2__layout"
            />
        </div>
    );
}

export function WorkbenchLayoutHost(props: WorkbenchLayoutHostProps): ReactNode {
    return <LayoutV2WorkbenchHost {...props} />;
}
