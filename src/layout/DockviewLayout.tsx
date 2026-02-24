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
import { Settings } from "lucide-react";
import {
    getArticleSnapshotById,
    getFocusedArticleSnapshot,
    reportArticleFocus,
} from "../store/editorContextStore";
import {
    moveVaultDirectoryToDirectory,
    moveVaultMarkdownFileToDirectory,
    readVaultMarkdownFile,
    saveVaultMarkdownFile,
} from "../api/vaultApi";
import { subscribeVaultFsBusEvent } from "../events/appEventBus";
import { useVaultState } from "../store/vaultStore";
import {
    executeCommand,
    getCommandCondition,
    getCommandDefinitions,
    isEditorScopedCommand,
    type CommandContext,
    type CommandId,
} from "../commands/commandSystem";
import {
    detectFocusedComponentFromEvent,
    initFocusTracking,
    isConditionSatisfied,
    PANEL_ID_DATA_ATTR,
    TAB_COMPONENT_DATA_ATTR,
} from "../commands/focusContext";
import {
    COMMAND_PALETTE_OPEN_REQUESTED_EVENT,
    QUICK_SWITCHER_OPEN_REQUESTED_EVENT,
    TAB_CLOSE_SHORTCUT_TRIGGERED_EVENT,
    notifyTabCloseShortcutTriggered,
} from "../commands/shortcutEvents";
import {
    ensureShortcutBindingsLoaded,
    matchShortcut,
    useShortcutState,
} from "../store/shortcutStore";
import {
    requestApplicationQuit,
    resolveSystemShortcutCommand,
} from "../commands/systemShortcutSubsystem";
import { applyPanelOrderForPosition } from "./panelOrderUtils";
import { CommandPaletteModal } from "./CommandPaletteModal";
import { MoveFileDirectoryModal } from "./MoveFileDirectoryModal";
import { QuickSwitcherModal } from "./QuickSwitcherModal";

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
    requestMoveFileToDirectory: (relativePath: string) => void;
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
    onActivityClick?: (context: PanelRenderContext) => void;
    render: (context: PanelRenderContext) => ReactNode;
}

interface DockviewLayoutProps {
    panels?: PanelDefinition[];
    tabComponents?: TabComponentDefinition[];
    initialTabs?: TabInstanceDefinition[];
    initialActivePanelId?: string;
}

const SETTINGS_TAB_ID = "settings";

function openSettingsTab(api: DockviewApi | null): void {
    if (!api) {
        return;
    }

    const existingPanel = api.getPanel(SETTINGS_TAB_ID);
    if (existingPanel) {
        existingPanel.api.setActive();
        return;
    }

    api.addPanel({
        id: SETTINGS_TAB_ID,
        title: "设置",
        component: "settings",
    });
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

interface MoveSourceSnapshot {
    articleId: string;
    path: string;
    isDir: boolean;
    content: string;
    hasInMemoryContent: boolean;
}

function isMarkdownPath(path: string): boolean {
    const normalizedPath = path.toLowerCase();
    return normalizedPath.endsWith(".md") || normalizedPath.endsWith(".markdown");
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
    const [isLeftSidebarVisible, setIsLeftSidebarVisible] = useState(true);
    const [isRightSidebarVisible, setIsRightSidebarVisible] = useState(true);
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
    const [isQuickSwitcherOpen, setIsQuickSwitcherOpen] = useState<boolean>(false);
    const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState<boolean>(false);
    const [isMoveFileDirectoryModalOpen, setIsMoveFileDirectoryModalOpen] = useState<boolean>(false);
    const [moveSourceSnapshot, setMoveSourceSnapshot] = useState<MoveSourceSnapshot | null>(null);
    const { currentVaultPath, isLoadingTree, error: vaultError, files } = useVaultState();
    const { bindings } = useShortcutState();

    const dockviewApiRef = useRef<DockviewApi | null>(null);
    const leftPaneApiRef = useRef<PaneviewApi | null>(null);
    const rightPaneApiRef = useRef<PaneviewApi | null>(null);
    const leftUnhandledDragDisposeRef = useRef<{ dispose: () => void } | null>(null);
    const rightUnhandledDragDisposeRef = useRef<{ dispose: () => void } | null>(null);
    const pendingExpandedStateRef = useRef<Map<string, boolean>>(new Map());
    const suppressWindowCloseUntilRef = useRef<number>(0);
    const mainDockHostRef = useRef<HTMLDivElement | null>(null);

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
        if (!data) {
            return;
        }

        const movedPanelId = data.paneId;
        const dropTargetPanelId = event.panel.id;
        if (!panelById.has(movedPanelId)) {
            return;
        }

        if (event.api.getPanel(movedPanelId)) {
            const orderedIds = event.api.panels
                .map((panel) => panel.id)
                .filter((panelId) => panelById.has(panelId));

            setPanelStates((prev) => applyPanelOrderForPosition(prev, targetPosition, orderedIds));

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

    const openMarkdownTabByRelativePath = async (relativePath: string): Promise<void> => {
        const normalizedPath = relativePath.replace(/\\/g, "/");
        const fileName = normalizedPath.split("/").pop() ?? "untitled.md";

        console.info("[quick-switcher] open markdown tab start", { relativePath: normalizedPath });
        const file = await readVaultMarkdownFile(normalizedPath);

        openTab({
            id: `file:${normalizedPath}`,
            title: fileName,
            component: "codemirror",
            params: {
                path: normalizedPath,
                content: file.content,
            },
        });

        console.info("[quick-switcher] open markdown tab success", {
            relativePath: normalizedPath,
            bytes: file.content.length,
        });
    };

    const resolveMovableFocusedArticle = (): MoveSourceSnapshot | null => {
        const activeArticle = activeTabId ? getArticleSnapshotById(activeTabId) : null;
        const focusedArticle = getFocusedArticleSnapshot();
        const targetArticle = activeArticle ?? focusedArticle;

        if (!targetArticle) {
            console.warn("[move-file] open modal skipped: no focused article snapshot");
            return null;
        }

        const normalizedPath = targetArticle.path.replace(/\\/g, "/");
        const isMarkdown = normalizedPath.endsWith(".md") || normalizedPath.endsWith(".markdown");
        if (!isMarkdown) {
            console.warn("[move-file] open modal skipped: focused article is not markdown", {
                path: normalizedPath,
            });
            return null;
        }

        return {
            articleId: targetArticle.articleId,
            path: normalizedPath,
            isDir: false,
            content: targetArticle.content,
            hasInMemoryContent: true,
        };
    };

    const openMoveFocusedFileDirectoryModal = (): void => {
        const sourceSnapshot = resolveMovableFocusedArticle();
        if (!sourceSnapshot) {
            return;
        }

        setMoveSourceSnapshot(sourceSnapshot);
        setIsMoveFileDirectoryModalOpen(true);
        console.info("[move-file] open directory picker", {
            articleId: sourceSnapshot.articleId,
            sourcePath: sourceSnapshot.path,
        });
    };

    const openMoveFileDirectoryModalByPath = (relativePath: string): void => {
        const normalizedPath = relativePath.replace(/\\/g, "/");
        const targetEntry = files.find((entry) => entry.path.replace(/\\/g, "/") === normalizedPath);
        if (!targetEntry) {
            console.warn("[move-file] open modal by path skipped: target path missing in tree", {
                relativePath,
            });
            return;
        }

        if (!targetEntry.isDir && !isMarkdownPath(normalizedPath)) {
            console.warn("[move-file] open modal by path skipped: target file is not markdown", {
                relativePath,
            });
            return;
        }

        const tabId = `file:${normalizedPath}`;
        const openedSnapshot = getArticleSnapshotById(tabId);
        const sourceSnapshot: MoveSourceSnapshot = {
            articleId: openedSnapshot?.articleId ?? tabId,
            path: normalizedPath,
            isDir: targetEntry.isDir,
            content: openedSnapshot?.content ?? "",
            hasInMemoryContent: Boolean(openedSnapshot),
        };

        setMoveSourceSnapshot(sourceSnapshot);
        setIsMoveFileDirectoryModalOpen(true);
        console.info("[move-file] open directory picker by path", {
            articleId: sourceSnapshot.articleId,
            sourcePath: sourceSnapshot.path,
        });
    };

    const closeMoveFocusedFileDirectoryModal = (): void => {
        setIsMoveFileDirectoryModalOpen(false);
        setMoveSourceSnapshot(null);
    };

    const moveDirectoryOptions = useMemo(
        () =>
            files
                .filter((entry) => entry.isDir)
                .map((entry) => entry.path.replace(/\\/g, "/"))
                .sort((left, right) => left.localeCompare(right)),
        [files],
    );

    const handleMoveFileToDirectoryConfirmed = async (targetDirectoryRelativePath: string): Promise<void> => {
        const source = moveSourceSnapshot;
        if (!source) {
            console.warn("[move-file] confirm skipped: missing source snapshot");
            return;
        }

        try {
            if (source.isDir) {
                const moveResult = await moveVaultDirectoryToDirectory(source.path, targetDirectoryRelativePath);
                closeMoveFocusedFileDirectoryModal();
                console.info("[move-file] moved directory", {
                    from: source.path,
                    to: moveResult.relativePath,
                });
                return;
            }

            const moveResult = await moveVaultMarkdownFileToDirectory(source.path, targetDirectoryRelativePath);
            const targetPath = moveResult.relativePath.replace(/\\/g, "/");

            if (targetPath === source.path) {
                console.info("[move-file] source and target are identical, skip reopen", {
                    path: targetPath,
                });
                closeMoveFocusedFileDirectoryModal();
                return;
            }

            if (source.hasInMemoryContent) {
                await saveVaultMarkdownFile(targetPath, source.content);
            }

            closeTab(source.articleId);
            openTab({
                id: `file:${targetPath}`,
                title: targetPath.split("/").pop() ?? "untitled.md",
                component: "codemirror",
                params: {
                    path: targetPath,
                    content: source.hasInMemoryContent ? source.content : await readVaultMarkdownFile(targetPath).then((result) => result.content),
                },
            });

            closeMoveFocusedFileDirectoryModal();
            console.info("[move-file] moved focused markdown file", {
                from: source.path,
                to: targetPath,
            });
        } catch (error) {
            console.error("[move-file] move failed", {
                from: source.path,
                targetDirectoryRelativePath,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    };

    const setActiveTab = (tabId: string): void => {
        dockviewApiRef.current?.getPanel(tabId)?.api.setActive();
        setActiveTabId(tabId);
    };

    const buildCommandContext = (): CommandContext => ({
        activeTabId,
        closeTab,
        openQuickSwitcher: () => {
            console.info("[quick-switcher] open requested by command");
            setIsQuickSwitcherOpen(true);
        },
        openCommandPalette: () => {
            console.info("[command-palette] open requested by command");
            setIsCommandPaletteOpen(true);
        },
        openMoveFocusedFileToDirectory: () => {
            openMoveFocusedFileDirectoryModal();
        },
        toggleLeftSidebarVisibility: () => {
            setIsLeftSidebarVisible((previousValue) => {
                const nextValue = !previousValue;
                console.info("[layout] toggle left sidebar", {
                    previousValue,
                    nextValue,
                });
                return nextValue;
            });
        },
        toggleRightSidebarVisibility: () => {
            setIsRightSidebarVisible((previousValue) => {
                const nextValue = !previousValue;
                console.info("[layout] toggle right sidebar", {
                    previousValue,
                    nextValue,
                });
                return nextValue;
            });
        },
        openFileTab: (relativePath, content) => {
            const normalizedPath = relativePath.replace(/\\/g, "/");
            const fileName = normalizedPath.split("/").pop() ?? "untitled.md";
            openTab({
                id: `file:${normalizedPath}`,
                title: fileName,
                component: "codemirror",
                params: {
                    path: normalizedPath,
                    content,
                },
            });
        },
        getExistingMarkdownPaths: () =>
            files
                .filter((entry) => !entry.isDir)
                .filter((entry) => entry.path.endsWith(".md") || entry.path.endsWith(".markdown"))
                .map((entry) => entry.path),
        quitApplication: async () => {
            await requestApplicationQuit();
        },
        getFileTreeSelectedItem: () => {
            const activeEl = document.activeElement as HTMLElement | null;
            if (!activeEl?.closest(".file-tree")) {
                return null;
            }
            const treeItemEl = activeEl.closest("[data-tree-path]") as HTMLElement | null;
            if (!treeItemEl) {
                return null;
            }
            const path = treeItemEl.getAttribute("data-tree-path");
            if (!path) {
                return null;
            }
            const isDir = treeItemEl.getAttribute("data-tree-is-dir") === "true";
            return { path, isDir };
        },
        getFileTreePasteTargetDirectory: () => {
            const activeEl = document.activeElement as HTMLElement | null;
            const treeItemEl = activeEl?.closest("[data-tree-path]") as HTMLElement | null;
            if (!treeItemEl) {
                return "";
            }
            const path = treeItemEl.getAttribute("data-tree-path") ?? "";
            const isDir = treeItemEl.getAttribute("data-tree-is-dir") === "true";
            if (isDir) {
                return path;
            }
            const splitIndex = path.lastIndexOf("/");
            return splitIndex >= 0 ? path.slice(0, splitIndex) : "";
        },
    });

    // 初始化组件焦点追踪，记录焦点在编辑器/文件树/其他组件间的切换日志
    useEffect(() => {
        return initFocusTracking();
    }, []);

    // 订阅文件系统删除事件，自动关闭对应的编辑器 tab
    // 适用于文件删除和目录删除（目录删除时关闭其下所有文件的 tab）
    useEffect(() => {
        const unlisten = subscribeVaultFsBusEvent((payload) => {
            if (payload.eventType !== "deleted") {
                return;
            }

            const deletedPath = payload.relativePath;
            if (!deletedPath) {
                console.warn("[dockview-layout] delete event missing relativePath", {
                    eventId: payload.eventId,
                });
                return;
            }

            const api = dockviewApiRef.current;
            if (!api) {
                return;
            }

            const normalizedDeletedPath = deletedPath.replace(/\\/g, "/");

            // 尝试关闭精确匹配的文件 tab（file:<path>）
            const exactTabId = `file:${normalizedDeletedPath}`;
            const exactPanel = api.getPanel(exactTabId);
            if (exactPanel) {
                exactPanel.api.close();
                console.info("[dockview-layout] closed tab for deleted file", {
                    eventId: payload.eventId,
                    tabId: exactTabId,
                    path: normalizedDeletedPath,
                });
                return;
            }

            // 目录删除：关闭该目录下所有文件的 tab
            const dirPrefix = `file:${normalizedDeletedPath}/`;
            const panelsToClose = api.panels.filter((panel) => panel.id.startsWith(dirPrefix));

            for (const panel of panelsToClose) {
                panel.api.close();
            }

            if (panelsToClose.length > 0) {
                console.info("[dockview-layout] closed tabs for deleted directory", {
                    eventId: payload.eventId,
                    directory: normalizedDeletedPath,
                    closedCount: panelsToClose.length,
                    closedTabIds: panelsToClose.map((p) => p.id),
                });
            }
        });

        return unlisten;
    }, []);

    useEffect(() => {
        if (!currentVaultPath || isLoadingTree || vaultError) {
            return;
        }

        void ensureShortcutBindingsLoaded(currentVaultPath);
    }, [currentVaultPath, isLoadingTree, vaultError]);

    useEffect(() => {
        let unlisten: (() => void) | null = null;
        const handleCloseShortcutTriggered = (): void => {
            suppressWindowCloseUntilRef.current = Date.now() + 1200;
        };

        window.addEventListener(TAB_CLOSE_SHORTCUT_TRIGGERED_EVENT, handleCloseShortcutTriggered);

        const runtimeWindow = window as Window & {
            __TAURI_INTERNALS__?: unknown;
            __TAURI__?: unknown;
        };
        const isTauriRuntime = Boolean(runtimeWindow.__TAURI_INTERNALS__ || runtimeWindow.__TAURI__);
        if (!isTauriRuntime) {
            return;
        }

        void import("@tauri-apps/api/window")
            .then(async ({ getCurrentWindow }) => {
                unlisten = await getCurrentWindow().onCloseRequested((event) => {
                    const now = Date.now();
                    if (now <= suppressWindowCloseUntilRef.current) {
                        event.preventDefault();
                        console.info("[shortcut] blocked native window close after close-tab shortcut");
                    }
                });
            })
            .catch((error) => {
                console.warn("[shortcut] failed to attach onCloseRequested guard", error);
            });

        return () => {
            window.removeEventListener(TAB_CLOSE_SHORTCUT_TRIGGERED_EVENT, handleCloseShortcutTriggered);
            if (unlisten) {
                unlisten();
            }
        };
    }, []);

    useEffect(() => {
        const handleQuickSwitcherOpenRequested = (): void => {
            console.info("[quick-switcher] open requested by event");
            setIsQuickSwitcherOpen(true);
        };

        window.addEventListener(QUICK_SWITCHER_OPEN_REQUESTED_EVENT, handleQuickSwitcherOpenRequested);
        return () => {
            window.removeEventListener(QUICK_SWITCHER_OPEN_REQUESTED_EVENT, handleQuickSwitcherOpenRequested);
        };
    }, []);

    useEffect(() => {
        const handleCommandPaletteOpenRequested = (): void => {
            console.info("[command-palette] open requested by event");
            setIsCommandPaletteOpen(true);
        };

        window.addEventListener(COMMAND_PALETTE_OPEN_REQUESTED_EVENT, handleCommandPaletteOpenRequested);
        return () => {
            window.removeEventListener(COMMAND_PALETTE_OPEN_REQUESTED_EVENT, handleCommandPaletteOpenRequested);
        };
    }, []);

    useEffect(() => {
        const handleKeydown = (event: KeyboardEvent): void => {
            const target = event.target as HTMLElement | null;
            const isCodeMirrorTarget = Boolean(target?.closest(".cm-editor"));
            const isTypingTarget =
                target instanceof HTMLInputElement ||
                target instanceof HTMLTextAreaElement ||
                target?.isContentEditable === true;

            // 编辑器快捷键由 CodeMirrorEditorTab 的独立 handler 处理
            if (isCodeMirrorTarget) {
                return;
            }

            // 文本输入框中不拦截快捷键，保留原生行为
            if (isTypingTarget) {
                return;
            }

            // 系统级快捷键（Cmd+W/Cmd+Q）优先级最高
            const systemShortcutResolution = resolveSystemShortcutCommand(event, bindings);
            if (systemShortcutResolution) {
                event.preventDefault();
                event.stopPropagation();

                if (systemShortcutResolution.commandId === "tab.closeFocused") {
                    notifyTabCloseShortcutTriggered();
                }

                executeCommand(systemShortcutResolution.commandId, buildCommandContext());
                return;
            }

            // 检测当前焦点上下文，用于条件匹配
            const focusedComponent = detectFocusedComponentFromEvent(event);

            // 找到所有快捷键匹配的命令
            const matchingCommandIds = Object.entries(bindings)
                .filter(([, shortcut]) => matchShortcut(event, shortcut))
                .map(([id]) => id as CommandId);

            if (matchingCommandIds.length === 0) {
                return;
            }

            // 优先选择条件匹配的命令（更具体），其次无条件的全局命令
            const conditionedMatch = matchingCommandIds.find((id) => {
                const condition = getCommandCondition(id);
                return condition !== undefined && isConditionSatisfied(condition, focusedComponent);
            });

            const unconditionedMatch = matchingCommandIds.find((id) => {
                const condition = getCommandCondition(id);
                return condition === undefined && !isEditorScopedCommand(id);
            });

            const commandId = conditionedMatch ?? unconditionedMatch ?? null;

            if (!commandId) {
                return;
            }

            // 编辑器作用域命令不在全局 handler 中执行（已由编辑器处理）
            if (isEditorScopedCommand(commandId)) {
                return;
            }

            event.preventDefault();
            event.stopPropagation();

            if (commandId === "tab.closeFocused") {
                notifyTabCloseShortcutTriggered();
            }

            executeCommand(commandId, buildCommandContext());
        };

        window.addEventListener("keydown", handleKeydown, { capture: true });
        return () => {
            window.removeEventListener("keydown", handleKeydown, { capture: true });
        };
    }, [bindings, activeTabId, files, openTab]);

    const panelRenderContext: PanelRenderContext = {
        activeTabId,
        dockviewApi,
        openTab,
        closeTab,
        setActiveTab,
        requestMoveFileToDirectory: (relativePath: string) => {
            openMoveFileDirectoryModalByPath(relativePath);
        },
    };

    // 为每个 dockview tab 组件包装 data-tab-component 属性容器，
    // 使焦点检测可通过 DOM 属性识别当前聚焦的标签类型
    const dockviewComponents = useMemo<Record<string, (props: IDockviewPanelProps<Record<string, unknown>>) => ReactNode>>(
        () => {
            const wrapTabComponent = (
                componentKey: string,
                Component: (props: IDockviewPanelProps<Record<string, unknown>>) => ReactNode,
            ): ((props: IDockviewPanelProps<Record<string, unknown>>) => ReactNode) => {
                const Wrapped = (tabProps: IDockviewPanelProps<Record<string, unknown>>): ReactNode => (
                    // tabIndex={-1} 使容器可聚焦，点击空白区域也能触发 focusin
                    // outline: "none" 避免容器获焦时显示浏览器默认蓝色轮廓
                    <div
                        {...{ [TAB_COMPONENT_DATA_ATTR]: componentKey }}
                        tabIndex={-1}
                        style={{ height: "100%", outline: "none" }}
                    >
                        <Component {...tabProps} />
                    </div>
                );
                Wrapped.displayName = `TabWrapper(${componentKey})`;
                return Wrapped;
            };

            return {
                welcome: wrapTabComponent("welcome", WelcomeTabComponent),
                ...Object.fromEntries(
                    tabComponents.map((item) => [item.key, wrapTabComponent(item.key, item.component)]),
                ),
            };
        },
        [tabComponents],
    );

    // 为每个侧栏 pane panel 包装 data-panel-id 属性容器，
    // 使焦点检测可通过 DOM 属性识别当前聚焦的面板
    const leftPaneComponents = useMemo(
        () =>
            Object.fromEntries(
                visibleLeftPanels.map((panel) => [
                    panel.id,
                    () => (
                        // tabIndex={-1} 使面板容器可聚焦，点击空白区域触发 focusin
                        <div
                            className="pane-panel-content"
                            {...{ [PANEL_ID_DATA_ATTR]: panel.id }}
                            tabIndex={-1}
                            style={{ outline: "none" }}
                        >
                            {panel.render(panelRenderContext)}
                        </div>
                    ),
                ]),
            ) as Record<string, React.FunctionComponent<IPaneviewPanelProps>>,
        [visibleLeftPanels, panelRenderContext],
    );

    const rightPaneComponents = useMemo(
        () =>
            Object.fromEntries(
                rightPanels.map((panel) => [
                    panel.id,
                    () => (
                        // tabIndex={-1} 使面板容器可聚焦，点击空白区域触发 focusin
                        <div
                            className="pane-panel-content"
                            {...{ [PANEL_ID_DATA_ATTR]: panel.id }}
                            tabIndex={-1}
                            style={{ outline: "none" }}
                        >
                            {panel.render(panelRenderContext)}
                        </div>
                    ),
                ]),
            ) as Record<string, React.FunctionComponent<IPaneviewPanelProps>>,
        [rightPanels, panelRenderContext],
    );

    const topActivityItems = useMemo(() => activityItems.filter((item) => item.section === "top"), [activityItems]);
    const bottomActivityItems = useMemo(
        () => activityItems.filter((item) => item.section === "bottom"),
        [activityItems],
    );

    const handleActivityItemClick = (activityId: string): void => {
        const panel = leftPanels.find((candidate) => activityIdOf(candidate) === activityId);
        if (!panel) {
            return;
        }

        if (panel.onActivityClick) {
            panel.onActivityClick(panelRenderContext);
            return;
        }

        setIsLeftSidebarVisible(true);
        setActiveActivityId(activityId);
        setActivePanelId(panel.id);
    };

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

    useEffect(() => {
        const host = mainDockHostRef.current;
        if (!host) {
            return;
        }

        const applyTabStripDragRegion = (): void => {
            const tabStrips = host.querySelectorAll<HTMLElement>(".dv-tabs-and-actions-container");
            tabStrips.forEach((tabStrip) => {
                tabStrip.setAttribute("data-tauri-drag-region", "");
                tabStrip.classList.add("tab-strip-drag-region");
            });
        };

        applyTabStripDragRegion();

        const observer = new MutationObserver(() => {
            applyTabStripDragRegion();
        });

        observer.observe(host, {
            childList: true,
            subtree: true,
        });

        return () => {
            observer.disconnect();
        };
    }, [dockviewApi]);

    const handleReady = (event: DockviewReadyEvent): void => {
        const api = event.api;
        setDockviewApi(api);

        api.onDidActivePanelChange((panel) => {
            setActiveTabId(panel?.id ?? null);

            if (!panel) {
                return;
            }

            const activeDockPanel = api.getPanel(panel.id);
            const params = activeDockPanel?.params as Record<string, unknown> | undefined;
            const hasPath = typeof params?.path === "string" && params.path.length > 0;

            if (!hasPath) {
                return;
            }

            const panelPath = hasPath ? (params?.path as string) : panel.id;

            reportArticleFocus({
                articleId: panel.id,
                path: panelPath,
            });
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
    const shouldRenderLeftSidebar = isLeftSidebarVisible && visibleLeftPanels.length > 0;
    const shouldRenderRightSidebar = isRightSidebarVisible && rightPanels.length > 0;
    const gridTemplateColumns = shouldRenderLeftSidebar
        ? (shouldRenderRightSidebar
            ? "48px var(--left-sidebar-width, 280px) 1fr var(--right-sidebar-width, 260px)"
            : "48px var(--left-sidebar-width, 280px) 1fr")
        : (shouldRenderRightSidebar
            ? "48px 1fr var(--right-sidebar-width, 260px)"
            : "48px 1fr");

    return (
        <div
            className="dockview-layout"
            style={
                {
                    "--left-sidebar-width": `${String(leftSidebarWidth)}px`,
                    "--right-sidebar-width": `${String(rightSidebarWidth)}px`,
                    gridTemplateColumns,
                } as CSSProperties
            }
        >
            <aside className="activity-bar activity-bar-drag-region" aria-label="活动栏" data-tauri-drag-region>
                <div className="activity-bar-top">
                    {topActivityItems.map((item) => (
                        <button
                            key={item.id}
                            type="button"
                            className={`activity-bar-item window-no-drag ${item.id === activeActivityId ? "active" : ""}`}
                            title={item.title}
                            onClick={() => {
                                handleActivityItemClick(item.id);
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
                            className={`activity-bar-item window-no-drag ${item.id === activeActivityId ? "active" : ""}`}
                            title={item.title}
                            onClick={() => {
                                handleActivityItemClick(item.id);
                            }}
                        >
                            {item.icon}
                        </button>
                    ))}
                    <button
                        type="button"
                        className="activity-bar-item window-no-drag"
                        title="设置"
                        onClick={() => {
                            openSettingsTab(dockviewApiRef.current);
                        }}
                    >
                        <Settings size={18} strokeWidth={1.8} />
                    </button>
                </div>
            </aside>

            {shouldRenderLeftSidebar && (
                <section className="left-sidebar" aria-label="左侧扩展面板区">
                    <header className="sidebar-header window-drag-region" data-tauri-drag-region>{activeLeftPanel?.title ?? "Panels"}</header>
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
            )}

            <main className="main-content-area" aria-label="Dockview 主区域">
                <div ref={mainDockHostRef} className="main-dockview-host">
                    <DockviewReact
                        className="dockview-theme-abyss main-dockview"
                        components={dockviewComponents}
                        onReady={handleReady}
                    />
                </div>
            </main>

            {shouldRenderRightSidebar && (
                <section className="right-sidebar" aria-label="右侧扩展面板区">
                    <div className="sidebar-resize-handle left-edge" onMouseDown={(event) => beginResize("right", event)} />
                    <header className="sidebar-header window-drag-region" data-tauri-drag-region>Right Panels</header>
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

            <QuickSwitcherModal
                isOpen={isQuickSwitcherOpen}
                onClose={() => {
                    console.info("[quick-switcher] closed");
                    setIsQuickSwitcherOpen(false);
                }}
                onOpenRelativePath={(relativePath) => {
                    void openMarkdownTabByRelativePath(relativePath).catch((error) => {
                        console.error("[quick-switcher] open markdown tab failed", {
                            relativePath,
                            error: error instanceof Error ? error.message : String(error),
                        });
                    });
                }}
            />

            <CommandPaletteModal
                isOpen={isCommandPaletteOpen}
                commands={getCommandDefinitions().filter((command) => command.id !== "commandPalette.open")}
                onClose={() => {
                    console.info("[command-palette] closed");
                    setIsCommandPaletteOpen(false);
                }}
                onExecuteCommand={(commandId) => {
                    executeCommand(commandId, buildCommandContext());
                }}
            />

            <MoveFileDirectoryModal
                isOpen={isMoveFileDirectoryModalOpen}
                sourceFilePath={moveSourceSnapshot?.path ?? ""}
                directories={moveDirectoryOptions}
                onClose={() => {
                    console.info("[move-file] closed directory picker");
                    closeMoveFocusedFileDirectoryModal();
                }}
                onConfirmDirectory={(directoryRelativePath) => {
                    void handleMoveFileToDirectoryConfirmed(directoryRelativePath);
                }}
            />
        </div>
    );
}
