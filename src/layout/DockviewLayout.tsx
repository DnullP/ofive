/**
 * @module layout/DockviewLayout
 * @description 使用 dockview 官方 React 适配实现主布局，并提供接近 SolidJS 版本的交互体验。
 * @dependencies
 *   - react
 *   - dockview
 */

import {
    useEffect,
    useMemo,
    useRef,
    useState,
    type CSSProperties,
    type MouseEvent as ReactMouseEvent,
    type ReactNode,
} from "react";
import {
    DockviewReact,
    PaneviewReact,
    type DockviewApi,
    type DockviewReadyEvent,
    type IDockviewPanelProps,
    type IPaneviewPanelProps,
    type PaneviewApi,
    type PaneviewReadyEvent,
} from "dockview";
import type { PaneviewDndOverlayEvent, PaneviewDropEvent } from "dockview-core";
import "dockview/dist/styles/dockview.css";
import "./DockviewLayout.css";

export type PanelPosition = "left" | "right";

export interface TabComponentDefinition {
    key: string;
    component: (props: IDockviewPanelProps<Record<string, unknown>>) => ReactNode;
}

export interface TabInstanceDefinition {
    id: string;
    title: string;
    component: string;
    params?: Record<string, unknown>;
}

export interface PanelRenderContext {
    activeTabId: string | null;
    dockviewApi: DockviewApi | null;
    openTab: (tab: TabInstanceDefinition) => void;
    closeTab: (tabId: string) => void;
    setActiveTab: (tabId: string) => void;
}

export interface PanelDefinition {
    id: string;
    title: string;
    icon?: ReactNode;
    position?: PanelPosition;
    order?: number;
    activityId?: string;
    activityTitle?: string;
    activityIcon?: ReactNode;
    activitySection?: "top" | "bottom";
    render: (context: PanelRenderContext) => ReactNode;
}

interface DockviewLayoutProps {
    panels?: PanelDefinition[];
    tabComponents?: TabComponentDefinition[];
    initialTabs?: TabInstanceDefinition[];
    initialActivePanelId?: string;
}

interface PanelRuntimeState {
    id: string;
    position: PanelPosition;
    order: number;
    activityId: string;
}

interface ActivityItem {
    id: string;
    title: string;
    icon: ReactNode;
    section: "top" | "bottom";
}

function WelcomeTabComponent(): ReactNode {
    return (
        <div className="dockview-welcome-tab">
            <h2>欢迎使用 ofive</h2>
            <p>请从左侧 Panel 打开文件，或通过扩展注册新的 Tab 组件。</p>
        </div>
    );
}

export function DockviewLayout({
    panels = [],
    tabComponents = [],
    initialTabs = [],
    initialActivePanelId,
}: DockviewLayoutProps): ReactNode {
    const [dockviewApi, setDockviewApi] = useState<DockviewApi | null>(null);
    const [activeTabId, setActiveTabId] = useState<string | null>(null);
    const [leftSidebarWidth, setLeftSidebarWidth] = useState(280);
    const [rightSidebarWidth, setRightSidebarWidth] = useState(260);
    const [panelStates, setPanelStates] = useState<PanelRuntimeState[]>(() =>
        panels.map((panel, index) => ({
            id: panel.id,
            position: panel.position ?? "left",
            order: panel.order ?? index,
            activityId: panel.activityId ?? panel.id,
        })),
    );
    const [activePanelId, setActivePanelId] = useState<string | null>(initialActivePanelId ?? null);
    const [activeActivityId, setActiveActivityId] = useState<string | null>(null);

    const dockviewApiRef = useRef<DockviewApi | null>(null);
    const leftPaneApiRef = useRef<PaneviewApi | null>(null);
    const rightPaneApiRef = useRef<PaneviewApi | null>(null);
    const leftUnhandledDragDisposeRef = useRef<{ dispose: () => void } | null>(null);
    const rightUnhandledDragDisposeRef = useRef<{ dispose: () => void } | null>(null);
    const pendingExpandedStateRef = useRef<Map<string, boolean>>(new Map());

    useEffect(() => {
        dockviewApiRef.current = dockviewApi;
    }, [dockviewApi]);

    const panelById = useMemo(() => new Map(panels.map((panel) => [panel.id, panel])), [panels]);
    const activityMetaById = useMemo(
        () =>
            new Map(
                panels.map((panel) => {
                    const activityId = panel.activityId ?? panel.id;
                    return [
                        activityId,
                        {
                            title: panel.activityTitle ?? panel.title,
                            icon: panel.activityIcon ?? panel.icon ?? panel.title.slice(0, 1).toUpperCase(),
                            section: panel.activitySection ?? "top",
                        },
                    ] as const;
                }),
            ),
        [panels],
    );
    const activityIdByPanelId = useMemo(
        () => new Map(panelStates.map((state) => [state.id, state.activityId])),
        [panelStates],
    );

    const activityIdOf = (panel: PanelDefinition): string =>
        activityIdByPanelId.get(panel.id) ?? panel.activityId ?? panel.id;

    useEffect(() => {
        setPanelStates((prev) => {
            const prevMap = new Map(prev.map((item) => [item.id, item]));
            return panels.map((panel, index) => {
                const existing = prevMap.get(panel.id);
                if (existing) {
                    return existing;
                }
                return {
                    id: panel.id,
                    position: panel.position ?? "left",
                    order: panel.order ?? index,
                    activityId: panel.activityId ?? panel.id,
                };
            });
        });
    }, [panels]);

    const orderedPanelsByPosition = (position: PanelPosition): PanelDefinition[] =>
        panelStates
            .filter((item) => item.position === position)
            .sort((a, b) => a.order - b.order)
            .map((item) => panelById.get(item.id))
            .filter((item): item is PanelDefinition => item !== undefined);

    const leftPanels = useMemo(() => orderedPanelsByPosition("left"), [panelStates, panelById]);
    const rightPanels = useMemo(() => orderedPanelsByPosition("right"), [panelStates, panelById]);

    const activityItems = useMemo<ActivityItem[]>(() => {
        const dedup = new Set<string>();
        const items: ActivityItem[] = [];

        leftPanels.forEach((panel) => {
            const activityId = activityIdOf(panel);
            if (dedup.has(activityId)) {
                return;
            }
            dedup.add(activityId);
            const meta = activityMetaById.get(activityId);
            items.push({
                id: activityId,
                title: meta?.title ?? panel.activityTitle ?? panel.title,
                icon: meta?.icon ?? panel.activityIcon ?? panel.icon ?? panel.title.slice(0, 1).toUpperCase(),
                section: meta?.section ?? panel.activitySection ?? "top",
            });
        });

        return items;
    }, [leftPanels, activityMetaById]);

    useEffect(() => {
        if (activityItems.length === 0) {
            setActiveActivityId(null);
            return;
        }

        if (!activeActivityId || !activityItems.some((item) => item.id === activeActivityId)) {
            setActiveActivityId(activityItems[0]?.id ?? null);
        }
    }, [activeActivityId, activityItems]);

    const visibleLeftPanels = useMemo(() => {
        if (!activeActivityId) {
            return leftPanels;
        }
        return leftPanels.filter((panel) => activityIdOf(panel) === activeActivityId);
    }, [activeActivityId, leftPanels]);

    useEffect(() => {
        if (!activePanelId) {
            setActivePanelId(visibleLeftPanels[0]?.id ?? rightPanels[0]?.id ?? null);
            return;
        }

        const exists = [...visibleLeftPanels, ...rightPanels].some((panel) => panel.id === activePanelId);
        if (!exists) {
            setActivePanelId(visibleLeftPanels[0]?.id ?? rightPanels[0]?.id ?? null);
        }
    }, [activePanelId, visibleLeftPanels, rightPanels]);

    useEffect(() => {
        if (!activePanelId) {
            return;
        }

        const panel = leftPanels.find((item) => item.id === activePanelId);
        if (!panel) {
            return;
        }

        const activityId = activityIdOf(panel);
        if (activityId !== activeActivityId) {
            setActiveActivityId(activityId);
        }
    }, [activePanelId, activeActivityId, leftPanels, activityIdByPanelId]);

    const expandedLeftPanelId = useMemo(() => {
        if (activePanelId && visibleLeftPanels.some((panel) => panel.id === activePanelId)) {
            return activePanelId;
        }
        return visibleLeftPanels[0]?.id ?? null;
    }, [activePanelId, visibleLeftPanels]);

    const syncPanePanels = (api: PaneviewApi, panelList: PanelDefinition[], expandedPanelId: string | null): void => {
        const ids = panelList.map((panel) => panel.id);
        const currentExpandedById = new Map(api.panels.map((panel) => [panel.id, panel.api.isExpanded]));

        const stalePanelIds = api.panels
            .map((panel) => panel.id)
            .filter((panelId) => !ids.includes(panelId));

        stalePanelIds.forEach((panelId) => {
            const stalePanel = api.getPanel(panelId);
            if (!stalePanel) {
                return;
            }

            try {
                api.removePanel(stalePanel);
            } catch (error) {
                if (!(error instanceof DOMException && error.name === "NotFoundError")) {
                    console.warn("[DockviewLayout] skip removing stale panel", panelId, error);
                }
            }
        });

        panelList.forEach((panel, index) => {
            if (!api.getPanel(panel.id)) {
                const pendingExpanded = pendingExpandedStateRef.current.get(panel.id);
                const knownExpanded = currentExpandedById.get(panel.id);
                const fallbackExpanded = expandedPanelId ? panel.id === expandedPanelId : index === 0;

                api.addPanel({
                    id: panel.id,
                    component: panel.id,
                    title: panel.title,
                    isExpanded: pendingExpanded ?? knownExpanded ?? fallbackExpanded,
                    index,
                });

                if (pendingExpanded !== undefined) {
                    pendingExpandedStateRef.current.delete(panel.id);
                }
            }
        });

        ids.forEach((id, index) => {
            const fromIndex = api.panels.findIndex((panel) => panel.id === id);
            if (fromIndex >= 0 && fromIndex !== index) {
                api.movePanel(fromIndex, index);
            }
        });

    };

    useEffect(() => {
        const api = leftPaneApiRef.current;
        if (api) {
            syncPanePanels(api, visibleLeftPanels, expandedLeftPanelId);
        }
    }, [visibleLeftPanels, expandedLeftPanelId]);

    useEffect(() => {
        const api = rightPaneApiRef.current;
        if (api) {
            syncPanePanels(api, rightPanels, null);
        }
    }, [rightPanels]);

    const handleUnhandledDragOver = (targetApi: PaneviewApi, event: PaneviewDndOverlayEvent): void => {
        const data = event.getData();
        if (!data) {
            return;
        }

        if (targetApi.getPanel(data.paneId)) {
            return;
        }

        if (panelById.has(data.paneId)) {
            event.accept();
        }
    };

    const handleCrossContainerDrop = (targetPosition: PanelPosition, event: PaneviewDropEvent): void => {
        const data = event.getData();
        if (!data || event.api.getPanel(data.paneId)) {
            return;
        }

        const movedPanelId = data.paneId;
        const dropTargetPanelId = event.panel.id;
        if (!panelById.has(movedPanelId)) {
            return;
        }

        const sourceExpanded =
            leftPaneApiRef.current?.getPanel(movedPanelId)?.api.isExpanded ??
            rightPaneApiRef.current?.getPanel(movedPanelId)?.api.isExpanded;
        if (typeof sourceExpanded === "boolean") {
            pendingExpandedStateRef.current.set(movedPanelId, sourceExpanded);
        }

        queueMicrotask(() => {
            setPanelStates((prev) => {
                const moved = prev.find((item) => item.id === movedPanelId);
                if (!moved) {
                    return prev;
                }

                const sourcePosition = moved.position;
                const targetPanelId = dropTargetPanelId;
                const firstLeftActivityId = prev
                    .filter((item) => item.position === "left")
                    .sort((a, b) => a.order - b.order)[0]?.activityId;
                const targetPanelState = prev.find(
                    (item) => item.id === targetPanelId && item.position === targetPosition,
                );
                const targetPanelDefinition = panelById.get(targetPanelId);
                const targetPanelActivityId =
                    targetPosition === "left"
                        ? targetPanelState?.activityId ??
                        (targetPanelDefinition ? targetPanelDefinition.activityId ?? targetPanelDefinition.id : undefined)
                        : undefined;
                const fallbackLeftActivityId =
                    targetPanelActivityId ??
                    firstLeftActivityId ??
                    activeActivityId ??
                    moved.activityId;
                const nextActivityId = targetPosition === "left" ? fallbackLeftActivityId : moved.activityId;
                const targetIds = prev
                    .filter((item) => item.position === targetPosition && item.id !== movedPanelId)
                    .sort((a, b) => a.order - b.order)
                    .map((item) => item.id);

                let insertIndex = targetIds.indexOf(targetPanelId);
                if (insertIndex < 0) {
                    insertIndex = targetIds.length;
                }

                if (event.position === "bottom" || event.position === "right") {
                    insertIndex += 1;
                }

                insertIndex = Math.max(0, Math.min(insertIndex, targetIds.length));
                targetIds.splice(insertIndex, 0, movedPanelId);

                const sourceIds = prev
                    .filter((item) => item.position === sourcePosition && item.id !== movedPanelId)
                    .sort((a, b) => a.order - b.order)
                    .map((item) => item.id);

                return prev.map((item) => {
                    if (item.id === movedPanelId) {
                        return {
                            ...item,
                            position: targetPosition,
                            order: targetIds.indexOf(movedPanelId),
                            activityId: nextActivityId,
                        };
                    }

                    if (item.position === targetPosition) {
                        const order = targetIds.indexOf(item.id);
                        if (order >= 0) {
                            return { ...item, order };
                        }
                    }

                    if (item.position === sourcePosition && sourcePosition !== targetPosition) {
                        const order = sourceIds.indexOf(item.id);
                        if (order >= 0) {
                            return { ...item, order };
                        }
                    }

                    return item;
                });
            });

            setActivePanelId((currentActivePanelId) => {
                if (targetPosition === "left") {
                    const hasActiveLeftPanel = leftPanels.some((panel) => panel.id === currentActivePanelId);
                    if (hasActiveLeftPanel) {
                        return currentActivePanelId;
                    }

                    const hasTargetLeftPanel = leftPanels.some((panel) => panel.id === dropTargetPanelId);
                    if (hasTargetLeftPanel) {
                        return dropTargetPanelId;
                    }
                }

                return movedPanelId;
            });
        });
    };

    const openTab = (tab: TabInstanceDefinition): void => {
        const api = dockviewApiRef.current;
        if (!api) {
            return;
        }
        const existing = api.getPanel(tab.id);
        if (existing) {
            existing.api.setActive();
            return;
        }
        api.addPanel({
            id: tab.id,
            title: tab.title,
            component: tab.component,
            params: tab.params,
        });
        setActiveTabId(tab.id);
    };

    const closeTab = (tabId: string): void => {
        dockviewApiRef.current?.getPanel(tabId)?.api.close();
    };

    const setActiveTab = (tabId: string): void => {
        dockviewApiRef.current?.getPanel(tabId)?.api.setActive();
        setActiveTabId(tabId);
    };

    const panelRenderContext: PanelRenderContext = {
        activeTabId,
        dockviewApi,
        openTab,
        closeTab,
        setActiveTab,
    };

    const dockviewComponents = useMemo<Record<string, (props: IDockviewPanelProps<Record<string, unknown>>) => ReactNode>>(
        () => ({
            welcome: WelcomeTabComponent,
            ...Object.fromEntries(tabComponents.map((item) => [item.key, item.component])),
        }),
        [tabComponents],
    );

    const leftPaneComponents = useMemo(
        () =>
            Object.fromEntries(
                visibleLeftPanels.map((panel) => [
                    panel.id,
                    () => <div className="pane-panel-content">{panel.render(panelRenderContext)}</div>,
                ]),
            ) as Record<string, React.FunctionComponent<IPaneviewPanelProps>>,
        [visibleLeftPanels, panelRenderContext],
    );

    const rightPaneComponents = useMemo(
        () =>
            Object.fromEntries(
                rightPanels.map((panel) => [
                    panel.id,
                    () => <div className="pane-panel-content">{panel.render(panelRenderContext)}</div>,
                ]),
            ) as Record<string, React.FunctionComponent<IPaneviewPanelProps>>,
        [rightPanels, panelRenderContext],
    );

    const topActivityItems = useMemo(() => activityItems.filter((item) => item.section === "top"), [activityItems]);
    const bottomActivityItems = useMemo(
        () => activityItems.filter((item) => item.section === "bottom"),
        [activityItems],
    );

    const beginResize = (side: "left" | "right", event: ReactMouseEvent<HTMLDivElement>): void => {
        event.preventDefault();
        const startX = event.clientX;
        const startWidth = side === "left" ? leftSidebarWidth : rightSidebarWidth;

        const onMouseMove = (moveEvent: MouseEvent): void => {
            const delta = moveEvent.clientX - startX;
            if (side === "left") {
                setLeftSidebarWidth(Math.max(220, Math.min(520, startWidth + delta)));
            } else {
                setRightSidebarWidth(Math.max(220, Math.min(520, startWidth - delta)));
            }
        };

        const onMouseUp = (): void => {
            document.removeEventListener("mousemove", onMouseMove);
            document.removeEventListener("mouseup", onMouseUp);
            document.body.style.cursor = "";
            document.body.style.userSelect = "";
        };

        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
        document.addEventListener("mousemove", onMouseMove);
        document.addEventListener("mouseup", onMouseUp);
    };

    const handleLeftPaneReady = (event: PaneviewReadyEvent): void => {
        const api = event.api;
        leftPaneApiRef.current = api;

        leftUnhandledDragDisposeRef.current?.dispose();
        leftUnhandledDragDisposeRef.current = api.onUnhandledDragOverEvent((dragEvent) => {
            handleUnhandledDragOver(api, dragEvent);
        });

        syncPanePanels(api, visibleLeftPanels, expandedLeftPanelId);
    };

    const handleRightPaneReady = (event: PaneviewReadyEvent): void => {
        const api = event.api;
        rightPaneApiRef.current = api;

        rightUnhandledDragDisposeRef.current?.dispose();
        rightUnhandledDragDisposeRef.current = api.onUnhandledDragOverEvent((dragEvent) => {
            handleUnhandledDragOver(api, dragEvent);
        });

        syncPanePanels(api, rightPanels, null);
    };

    useEffect(
        () => () => {
            leftUnhandledDragDisposeRef.current?.dispose();
            rightUnhandledDragDisposeRef.current?.dispose();
        },
        [],
    );

    const handleReady = (event: DockviewReadyEvent): void => {
        const api = event.api;
        setDockviewApi(api);

        api.onDidActivePanelChange((panel) => {
            setActiveTabId(panel?.id ?? null);
        });

        if (initialTabs.length === 0) {
            api.addPanel({ id: "welcome", title: "首页", component: "welcome" });
            return;
        }

        initialTabs.forEach((tab) => {
            api.addPanel({
                id: tab.id,
                title: tab.title,
                component: tab.component,
                params: tab.params,
            });
        });

        setActiveTabId(initialTabs[0]?.id ?? null);
    };

    const activeLeftPanel = visibleLeftPanels.find((panel) => panel.id === activePanelId) ?? visibleLeftPanels[0];

    return (
        <div
            className="dockview-layout"
            style={
                {
                    "--left-sidebar-width": `${String(leftSidebarWidth)}px`,
                    "--right-sidebar-width": `${String(rightSidebarWidth)}px`,
                } as CSSProperties
            }
        >
            <aside className="activity-bar" aria-label="活动栏">
                <div className="activity-bar-top">
                    {topActivityItems.map((item) => (
                        <button
                            key={item.id}
                            type="button"
                            className={`activity-bar-item ${item.id === activeActivityId ? "active" : ""}`}
                            title={item.title}
                            onClick={() => {
                                setActiveActivityId(item.id);
                                const panel = leftPanels.find((candidate) => activityIdOf(candidate) === item.id);
                                if (panel) {
                                    setActivePanelId(panel.id);
                                }
                            }}
                        >
                            {item.icon}
                        </button>
                    ))}
                </div>

                <div className="activity-bar-bottom">
                    {bottomActivityItems.map((item) => (
                        <button
                            key={item.id}
                            type="button"
                            className={`activity-bar-item ${item.id === activeActivityId ? "active" : ""}`}
                            title={item.title}
                            onClick={() => {
                                setActiveActivityId(item.id);
                                const panel = leftPanels.find((candidate) => activityIdOf(candidate) === item.id);
                                if (panel) {
                                    setActivePanelId(panel.id);
                                }
                            }}
                        >
                            {item.icon}
                        </button>
                    ))}
                </div>
            </aside>

            <section className="left-sidebar" aria-label="左侧扩展面板区">
                <header className="sidebar-header">{activeLeftPanel?.title ?? "Panels"}</header>
                <div className="sidebar-content">
                    <PaneviewReact
                        className="dockview-theme-abyss sidebar-paneview-container"
                        components={leftPaneComponents}
                        onReady={handleLeftPaneReady}
                        onDidDrop={(event) => {
                            handleCrossContainerDrop("left", event);
                        }}
                    />
                </div>
                <div className="sidebar-resize-handle right-edge" onMouseDown={(event) => beginResize("left", event)} />
            </section>

            <main className="main-content-area" aria-label="Dockview 主区域">
                <DockviewReact
                    className="dockview-theme-abyss main-dockview"
                    components={dockviewComponents}
                    onReady={handleReady}
                />
            </main>

            {rightPanels.length > 0 && (
                <section className="right-sidebar" aria-label="右侧扩展面板区">
                    <div className="sidebar-resize-handle left-edge" onMouseDown={(event) => beginResize("right", event)} />
                    <header className="sidebar-header">Right Panels</header>
                    <div className="sidebar-content">
                        <PaneviewReact
                            className="dockview-theme-abyss sidebar-paneview-container"
                            components={rightPaneComponents}
                            onReady={handleRightPaneReady}
                            onDidDrop={(event) => {
                                handleCrossContainerDrop("right", event);
                            }}
                        />
                    </div>
                </section>
            )}
        </div>
    );
}
