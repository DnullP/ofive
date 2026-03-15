/**
 * @module host/layout/DockviewLayout
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
import { useTranslation } from "react-i18next";
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
import { getPaneData } from "dockview-core";
import "dockview/dist/styles/dockview.css";
import "./DockviewLayout.css";
import { Settings } from "lucide-react";
import i18n from "../../i18n";
import {
    getArticleSnapshotById,
    getFocusedArticleSnapshot,
    reportArticleFocus,
} from "../store/editorContextStore";
import {
    clearActiveEditor,
    reportActiveEditor,
} from "../store/activeEditorStore";
import {
    moveVaultDirectoryToDirectory,
    moveVaultMarkdownFileToDirectory,
    readVaultMarkdownFile,
    saveVaultMarkdownFile,
} from "../../api/vaultApi";
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
import { MoveFileDirectoryModal } from "./MoveFileDirectoryModal";
import { CreateEntryModal } from "./CreateEntryModal";
import {
    SETTINGS_ACTIVITY_ID,
    mergeActivityBarConfig,
    useActivityBarConfig,
    ensureActivityBarConfigLoaded,
    updateActivityBarConfig,
} from "../store/activityBarStore";
import { showNativeContextMenu } from "./nativeContextMenu";
import {
    ActivityBar,
    SidebarHeader,
    Sidebar,
    SidebarIconBar,
    ACTIVITY_ICON_DRAG_TYPE,
    type ActivityIconItem,
    type IconDragState,
} from "./sidebar";
import {
    registerOverlay,
    useSidebarHeaderActions,
    useActivities,
    useOverlays,
    usePanels,
    useTabComponents,
    resolveTitle,
    resolveActivityTitle,
} from "../registry";
import {
    buildInitialPanelStates,
    mergePanelStates,
    computeCrossContainerDrop,
    computeEmptySidebarDrop,
    computeEmptyRightSidebarDrop,
} from "./layoutStateReducers";
import { openFileWithResolver } from "./openFileService";
import {
    setRightSidebarVisibilitySnapshot,
    subscribeRightSidebarToggleRequest,
} from "./rightSidebarVisibilityBridge";

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
    openFile: (options: {
        relativePath: string;
        contentOverride?: string;
        preferredOpenerId?: string;
    }) => Promise<void>;
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
    /**
     * 标记此面板为"仅标签"模式：点击图标只触发 onActivityClick 打开 Tab，
     * 不在侧边栏中生成面板容器。适用于知识图谱等无需侧边栏面板的活动。
     */
    tabOnly?: boolean;
    render: (context: PanelRenderContext) => ReactNode;
}

/**
 * @interface DockviewLayoutProps
 * @description DockviewLayout 组件属性。
 *   panels 和 tabComponents 现在从全局注册中心获取，
 *   不再需要通过 props 传入。initialTabs 和 initialActivePanelId
 *   仍通过 props 控制初始状态。
 * @field initialTabs           - 初始打开的标签页列表
 * @field initialActivePanelId  - 初始激活的面板 ID
 */
interface DockviewLayoutProps {
    /** 初始打开的标签页 */
    initialTabs?: TabInstanceDefinition[];
    /** 初始激活的面板 ID */
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
        title: i18n.t("dockview.settingsTooltip"),
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

/**
 * @function syncActiveEditorFromPanel
 * @description 根据当前激活的 dockview panel 同步活跃 Markdown 编辑器状态。
 *   仅 Markdown 编辑器标签会写入 activeEditorStore；其他标签会清空该状态。
 * @param panelId 当前激活 panel ID；null 表示无激活标签。
 * @param panelParams 当前激活 panel 的参数。
 */
function syncActiveEditorFromPanel(
    panelId: string | null,
    panelParams: Record<string, unknown> | undefined,
): void {
    if (!panelId) {
        clearActiveEditor();
        return;
    }

    const path = typeof panelParams?.path === "string"
        ? panelParams.path.replace(/\\/g, "/")
        : null;

    if (!path || !isMarkdownPath(path)) {
        clearActiveEditor();
        return;
    }

    reportActiveEditor({
        articleId: panelId,
        path,
    });
}

function WelcomeTabComponent(): ReactNode {
    const { t } = useTranslation();
    return (
        <div className="dockview-welcome-tab">
            <h2>{t("dockview.welcomeTitle")}</h2>
            <p>{t("dockview.welcomeDesc")}</p>
        </div>
    );
}

export function DockviewLayout({
    initialTabs = [],
    initialActivePanelId,
}: DockviewLayoutProps): ReactNode {
    const { t } = useTranslation();

    /* ── 从全局注册中心获取数据 ── */
    const registeredActivities = useActivities();
    const registeredPanels = usePanels();
    const registeredTabComponents = useTabComponents();
    const registeredOverlays = useOverlays();

    /**
     * 将注册中心的数据转换为内部 PanelDefinition 格式。
     * 这是一个桥接层，使注册中心数据兼容已有的内部逻辑。
     */
    const panels = useMemo<PanelDefinition[]>(() => {
        const result: PanelDefinition[] = [];

        /* 从注册的面板和活动生成 PanelDefinition */
        for (const panelDesc of registeredPanels) {
            const activity = registeredActivities.find((a) => a.id === panelDesc.activityId);
            result.push({
                id: panelDesc.id,
                title: resolveTitle(panelDesc.title),
                icon: activity?.icon,
                position: panelDesc.defaultPosition,
                order: panelDesc.defaultOrder,
                activityId: panelDesc.activityId,
                activityTitle: activity ? resolveActivityTitle(activity.title) : undefined,
                activityIcon: activity?.icon,
                activitySection: activity?.defaultSection,
                tabOnly: false,
                render: panelDesc.render,
            });
        }

        /* 回调型活动图标需要生成 tabOnly 的虚拟 PanelDefinition 以保留活动栏图标 */
        for (const activity of registeredActivities) {
            if (activity.type !== "callback") {
                continue;
            }
            /* 确保不与已有面板的 activityId 冲突 */
            const hasPanel = registeredPanels.some((p) => p.activityId === activity.id);
            if (hasPanel) {
                continue;
            }
            result.push({
                id: `${activity.id}-activity`,
                title: resolveActivityTitle(activity.title),
                icon: activity.icon,
                position: activity.defaultBar === "right" ? "right" : "left",
                order: activity.defaultOrder,
                activityId: activity.id,
                activityTitle: resolveActivityTitle(activity.title),
                activityIcon: activity.icon,
                activitySection: activity.defaultSection,
                tabOnly: true,
                onActivityClick: activity.onActivate,
                render: () => null,
            });
        }

        return result;
    }, [registeredActivities, registeredPanels]);

    /** 将注册的 Tab 组件转换为旧格式 */
    const tabComponents = useMemo<TabComponentDefinition[]>(
        () => registeredTabComponents.map((desc) => ({
            key: desc.id,
            component: desc.component,
        })),
        [registeredTabComponents],
    );
    const [dockviewApi, setDockviewApi] = useState<DockviewApi | null>(null);
    const [activeTabId, setActiveTabId] = useState<string | null>(null);
    const [leftSidebarWidth, setLeftSidebarWidth] = useState(280);
    const [rightSidebarWidth, setRightSidebarWidth] = useState(260);
    const [isLeftSidebarVisible, setIsLeftSidebarVisible] = useState(true);
    const [isRightSidebarVisible, setIsRightSidebarVisible] = useState(true);
    const [panelStates, setPanelStates] = useState<PanelRuntimeState[]>(() =>
        buildInitialPanelStates(panels),
    );
    const [activePanelId, setActivePanelId] = useState<string | null>(initialActivePanelId ?? null);
    const [activeActivityId, setActiveActivityId] = useState<string | null>(null);
    /** 右侧栏当前激活的活动分组 ID */
    const [activeRightActivityId, setActiveRightActivityId] = useState<string | null>(null);
    const [isMoveFileDirectoryModalOpen, setIsMoveFileDirectoryModalOpen] = useState<boolean>(false);
    const [moveSourceSnapshot, setMoveSourceSnapshot] = useState<MoveSourceSnapshot | null>(null);
    const [createEntryDraftRequest, setCreateEntryDraftRequest] = useState<{
        kind: "file" | "folder";
        baseDirectory: string;
        title: string;
        placeholder: string;
        initialValue: string;
        resolve: (value: string | null) => void;
    } | null>(null);
    const {
        currentVaultPath,
        isLoadingTree,
        backendReady,
        error: vaultError,
        files,
    } = useVaultState();
    const { bindings } = useShortcutState();
    const activityBarConfigState = useActivityBarConfig();

    /** 活动图标拖拽状态：记录被拖拽项 ID、来源栏、目标位置 */
    const [dragState, setDragState] = useState<IconDragState | null>(null);

    /** 空侧栏拖入高亮状态：paneview 面板拖入空的左侧栏占位区域时为 true */
    const [isEmptySidebarDragOver, setIsEmptySidebarDragOver] = useState(false);
    /** 空侧栏拖入高亮状态：paneview 面板拖入空的右侧栏占位区域时为 true */
    const [isEmptyRightSidebarDragOver, setIsEmptyRightSidebarDragOver] = useState(false);
    /** 右侧图标栏拖入高亮状态：活动图标从 ActivityBar 拖入时为 true */
    const [isRightIconBarDragOver, setIsRightIconBarDragOver] = useState(false);

    const dockviewApiRef = useRef<DockviewApi | null>(null);
    const leftPaneApiRef = useRef<PaneviewApi | null>(null);
    const rightPaneApiRef = useRef<PaneviewApi | null>(null);
    const leftUnhandledDragDisposeRef = useRef<{ dispose: () => void } | null>(null);
    const rightUnhandledDragDisposeRef = useRef<{ dispose: () => void } | null>(null);
    const pendingExpandedStateRef = useRef<Map<string, boolean>>(new Map());
    const suppressWindowCloseUntilRef = useRef<number>(0);
    const mainDockHostRef = useRef<HTMLDivElement | null>(null);
    /** 缓存 paneview 面板的标题，用于检测语言切换后标题是否变化 */
    const paneTitleCacheRef = useRef<Map<string, string>>(new Map());

    useEffect(() => {
        dockviewApiRef.current = dockviewApi;
    }, [dockviewApi]);

    useEffect(() => {
        setRightSidebarVisibilitySnapshot(isRightSidebarVisible);
    }, [isRightSidebarVisible]);

    useEffect(() => {
        return subscribeRightSidebarToggleRequest(() => {
            setIsRightSidebarVisible((previousValue) => {
                const nextValue = !previousValue;
                console.info("[layout] toggle right sidebar from titlebar", {
                    previousValue,
                    nextValue,
                });
                return nextValue;
            });
        });
    }, []);

    /* 仓库就绪后加载活动栏定制配置 */
    useEffect(() => {
        if (currentVaultPath && backendReady && !isLoadingTree && !vaultError) {
            void ensureActivityBarConfigLoaded(currentVaultPath);
        }
    }, [backendReady, currentVaultPath, isLoadingTree, vaultError]);

    /**
     * 监听 i18n 语言切换事件，动态更新 dockview 主区域已打开面板的标题。
     *
     * dockview 的 addPanel({ title }) 只在创建时设置静态标题，
     * 语言切换后需要手动调用 panel.api.setTitle() 刷新。
     *
     * 处理的面板：
     * - "welcome"：首页标签
     * - "settings"：设置标签
     * - "knowledge-graph"：知识图谱标签
     * - 文件标签（id 以 "file:" 开头）：标题为文件名，无需翻译
     */
    useEffect(() => {
        const handleLanguageChanged = (): void => {
            const api = dockviewApiRef.current;
            if (!api) {
                return;
            }

            console.info("[DockviewLayout] language changed, updating dockview panel titles");

            for (const panel of api.panels) {
                if (panel.id === "welcome") {
                    panel.api.setTitle(i18n.t("app.homeTabTitle"));
                } else if (panel.id === SETTINGS_TAB_ID) {
                    panel.api.setTitle(i18n.t("dockview.settingsTooltip"));
                } else if (panel.id === "knowledge-graph") {
                    panel.api.setTitle(i18n.t("app.knowledgeGraph"));
                }
            }
        };

        i18n.on("languageChanged", handleLanguageChanged);
        return () => {
            i18n.off("languageChanged", handleLanguageChanged);
        };
    }, []);

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
        setPanelStates((prev) => mergePanelStates(prev, panels));
    }, [panels]);

    const orderedPanelsByPosition = (position: PanelPosition): PanelDefinition[] =>
        panelStates
            .filter((item) => item.position === position)
            .sort((a, b) => a.order - b.order)
            .map((item) => panelById.get(item.id))
            .filter((item): item is PanelDefinition => item !== undefined)
            /* tabOnly 的面板只提供活动栏图标，不在侧边栏中生成面板容器 */
            .filter((item) => !item.tabOnly);

    const leftPanels = useMemo(() => orderedPanelsByPosition("left"), [panelStates, panelById]);
    const rightPanels = useMemo(() => orderedPanelsByPosition("right"), [panelStates, panelById]);

    /**
     * 活动栏项列表：仅包含显式声明了 activityId 的面板。
     * 未声明 activityId 的面板不在活动栏显示图标。
     * 活动栏图标独立于面板当前所在的容器位置存在，面板被拖到其他侧后图标仍保留。
     */
    const activityItems = useMemo<ActivityItem[]>(() => {
        const dedup = new Set<string>();
        const items: ActivityItem[] = [];

        panels.filter((p) => p.activityId !== undefined).forEach((panel) => {
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
    }, [panels, activityMetaById]);

    /**
     * 将面板派生的活动项与存储的定制配置合并，
     * 同时加入内置的"设置"按钮，得到最终的活动栏有序列表。
     * 面板的初始 position 决定其 activity icon 的默认 bar 归属。
     */

    /** 活动 ID → 默认归属栏（由面板初始 position 决定） */
    const activityDefaultBar = useMemo(() => {
        const map = new Map<string, "left" | "right">();
        for (const panel of panels) {
            if (panel.activityId === undefined) continue;
            const aid = activityIdOf(panel);
            if (!map.has(aid)) {
                map.set(aid, panel.position === "right" ? "right" : "left");
            }
        }
        return map;
    }, [panels]);

    const mergedActivityItems = useMemo<ActivityIconItem[]>(() => {
        const allDefaults = [
            ...activityItems.map((item) => ({
                id: item.id,
                section: item.section,
                bar: activityDefaultBar.get(item.id),
            })),
            { id: SETTINGS_ACTIVITY_ID, section: "bottom" as const },
        ];
        const merged = mergeActivityBarConfig(allDefaults, activityBarConfigState.config);

        const itemInfoMap = new Map(activityItems.map((item) => [item.id, item]));
        return merged.map((m) => {
            const info = itemInfoMap.get(m.id);
            return {
                id: m.id,
                title:
                    m.id === SETTINGS_ACTIVITY_ID
                        ? t("dockview.settingsTooltip")
                        : (info?.title ?? m.id),
                icon:
                    m.id === SETTINGS_ACTIVITY_ID
                        ? <Settings size={18} strokeWidth={1.8} />
                        : (info?.icon ?? m.id[0]),
                section: m.section,
                visible: m.visible,
                isSettings: m.id === SETTINGS_ACTIVITY_ID,
                bar: m.bar,
            };
        });
    }, [activityItems, activityBarConfigState.config, t]);

    /* ────────── 左侧 ActivityBar 可见项 ────────── */

    /** 左侧 ActivityBar 中的所有项（bar === "left"） */
    const leftBarItems = useMemo(
        () => mergedActivityItems.filter((i) => i.bar === "left"),
        [mergedActivityItems],
    );

    /** 左侧 ActivityBar 中可见的非设置项 */
    const visibleNonSettingsItems = useMemo(
        () => leftBarItems.filter((i) => i.visible && !i.isSettings),
        [leftBarItems],
    );

    /**
     * 左侧栏中有面板容器的活动项（排除 tabOnly）。
     * 仅这些活动项适合作为 activeActivityId 的自动选中候选。
     */
    const leftPanelActivityItems = useMemo(
        () => visibleNonSettingsItems.filter((i) => {
            const panelDef = panels.find((p) => activityIdOf(p) === i.id);
            return !panelDef?.tabOnly;
        }),
        [visibleNonSettingsItems, panels],
    );

    /** 左侧 ActivityBar 中可见的顶部项 */
    const visibleTopActivityItems = useMemo(
        () => leftBarItems.filter((i) => i.visible && i.section === "top"),
        [leftBarItems],
    );

    /** 左侧 ActivityBar 中可见的底部项 */
    const visibleBottomActivityItems = useMemo(
        () => leftBarItems.filter((i) => i.visible && i.section === "bottom"),
        [leftBarItems],
    );

    /* ────────── 右侧 SidebarIconBar 可见项 ────────── */

    /** 右侧 SidebarIconBar 中可见的项（bar === "right"） */
    const rightBarItems = useMemo(
        () => mergedActivityItems.filter((i) => i.bar === "right" && i.visible),
        [mergedActivityItems],
    );

    /**
     * 右侧栏根据 activeRightActivityId 过滤可见面板，
     * 与左侧栏的 visibleLeftPanels 逻辑对称。
     * 如果没有选中的活动项，显示全部右侧面板。
     */
    const visibleRightPanels = useMemo(() => {
        if (!activeRightActivityId) {
            return rightPanels;
        }
        return rightPanels.filter((panel) => activityIdOf(panel) === activeRightActivityId);
    }, [activeRightActivityId, rightPanels]);

    /* ────────── 左侧活动项自动选中 ────────── */

    useEffect(() => {
        if (leftPanelActivityItems.length === 0) {
            setActiveActivityId(null);
            return;
        }

        if (!activeActivityId || !leftPanelActivityItems.some((item) => item.id === activeActivityId)) {
            setActiveActivityId(leftPanelActivityItems[0]?.id ?? null);
        }
    }, [activeActivityId, leftPanelActivityItems]);

    /* ────────── 右侧活动项自动选中 ────────── */

    useEffect(() => {
        if (rightBarItems.length === 0) {
            setActiveRightActivityId(null);
            return;
        }
        /* 排除 settings 和 tabOnly 的项，它们没有侧边栏面板 */
        const panelRightItems = rightBarItems.filter((i) => {
            if (i.isSettings) return false;
            const panelDef = panels.find((p) => activityIdOf(p) === i.id);
            return !panelDef?.tabOnly;
        });
        if (panelRightItems.length === 0) {
            setActiveRightActivityId(null);
            return;
        }
        if (!activeRightActivityId || !panelRightItems.some((i) => i.id === activeRightActivityId)) {
            setActiveRightActivityId(panelRightItems[0]?.id ?? null);
        }
    }, [activeRightActivityId, rightBarItems, panels]);

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

        /*
         * 仅当 activePanelId 在 visibleLeftPanels 中可见时才同步 activeActivityId。
         * 如果面板不在可见列表中，说明 Effect 1（上方）即将重置 activePanelId，
         * 此时不应反向更新 activeActivityId，否则两个 Effect 会互相追逐导致
         * "Maximum update depth exceeded" 无限循环。
         */
        if (!visibleLeftPanels.some((p) => p.id === activePanelId)) {
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
    }, [activePanelId, activeActivityId, leftPanels, visibleLeftPanels, activityIdByPanelId]);

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
            const existingPanel = api.getPanel(panel.id);
            const cachedTitle = paneTitleCacheRef.current.get(panel.id);

            // Paneview 没有 setTitle()，标题变化时需要移除后重新添加面板
            if (existingPanel && cachedTitle !== undefined && cachedTitle !== panel.title) {
                const wasExpanded = existingPanel.api.isExpanded;
                console.info("[DockviewLayout] paneview panel title changed, re-creating", panel.id, {
                    oldTitle: cachedTitle,
                    newTitle: panel.title,
                });

                try {
                    api.removePanel(existingPanel);
                } catch (error) {
                    if (!(error instanceof DOMException && error.name === "NotFoundError")) {
                        console.warn("[DockviewLayout] skip removing title-changed panel", panel.id, error);
                    }
                }

                api.addPanel({
                    id: panel.id,
                    component: panel.id,
                    title: panel.title,
                    isExpanded: wasExpanded,
                    index,
                });
                paneTitleCacheRef.current.set(panel.id, panel.title);
                return;
            }

            if (!existingPanel) {
                const pendingExpanded = pendingExpandedStateRef.current.get(panel.id);
                const knownExpanded = currentExpandedById.get(panel.id);
                const fallbackExpanded = expandedPanelId ? panel.id === expandedPanelId : true;

                api.addPanel({
                    id: panel.id,
                    component: panel.id,
                    title: panel.title,
                    isExpanded: pendingExpanded ?? knownExpanded ?? fallbackExpanded,
                    index,
                });

                paneTitleCacheRef.current.set(panel.id, panel.title);

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
            syncPanePanels(api, visibleRightPanels, null);
        }
    }, [visibleRightPanels]);

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

    /**
     * 空侧栏 dragover 处理：当 paneview 面板拖入空的左侧栏区域时，
     * 通过 getPaneData() 读取 dockview-core 内部的 LocalSelectionTransfer 数据，
     * 判断是否为有效的面板拖拽并接受该拖入操作。
     *
     * 此处理弥补了 PaneviewReact 在 0 个面板时无法触发 onDidDrop 的限制。
     *
     * @param e React 原生拖拽事件。
     */
    const handleEmptySidebarDragOver = (e: React.DragEvent<HTMLDivElement>): void => {
        const paneData = getPaneData();
        if (!paneData || !panelById.has(paneData.paneId)) {
            return;
        }
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setIsEmptySidebarDragOver(true);
    };

    /** 空侧栏 dragleave 处理：清除拖入高亮状态。 */
    const handleEmptySidebarDragLeave = (): void => {
        setIsEmptySidebarDragOver(false);
    };

    /**
     * 空侧栏 drop 处理：将面板从右侧栏移动到左侧栏（当前活动项下）。
     *
     * 通过 getPaneData() 获取被拖拽面板的 paneId，
     * 然后更新 panelStates 将该面板的 position 改为 "left"，
     * activityId 设为当前活动项 ID。
     *
     * @param e React 原生拖拽事件。
     * @sideEffects 修改 panelStates, activePanelId, isEmptySidebarDragOver。
     */
    const handleEmptySidebarDrop = (e: React.DragEvent<HTMLDivElement>): void => {
        e.preventDefault();
        setIsEmptySidebarDragOver(false);

        const paneData = getPaneData();
        if (!paneData || !panelById.has(paneData.paneId)) {
            console.warn("[DockviewLayout] empty sidebar drop: no valid pane data");
            return;
        }

        const movedPanelId = paneData.paneId;
        console.info("[DockviewLayout] empty sidebar drop", { movedPanelId, activeActivityId });

        /* icon 与 panel 解耦：面板拖入左侧空占位时不改变 icon 的 bar 归属，
         * 面板的 activityId 由 computeEmptySidebarDrop 设为当前左侧活动项。 */

        /* 保存被拖拽面板的展开状态，以便重建时恢复 */
        const sourceExpanded =
            leftPaneApiRef.current?.getPanel(movedPanelId)?.api.isExpanded ??
            rightPaneApiRef.current?.getPanel(movedPanelId)?.api.isExpanded;
        if (typeof sourceExpanded === "boolean") {
            pendingExpandedStateRef.current.set(movedPanelId, sourceExpanded);
        }

        queueMicrotask(() => {
            setPanelStates((prev) =>
                computeEmptySidebarDrop({ prev, movedPanelId, activeActivityId }),
            );

            setActivePanelId(movedPanelId);
        });
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

        /* icon 与 panel 解耦：面板拖拽不改变 activity icon 的 bar 归属，
         * 面板的 activityId 由 computeCrossContainerDrop 设为目标面板所属的 activity 分组。 */

        queueMicrotask(() => {
            setPanelStates((prev) =>
                computeCrossContainerDrop({
                    prev,
                    movedPanelId,
                    targetPosition,
                    dropTargetPanelId,
                    dropPosition: event.position as "top" | "bottom" | "left" | "right",
                    panelById,
                    activeActivityId,
                    activeRightActivityId,
                }),
            );

            if (targetPosition === "right") {
                setIsRightSidebarVisible(true);
            }

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
        api.getPanel(tab.id)?.api.setActive();
        setActiveTabId(tab.id);
    };

    const closeTab = (tabId: string): void => {
        dockviewApiRef.current?.getPanel(tabId)?.api.close();
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

    const settleCreateEntryDraftRequest = (value: string | null): void => {
        setCreateEntryDraftRequest((currentRequest) => {
            if (!currentRequest) {
                return null;
            }

            window.setTimeout(() => {
                currentRequest.resolve(value);
            }, 0);
            return null;
        });
    };

    const requestCreateEntryDraft: NonNullable<CommandContext["requestCreateEntryDraft"]> = (request) =>
        new Promise((resolve) => {
            setCreateEntryDraftRequest((currentRequest) => {
                if (currentRequest) {
                    window.setTimeout(() => {
                        currentRequest.resolve(null);
                    }, 0);
                }

                console.info("[layout] open create-entry modal", {
                    kind: request.kind,
                    baseDirectory: request.baseDirectory,
                });

                return {
                    ...request,
                    resolve,
                };
            });
        });

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
            await openFileWithResolver({
                relativePath: targetPath,
                currentVaultPath,
                contentOverride: source.hasInMemoryContent
                    ? source.content
                    : await readVaultMarkdownFile(targetPath).then((result) => result.content),
                openTab,
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

    const activatePanelById = (panelId: string): void => {
        const targetPanel = panelById.get(panelId);
        const targetState = panelStates.find((state) => state.id === panelId);

        if (!targetPanel || !targetState) {
            console.warn("[layout] activate panel skipped: panel not found", { panelId });
            return;
        }

        const activityId = activityIdOf(targetPanel);
        setActivePanelId(panelId);

        if (targetState.position === "right") {
            setActiveRightActivityId(activityId);
            setIsRightSidebarVisible(true);
            console.info("[layout] activated right panel", { panelId, activityId });
            return;
        }

        setActiveActivityId(activityId);
        setIsLeftSidebarVisible(true);
        console.info("[layout] activated left panel", { panelId, activityId });
    };

    const buildCommandContext = (): CommandContext => ({
        activeTabId,
        closeTab,
        openTab,
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
        openFileTab: (relativePath, content, tabParams) => {
            void openFileWithResolver({
                relativePath,
                currentVaultPath,
                contentOverride: content,
                tabParams,
                openTab,
            });
        },
        activatePanel: (panelId) => {
            activatePanelById(panelId);
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
        requestCreateEntryDraft,
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
        if (!currentVaultPath || !backendReady || isLoadingTree || vaultError) {
            return;
        }

        void ensureShortcutBindingsLoaded(currentVaultPath);
    }, [backendReady, currentVaultPath, isLoadingTree, vaultError]);

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
        const handleKeydown = (event: KeyboardEvent): void => {
            const target = event.target as HTMLElement | null;
            const isCodeMirrorTarget = Boolean(target?.closest(".cm-editor"));
            const isTypingTarget =
                target instanceof HTMLInputElement ||
                target instanceof HTMLTextAreaElement ||
                target?.isContentEditable === true;

            // 文本输入框中不拦截快捷键，保留原生行为
            // （CodeMirror 内容区不属于此类，由后续逻辑处理）
            if (isTypingTarget && !isCodeMirrorTarget) {
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

            // 编辑器作用域命令不在全局 handler 中执行（已由编辑器内部 handler 处理）
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
        openFile: async ({ relativePath, contentOverride, preferredOpenerId }) => {
            await openFileWithResolver({
                relativePath,
                currentVaultPath,
                contentOverride,
                preferredOpenerId,
                openTab,
            });
        },
        closeTab,
        setActiveTab,
        requestMoveFileToDirectory: (relativePath: string) => {
            openMoveFileDirectoryModalByPath(relativePath);
        },
    };

    const overlayRenderContext = {
        ...panelRenderContext,
        executeCommand: (commandId: CommandId) => {
            executeCommand(commandId, buildCommandContext());
        },
        getCommandDefinitions: () => getCommandDefinitions(),
    };

    const moveFileOverlayStateRef = useRef({
        isOpen: false,
        sourceFilePath: "",
        directories: [] as string[],
        onClose: () => { },
        onConfirmDirectory: (_directoryRelativePath: string) => { },
    });
    const createEntryOverlayStateRef = useRef({
        isOpen: false,
        kind: "file" as "file" | "folder",
        baseDirectory: "",
        title: "",
        placeholder: "",
        initialValue: "",
        onClose: () => { },
        onConfirm: (_draftName: string) => { },
    });

    moveFileOverlayStateRef.current = {
        isOpen: isMoveFileDirectoryModalOpen,
        sourceFilePath: moveSourceSnapshot?.path ?? "",
        directories: moveDirectoryOptions,
        onClose: () => {
            console.info("[move-file] closed directory picker");
            closeMoveFocusedFileDirectoryModal();
        },
        onConfirmDirectory: (directoryRelativePath: string) => {
            void handleMoveFileToDirectoryConfirmed(directoryRelativePath);
        },
    };
    createEntryOverlayStateRef.current = {
        isOpen: createEntryDraftRequest !== null,
        kind: createEntryDraftRequest?.kind ?? "file",
        baseDirectory: createEntryDraftRequest?.baseDirectory ?? "",
        title: createEntryDraftRequest?.title ?? "",
        placeholder: createEntryDraftRequest?.placeholder ?? "",
        initialValue: createEntryDraftRequest?.initialValue ?? "",
        onClose: () => {
            console.info("[layout] close create-entry modal");
            settleCreateEntryDraftRequest(null);
        },
        onConfirm: (draftName: string) => {
            console.info("[layout] confirm create-entry modal", {
                kind: createEntryDraftRequest?.kind,
                baseDirectory: createEntryDraftRequest?.baseDirectory,
                draftName,
            });
            settleCreateEntryDraftRequest(draftName);
        },
    };

    useEffect(() => {
        const unregisterMoveFileOverlay = registerOverlay({
            id: "host-move-file-directory",
            order: 30,
            render: () => {
                const overlayState = moveFileOverlayStateRef.current;
                return (
                    <MoveFileDirectoryModal
                        isOpen={overlayState.isOpen}
                        sourceFilePath={overlayState.sourceFilePath}
                        directories={overlayState.directories}
                        onClose={overlayState.onClose}
                        onConfirmDirectory={overlayState.onConfirmDirectory}
                    />
                );
            },
        });
        const unregisterCreateEntryOverlay = registerOverlay({
            id: "host-create-entry",
            order: 40,
            render: () => {
                const overlayState = createEntryOverlayStateRef.current;
                return (
                    <CreateEntryModal
                        isOpen={overlayState.isOpen}
                        kind={overlayState.kind}
                        baseDirectory={overlayState.baseDirectory}
                        title={overlayState.title}
                        placeholder={overlayState.placeholder}
                        initialValue={overlayState.initialValue}
                        onClose={overlayState.onClose}
                        onConfirm={overlayState.onConfirm}
                    />
                );
            },
        });

        return () => {
            unregisterCreateEntryOverlay();
            unregisterMoveFileOverlay();
        };
    }, []);

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

    /**
     * 活动栏项点击处理：活动栏始终控制左侧栏。
     *
     * 设计思路：活动栏是左侧栏的入口，点击行为始终围绕左侧栏展开：
     * - 点击当前激活的 activity → 折叠/展开左侧栏（toggle）
     * - 点击不同的 activity → 切换到该 activity 并展开左侧栏
     * - 若面板有 onActivityClick（如知识图谱打开 Tab），优先执行自定义行为。
     * - 即使该 activity 下的面板已被拖到右侧，点击仍展开左侧栏（空容器可接受拖入）。
     *
     * @param activityId 被点击的活动项 ID。
     */
    const handleActivityItemClick = (activityId: string): void => {
        const panel = panels.find((candidate) => activityIdOf(candidate) === activityId);

        if (panel?.onActivityClick) {
            panel.onActivityClick(panelRenderContext);
            return;
        }

        if (activityId === activeActivityId) {
            /* 再次点击当前活动项 → toggle 左侧栏可见性 */
            setIsLeftSidebarVisible((prev) => !prev);
            return;
        }

        setActiveActivityId(activityId);
        setIsLeftSidebarVisible(true);
        if (panel) {
            setActivePanelId(panel.id);
        }
    };

    /**
     * 合并后的活动栏项点击处理：区分设置按钮与面板活动项。
     * @param item 被点击的合并活动项。
     */
    const handleMergedActivityItemClick = (item: ActivityIconItem): void => {
        if (item.isSettings) {
            openSettingsTab(dockviewApiRef.current);
            return;
        }
        handleActivityItemClick(item.id);
    };

    /* ────────────────── 活动栏拖拽排序 ────────────────── */

    /**
     * 活动栏项拖拽开始：记录被拖拽项 ID。
     * @param itemId 被拖拽的活动项 ID。
     */
    const handleActivityDragStart = (itemId: string) => (e: React.DragEvent<HTMLButtonElement>): void => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", itemId);
        e.dataTransfer.setData(ACTIVITY_ICON_DRAG_TYPE, itemId);
        setDragState({ draggedId: itemId, sourceBar: "left", targetSection: "top", targetIndex: -1 });
        console.debug("[activity-bar] drag start", { itemId });
    };

    /** 活动栏项拖拽结束：清理拖拽状态。 */
    const handleActivityDragEnd = (): void => {
        setDragState(null);
    };

    /**
     * 活动栏单项 dragover：根据光标 Y 轴位于项上半/下半区来计算插入索引。
     * @param section 当前区域。
     * @param visibleIndex 该项在可见列表中的索引。
     */
    const handleActivityItemDragOver = (
        section: "top" | "bottom",
        visibleIndex: number,
    ) => (e: React.DragEvent<HTMLButtonElement>): void => {
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "move";

        const rect = e.currentTarget.getBoundingClientRect();
        /* 补偿 CSS transform 偏移：被 translateY 偏移的图标通过 data-visual-shift
           属性标记其偏移量，将 rect 还原到未偏移的"真实碰撞体"位置进行计算，
           避免视觉偏移导致 midY 抖动。 */
        const visualShift = Number(e.currentTarget.dataset.visualShift ?? 0);
        const midY = rect.top - visualShift + rect.height / 2;
        const insertIndex = e.clientY < midY ? visibleIndex : visibleIndex + 1;

        setDragState((prev) => {
            if (!prev) {
                return null;
            }
            if (prev.targetSection === section && prev.targetIndex === insertIndex) {
                return prev;
            }
            return { ...prev, targetSection: section, targetIndex: insertIndex };
        });
    };

    /**
     * 活动栏区域容器 dragover：当光标位于区域空白处时将插入点设置为末尾。
     * @param section 目标区域。
     * @param visibleCount 该区域的可见项数量。
     */
    const handleActivitySectionDragOver = (
        section: "top" | "bottom",
        visibleCount: number,
    ) => (e: React.DragEvent<HTMLDivElement>): void => {
        if (e.target !== e.currentTarget) {
            return;
        }
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setDragState((prev) => {
            if (!prev) {
                return null;
            }
            return { ...prev, targetSection: section, targetIndex: visibleCount };
        });
    };

    /**
     * 活动栏拖拽放置：根据 dragState 中的目标位置重新排序。
     * 重排逻辑：按区域和可见性分组，将被拖拽项插入目标位置，隐藏项保持在末尾。
     */
    const handleActivityBarDrop = (e: React.DragEvent<HTMLElement>): void => {
        e.preventDefault();
        if (!dragState || dragState.targetIndex < 0) {
            setDragState(null);
            return;
        }

        const { draggedId, targetSection, targetIndex } = dragState;
        const dragged = mergedActivityItems.find((i) => i.id === draggedId);
        if (!dragged) {
            setDragState(null);
            return;
        }

        const others = mergedActivityItems.filter((i) => i.id !== draggedId);
        const topVisible = others.filter((i) => i.section === "top" && i.visible);
        const topHidden = others.filter((i) => i.section === "top" && !i.visible);
        const bottomVisible = others.filter((i) => i.section === "bottom" && i.visible);
        const bottomHidden = others.filter((i) => i.section === "bottom" && !i.visible);

        const updatedDragged: ActivityIconItem = { ...dragged, section: targetSection };
        const targetList = targetSection === "top" ? topVisible : bottomVisible;
        const clamped = Math.min(Math.max(0, targetIndex), targetList.length);
        targetList.splice(clamped, 0, updatedDragged);

        const reordered = [
            ...topVisible, ...topHidden,
            ...bottomVisible, ...bottomHidden,
        ];

        updateActivityBarConfig({
            items: reordered.map((i) => ({ id: i.id, section: i.section, visible: i.visible, bar: i.bar })),
        });
        setDragState(null);
        console.info("[activity-bar] reorder completed", {
            draggedId,
            targetSection,
            targetIndex: clamped,
        });
    };

    /* ────────────────── 活动栏右键菜单 ────────────────── */

    /**
     * 右键点击活动栏图标：提供"向上对齐"、"向下对齐"、"隐藏"选项。
     * @param item 被右键的活动项。
     */
    const handleActivityItemContextMenu = (
        item: ActivityIconItem,
    ) => async (e: ReactMouseEvent<HTMLButtonElement>): Promise<void> => {
        e.preventDefault();
        e.stopPropagation();

        const menuItems = [];
        if (item.section !== "top") {
            menuItems.push({ id: "align-top", text: t("dockview.activityAlignTop") });
        }
        if (item.section !== "bottom") {
            menuItems.push({ id: "align-bottom", text: t("dockview.activityAlignBottom") });
        }
        menuItems.push({ id: "hide", text: t("dockview.activityHide") });

        const selectedId = await showNativeContextMenu(menuItems);
        if (!selectedId) {
            return;
        }

        if (selectedId === "align-top" || selectedId === "align-bottom") {
            const newSection = selectedId === "align-top" ? "top" : "bottom";
            const withoutItem = mergedActivityItems.filter((i) => i.id !== item.id);
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
            console.info("[activity-bar] item moved to section", { itemId: item.id, newSection });
        } else if (selectedId === "hide") {
            const updated = mergedActivityItems.map((i) =>
                i.id === item.id ? { ...i, visible: false } : i,
            );
            updateActivityBarConfig({
                items: updated.map((i) => ({ id: i.id, section: i.section, visible: i.visible, bar: i.bar })),
            });
            console.info("[activity-bar] item hidden", { itemId: item.id });
        }
    };

    /**
     * 右键点击活动栏空白处：列出所有活动项并提供可见性切换。
     * 使用 CheckMenuItem 展示当前可见状态。
     */
    const handleActivityBarBackgroundContextMenu = async (
        e: ReactMouseEvent<HTMLElement>,
    ): Promise<void> => {
        const target = e.target as HTMLElement;
        if (target.closest(".activity-bar-item")) {
            return;
        }
        e.preventDefault();

        const menuItems = mergedActivityItems.map((item) => ({
            id: item.id,
            text: item.title,
            checked: item.visible,
        }));

        const selectedId = await showNativeContextMenu(menuItems);
        if (!selectedId) {
            return;
        }

        const updated = mergedActivityItems.map((i) =>
            i.id === selectedId ? { ...i, visible: !i.visible } : i,
        );
        updateActivityBarConfig({
            items: updated.map((i) => ({ id: i.id, section: i.section, visible: i.visible, bar: i.bar })),
        });
        console.info("[activity-bar] visibility toggled", {
            itemId: selectedId,
            nowVisible: !mergedActivityItems.find((i) => i.id === selectedId)?.visible,
        });
    };

    /* ────────────────── 右侧图标栏处理 ────────────────── */

    /**
     * 右侧图标栏项点击：切换 activeRightActivityId。
     * - 如果该 item 是 settings → 打开设置 Tab
     * - 如果点击的是已激活项 → toggle 右侧栏显隐
     * - 否则 → 切换到该 activity 并展开右侧栏
     * @param item 被点击的图标项。
     */
    const handleRightIconBarItemClick = (item: ActivityIconItem): void => {
        if (item.isSettings) {
            openSettingsTab(dockviewApiRef.current);
            return;
        }

        const panel = panels.find((p) => activityIdOf(p) === item.id);
        if (panel?.onActivityClick) {
            panel.onActivityClick(panelRenderContext);
            return;
        }

        if (item.id === activeRightActivityId) {
            setIsRightSidebarVisible((prev) => !prev);
            return;
        }

        setActiveRightActivityId(item.id);
        setIsRightSidebarVisible(true);
        console.debug("[right-icon-bar] switched active right activity", { id: item.id });
    };

    /**
     * 右侧图标栏项拖拽开始：允许从右侧拖回左侧。
     * @param itemId 被拖拽项 ID。
     */
    const handleRightIconBarItemDragStart = (itemId: string) => (e: React.DragEvent<HTMLButtonElement>): void => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", itemId);
        e.dataTransfer.setData(ACTIVITY_ICON_DRAG_TYPE, itemId);
        setDragState({ draggedId: itemId, sourceBar: "right", targetSection: "top", targetIndex: -1 });
        console.debug("[right-icon-bar] drag start", { itemId });
    };

    /** 右侧图标栏项拖拽结束。 */
    const handleRightIconBarItemDragEnd = (): void => {
        setDragState(null);
        setIsRightIconBarDragOver(false);
    };

    /**
     * 右侧图标栏 dragover：接受来自 ActivityBar 的图标拖拽。
     * 通过检测 dataTransfer 中是否包含 ACTIVITY_ICON_DRAG_TYPE 来判断。
     * @param e React 拖拽事件。
     */
    const handleRightIconBarDragOver = (e: React.DragEvent<HTMLDivElement>): void => {
        if (!e.dataTransfer.types.includes(ACTIVITY_ICON_DRAG_TYPE)) {
            return;
        }
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setIsRightIconBarDragOver(true);
    };

    /** 右侧图标栏 dragleave：清除高亮。 */
    const handleRightIconBarDragLeave = (): void => {
        setIsRightIconBarDragOver(false);
    };

    /**
     * 右侧图标栏 drop：将图标从左栏移到右栏。
     * 更新 mergedActivityItems 中该项的 bar 为 "right"，
     * 并将其关联面板的 position 改为 "right"。
     *
     * @param e React 拖拽事件。
     * @sideEffects 修改 activityBarConfig, panelStates, activeRightActivityId, dragState, isRightIconBarDragOver。
     */
    const handleRightIconBarDrop = (e: React.DragEvent<HTMLDivElement>): void => {
        e.preventDefault();
        setIsRightIconBarDragOver(false);

        const itemId = e.dataTransfer.getData("text/plain");
        if (!itemId) {
            setDragState(null);
            return;
        }

        const item = mergedActivityItems.find((i) => i.id === itemId);
        if (!item) {
            console.warn("[right-icon-bar] drop: item not found", { itemId });
            setDragState(null);
            return;
        }

        /* 更新活动栏配置：将 item 的 bar 改为 right */
        const updated = mergedActivityItems.map((i) =>
            i.id === itemId ? { ...i, bar: "right" as const } : i,
        );
        updateActivityBarConfig({
            items: updated.map((i) => ({ id: i.id, section: i.section, visible: i.visible, bar: i.bar })),
        });

        /* 如果 item 是 panel container（有关联面板），将面板移到右侧 */
        if (!item.isSettings) {
            const panelDef = panels.find((p) => activityIdOf(p) === itemId);
            const isTabOnly = panelDef?.tabOnly ?? false;

            setPanelStates((prev) =>
                prev.map((ps) => {
                    const pd = panelById.get(ps.id);
                    if (pd && activityIdOf(pd) === itemId) {
                        return { ...ps, position: "right" as PanelPosition };
                    }
                    return ps;
                }),
            );

            /* tabOnly 的活动不产生侧边栏面板，故不设为 activeRightActivityId */
            if (!isTabOnly) {
                setActiveRightActivityId(itemId);
            }
            setIsRightSidebarVisible(true);
        }

        setDragState(null);
        console.info("[right-icon-bar] icon moved to right bar", { itemId });
    };

    /**
     * 左侧 ActivityBar drop 处理（扩展）：除了区域内重排，
     * 还需处理从右侧图标栏拖回左侧的跨栏操作。
     */
    const handleActivityBarDropWithCrossBar = (e: React.DragEvent<HTMLElement>): void => {
        /* 检查是否是跨栏拖拽（从右栏拖回来的） */
        if (dragState?.sourceBar === "right") {
            e.preventDefault();
            const itemId = dragState.draggedId;
            const item = mergedActivityItems.find((i) => i.id === itemId);
            if (!item) {
                setDragState(null);
                return;
            }

            /* 更新活动栏配置：将 item 的 bar 改回 left */
            const updated = mergedActivityItems.map((i) =>
                i.id === itemId ? { ...i, bar: "left" as const } : i,
            );
            updateActivityBarConfig({
                items: updated.map((i) => ({ id: i.id, section: i.section, visible: i.visible, bar: i.bar })),
            });

            /* 将关联面板移回左侧 */
            if (!item.isSettings) {
                const panelDef = panels.find((p) => activityIdOf(p) === itemId);
                const isTabOnly = panelDef?.tabOnly ?? false;

                setPanelStates((prev) =>
                    prev.map((ps) => {
                        const pd = panelById.get(ps.id);
                        if (pd && activityIdOf(pd) === itemId) {
                            return { ...ps, position: "left" as PanelPosition };
                        }
                        return ps;
                    }),
                );

                /* tabOnly 的活动不产生侧边栏面板，故不设为 activeActivityId */
                if (!isTabOnly) {
                    setActiveActivityId(itemId);
                }
                setIsLeftSidebarVisible(true);
            }

            setDragState(null);
            console.info("[activity-bar] icon moved back from right bar", { itemId });
            return;
        }

        /* 同栏内的重排逻辑 */
        handleActivityBarDrop(e);
    };

    /* ────────────────── 空右侧栏拖入 ────────────────── */

    /**
     * 空右侧栏 dragover 处理：接受 paneview 面板拖入。
     * @param e React 拖拽事件。
     */
    const handleEmptyRightSidebarDragOver = (e: React.DragEvent<HTMLDivElement>): void => {
        const paneData = getPaneData();
        if (!paneData || !panelById.has(paneData.paneId)) {
            return;
        }
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setIsEmptyRightSidebarDragOver(true);
    };

    /** 空右侧栏 dragleave 处理。 */
    const handleEmptyRightSidebarDragLeave = (): void => {
        setIsEmptyRightSidebarDragOver(false);
    };

    /**
     * 空右侧栏 drop 处理：将面板从左侧栏移动到右侧栏。
     * @param e React 拖拽事件。
     * @sideEffects 修改 panelStates, isEmptyRightSidebarDragOver。
     */
    const handleEmptyRightSidebarDrop = (e: React.DragEvent<HTMLDivElement>): void => {
        e.preventDefault();
        setIsEmptyRightSidebarDragOver(false);

        const paneData = getPaneData();
        if (!paneData || !panelById.has(paneData.paneId)) {
            console.warn("[DockviewLayout] empty right sidebar drop: no valid pane data");
            return;
        }

        const movedPanelId = paneData.paneId;
        console.info("[DockviewLayout] empty right sidebar drop", { movedPanelId });

        /* icon 与 panel 解耦：面板拖入右侧空占位时不改变 icon 的 bar 归属，
         * 面板的 activityId 由 computeEmptyRightSidebarDrop 设为当前右侧活动项。 */
        setIsRightSidebarVisible(true);

        const sourceExpanded =
            leftPaneApiRef.current?.getPanel(movedPanelId)?.api.isExpanded ??
            rightPaneApiRef.current?.getPanel(movedPanelId)?.api.isExpanded;
        if (typeof sourceExpanded === "boolean") {
            pendingExpandedStateRef.current.set(movedPanelId, sourceExpanded);
        }

        queueMicrotask(() => {
            setPanelStates((prev) =>
                computeEmptyRightSidebarDrop({ prev, movedPanelId, panelById, activeRightActivityId }),
            );
        });
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

        syncPanePanels(api, visibleRightPanels, null);
    };

    useEffect(
        () => () => {
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

            const activeDockPanel = panel ? api.getPanel(panel.id) : null;
            const params = activeDockPanel?.params as Record<string, unknown> | undefined;
            syncActiveEditorFromPanel(panel?.id ?? null, params);

            if (!panel) {
                return;
            }

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
            clearActiveEditor();
            api.addPanel({ id: "welcome", title: t("app.homeTabTitle"), component: "welcome" });
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
        syncActiveEditorFromPanel(initialTabs[0]?.id ?? null, initialTabs[0]?.params);
    };

    const activeLeftPanel = visibleLeftPanels.find((panel) => panel.id === activePanelId) ?? visibleLeftPanels[0];
    const activeLeftSidebarActivityId = activeLeftPanel?.activityId ?? activeActivityId ?? null;
    const leftSidebarHeaderActions = useSidebarHeaderActions(activeLeftSidebarActivityId);
    const leftSidebarHeaderActionContext = activeLeftSidebarActivityId
        ? {
            ...panelRenderContext,
            activityId: activeLeftSidebarActivityId,
            panelId: activeLeftPanel?.id ?? null,
            side: "left" as const,
            executeCommand: (commandId: CommandId) => {
                executeCommand(commandId, buildCommandContext());
            },
        }
        : null;
    /* 左侧栏在活动栏有选中项且用户未折叠时渲染（即使面板列表为空也保留容器） */
    const shouldRenderLeftSidebar = isLeftSidebarVisible && activeActivityId !== null;
    /* 右侧栏只要未被用户 toggle 关闭就始终渲染（空内容时显示占位） */
    const shouldRenderRightSidebar = isRightSidebarVisible;
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
            {/* 活动栏：支持拖拽排序、右键菜单定制、跨栏拖拽 */}
            <ActivityBar
                topItems={visibleTopActivityItems}
                bottomItems={visibleBottomActivityItems}
                activeItemId={activeActivityId}
                dragState={dragState}
                onItemClick={handleMergedActivityItemClick}
                onItemDragStart={handleActivityDragStart}
                onItemDragEnd={handleActivityDragEnd}
                onItemDragOver={handleActivityItemDragOver}
                onSectionDragOver={handleActivitySectionDragOver}
                onDrop={handleActivityBarDropWithCrossBar}
                onItemContextMenu={handleActivityItemContextMenu}
                onBackgroundContextMenu={handleActivityBarBackgroundContextMenu}
                ariaLabel={t("dockview.activityBar")}
            />

            {shouldRenderLeftSidebar && (
                <Sidebar
                    side="left"
                    width={leftSidebarWidth}
                    onBeginResize={(e) => beginResize("left", e)}
                    ariaLabel={t("dockview.leftPanelArea")}
                    header={
                        <SidebarHeader
                            title={
                                activeLeftPanel?.title
                                ?? mergedActivityItems.find((i) => i.id === activeActivityId)?.title
                                ?? "Panels"
                            }
                            actions={leftSidebarHeaderActions}
                            actionContext={leftSidebarHeaderActionContext ?? {
                                ...panelRenderContext,
                                activityId: "",
                                panelId: null,
                                side: "left",
                                executeCommand: () => { },
                            }}
                            testId="left-sidebar-header"
                        />
                    }
                >
                    {visibleLeftPanels.length > 0 ? (
                        <PaneviewReact
                            className="dockview-theme-abyss sidebar-paneview-container"
                            components={leftPaneComponents}
                            onReady={handleLeftPaneReady}
                            onDidDrop={(event) => {
                                handleCrossContainerDrop("left", event);
                            }}
                        />
                    ) : (
                        /* 该 activity 下暂无左侧面板时显示空状态占位，支持拖入面板 */
                        <div
                            className={`sidebar-empty-placeholder${isEmptySidebarDragOver ? " drag-over" : ""}`}
                            data-testid="left-sidebar-empty"
                            onDragOver={handleEmptySidebarDragOver}
                            onDragLeave={handleEmptySidebarDragLeave}
                            onDrop={handleEmptySidebarDrop}
                        >
                            {t("dockview.sidebarEmpty")}
                        </div>
                    )}
                </Sidebar>
            )}

            <main className="main-content-area" aria-label={t("dockview.mainArea")}>
                <div ref={mainDockHostRef} className="main-dockview-host">
                    <DockviewReact
                        className="dockview-theme-abyss main-dockview"
                        components={dockviewComponents}
                        onReady={handleReady}
                    />
                </div>
            </main>

            {shouldRenderRightSidebar && (
                <Sidebar
                    side="right"
                    width={rightSidebarWidth}
                    onBeginResize={(e) => beginResize("right", e)}
                    ariaLabel={t("dockview.rightPanelArea")}
                    header={
                        <SidebarIconBar
                            items={rightBarItems}
                            activeItemId={activeRightActivityId}
                            dragState={dragState}
                            onItemClick={handleRightIconBarItemClick}
                            onDragOver={handleRightIconBarDragOver}
                            onDrop={handleRightIconBarDrop}
                            onDragLeave={handleRightIconBarDragLeave}
                            isDragOver={isRightIconBarDragOver}
                            onItemDragStart={handleRightIconBarItemDragStart}
                            onItemDragEnd={handleRightIconBarItemDragEnd}
                        />
                    }
                >
                    {visibleRightPanels.length > 0 ? (
                        <PaneviewReact
                            className="dockview-theme-abyss sidebar-paneview-container"
                            components={rightPaneComponents}
                            onReady={handleRightPaneReady}
                            onDidDrop={(event) => {
                                handleCrossContainerDrop("right", event);
                            }}
                        />
                    ) : (
                        /* 右侧栏暂无面板时显示空状态占位，支持拖入面板 */
                        <div
                            className={`sidebar-empty-placeholder${isEmptyRightSidebarDragOver ? " drag-over" : ""}`}
                            data-testid="right-sidebar-empty"
                            onDragOver={handleEmptyRightSidebarDragOver}
                            onDragLeave={handleEmptyRightSidebarDragLeave}
                            onDrop={handleEmptyRightSidebarDrop}
                        >
                            {t("dockview.sidebarEmpty")}
                        </div>
                    )}
                </Sidebar>
            )}

            {registeredOverlays.map((overlay) => (
                <div key={overlay.id} data-overlay-id={overlay.id}>
                    {overlay.render(overlayRenderContext)}
                </div>
            ))}
        </div>
    );
}
