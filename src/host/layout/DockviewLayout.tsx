/**
 * @module host/layout/DockviewLayout
 * @description 使用 dockview 官方 React 适配实现主布局，并提供接近 SolidJS 版本的交互体验。
 * @dependencies
 *   - react
 *   - dockview
 */

import {
    memo,
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
    type IDockviewPanel,
    type IDockviewPanelProps,
    type IPaneviewPanelProps,
    type PaneviewApi,
    type PaneviewReadyEvent,
} from "dockview";
import type { DockviewDidDropEvent, PaneviewDndOverlayEvent, PaneviewDropEvent } from "dockview-core";
import { getPaneData, getPanelData, type Direction } from "dockview-core";
import "dockview/dist/styles/dockview.css";
import "./DockviewLayout.css";
import { Settings } from "lucide-react";
import i18n from "../../i18n";
import {
    getArticleSnapshotById,
    getFocusedArticleSnapshot,
    reportArticleFocus,
    resetEditorContext,
} from "../store/editorContextStore";
import {
    clearActiveEditor,
    getActiveEditorSnapshot,
    reportActiveEditor,
} from "../store/activeEditorStore";
import {
    moveVaultDirectoryToDirectory,
    moveVaultMarkdownFileToDirectory,
    readVaultMarkdownFile,
    saveVaultMarkdownFile,
} from "../../api/vaultApi";
import {
    emitEditorCommandRequestedEvent,
    subscribeVaultFsBusEvent,
} from "../events/appEventBus";
import { useVaultState } from "../store/vaultStore";
import {
    executeCommand,
    getCommandDefinitions,
    type CommandContext,
    type CommandId,
} from "../commands/commandSystem";
import {
    detectFocusedComponentFromEvent,
    initFocusTracking,
    PANEL_ID_DATA_ATTR,
    TAB_COMPONENT_DATA_ATTR,
} from "../commands/focusContext";
import {
    TAB_CLOSE_SHORTCUT_TRIGGERED_EVENT,
    notifyTabCloseShortcutTriggered,
} from "../commands/shortcutEvents";
import {
    ensureShortcutBindingsLoaded,
    useShortcutState,
} from "../store/shortcutStore";
import {
    requestApplicationQuit,
} from "../commands/systemShortcutSubsystem";
import { dispatchShortcut } from "../commands/shortcutDispatcher";
import { createConditionContext } from "../conditions/conditionEvaluator";
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
import { useConfigState } from "../store/configStore";
import { showNativeContextMenu } from "./nativeContextMenu";
import type { NativeContextMenuItem } from "./nativeContextMenu";
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
    useConvertibleViews,
    resolveTitle,
    resolveActivityTitle,
    buildConvertibleViewTabParams,
    readConvertibleViewTabState,
} from "../registry";
import { getTabComponentById } from "../registry/tabComponentRegistry";
import {
    buildInitialPanelStates,
    computeCrossContainerDrop,
    computeEmptySidebarDrop,
    computeEmptyRightSidebarDrop,
    removeActivityReferencesFromPanelStates,
    repairUnknownActivityReferencesInPanelStates,
} from "./layoutStateReducers";
import { removeCustomActivityFromVaultConfig } from "../../plugins/custom-activity/customActivityConfig";
import {
    getSidebarLayoutFromVaultConfig,
    mergePanelStatesWithSidebarLayoutFallback,
    restorePanelStatesFromSidebarLayout,
    saveSidebarLayoutSnapshot,
    type SidebarLayoutSnapshot,
} from "./sidebarLayoutPersistence";
import { openFileWithResolver } from "./openFileService";
import {
    setRightSidebarVisibilitySnapshot,
    subscribeRightSidebarToggleRequest,
} from "./rightSidebarVisibilityBridge";
import {
    decorateTabParamsWithLifecycle,
    shouldCloseTabOnVaultChange,
} from "./vaultTabScope";

const CUSTOM_ACTIVITY_CREATE_COMMAND_ID = "customActivity.create";
const CUSTOM_ACTIVITY_REGISTRATION_PREFIX = "custom-activity:";
const SIDEBAR_MIN_WIDTH = 220;
const SIDEBAR_MAX_WIDTH = 520;
const SIDEBAR_LAYOUT_SAVE_DEBOUNCE_MS = 300;
const SIDEBAR_PANE_MIN_BODY_SIZE = 72;
const SIDEBAR_PANE_MIN_TOTAL_SIZE = 104;

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
    hostPanelId: string | null;
    convertibleView: ConvertiblePanelRenderState | null;
    openTab: (tab: TabInstanceDefinition) => void;
    openFile: (options: {
        relativePath: string;
        contentOverride?: string;
        preferredOpenerId?: string;
    }) => Promise<void>;
    closeTab: (tabId: string) => void;
    setActiveTab: (tabId: string) => void;
    activatePanel: (panelId: string) => void;
    executeCommand: (commandId: CommandId) => void;
    requestMoveFileToDirectory: (relativePath: string) => void;
}

/** Panel 渲染时可读取的可转化视图上下文。 */
export interface ConvertiblePanelRenderState {
    /** 可转化视图描述符 ID。 */
    descriptorId: string;
    /** 当前容器模式。 */
    mode: "panel";
    /** 当前面板 ID。 */
    panelId: string;
    /** 状态共享键。 */
    stateKey: string;
    /** 上一次从 Tab 转入时携带的源参数。 */
    sourceParams?: Record<string, unknown>;
    /** 来源 Tab ID。 */
    sourceTabId?: string;
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

interface ConvertibleViewRuntimeState {
    descriptorId: string;
    mode: "tab" | "panel";
    stateKey: string;
    sourceParams?: Record<string, unknown>;
    sourceTabId?: string;
}

function buildInitialConvertibleViewRuntime(
    descriptors: Array<{
        id: string;
        defaultMode: "tab" | "panel";
        getInitialStateKey?: () => string;
    }>,
): Record<string, ConvertibleViewRuntimeState> {
    return Object.fromEntries(
        descriptors.map((descriptor) => [
            descriptor.id,
            {
                descriptorId: descriptor.id,
                mode: descriptor.defaultMode,
                stateKey: descriptor.getInitialStateKey?.() ?? descriptor.id,
            } satisfies ConvertibleViewRuntimeState,
        ]),
    );
}

function mergeConvertibleViewRuntimeWithSidebarLayoutFallback(
    previous: Record<string, ConvertibleViewRuntimeState>,
    descriptors: Array<{
        id: string;
        defaultMode: "tab" | "panel";
        getInitialStateKey?: () => string;
    }>,
    snapshot: SidebarLayoutSnapshot | null,
): Record<string, ConvertibleViewRuntimeState> {
    const persistedById = new Map(
        snapshot?.convertiblePanelStates.map((item) => [item.descriptorId, item] as const) ?? [],
    );

    return Object.fromEntries(
        descriptors.map((descriptor) => {
            const existing = previous[descriptor.id];
            if (existing) {
                return [descriptor.id, existing];
            }

            const persisted = persistedById.get(descriptor.id);
            if (persisted) {
                return [
                    descriptor.id,
                    {
                        descriptorId: descriptor.id,
                        mode: "panel" as const,
                        stateKey: persisted.stateKey,
                        sourceParams: persisted.sourceParams,
                    },
                ];
            }

            return [
                descriptor.id,
                {
                    descriptorId: descriptor.id,
                    mode: descriptor.defaultMode,
                    stateKey: descriptor.getInitialStateKey?.() ?? descriptor.id,
                },
            ];
        }),
    );
}

function stripConvertibleViewTabParam(
    params: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
    if (!params) {
        return undefined;
    }

    const { __convertibleView: _ignored, ...rest } = params;
    return Object.keys(rest).length > 0 ? rest : undefined;
}

function isMarkdownPath(path: string): boolean {
    const normalizedPath = path.toLowerCase();
    return normalizedPath.endsWith(".md") || normalizedPath.endsWith(".markdown");
}

function clampSidebarWidth(width: number): number {
    return Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, width));
}

function normalizePaneSize(size: number | undefined): number | undefined {
    if (typeof size !== "number" || Number.isNaN(size)) {
        return undefined;
    }

    return Math.max(size, SIDEBAR_PANE_MIN_TOTAL_SIZE);
}

function isDisposedDockviewResourceError(error: unknown): boolean {
    return error instanceof Error && error.message.includes("resource is already disposed");
}

function isRecoverablePaneviewError(error: unknown): boolean {
    return isDisposedDockviewResourceError(error)
        || (error instanceof DOMException && error.name === "NotFoundError")
        || (error instanceof TypeError && error.message.includes("reading 'size'"));
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

function decorateTabInstanceWithLifecycle(tab: TabInstanceDefinition): TabInstanceDefinition {
    const lifecycleScope = getTabComponentById(tab.component)?.lifecycleScope ?? "global";

    return {
        ...tab,
        params: decorateTabParamsWithLifecycle({
            componentId: tab.component,
            lifecycleScope,
            params: tab.params,
        }),
    };
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
    const registeredConvertibleViews = useConvertibleViews();
    const registeredOverlays = useOverlays();

    /**
     * 将注册中心的数据转换为内部 PanelDefinition 格式。
     * callback activity 只保留为活动栏图标，不再被翻译为虚拟 panel 容器。
     */
    const panels = useMemo<PanelDefinition[]>(() => {
        const result: PanelDefinition[] = [];

        /* 从注册的面板生成 PanelDefinition；panel 与 callback 在这里保持互斥。 */
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
                render: panelDesc.render,
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
    const [convertibleViewRuntime, setConvertibleViewRuntime] = useState<Record<string, ConvertibleViewRuntimeState>>(
        () => buildInitialConvertibleViewRuntime(registeredConvertibleViews),
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
    const configState = useConfigState();
    const { bindings } = useShortcutState();
    const activityBarConfigState = useActivityBarConfig();
    const [paneLayoutRevision, setPaneLayoutRevision] = useState(0);

    /** 活动图标拖拽状态：记录被拖拽项 ID、来源栏、目标位置 */
    const [dragState, setDragState] = useState<IconDragState | null>(null);

    /** 空侧栏拖入高亮状态：paneview 面板拖入空的左侧栏占位区域时为 true */
    const [isEmptySidebarDragOver, setIsEmptySidebarDragOver] = useState(false);
    /** 空侧栏拖入高亮状态：paneview 面板拖入空的右侧栏占位区域时为 true */
    const [isEmptyRightSidebarDragOver, setIsEmptyRightSidebarDragOver] = useState(false);
    /** 全折叠左侧 pane 空白区拖入高亮状态。 */
    const [isCollapsedLeftSidebarDragOver, setIsCollapsedLeftSidebarDragOver] = useState(false);
    /** 全折叠右侧 pane 空白区拖入高亮状态。 */
    const [isCollapsedRightSidebarDragOver, setIsCollapsedRightSidebarDragOver] = useState(false);
    /** 右侧图标栏拖入高亮状态：活动图标从 ActivityBar 拖入时为 true */
    const [isRightIconBarDragOver, setIsRightIconBarDragOver] = useState(false);

    const dockviewApiRef = useRef<DockviewApi | null>(null);
    const leftPaneApiRef = useRef<PaneviewApi | null>(null);
    const rightPaneApiRef = useRef<PaneviewApi | null>(null);
    const leftUnhandledDragDisposeRef = useRef<{ dispose: () => void } | null>(null);
    const rightUnhandledDragDisposeRef = useRef<{ dispose: () => void } | null>(null);
    const leftPaneLayoutDisposeRef = useRef<{ dispose: () => void } | null>(null);
    const rightPaneLayoutDisposeRef = useRef<{ dispose: () => void } | null>(null);
    const pendingExpandedStateRef = useRef<Map<string, boolean>>(new Map());
    const paneExpandedStateRef = useRef<Map<string, boolean>>(new Map());
    const paneSizeStateRef = useRef<Map<string, number>>(new Map());
    const suppressWindowCloseUntilRef = useRef<number>(0);
    const mainDockHostRef = useRef<HTMLDivElement | null>(null);
    /** 缓存 paneview 面板的标题，用于检测语言切换后标题是否变化 */
    const paneTitleCacheRef = useRef<Map<string, string>>(new Map());
    const dockUnhandledDragDisposeRef = useRef<{ dispose: () => void } | null>(null);
    const lastActiveLeftPanelByActivityRef = useRef<Map<string, string>>(new Map());
    const sidebarLayoutSnapshotRef = useRef<SidebarLayoutSnapshot | null>(null);
    const restoredSidebarLayoutVaultPathRef = useRef<string | null>(null);
    const sidebarLayoutReadyRef = useRef(false);
    const sidebarLayoutPersistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const restoredLeftPaneSnapshotVaultPathRef = useRef<string | null>(null);
    const restoredRightPaneSnapshotVaultPathRef = useRef<string | null>(null);
    const previousVaultPathRef = useRef<string | null>(null);

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

    useEffect(() => {
        const nextVaultPath = currentVaultPath.trim().length > 0 ? currentVaultPath : null;
        const previousVaultPath = previousVaultPathRef.current;
        previousVaultPathRef.current = nextVaultPath;

        if (!previousVaultPath || !nextVaultPath || previousVaultPath === nextVaultPath) {
            return;
        }

        console.info("[layout] vault changed, resetting vault-scoped UI", {
            from: previousVaultPath,
            to: nextVaultPath,
        });

        clearActiveEditor();
        resetEditorContext();
        setIsMoveFileDirectoryModalOpen(false);
        setMoveSourceSnapshot(null);
        setCreateEntryDraftRequest((currentRequest) => {
            if (!currentRequest) {
                return null;
            }

            window.setTimeout(() => {
                currentRequest.resolve(null);
            }, 0);
            return null;
        });

        const api = dockviewApiRef.current;
        if (!api) {
            return;
        }

        const panelsToClose = api.panels.filter((panel) =>
            shouldCloseTabOnVaultChange({
                panelId: panel.id,
                panelParams: panel.params as Record<string, unknown> | undefined,
            })
        );

        panelsToClose.forEach((panel) => {
            panel.api.close();
        });

        if (panelsToClose.length > 0) {
            console.info("[layout] closed vault-scoped tabs after vault change", {
                count: panelsToClose.length,
                closedTabIds: panelsToClose.map((panel) => panel.id),
            });
        }

        if (api.panels.length === 0 && initialTabs.length > 0) {
            const fallbackTab = decorateTabInstanceWithLifecycle(initialTabs[0]);

            api.addPanel({
                id: fallbackTab.id,
                title: fallbackTab.title,
                component: fallbackTab.component,
                params: fallbackTab.params,
            });
            api.getPanel(fallbackTab.id)?.api.setActive();
        }

        const nextPanel = api.panels[0] ?? null;
        const nextParams = nextPanel?.params as Record<string, unknown> | undefined;
        setActiveTabId(nextPanel?.id ?? null);
        syncActiveEditorFromPanel(nextPanel?.id ?? null, nextParams);
    }, [currentVaultPath, initialTabs]);

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
    const activityDescriptorById = useMemo(
        () => new Map(registeredActivities.map((activity) => [activity.id, activity] as const)),
        [registeredActivities],
    );
    const activityMetaById = useMemo(() => {
        const meta = new Map<string, {
            title: string;
            icon: ReactNode;
            section: "top" | "bottom";
        }>();

        registeredActivities.forEach((activity) => {
            meta.set(activity.id, {
                title: resolveActivityTitle(activity.title),
                icon: activity.icon,
                section: activity.defaultSection,
            });
        });

        panels.forEach((panel) => {
            const activityId = panel.activityId ?? panel.id;
            if (meta.has(activityId)) {
                return;
            }
            meta.set(activityId, {
                title: panel.activityTitle ?? panel.title,
                icon: panel.activityIcon ?? panel.icon ?? panel.title.slice(0, 1).toUpperCase(),
                section: panel.activitySection ?? "top",
            });
        });

        return meta;
    }, [panels, registeredActivities]);
    const activityIdByPanelId = useMemo(
        () => new Map(panelStates.map((state) => [state.id, state.activityId])),
        [panelStates],
    );
    const knownActivityIds = useMemo(() => {
        const ids = new Set<string>();

        panels.forEach((panel) => {
            ids.add(panel.activityId ?? panel.id);
        });
        activityDescriptorById.forEach((_descriptor, id) => {
            ids.add(id);
        });

        return ids;
    }, [activityDescriptorById, panels]);

    const activityIdOf = (panel: PanelDefinition): string =>
        activityIdByPanelId.get(panel.id) ?? panel.activityId ?? panel.id;

    useEffect(() => {
        if (restoredSidebarLayoutVaultPathRef.current !== currentVaultPath) {
            sidebarLayoutReadyRef.current = false;
            sidebarLayoutSnapshotRef.current = null;
            restoredLeftPaneSnapshotVaultPathRef.current = null;
            restoredRightPaneSnapshotVaultPathRef.current = null;
            paneExpandedStateRef.current.clear();
            paneSizeStateRef.current.clear();
        }
    }, [currentVaultPath]);

    useEffect(() => {
        if (!currentVaultPath || !configState.backendConfig) {
            return;
        }

        if (restoredSidebarLayoutVaultPathRef.current === currentVaultPath) {
            return;
        }

        const snapshot = getSidebarLayoutFromVaultConfig(configState.backendConfig);
        sidebarLayoutSnapshotRef.current = snapshot;
        restoredSidebarLayoutVaultPathRef.current = currentVaultPath;
        sidebarLayoutReadyRef.current = true;

        if (!snapshot) {
            return;
        }

        snapshot.paneStates.forEach((item) => {
            if (typeof item.expanded === "boolean") {
                paneExpandedStateRef.current.set(item.id, item.expanded);
            }
            if (typeof item.size === "number") {
                paneSizeStateRef.current.set(item.id, item.size);
            }
        });

        setLeftSidebarWidth(clampSidebarWidth(snapshot.left.width));
        setRightSidebarWidth(clampSidebarWidth(snapshot.right.width));
        setIsLeftSidebarVisible(snapshot.left.visible);
        setIsRightSidebarVisible(snapshot.right.visible);
        setActivePanelId(snapshot.left.activePanelId);
        setActiveActivityId(snapshot.left.activeActivityId);
        setActiveRightActivityId(snapshot.right.activeActivityId);
        setPanelStates(restorePanelStatesFromSidebarLayout(panels, snapshot));
        setConvertibleViewRuntime(() =>
            mergeConvertibleViewRuntimeWithSidebarLayoutFallback(
                {},
                registeredConvertibleViews,
                snapshot,
            ));
        setPaneLayoutRevision((value) => value + 1);
    }, [configState.backendConfig, currentVaultPath, panels, registeredConvertibleViews]);

    useEffect(() => {
        if (!sidebarLayoutReadyRef.current) {
            return;
        }

        setPanelStates((prev) =>
            mergePanelStatesWithSidebarLayoutFallback(
                prev,
                panels,
                sidebarLayoutSnapshotRef.current,
            ));
    }, [panels]);

    useEffect(() => {
        setPanelStates((prev) => repairUnknownActivityReferencesInPanelStates(
            prev,
            panels,
            knownActivityIds,
        ));
    }, [knownActivityIds, panels]);

    useEffect(() => {
        setConvertibleViewRuntime((previous) =>
            mergeConvertibleViewRuntimeWithSidebarLayoutFallback(
                previous,
                registeredConvertibleViews,
                sidebarLayoutSnapshotRef.current,
            ));
    }, [registeredConvertibleViews]);

    const convertibleByPanelId = useMemo(
        () => new Map(registeredConvertibleViews.map((descriptor) => [descriptor.panelId, descriptor] as const)),
        [registeredConvertibleViews],
    );
    const convertibleByTabComponentId = useMemo(
        () => new Map(registeredConvertibleViews.map((descriptor) => [descriptor.tabComponentId, descriptor] as const)),
        [registeredConvertibleViews],
    );

    const getConvertibleRuntimeState = (
        descriptorId: string,
    ): ConvertibleViewRuntimeState | null => convertibleViewRuntime[descriptorId] ?? null;

    const capturePaneLayout = (api: PaneviewApi): void => {
        try {
            const serialized = api.toJSON();
            serialized.views.forEach((view) => {
                paneExpandedStateRef.current.set(view.data.id, view.expanded ?? true);
                paneSizeStateRef.current.set(view.data.id, view.size);
            });
            setPaneLayoutRevision((value) => value + 1);
        } catch (error) {
            if (isRecoverablePaneviewError(error)) {
                console.info("[DockviewLayout] skip capture pane layout for recoverable pane error", {
                    error,
                });
                return;
            }
            throw error;
        }
    };

    function isConvertiblePanelVisible(panelId: string): boolean {
        const descriptor = convertibleByPanelId.get(panelId);
        if (!descriptor) {
            return true;
        }

        const runtime = getConvertibleRuntimeState(descriptor.id);
        return (runtime?.mode ?? descriptor.defaultMode) === "panel";
    }

    const activityIdsWithSidebarContainer = useMemo(() => {
        const ids = new Set<string>();

        registeredActivities.forEach((activity) => {
            if (activity.type === "panel-container") {
                ids.add(activity.id);
            }
        });

        panels.forEach((panel) => {
            if (!isConvertiblePanelVisible(panel.id)) {
                return;
            }
            ids.add(activityIdOf(panel));
        });

        return ids;
    }, [activityIdByPanelId, convertibleViewRuntime, convertibleByPanelId, panels, registeredActivities]);

    const orderedPanelsByPosition = (position: PanelPosition): PanelDefinition[] =>
        panelStates
            .filter((item) => item.position === position)
            .sort((a, b) => a.order - b.order)
            .map((item) => panelById.get(item.id))
            .filter((item): item is PanelDefinition => item !== undefined)
            /* 可转化组件在 tab 模式下隐藏 panel 容器 */
            .filter((item) => isConvertiblePanelVisible(item.id));

    const leftPanels = useMemo(
        () => orderedPanelsByPosition("left"),
        [panelStates, panelById, convertibleViewRuntime, convertibleByPanelId],
    );
    const rightPanels = useMemo(
        () => orderedPanelsByPosition("right"),
        [panelStates, panelById, convertibleViewRuntime, convertibleByPanelId],
    );

    /**
     * 活动栏项列表：显式 activity 优先，panel 派生项仅用于兜底 orphan panel。
     * callback activity 直接来源于 activityRegistry，不再通过虚拟 panel 参与布局。
     */
    const activityItems = useMemo<ActivityItem[]>(() => {
        const dedup = new Set<string>();
        const items: ActivityItem[] = [];

        registeredActivities.forEach((activity) => {
            if (dedup.has(activity.id)) {
                return;
            }
            dedup.add(activity.id);
            items.push({
                id: activity.id,
                title: resolveActivityTitle(activity.title),
                icon: activity.icon,
                section: activity.defaultSection,
            });
        });

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
    }, [activityMetaById, panels, registeredActivities]);

    /**
     * 将面板派生的活动项与存储的定制配置合并，
     * 同时加入内置的"设置"按钮，得到最终的活动栏有序列表。
     * 面板的初始 position 决定其 activity icon 的默认 bar 归属。
     */

    /** 活动 ID → 默认归属栏（显式 activity 优先，其次兜底到 panel 的当前位置） */
    const activityDefaultBar = useMemo(() => {
        const map = new Map<string, "left" | "right">();
        registeredActivities.forEach((activity) => {
            map.set(activity.id, activity.defaultBar);
        });

        panelStates.forEach((state) => {
            if (map.has(state.activityId)) {
                return;
            }
            map.set(state.activityId, state.position === "right" ? "right" : "left");
        });

        return map;
    }, [panelStates, registeredActivities]);

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
     * 左侧栏中有真实 panel 容器的活动项。
     * callback activity 不会进入该集合，因此不会被当成侧栏容器自动选中。
     */
    const leftPanelActivityItems = useMemo(
        () => visibleNonSettingsItems.filter((i) => {
            const activityDescriptor = activityDescriptorById.get(i.id);
            if (activityDescriptor?.type === "callback") {
                return false;
            }
            return activityIdsWithSidebarContainer.has(i.id);
        }),
        [activityDescriptorById, activityIdsWithSidebarContainer, visibleNonSettingsItems],
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

    const preferredRightActivityId = useMemo(() => {
        const panelRightItems = rightBarItems.filter((item) => {
            const activityDescriptor = activityDescriptorById.get(item.id);
            if (activityDescriptor?.type === "callback") {
                return false;
            }
            if (item.isSettings) {
                return false;
            }
            return activityIdsWithSidebarContainer.has(item.id);
        });

        if (panelRightItems.length === 0) {
            return null;
        }

        const panelCountByActivityId = new Map<string, number>();
        rightPanels.forEach((panel) => {
            const activityId = activityIdOf(panel);
            panelCountByActivityId.set(activityId, (panelCountByActivityId.get(activityId) ?? 0) + 1);
        });

        return panelRightItems.reduce<string | null>((bestId, item) => {
            if (bestId === null) {
                return item.id;
            }

            const bestCount = panelCountByActivityId.get(bestId) ?? 0;
            const currentCount = panelCountByActivityId.get(item.id) ?? 0;
            if (currentCount > bestCount) {
                return item.id;
            }

            return bestId;
        }, null);
    }, [activityDescriptorById, activityIdsWithSidebarContainer, rightBarItems, rightPanels]);

    /**
     * 右侧栏根据 activeRightActivityId 过滤可见面板，
     * 与左侧栏的 visibleLeftPanels 逻辑对称。
     * 如果状态尚未完成活动项选择，则回退到首个右侧面板容器活动，
     * 避免初始化或拖拽瞬间把其他 activity 分组的面板一并渲染出来。
     */
    const visibleRightPanels = useMemo(() => {
        const resolvedActivityId = activeRightActivityId ?? preferredRightActivityId;
        if (!resolvedActivityId) {
            return rightPanels;
        }
        return rightPanels.filter((panel) => activityIdOf(panel) === resolvedActivityId);
    }, [activeRightActivityId, preferredRightActivityId, rightPanels]);

    /* ────────── 左侧活动项自动选中 ────────── */

    useEffect(() => {
        if (!activityBarConfigState.isLoaded) {
            return;
        }
        if (leftPanelActivityItems.length === 0) {
            setActiveActivityId(null);
            return;
        }

        if (!activeActivityId || !leftPanelActivityItems.some((item) => item.id === activeActivityId)) {
            setActiveActivityId(leftPanelActivityItems[0]?.id ?? null);
        }
    }, [activeActivityId, activityBarConfigState.isLoaded, leftPanelActivityItems]);

    /* ────────── 右侧活动项自动选中 ────────── */

    useEffect(() => {
        if (!activityBarConfigState.isLoaded) {
            return;
        }
        if (rightBarItems.length === 0) {
            setActiveRightActivityId(null);
            return;
        }
        /* 排除 settings 与 callback-only 项，它们没有右侧 panel 容器 */
        if (!preferredRightActivityId) {
            setActiveRightActivityId(null);
            return;
        }
        const hasActiveRightItem = rightBarItems.some((item) => item.id === activeRightActivityId);
        if (!activeRightActivityId || !hasActiveRightItem) {
            setActiveRightActivityId(preferredRightActivityId);
        }
    }, [activeRightActivityId, activityBarConfigState.isLoaded, preferredRightActivityId, rightBarItems]);

    const visibleLeftPanels = useMemo(() => {
        if (!activeActivityId) {
            return leftPanels;
        }
        return leftPanels.filter((panel) => activityIdOf(panel) === activeActivityId);
    }, [activeActivityId, leftPanels]);

    const preferredLeftPanelId = useMemo(() => {
        if (!activeActivityId) {
            return null;
        }

        const candidatePanels = leftPanels.filter((panel) => activityIdOf(panel) === activeActivityId);
        if (candidatePanels.length === 0) {
            return null;
        }

        const rememberedPanelId = lastActiveLeftPanelByActivityRef.current.get(activeActivityId);
        if (rememberedPanelId && candidatePanels.some((panel) => panel.id === rememberedPanelId)) {
            return rememberedPanelId;
        }

        return candidatePanels[0]?.id ?? null;
    }, [activeActivityId, leftPanels, activityIdByPanelId]);

    useEffect(() => {
        if (!activePanelId) {
            setActivePanelId(preferredLeftPanelId ?? rightPanels[0]?.id ?? null);
            return;
        }

        const exists = [...visibleLeftPanels, ...rightPanels].some((panel) => panel.id === activePanelId);
        if (!exists) {
            setActivePanelId(preferredLeftPanelId ?? rightPanels[0]?.id ?? null);
        }
    }, [activePanelId, preferredLeftPanelId, visibleLeftPanels, rightPanels]);

    useEffect(() => {
        if (!activeActivityId || !activePanelId) {
            return;
        }

        if (!visibleLeftPanels.some((panel) => panel.id === activePanelId)) {
            return;
        }

        lastActiveLeftPanelByActivityRef.current.set(activeActivityId, activePanelId);
    }, [activeActivityId, activePanelId, visibleLeftPanels]);

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
        return preferredLeftPanelId ?? visibleLeftPanels[0]?.id ?? null;
    }, [activePanelId, preferredLeftPanelId, visibleLeftPanels]);

    const requestPaneviewRelayout = (api: PaneviewApi): void => {
        const runLayout = (): void => {
            try {
                api.layout(api.width, api.height);
            } catch (error) {
                if (isRecoverablePaneviewError(error)) {
                    console.info("[DockviewLayout] skip relayout for recoverable pane error", { error });
                    return;
                }
                throw error;
            }
        };

        requestAnimationFrame(() => {
            runLayout();
            requestAnimationFrame(() => {
                runLayout();
            });
        });

        window.setTimeout(() => {
            runLayout();
        }, 32);
    };

    const restorePaneviewLayoutFromSnapshot = (
        api: PaneviewApi,
        panelList: PanelDefinition[],
        expandedPanelId: string | null,
        side: "left" | "right",
    ): boolean => {
        if (!currentVaultPath) {
            return false;
        }

        const restoredVaultPathRef = side === "left"
            ? restoredLeftPaneSnapshotVaultPathRef
            : restoredRightPaneSnapshotVaultPathRef;

        if (restoredVaultPathRef.current === currentVaultPath) {
            return false;
        }

        const snapshot = sidebarLayoutSnapshotRef.current;
        if (!snapshot || panelList.length === 0) {
            return false;
        }

        const paneStateById = new Map(snapshot.paneStates.map((item) => [item.id, item] as const));
        if (!panelList.some((panel) => paneStateById.has(panel.id))) {
            return false;
        }

        try {
            api.fromJSON({
                size: Math.max(api.height, 0),
                views: panelList.map((panel) => {
                    const persistedPaneState = paneStateById.get(panel.id);
                    const size = normalizePaneSize(
                        persistedPaneState?.size ?? paneSizeStateRef.current.get(panel.id),
                    ) ?? SIDEBAR_PANE_MIN_TOTAL_SIZE;

                    paneTitleCacheRef.current.set(panel.id, panel.title);

                    return {
                        data: {
                            id: panel.id,
                            component: panel.id,
                            title: panel.title,
                        },
                        size,
                        expanded: persistedPaneState?.expanded ?? (expandedPanelId ? panel.id === expandedPanelId : true),
                    };
                }),
            });
        } catch (error) {
            if (isRecoverablePaneviewError(error)) {
                console.warn("[DockviewLayout] skip restoring pane snapshot because paneview rejected the snapshot", {
                    side,
                    error,
                });
                return false;
            }
            throw error;
        }

        restoredVaultPathRef.current = currentVaultPath;
        requestPaneviewRelayout(api);
        capturePaneLayout(api);
        return true;
    };

    const syncPanePanels = (api: PaneviewApi, panelList: PanelDefinition[], expandedPanelId: string | null): void => {
        const ids = panelList.map((panel) => panel.id);
        let didMutateLayout = false;
        let serializedPaneview;
        try {
            serializedPaneview = api.toJSON();
        } catch (error) {
            if (isRecoverablePaneviewError(error)) {
                console.info("[DockviewLayout] skip syncing pane resource after recoverable pane error", {
                    error,
                });
                return;
            }
            throw error;
        }
        const currentLayoutById = new Map(
            serializedPaneview.views.map((view) => [
                view.data.id,
                {
                    expanded: view.expanded ?? true,
                    size: view.size,
                },
            ] as const),
        );
        currentLayoutById.forEach((layout, panelId) => {
            paneExpandedStateRef.current.set(panelId, layout.expanded);
            paneSizeStateRef.current.set(panelId, layout.size);
        });

        const stalePanelIds = api.panels
            .map((panel) => panel.id)
            .filter((panelId) => !ids.includes(panelId));

        stalePanelIds.forEach((panelId) => {
            const stalePanel = api.getPanel(panelId);
            if (!stalePanel) {
                return;
            }

            const staleLayout = currentLayoutById.get(panelId);
            let fallbackExpanded = true;
            if (staleLayout?.expanded !== undefined) {
                fallbackExpanded = staleLayout.expanded;
            } else {
                try {
                    fallbackExpanded = stalePanel.api.isExpanded;
                } catch (error) {
                    if (!isDisposedDockviewResourceError(error)) {
                        throw error;
                    }
                }
            }
            paneExpandedStateRef.current.set(panelId, fallbackExpanded);
            if (typeof staleLayout?.size === "number") {
                paneSizeStateRef.current.set(panelId, staleLayout.size);
            }

            try {
                api.removePanel(stalePanel);
                didMutateLayout = true;
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
                const currentLayout = currentLayoutById.get(panel.id);
                let wasExpanded = currentLayout?.expanded ?? true;
                if (currentLayout?.expanded === undefined) {
                    try {
                        wasExpanded = existingPanel.api.isExpanded;
                    } catch (error) {
                        if (!isDisposedDockviewResourceError(error)) {
                            throw error;
                        }
                    }
                }
                const previousSize = normalizePaneSize(
                    currentLayout?.size ?? paneSizeStateRef.current.get(panel.id),
                );
                paneExpandedStateRef.current.set(panel.id, wasExpanded);
                if (typeof previousSize === "number") {
                    paneSizeStateRef.current.set(panel.id, previousSize);
                }
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

                try {
                    api.addPanel({
                        id: panel.id,
                        component: panel.id,
                        title: panel.title,
                        minimumBodySize: SIDEBAR_PANE_MIN_BODY_SIZE,
                        isExpanded: wasExpanded,
                        index,
                        size: previousSize,
                    });
                } catch (error) {
                    if (isRecoverablePaneviewError(error)) {
                        console.warn("[DockviewLayout] skip re-adding title-changed panel", {
                            panelId: panel.id,
                            error,
                        });
                        return;
                    }
                    throw error;
                }
                didMutateLayout = true;
                paneTitleCacheRef.current.set(panel.id, panel.title);
                return;
            }

            if (!existingPanel) {
                const pendingExpanded = pendingExpandedStateRef.current.get(panel.id);
                const knownExpanded = currentLayoutById.get(panel.id)?.expanded;
                const cachedExpanded = paneExpandedStateRef.current.get(panel.id);
                const cachedSize = normalizePaneSize(
                    currentLayoutById.get(panel.id)?.size ?? paneSizeStateRef.current.get(panel.id),
                );
                const fallbackExpanded = expandedPanelId ? panel.id === expandedPanelId : true;

                try {
                    api.addPanel({
                        id: panel.id,
                        component: panel.id,
                        title: panel.title,
                        minimumBodySize: SIDEBAR_PANE_MIN_BODY_SIZE,
                        isExpanded: pendingExpanded ?? knownExpanded ?? cachedExpanded ?? fallbackExpanded,
                        index,
                        size: cachedSize,
                    });
                } catch (error) {
                    if (isRecoverablePaneviewError(error)) {
                        console.warn("[DockviewLayout] skip adding pane panel after recoverable pane error", {
                            panelId: panel.id,
                            error,
                        });
                        return;
                    }
                    throw error;
                }
                didMutateLayout = true;

                paneTitleCacheRef.current.set(panel.id, panel.title);

                if (pendingExpanded !== undefined) {
                    pendingExpandedStateRef.current.delete(panel.id);
                }
            }
        });

        ids.forEach((id, index) => {
            const fromIndex = api.panels.findIndex((panel) => panel.id === id);
            if (fromIndex >= 0 && fromIndex !== index) {
                try {
                    api.movePanel(fromIndex, index);
                } catch (error) {
                    if (isRecoverablePaneviewError(error)) {
                        console.warn("[DockviewLayout] skip moving pane panel after recoverable pane error", {
                            panelId: id,
                            fromIndex,
                            toIndex: index,
                            error,
                        });
                        return;
                    }
                    throw error;
                }
                didMutateLayout = true;
            }
        });

        if (didMutateLayout) {
            requestPaneviewRelayout(api);
        }

    };

    useEffect(() => {
        const api = leftPaneApiRef.current;
        if (api) {
            if (restorePaneviewLayoutFromSnapshot(api, visibleLeftPanels, expandedLeftPanelId, "left")) {
                return;
            }
            syncPanePanels(api, visibleLeftPanels, expandedLeftPanelId);
        }
    }, [currentVaultPath, expandedLeftPanelId, visibleLeftPanels]);

    useEffect(() => {
        const api = rightPaneApiRef.current;
        if (api) {
            if (restorePaneviewLayoutFromSnapshot(api, visibleRightPanels, null, "right")) {
                return;
            }
            syncPanePanels(api, visibleRightPanels, null);
        }
    }, [currentVaultPath, visibleRightPanels]);

    useEffect(
        () => () => {
            if (sidebarLayoutPersistTimerRef.current !== null) {
                clearTimeout(sidebarLayoutPersistTimerRef.current);
            }
        },
        [],
    );

    useEffect(() => {
        if (!currentVaultPath || !sidebarLayoutReadyRef.current) {
            return;
        }

        if (sidebarLayoutPersistTimerRef.current !== null) {
            clearTimeout(sidebarLayoutPersistTimerRef.current);
        }

        sidebarLayoutPersistTimerRef.current = setTimeout(() => {
            const knownPanelIds = new Set(panelStates.map((item) => item.id));
            const paneStates = Array.from(knownPanelIds).reduce<SidebarLayoutSnapshot["paneStates"]>((result, id) => {
                const expanded = paneExpandedStateRef.current.get(id);
                const size = paneSizeStateRef.current.get(id);
                if (expanded === undefined && size === undefined) {
                    return result;
                }

                result.push({
                    id,
                    expanded,
                    size,
                });
                return result;
            }, []);

            const snapshot: SidebarLayoutSnapshot = {
                version: 1,
                left: {
                    width: leftSidebarWidth,
                    visible: isLeftSidebarVisible,
                    activeActivityId,
                    activePanelId,
                },
                right: {
                    width: rightSidebarWidth,
                    visible: isRightSidebarVisible,
                    activeActivityId: activeRightActivityId,
                    activePanelId: null,
                },
                panelStates,
                paneStates,
                convertiblePanelStates: Object.values(convertibleViewRuntime)
                    .filter((runtime) => runtime.mode === "panel")
                    .map((runtime) => ({
                        descriptorId: runtime.descriptorId,
                        stateKey: runtime.stateKey,
                        sourceParams: runtime.sourceParams,
                    })),
            };

            sidebarLayoutSnapshotRef.current = snapshot;
            void saveSidebarLayoutSnapshot(snapshot);
        }, SIDEBAR_LAYOUT_SAVE_DEBOUNCE_MS);

        return () => {
            if (sidebarLayoutPersistTimerRef.current !== null) {
                clearTimeout(sidebarLayoutPersistTimerRef.current);
            }
        };
    }, [
        activeActivityId,
        activePanelId,
        activeRightActivityId,
        currentVaultPath,
        isLeftSidebarVisible,
        isRightSidebarVisible,
        leftSidebarWidth,
        paneLayoutRevision,
        panelStates,
        rightSidebarWidth,
        convertibleViewRuntime,
        Boolean(configState.backendConfig),
    ]);

    const resolveActivityIdForPanelDrop = (
        targetPosition: PanelPosition,
        dropTargetPanelId?: string | null,
    ): string | null => {
        if (dropTargetPanelId) {
            const targetState = panelStates.find((item) => item.id === dropTargetPanelId);
            if (targetState) {
                return targetState.activityId;
            }

            const targetDefinition = panelById.get(dropTargetPanelId);
            if (targetDefinition) {
                return targetDefinition.activityId ?? targetDefinition.id;
            }
        }

        return targetPosition === "left" ? activeActivityId : activeRightActivityId;
    };

    const convertDockviewTabToPanel = (options: {
        targetPosition: PanelPosition;
        dropTargetPanelId?: string;
        dropPosition?: "top" | "bottom" | "left" | "right";
        emptyTarget?: boolean;
    }): boolean => {
        const transfer = getPanelData();
        if (!transfer || !transfer.panelId) {
            return false;
        }

        const sourceDockPanel = dockviewApiRef.current?.getPanel(transfer.panelId);
        if (!sourceDockPanel) {
            return false;
        }

        const descriptor = convertibleByTabComponentId.get(sourceDockPanel.view.contentComponent);
        if (!descriptor) {
            return false;
        }

        const tabParams = sourceDockPanel.params as Record<string, unknown> | undefined;
        const tabState = readConvertibleViewTabState(tabParams);
        const fallbackRuntime = getConvertibleRuntimeState(descriptor.id);
        const stateKey = tabState?.stateKey
            ?? fallbackRuntime?.stateKey
            ?? descriptor.getInitialStateKey?.()
            ?? descriptor.id;
        const sourceParams = stripConvertibleViewTabParam(tabParams);
        const nextActivityId = resolveActivityIdForPanelDrop(options.targetPosition, options.dropTargetPanelId);

        pendingExpandedStateRef.current.set(descriptor.panelId, true);
        paneSizeStateRef.current.delete(descriptor.panelId);

        setConvertibleViewRuntime((previous) => ({
            ...previous,
            [descriptor.id]: {
                descriptorId: descriptor.id,
                mode: "panel",
                stateKey,
                sourceParams,
                sourceTabId: sourceDockPanel.id,
            },
        }));

        queueMicrotask(() => {
            setPanelStates((previous) => {
                if (options.emptyTarget) {
                    return options.targetPosition === "left"
                        ? computeEmptySidebarDrop({
                            prev: previous,
                            movedPanelId: descriptor.panelId,
                            activeActivityId: activeActivityId,
                        })
                        : computeEmptyRightSidebarDrop({
                            prev: previous,
                            movedPanelId: descriptor.panelId,
                            panelById,
                            activeRightActivityId,
                        });
                }

                return computeCrossContainerDrop({
                    prev: previous,
                    movedPanelId: descriptor.panelId,
                    targetPosition: options.targetPosition,
                    dropTargetPanelId: options.dropTargetPanelId ?? descriptor.panelId,
                    dropPosition: options.dropPosition ?? "bottom",
                    panelById,
                    activeActivityId,
                    activeRightActivityId,
                });
            });

            setActivePanelId(descriptor.panelId);
            if (options.targetPosition === "right") {
                setIsRightSidebarVisible(true);
                if (nextActivityId) {
                    setActiveRightActivityId(nextActivityId);
                }
            } else {
                setIsLeftSidebarVisible(true);
                if (nextActivityId) {
                    setActiveActivityId(nextActivityId);
                }
            }
        });

        sourceDockPanel.api.close();
        console.info("[DockviewLayout] converted tab to panel", {
            descriptorId: descriptor.id,
            tabId: sourceDockPanel.id,
            panelId: descriptor.panelId,
            targetPosition: options.targetPosition,
        });
        return true;
    };

    const convertPanePanelToTab = (dropEvent?: DockviewDidDropEvent): boolean => {
        const transfer = getPaneData();
        if (!transfer) {
            return false;
        }

        const descriptor = convertibleByPanelId.get(transfer.paneId);
        if (!descriptor) {
            return false;
        }

        const runtime = getConvertibleRuntimeState(descriptor.id);
        const tabDefinition = descriptor.buildTabInstance({
            stateKey: runtime?.stateKey ?? descriptor.getInitialStateKey?.() ?? descriptor.id,
            panelId: descriptor.panelId,
            params: runtime?.sourceParams,
        });

        openTabAtDropTarget(tabDefinition, {
            referencePanel: dropEvent?.panel ?? dropEvent?.group?.activePanel,
            position: dropEvent?.position,
        });
        setActivePanelId((current) => (current === descriptor.panelId ? null : current));
        console.info("[DockviewLayout] converted panel to tab", {
            descriptorId: descriptor.id,
            panelId: descriptor.panelId,
            tabId: tabDefinition.id,
            dropPosition: dropEvent?.position,
            dropTargetPanelId: dropEvent?.panel?.id,
        });
        return true;
    };

    const handleUnhandledDragOver = (targetApi: PaneviewApi, event: PaneviewDndOverlayEvent): void => {
        const data = event.getData();
        if (data) {
            if (targetApi.getPanel(data.paneId)) {
                return;
            }

            if (panelById.has(data.paneId)) {
                event.accept();
            }
            return;
        }

        const dockviewTransfer = getPanelData();
        if (!dockviewTransfer || !dockviewTransfer.panelId) {
            return;
        }

        const sourceDockPanel = dockviewApiRef.current?.getPanel(dockviewTransfer.panelId);
        if (!sourceDockPanel) {
            return;
        }

        if (convertibleByTabComponentId.has(sourceDockPanel.view.contentComponent)) {
            event.accept();
        }
    };

    /**
     * 判断当前拖拽是否可被侧栏 pane 容器接收。
     *
     * 接受两类来源：现有 paneview pane，以及可转换为 panel 的 dockview tab。
     */
    const canAcceptSidebarPaneDrop = (): boolean => {
        const paneData = getPaneData();
        if (paneData && panelById.has(paneData.paneId)) {
            return true;
        }

        const dockviewTransfer = getPanelData();
        if (!dockviewTransfer || !dockviewTransfer.panelId) {
            return false;
        }

        const sourceDockPanel = dockviewApiRef.current?.getPanel(dockviewTransfer.panelId);
        if (!sourceDockPanel) {
            return false;
        }

        return convertibleByTabComponentId.has(sourceDockPanel.view.contentComponent);
    };

    /**
     * 判断指定侧栏当前可见 pane 是否全部为折叠态。
     *
     * 当 PaneviewReact 只剩标题高度时，需要由外围容器补充空白区 drop target。
     */
    const areAllVisiblePanesCollapsed = (
        api: PaneviewApi | null,
        panelList: PanelDefinition[],
    ): boolean => {
        if (!api || panelList.length === 0 || api.panels.length === 0) {
            return false;
        }

        const visibleIds = new Set(panelList.map((panel) => panel.id));
        const visiblePanes = api.panels.filter((panel) => visibleIds.has(panel.id));
        if (visiblePanes.length === 0) {
            return false;
        }

        return visiblePanes.every((panel) => !panel.api.isExpanded);
    };

    /** 根据侧栏位置返回对应 PaneviewApi。 */
    const getPaneApiForPosition = (targetPosition: PanelPosition): PaneviewApi | null =>
        targetPosition === "left" ? leftPaneApiRef.current : rightPaneApiRef.current;

    /** 根据侧栏位置返回当前可见 panel 列表。 */
    const getVisiblePanelsForPosition = (targetPosition: PanelPosition): PanelDefinition[] =>
        targetPosition === "left" ? visibleLeftPanels : visibleRightPanels;

    /** 清除全折叠侧栏空白区拖入高亮。 */
    const clearCollapsedSidebarDragOver = (targetPosition: PanelPosition): void => {
        if (targetPosition === "left") {
            setIsCollapsedLeftSidebarDragOver(false);
            return;
        }

        setIsCollapsedRightSidebarDragOver(false);
    };

    /**
     * 判断当前指针是否位于“最后一个折叠 pane 底部以下”的侧栏空白区。
     *
     * 这样可以只接管真正的空白区释放，不影响标题区域原有的 paneview drop 逻辑。
     */
    const isPointerInCollapsedSidebarWhitespace = (
        container: HTMLDivElement,
        clientY: number,
    ): boolean => {
        const paneElements = Array.from(container.querySelectorAll<HTMLElement>(".dv-pane"));
        if (paneElements.length === 0) {
            return false;
        }

        const lastPaneBottom = Math.max(
            ...paneElements.map((paneElement) => paneElement.getBoundingClientRect().bottom),
        );

        return clientY > lastPaneBottom;
    };

    /**
     * 全折叠侧栏空白区 dragover：为空白区域提供 pane/tab 释放落点。
     */
    const handleCollapsedSidebarSurfaceDragOver = (
        targetPosition: PanelPosition,
        e: React.DragEvent<HTMLDivElement>,
    ): void => {
        const api = getPaneApiForPosition(targetPosition);
        const visiblePanels = getVisiblePanelsForPosition(targetPosition);
        if (
            !areAllVisiblePanesCollapsed(api, visiblePanels)
            || !canAcceptSidebarPaneDrop()
            || !isPointerInCollapsedSidebarWhitespace(e.currentTarget, e.clientY)
        ) {
            clearCollapsedSidebarDragOver(targetPosition);
            return;
        }

        e.preventDefault();
        e.dataTransfer.dropEffect = "move";

        if (targetPosition === "left") {
            setIsCollapsedLeftSidebarDragOver(true);
            return;
        }

        setIsCollapsedRightSidebarDragOver(true);
    };

    /** 全折叠侧栏空白区 dragleave：清除高亮。 */
    const handleCollapsedSidebarSurfaceDragLeave = (
        targetPosition: PanelPosition,
        _e: React.DragEvent<HTMLDivElement>,
    ): void => {
        clearCollapsedSidebarDragOver(targetPosition);
    };

    /**
     * 全折叠侧栏空白区 drop：按空侧栏语义将面板追加到当前 activity 容器末尾。
     */
    const handleCollapsedSidebarSurfaceDrop = (
        targetPosition: PanelPosition,
        e: React.DragEvent<HTMLDivElement>,
    ): void => {
        e.preventDefault();
        clearCollapsedSidebarDragOver(targetPosition);

        const api = getPaneApiForPosition(targetPosition);
        const visiblePanels = getVisiblePanelsForPosition(targetPosition);
        if (
            !areAllVisiblePanesCollapsed(api, visiblePanels)
            || !isPointerInCollapsedSidebarWhitespace(e.currentTarget, e.clientY)
        ) {
            return;
        }

        if (convertDockviewTabToPanel({
            targetPosition,
            emptyTarget: true,
        })) {
            console.info("[DockviewLayout] collapsed sidebar whitespace drop converted tab to panel", {
                targetPosition,
            });
            return;
        }

        const paneData = getPaneData();
        if (!paneData || !panelById.has(paneData.paneId)) {
            console.warn("[DockviewLayout] collapsed sidebar whitespace drop: no valid pane data", {
                targetPosition,
            });
            return;
        }

        const movedPanelId = paneData.paneId;
        const sourceExpanded =
            leftPaneApiRef.current?.getPanel(movedPanelId)?.api.isExpanded ??
            rightPaneApiRef.current?.getPanel(movedPanelId)?.api.isExpanded;
        if (typeof sourceExpanded === "boolean") {
            pendingExpandedStateRef.current.set(movedPanelId, sourceExpanded);
        }

        console.info("[DockviewLayout] collapsed sidebar whitespace drop", {
            targetPosition,
            movedPanelId,
        });

        queueMicrotask(() => {
            setPanelStates((prev) =>
                targetPosition === "left"
                    ? computeEmptySidebarDrop({
                        prev,
                        movedPanelId,
                        activeActivityId,
                    })
                    : computeEmptyRightSidebarDrop({
                        prev,
                        movedPanelId,
                        panelById,
                        activeRightActivityId,
                    }),
            );

            if (targetPosition === "right") {
                setIsRightSidebarVisible(true);
            } else {
                setIsLeftSidebarVisible(true);
            }

            setActivePanelId(movedPanelId);
        });
    };

    const handleDockviewUnhandledDragOver = (event: any): void => {
        const paneTransfer = event.getData?.() ?? getPaneData();
        if (!paneTransfer) {
            return;
        }

        if (convertibleByPanelId.has(paneTransfer.paneId)) {
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
        if (paneData && panelById.has(paneData.paneId)) {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            setIsEmptySidebarDragOver(true);
            return;
        }

        const dockviewTransfer = getPanelData();
        if (!dockviewTransfer || !dockviewTransfer.panelId) {
            return;
        }

        const sourceDockPanel = dockviewApiRef.current?.getPanel(dockviewTransfer.panelId);
        if (!sourceDockPanel || !convertibleByTabComponentId.has(sourceDockPanel.view.contentComponent)) {
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

        if (convertDockviewTabToPanel({
            targetPosition: "left",
            emptyTarget: true,
        })) {
            return;
        }

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
        if (convertDockviewTabToPanel({
            targetPosition,
            dropTargetPanelId: event.panel.id,
            dropPosition: event.position as "top" | "bottom" | "left" | "right",
        })) {
            return;
        }

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

        const descriptor = convertibleByTabComponentId.get(tab.component);
        const existingRuntime = descriptor ? getConvertibleRuntimeState(descriptor.id) : null;
        const tabConvertibleState = descriptor
            ? (readConvertibleViewTabState(tab.params) ?? {
                descriptorId: descriptor.id,
                stateKey: existingRuntime?.stateKey ?? descriptor.getInitialStateKey?.() ?? descriptor.id,
            })
            : null;
        const normalizedTab = descriptor && tabConvertibleState
            ? {
                ...tab,
                params: buildConvertibleViewTabParams(tabConvertibleState, tab.params),
            }
            : tab;
        const lifecycleAwareTab = decorateTabInstanceWithLifecycle(normalizedTab);

        if (descriptor && tabConvertibleState) {
            setConvertibleViewRuntime((previous) => ({
                ...previous,
                [descriptor.id]: {
                    descriptorId: descriptor.id,
                    mode: "tab",
                    stateKey: tabConvertibleState.stateKey,
                    sourceParams: stripConvertibleViewTabParam(
                        normalizedTab.params as Record<string, unknown> | undefined,
                    ),
                },
            }));
        }

        const existing = api.getPanel(lifecycleAwareTab.id);
        if (existing) {
            existing.api.setActive();
            return;
        }

        api.addPanel({
            id: normalizedTab.id,
            title: normalizedTab.title,
            component: normalizedTab.component,
            params: normalizedTab.params,
        });
        api.getPanel(normalizedTab.id)?.api.setActive();
        setActiveTabId(normalizedTab.id);
    };

    /**
     * 按实际 drop 落点在 dockview 中打开标签。
     * panel -> tab 转换时，如果用户将面板拖到主区域右侧/上方等位置，
     * 应保留对应 split，而不是仅恢复为普通 tab。
     */
    const openTabAtDropTarget = (
        tab: TabInstanceDefinition,
        options?: {
            referencePanel?: IDockviewPanel;
            position?: "top" | "bottom" | "left" | "right" | "center";
        },
    ): void => {
        const api = dockviewApiRef.current;
        if (!api) {
            return;
        }

        const descriptor = convertibleByTabComponentId.get(tab.component);
        const existingRuntime = descriptor ? getConvertibleRuntimeState(descriptor.id) : null;
        const tabConvertibleState = descriptor
            ? (readConvertibleViewTabState(tab.params) ?? {
                descriptorId: descriptor.id,
                stateKey: existingRuntime?.stateKey ?? descriptor.getInitialStateKey?.() ?? descriptor.id,
            })
            : null;
        const normalizedTab = descriptor && tabConvertibleState
            ? {
                ...tab,
                params: buildConvertibleViewTabParams(tabConvertibleState, tab.params),
            }
            : tab;
        const lifecycleAwareTab = decorateTabInstanceWithLifecycle(normalizedTab);

        if (descriptor && tabConvertibleState) {
            setConvertibleViewRuntime((previous) => ({
                ...previous,
                [descriptor.id]: {
                    descriptorId: descriptor.id,
                    mode: "tab",
                    stateKey: tabConvertibleState.stateKey,
                    sourceParams: stripConvertibleViewTabParam(
                        normalizedTab.params as Record<string, unknown> | undefined,
                    ),
                },
            }));
        }

        const existing = api.getPanel(normalizedTab.id);
        if (existing) {
            existing.api.setActive();
            return;
        }

        const directionByPosition: Record<"top" | "bottom" | "left" | "right", Direction> = {
            top: "above",
            bottom: "below",
            left: "left",
            right: "right",
        };

        const addPanelOptions = {
            id: lifecycleAwareTab.id,
            title: lifecycleAwareTab.title,
            component: lifecycleAwareTab.component,
            params: lifecycleAwareTab.params,
        };

        if (options?.referencePanel && options.position && options.position !== "center") {
            api.addPanel({
                ...addPanelOptions,
                position: {
                    referencePanel: options.referencePanel,
                    direction: directionByPosition[options.position],
                },
            });
        } else if (options?.referencePanel) {
            api.addPanel({
                ...addPanelOptions,
                position: {
                    referencePanel: options.referencePanel,
                    direction: "within",
                },
            });
        } else {
            api.addPanel(addPanelOptions);
        }

        api.getPanel(lifecycleAwareTab.id)?.api.setActive();
        setActiveTabId(lifecycleAwareTab.id);
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

        const convertibleDescriptor = convertibleByPanelId.get(panelId);
        if (convertibleDescriptor) {
            const existingRuntime = getConvertibleRuntimeState(convertibleDescriptor.id);
            setConvertibleViewRuntime((previous) => ({
                ...previous,
                [convertibleDescriptor.id]: {
                    descriptorId: convertibleDescriptor.id,
                    mode: "panel",
                    stateKey: existingRuntime?.stateKey
                        ?? convertibleDescriptor.getInitialStateKey?.()
                        ?? convertibleDescriptor.id,
                    sourceParams: existingRuntime?.sourceParams,
                    sourceTabId: existingRuntime?.sourceTabId,
                },
            }));
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
        executeEditorNativeCommand: (commandId) => {
            const activeEditor = getActiveEditorSnapshot();
            if (!activeEditor) {
                console.warn("[layout] editor command skipped: no active editor", {
                    commandId,
                });
                return false;
            }

            emitEditorCommandRequestedEvent({
                articleId: activeEditor.articleId,
                commandId,
            });
            console.info("[layout] forwarded editor command to active editor", {
                articleId: activeEditor.articleId,
                commandId,
                path: activeEditor.path,
            });
            return true;
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

            const resolution = dispatchShortcut({
                event,
                bindings,
                source: "global",
                conditionContext: createConditionContext({
                    focusedComponent: detectFocusedComponentFromEvent(event),
                    activeTabId,
                    currentVaultPath,
                }),
            });

            if (resolution.kind !== "execute" || !resolution.commandId) {
                return;
            }

            if (resolution.shouldPreventDefault) {
                event.preventDefault();
            }
            if (resolution.shouldStopPropagation) {
                event.stopPropagation();
            }

            if (resolution.notifyTabClose) {
                notifyTabCloseShortcutTriggered();
            }

            executeCommand(resolution.commandId, buildCommandContext());
        };

        window.addEventListener("keydown", handleKeydown, { capture: true });
        return () => {
            window.removeEventListener("keydown", handleKeydown, { capture: true });
        };
    }, [bindings, activeTabId, files, openTab]);

    const panelRenderContext: PanelRenderContext = {
        activeTabId,
        dockviewApi,
        hostPanelId: null,
        convertibleView: null,
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
        activatePanel: (panelId: string) => {
            activatePanelById(panelId);
        },
        executeCommand: (commandId: CommandId) => {
            executeCommand(commandId, buildCommandContext());
        },
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

    const createStaleDockviewPlaceholder = (
        componentKey: string,
    ): React.FunctionComponent<IDockviewPanelProps<Record<string, unknown>>> => {
        const Placeholder = memo(function StaleDockviewPlaceholder(): ReactNode {
            return (
                <div
                    {...{ [TAB_COMPONENT_DATA_ATTR]: componentKey }}
                    tabIndex={-1}
                    style={{ height: "100%", outline: "none" }}
                />
            );
        });
        Placeholder.displayName = `StaleDockviewPlaceholder(${componentKey})`;
        return Placeholder;
    };

    // 为每个 dockview tab 组件包装 data-tab-component 属性容器，
    // 使焦点检测可通过 DOM 属性识别当前聚焦的标签类型
    const dockviewComponents = useMemo<Record<string, React.FunctionComponent<IDockviewPanelProps<Record<string, unknown>>>>>(
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

            const componentEntries: Array<
                readonly [
                    string,
                    React.FunctionComponent<IDockviewPanelProps<Record<string, unknown>>>,
                ]
            > = [
                    ["welcome", wrapTabComponent("welcome", WelcomeTabComponent)],
                    ...tabComponents.map((item) => [item.key, wrapTabComponent(item.key, item.component)] as const),
                ];

            const knownComponentKeys = new Set(componentEntries.map(([key]) => key));
            const staleComponentKeys = dockviewApiRef.current?.panels
                .map((panel) => panel.view.contentComponent)
                .filter((componentKey) => !knownComponentKeys.has(componentKey))
                ?? [];

            staleComponentKeys.forEach((componentKey) => {
                componentEntries.push([componentKey, createStaleDockviewPlaceholder(componentKey)]);
            });

            return Object.fromEntries(componentEntries);
        },
        [tabComponents],
    );

    const createStalePanePlaceholder = (panelId: string): React.FunctionComponent<IPaneviewPanelProps> => {
        const Placeholder = memo(function StalePanePlaceholder(): ReactNode {
            return (
                <div
                    className="pane-panel-content"
                    {...{ [PANEL_ID_DATA_ATTR]: panelId }}
                    tabIndex={-1}
                    style={{ outline: "none" }}
                />
            );
        });
        Placeholder.displayName = `StalePanePlaceholder(${panelId})`;
        return Placeholder;
    };

    // 为每个侧栏 pane panel 包装 data-panel-id 属性容器，
    // 使焦点检测可通过 DOM 属性识别当前聚焦的面板
    const leftPaneComponents = useMemo(
        () => {
            const componentEntries = visibleLeftPanels.map((panel) => [
                panel.id,
                (() => (
                    // tabIndex={-1} 使面板容器可聚焦，点击空白区域触发 focusin
                    <div
                        className="pane-panel-content"
                        {...{ [PANEL_ID_DATA_ATTR]: panel.id }}
                        tabIndex={-1}
                        style={{ outline: "none" }}
                    >
                        {panel.render({
                            ...panelRenderContext,
                            hostPanelId: panel.id,
                            convertibleView: (() => {
                                const descriptor = convertibleByPanelId.get(panel.id);
                                if (!descriptor) {
                                    return null;
                                }

                                const runtime = getConvertibleRuntimeState(descriptor.id);
                                return {
                                    descriptorId: descriptor.id,
                                    mode: "panel" as const,
                                    panelId: panel.id,
                                    stateKey: runtime?.stateKey
                                        ?? descriptor.getInitialStateKey?.()
                                        ?? descriptor.id,
                                    sourceParams: runtime?.sourceParams,
                                    sourceTabId: runtime?.sourceTabId,
                                } satisfies ConvertiblePanelRenderState;
                            })(),
                        })}
                    </div>
                )) as React.FunctionComponent<IPaneviewPanelProps>,
            ] as const);

            const stalePanelIds = leftPaneApiRef.current?.panels
                .map((panel) => panel.id)
                .filter((panelId) => !visibleLeftPanels.some((panel) => panel.id === panelId))
                ?? [];

            stalePanelIds.forEach((panelId) => {
                componentEntries.push([panelId, createStalePanePlaceholder(panelId)]);
            });

            return Object.fromEntries(componentEntries) as Record<string, React.FunctionComponent<IPaneviewPanelProps>>;
        },
        [visibleLeftPanels, panelRenderContext],
    );

    const rightPaneComponents = useMemo(
        () => {
            const componentEntries = rightPanels.map((panel) => [
                panel.id,
                (() => (
                    // tabIndex={-1} 使面板容器可聚焦，点击空白区域触发 focusin
                    <div
                        className="pane-panel-content"
                        {...{ [PANEL_ID_DATA_ATTR]: panel.id }}
                        tabIndex={-1}
                        style={{ outline: "none" }}
                    >
                        {panel.render({
                            ...panelRenderContext,
                            hostPanelId: panel.id,
                            convertibleView: (() => {
                                const descriptor = convertibleByPanelId.get(panel.id);
                                if (!descriptor) {
                                    return null;
                                }

                                const runtime = getConvertibleRuntimeState(descriptor.id);
                                return {
                                    descriptorId: descriptor.id,
                                    mode: "panel" as const,
                                    panelId: panel.id,
                                    stateKey: runtime?.stateKey
                                        ?? descriptor.getInitialStateKey?.()
                                        ?? descriptor.id,
                                    sourceParams: runtime?.sourceParams,
                                    sourceTabId: runtime?.sourceTabId,
                                } satisfies ConvertiblePanelRenderState;
                            })(),
                        })}
                    </div>
                )) as React.FunctionComponent<IPaneviewPanelProps>,
            ] as const);

            const stalePanelIds = rightPaneApiRef.current?.panels
                .map((panel) => panel.id)
                .filter((panelId) => !rightPanels.some((panel) => panel.id === panelId))
                ?? [];

            stalePanelIds.forEach((panelId) => {
                componentEntries.push([panelId, createStalePanePlaceholder(panelId)]);
            });

            return Object.fromEntries(componentEntries) as Record<string, React.FunctionComponent<IPaneviewPanelProps>>;
        },
        [rightPanels, panelRenderContext],
    );

    /**
     * 活动栏项点击处理：活动栏始终控制左侧栏。
     *
     * 设计思路：活动栏是左侧栏的入口，点击行为始终围绕左侧栏展开：
     * - 点击当前激活的 activity → 折叠/展开左侧栏（toggle）
     * - 点击不同的 activity → 切换到该 activity 并展开左侧栏
    * - callback activity 直接执行 onActivate，且不会被视为侧栏容器。
     * - 即使该 activity 下的面板已被拖到右侧，点击仍展开左侧栏（空容器可接受拖入）。
     *
     * @param activityId 被点击的活动项 ID。
     */
    const handleActivityItemClick = (activityId: string): void => {
        const activityDescriptor = activityDescriptorById.get(activityId);
        if (activityDescriptor?.type === "callback") {
            activityDescriptor.onActivate(panelRenderContext);
            return;
        }

        const panel = panels.find((candidate) => activityIdOf(candidate) === activityId);

        if (activityId === activeActivityId) {
            /* 再次点击当前活动项 → toggle 左侧栏可见性 */
            setIsLeftSidebarVisible((prev) => !prev);
            return;
        }

        setActiveActivityId(activityId);
        setIsLeftSidebarVisible(true);
        setActivePanelId(() => {
            const candidatePanels = leftPanels.filter((item) => activityIdOf(item) === activityId);
            if (candidatePanels.length === 0) {
                return panel?.id ?? null;
            }

            const rememberedPanelId = lastActiveLeftPanelByActivityRef.current.get(activityId);
            if (rememberedPanelId && candidatePanels.some((item) => item.id === rememberedPanelId)) {
                return rememberedPanelId;
            }

            return candidatePanels[0]?.id ?? panel?.id ?? null;
        });
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
        if (item.id.startsWith(CUSTOM_ACTIVITY_REGISTRATION_PREFIX)) {
            menuItems.push({ id: "delete-custom-activity", text: t("dockview.activityDeleteCustom") });
        }
        menuItems.push({ id: "create-custom-activity", text: t("dockview.activityCreateCustom") });

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
        } else if (selectedId === "delete-custom-activity") {
            const configId = item.id.slice(CUSTOM_ACTIVITY_REGISTRATION_PREFIX.length);
            const deletedActivityId = item.id;
            const deletedPanelId = `custom-panel:${configId}`;
            const nextLeftActivityId = leftPanelActivityItems.find((candidate) => candidate.id !== deletedActivityId)?.id ?? null;
            const nextRightActivityId = rightBarItems.find((candidate) => {
                if (candidate.id === deletedActivityId || candidate.isSettings) {
                    return false;
                }

                const activityDescriptor = activityDescriptorById.get(candidate.id);
                if (activityDescriptor?.type === "callback") {
                    return false;
                }

                return activityIdsWithSidebarContainer.has(candidate.id);
            })?.id ?? null;

            updateActivityBarConfig({
                items: mergedActivityItems
                    .filter((candidate) => candidate.id !== deletedActivityId)
                    .map((candidate) => ({
                        id: candidate.id,
                        section: candidate.section,
                        visible: candidate.visible,
                        bar: candidate.bar,
                    })),
            });
            setPanelStates((prev) => removeActivityReferencesFromPanelStates(
                prev,
                panels,
                deletedActivityId,
                deletedPanelId,
            ));
            setActiveActivityId((current) => current === deletedActivityId ? nextLeftActivityId : current);
            setActiveRightActivityId((current) => current === deletedActivityId ? nextRightActivityId : current);
            setActivePanelId((current) => current === deletedPanelId ? null : current);
            lastActiveLeftPanelByActivityRef.current.delete(deletedActivityId);
            paneSizeStateRef.current.delete(deletedPanelId);
            paneExpandedStateRef.current.delete(deletedPanelId);

            await removeCustomActivityFromVaultConfig(configId);
            console.info("[activity-bar] custom activity deleted", { itemId: item.id, configId });
        } else if (selectedId === "create-custom-activity") {
            executeCommand(CUSTOM_ACTIVITY_CREATE_COMMAND_ID, buildCommandContext());
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

        const menuItems: NativeContextMenuItem[] = mergedActivityItems.map((item) => ({
            id: item.id,
            text: item.title,
            checked: item.visible,
        }));
        menuItems.unshift({
            id: "create-custom-activity",
            text: t("dockview.activityCreateCustom"),
        });

        const selectedId = await showNativeContextMenu(menuItems);
        if (!selectedId) {
            return;
        }

        if (selectedId === "create-custom-activity") {
            executeCommand(CUSTOM_ACTIVITY_CREATE_COMMAND_ID, buildCommandContext());
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

        const activityDescriptor = activityDescriptorById.get(item.id);
        if (activityDescriptor?.type === "callback") {
            activityDescriptor.onActivate(panelRenderContext);
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

        /* 如果 item 有真实 panel container，将关联面板移到右侧 */
        if (!item.isSettings) {
            const hasPanelContainer = activityIdsWithSidebarContainer.has(itemId);

            if (hasPanelContainer) {
                setPanelStates((prev) =>
                    prev.map((ps) => {
                        const pd = panelById.get(ps.id);
                        if (pd && activityIdOf(pd) === itemId) {
                            return { ...ps, position: "right" as PanelPosition };
                        }
                        return ps;
                    }),
                );

                /* callback-only 活动不产生侧边栏面板，故不设为 activeRightActivityId */
                setActiveRightActivityId(itemId);
                setIsRightSidebarVisible(true);
            }
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
                const hasPanelContainer = activityIdsWithSidebarContainer.has(itemId);

                if (hasPanelContainer) {
                    setPanelStates((prev) =>
                        prev.map((ps) => {
                            const pd = panelById.get(ps.id);
                            if (pd && activityIdOf(pd) === itemId) {
                                return { ...ps, position: "left" as PanelPosition };
                            }
                            return ps;
                        }),
                    );

                    /* callback-only 活动不产生侧边栏面板，故不设为 activeActivityId */
                    setActiveActivityId(itemId);
                    setIsLeftSidebarVisible(true);
                }
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
        if (paneData && panelById.has(paneData.paneId)) {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            setIsEmptyRightSidebarDragOver(true);
            return;
        }

        const dockviewTransfer = getPanelData();
        if (!dockviewTransfer || !dockviewTransfer.panelId) {
            return;
        }

        const sourceDockPanel = dockviewApiRef.current?.getPanel(dockviewTransfer.panelId);
        if (!sourceDockPanel || !convertibleByTabComponentId.has(sourceDockPanel.view.contentComponent)) {
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

        if (convertDockviewTabToPanel({
            targetPosition: "right",
            emptyTarget: true,
        })) {
            return;
        }

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
        leftPaneLayoutDisposeRef.current?.dispose();
        leftUnhandledDragDisposeRef.current = api.onUnhandledDragOverEvent((dragEvent) => {
            handleUnhandledDragOver(api, dragEvent);
        });
        leftPaneLayoutDisposeRef.current = api.onDidLayoutChange(() => {
            capturePaneLayout(api);
        });

        syncPanePanels(api, visibleLeftPanels, expandedLeftPanelId);
        capturePaneLayout(api);
    };

    const handleRightPaneReady = (event: PaneviewReadyEvent): void => {
        const api = event.api;
        rightPaneApiRef.current = api;

        rightUnhandledDragDisposeRef.current?.dispose();
        rightPaneLayoutDisposeRef.current?.dispose();
        rightUnhandledDragDisposeRef.current = api.onUnhandledDragOverEvent((dragEvent) => {
            handleUnhandledDragOver(api, dragEvent);
        });
        rightPaneLayoutDisposeRef.current = api.onDidLayoutChange(() => {
            capturePaneLayout(api);
        });

        syncPanePanels(api, visibleRightPanels, null);
        capturePaneLayout(api);
    };

    useEffect(
        () => () => {
            leftPaneLayoutDisposeRef.current?.dispose();
            rightPaneLayoutDisposeRef.current?.dispose();
            leftUnhandledDragDisposeRef.current?.dispose();
            rightUnhandledDragDisposeRef.current?.dispose();
            dockUnhandledDragDisposeRef.current?.dispose();
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

        dockUnhandledDragDisposeRef.current?.dispose();
        dockUnhandledDragDisposeRef.current = api.onUnhandledDragOverEvent((dragEvent) => {
            handleDockviewUnhandledDragOver(dragEvent);
        });

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

        const normalizedInitialTabs = initialTabs.map((tab) => decorateTabInstanceWithLifecycle(tab));

        normalizedInitialTabs.forEach((tab) => {
            api.addPanel({
                id: tab.id,
                title: tab.title,
                component: tab.component,
                params: tab.params,
            });
        });

        setActiveTabId(normalizedInitialTabs[0]?.id ?? null);
        syncActiveEditorFromPanel(normalizedInitialTabs[0]?.id ?? null, normalizedInitialTabs[0]?.params);
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
                        <div
                            className={`sidebar-paneview-drop-surface${isCollapsedLeftSidebarDragOver ? " drag-over" : ""}`}
                            data-testid="left-sidebar-collapsed-drop-surface"
                            onDragOver={(e) => {
                                handleCollapsedSidebarSurfaceDragOver("left", e);
                            }}
                            onDragLeave={(e) => {
                                handleCollapsedSidebarSurfaceDragLeave("left", e);
                            }}
                            onDrop={(e) => {
                                handleCollapsedSidebarSurfaceDrop("left", e);
                            }}
                        >
                            <PaneviewReact
                                className="dockview-theme-abyss sidebar-paneview-container"
                                components={leftPaneComponents}
                                onReady={handleLeftPaneReady}
                                onDidDrop={(event) => {
                                    handleCrossContainerDrop("left", event);
                                }}
                            />
                        </div>
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
                        onDidDrop={(event) => {
                            void convertPanePanelToTab(event);
                        }}
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
                        <div
                            className={`sidebar-paneview-drop-surface${isCollapsedRightSidebarDragOver ? " drag-over" : ""}`}
                            data-testid="right-sidebar-collapsed-drop-surface"
                            onDragOver={(e) => {
                                handleCollapsedSidebarSurfaceDragOver("right", e);
                            }}
                            onDragLeave={(e) => {
                                handleCollapsedSidebarSurfaceDragLeave("right", e);
                            }}
                            onDrop={(e) => {
                                handleCollapsedSidebarSurfaceDrop("right", e);
                            }}
                        >
                            <PaneviewReact
                                className="dockview-theme-abyss sidebar-paneview-container"
                                components={rightPaneComponents}
                                onReady={handleRightPaneReady}
                                onDidDrop={(event) => {
                                    handleCrossContainerDrop("right", event);
                                }}
                            />
                        </div>
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
