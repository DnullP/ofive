/**
 * @module host/layout/sidebarLayoutPersistence
 * @description 侧边栏工作区持久化模型与辅助函数。
 *   该模块只负责侧边栏布局的序列化/反序列化，不涉及主区 tab 会话。
 *
 * @dependencies
 *   - ../../api/vaultApi
 *   - ./layoutStateReducers
 *   - layout-v2
 *
 * @example
 *   const snapshot = getSidebarLayoutFromVaultConfig(config);
 *   const restored = restorePanelStatesFromSidebarLayout(panels, snapshot);
 *   await saveSidebarLayoutSnapshot(snapshot);
 */

import type { VaultConfig } from "../../api/vaultApi";
import type { PanelDefinitionInfo, PanelPosition, PanelRuntimeState } from "./layoutStateReducers";
import type {
    SectionNode,
    WorkbenchPanelLayoutSnapshot,
    WorkbenchPanelSectionLayoutSnapshot,
    WorkbenchSectionData,
    WorkbenchSectionRole,
} from "layout-v2";

/** 侧边栏布局配置键。 */
export const SIDEBAR_LAYOUT_CONFIG_KEY = "sidebarLayout";

/**
 * @interface SidebarRailLayoutSnapshot
 * @description 单侧边栏容器级持久化状态。
 */
export interface SidebarRailLayoutSnapshot {
    /** 当前侧栏宽度。 */
    width: number;
    /** 当前侧栏是否可见。 */
    visible: boolean;
    /** 当前激活的 activity。 */
    activeActivityId: string | null;
    /** 左侧当前激活 pane，对右侧可为 null。 */
    activePanelId: string | null;
}

/**
 * @interface SidebarPaneLayoutSnapshot
 * @description 单个 pane 的尺寸与展开态快照。
 */
export interface SidebarPaneLayoutSnapshot {
    /** pane id。 */
    id: string;
    /** pane 主轴尺寸。 */
    size?: number;
    /** pane 是否展开。 */
    expanded?: boolean;
}

/**
 * @interface SidebarConvertibleViewSnapshot
 * @description 需要在侧边栏工作区中恢复的可转化视图运行时状态。
 */
export interface SidebarConvertibleViewSnapshot {
    /** 描述符 id。 */
    descriptorId: string;
    /** 共享状态键。 */
    stateKey: string;
    /** 从 tab 转入 panel 时保留的参数。 */
    sourceParams?: Record<string, unknown>;
}

/**
 * @interface SidebarLayoutSnapshot
 * @description 完整侧边栏工作区快照。
 */
export interface SidebarLayoutSnapshot {
    /** 版本号，便于后续迁移。 */
    version: 1;
    /** 左侧栏状态。 */
    left: SidebarRailLayoutSnapshot;
    /** 右侧栏状态。 */
    right: SidebarRailLayoutSnapshot;
    /** 全量 panel 运行时归属状态。 */
    panelStates: PanelRuntimeState[];
    /** 已知 pane 的尺寸与展开态。 */
    paneStates: SidebarPaneLayoutSnapshot[];
    /** 需在启动后恢复为 panel 模式的可转化视图。 */
    convertiblePanelStates: SidebarConvertibleViewSnapshot[];
    /** section 分割比例（sectionId → ratio），用于恢复拖拽后的尺寸。 */
    sectionRatios?: Record<string, number>;
    /** panel icon split 拓扑快照，用于恢复动态 panel section。 */
    panelLayout?: WorkbenchPanelLayoutSnapshot;
}

/**
 * @function toSafeObject
 * @description 将 unknown 收窄为普通对象。
 * @param value 原始值。
 * @returns 普通对象或 null。
 */
function toSafeObject(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return null;
    }
    return value as Record<string, unknown>;
}

/**
 * @function normalizeRailSnapshot
 * @description 规范化单侧边栏快照。
 * @param value 原始对象。
 * @param fallbackWidth 默认宽度。
 * @returns 规范化结果。
 */
function normalizeRailSnapshot(
    value: unknown,
    fallbackWidth: number,
): SidebarRailLayoutSnapshot {
    const rail = toSafeObject(value);
    const width = typeof rail?.width === "number" && Number.isFinite(rail.width)
        ? rail.width
        : fallbackWidth;
    const visible = typeof rail?.visible === "boolean" ? rail.visible : true;
    const activeActivityId = typeof rail?.activeActivityId === "string"
        ? rail.activeActivityId
        : null;
    const activePanelId = typeof rail?.activePanelId === "string"
        ? rail.activePanelId
        : null;

    return {
        width,
        visible,
        activeActivityId,
        activePanelId,
    };
}

/**
 * @function normalizePanelState
 * @description 规范化单个 panel 运行时状态。
 * @param value 原始对象。
 * @returns 规范化结果或 null。
 */
function normalizePanelState(value: unknown): PanelRuntimeState | null {
    const item = toSafeObject(value);
    if (!item) {
        return null;
    }

    const id = typeof item.id === "string" ? item.id.trim() : "";
    const position: PanelPosition = item.position === "right" ? "right" : "left";
    const order = typeof item.order === "number" && Number.isFinite(item.order)
        ? item.order
        : null;
    const activityId = typeof item.activityId === "string" ? item.activityId.trim() : "";

    if (!id || order === null || !activityId) {
        return null;
    }

    return {
        id,
        position,
        order,
        activityId,
    };
}

/**
 * @function normalizePaneState
 * @description 规范化单个 pane 尺寸状态。
 * @param value 原始对象。
 * @returns 规范化结果或 null。
 */
function normalizePaneState(value: unknown): SidebarPaneLayoutSnapshot | null {
    const item = toSafeObject(value);
    if (!item) {
        return null;
    }

    const id = typeof item.id === "string" ? item.id.trim() : "";
    if (!id) {
        return null;
    }

    const size = typeof item.size === "number" && Number.isFinite(item.size)
        ? item.size
        : undefined;
    const expanded = typeof item.expanded === "boolean" ? item.expanded : undefined;

    return {
        id,
        size,
        expanded,
    };
}

/**
 * @function normalizeConvertiblePanelState
 * @description 规范化单个可转化 panel 状态。
 * @param value 原始对象。
 * @returns 规范化结果或 null。
 */
function normalizeConvertiblePanelState(value: unknown): SidebarConvertibleViewSnapshot | null {
    const item = toSafeObject(value);
    if (!item) {
        return null;
    }

    const descriptorId = typeof item.descriptorId === "string" ? item.descriptorId.trim() : "";
    const stateKey = typeof item.stateKey === "string" ? item.stateKey.trim() : "";
    const sourceParams = toSafeObject(item.sourceParams) ?? undefined;

    if (!descriptorId || !stateKey) {
        return null;
    }

    return {
        descriptorId,
        stateKey,
        sourceParams,
    };
}

/**
 * @function normalizeWorkbenchSectionRole
 * @description 规范化持久化 section role，非法值回退为 container 以避免恢复崩溃。
 * @param value 原始 role。
 * @returns 合法 role。
 */
function normalizeWorkbenchSectionRole(value: unknown): WorkbenchSectionRole {
    if (value === "root" || value === "container" || value === "activity-bar" || value === "sidebar" || value === "main") {
        return value;
    }
    return "container";
}

/**
 * @function normalizeSectionResizableEdges
 * @description 规范化 section 可 resize 边信息。
 * @param value 原始边信息。
 * @returns 完整边信息。
 */
function normalizeSectionResizableEdges(value: unknown): SectionNode<WorkbenchSectionData>["resizableEdges"] {
    const edges = toSafeObject(value);
    return {
        top: typeof edges?.top === "boolean" ? edges.top : true,
        right: typeof edges?.right === "boolean" ? edges.right : true,
        bottom: typeof edges?.bottom === "boolean" ? edges.bottom : true,
        left: typeof edges?.left === "boolean" ? edges.left : true,
    };
}

/**
 * @function normalizePanelLayoutSectionNode
 * @description 递归规范化 panel layout section tree，非法节点返回 null。
 * @param value 原始 section tree 节点。
 * @returns 可交给 layout-v2 恢复的 section tree 节点。
 */
function normalizePanelLayoutSectionNode(value: unknown): SectionNode<WorkbenchSectionData> | null {
    const node = toSafeObject(value);
    const data = toSafeObject(node?.data);
    const component = toSafeObject(data?.component);
    if (!node || !data || !component) {
        return null;
    }

    const id = typeof node.id === "string" ? node.id.trim() : "";
    const title = typeof node.title === "string" ? node.title : id;
    const componentType = typeof component.type === "string" ? component.type.trim() : "";
    if (!id || !componentType) {
        return null;
    }

    const splitRaw = node.split;
    let split: SectionNode<WorkbenchSectionData>["split"] = null;
    if (splitRaw !== null && splitRaw !== undefined) {
        const splitObject = toSafeObject(splitRaw);
        const children = Array.isArray(splitObject?.children) ? splitObject.children : [];
        const first = normalizePanelLayoutSectionNode(children[0]);
        const second = normalizePanelLayoutSectionNode(children[1]);
        const direction = splitObject?.direction === "vertical" ? "vertical" : "horizontal";
        const ratio = typeof splitObject?.ratio === "number" && Number.isFinite(splitObject.ratio)
            ? splitObject.ratio
            : 0.5;

        if (!first || !second) {
            return null;
        }

        split = {
            direction,
            ratio,
            children: [first, second],
        };
    }

    return {
        id,
        title,
        data: {
            role: normalizeWorkbenchSectionRole(data.role),
            component: {
                type: componentType,
                props: toSafeObject(component.props) ?? {},
            } as WorkbenchSectionData["component"],
        },
        resizableEdges: normalizeSectionResizableEdges(node.resizableEdges),
        meta: toSafeObject(node.meta) ?? undefined,
        split,
    };
}

/**
 * @function normalizePanelSectionLayoutSnapshot
 * @description 规范化单个 panel section 持久化快照。
 * @param value 原始 section 快照。
 * @returns 合法快照；非法时返回 null。
 */
function normalizePanelSectionLayoutSnapshot(
    value: unknown,
): WorkbenchPanelSectionLayoutSnapshot | null {
    const item = toSafeObject(value);
    if (!item) {
        return null;
    }

    const id = typeof item.id === "string" ? item.id.trim() : "";
    if (!id) {
        return null;
    }

    const panelIds = Array.isArray(item.panelIds)
        ? item.panelIds.filter((panelId): panelId is string => typeof panelId === "string" && panelId.trim().length > 0)
        : [];
    const focusedPanelId = typeof item.focusedPanelId === "string" ? item.focusedPanelId : null;

    return {
        id,
        panelIds,
        focusedPanelId,
        isCollapsed: typeof item.isCollapsed === "boolean" ? item.isCollapsed : false,
        isRoot: typeof item.isRoot === "boolean" ? item.isRoot : undefined,
    };
}

/**
 * @function normalizePanelLayoutSnapshot
 * @description 规范化 panel icon split 拓扑快照。
 * @param value 原始 panel layout 快照。
 * @returns 合法快照；不存在或非法时返回 undefined。
 */
function normalizePanelLayoutSnapshot(value: unknown): WorkbenchPanelLayoutSnapshot | undefined {
    const item = toSafeObject(value);
    if (!item) {
        return undefined;
    }

    const root = normalizePanelLayoutSectionNode(item.root);
    const sections = Array.isArray(item.sections)
        ? item.sections
              .map((section) => normalizePanelSectionLayoutSnapshot(section))
              .filter((section): section is WorkbenchPanelSectionLayoutSnapshot => section !== null)
        : [];

    if (!root || sections.length === 0) {
        return undefined;
    }

    return { root, sections };
}

/**
 * @function parseSidebarLayoutConfig
 * @description 从 VaultConfig.entries 解析侧边栏工作区快照。
 * @param entries 仓库配置 entries。
 * @returns 解析结果；不存在或非法时返回 null。
 */
export function parseSidebarLayoutConfig(entries: Record<string, unknown>): SidebarLayoutSnapshot | null {
    const root = toSafeObject(entries[SIDEBAR_LAYOUT_CONFIG_KEY]);
    if (!root) {
        return null;
    }

    const panelStatesRaw = Array.isArray(root.panelStates) ? root.panelStates : [];
    const paneStatesRaw = Array.isArray(root.paneStates) ? root.paneStates : [];
    const convertiblePanelStatesRaw = Array.isArray(root.convertiblePanelStates)
        ? root.convertiblePanelStates
        : [];
    const panelStates = panelStatesRaw
        .map((item) => normalizePanelState(item))
        .filter((item): item is PanelRuntimeState => item !== null);
    const paneStates = paneStatesRaw
        .map((item) => normalizePaneState(item))
        .filter((item): item is SidebarPaneLayoutSnapshot => item !== null);
    const convertiblePanelStates = convertiblePanelStatesRaw
        .map((item) => normalizeConvertiblePanelState(item))
        .filter((item): item is SidebarConvertibleViewSnapshot => item !== null);

    const sectionRatiosRaw = toSafeObject(root.sectionRatios);
    const sectionRatios: Record<string, number> | undefined = sectionRatiosRaw
        ? Object.fromEntries(
              Object.entries(sectionRatiosRaw).filter(
                  ([, v]) => typeof v === "number" && Number.isFinite(v),
              ),
          ) as Record<string, number>
        : undefined;
    const panelLayout = normalizePanelLayoutSnapshot(root.panelLayout);

    return {
        version: 1,
        left: normalizeRailSnapshot(root.left, 280),
        right: normalizeRailSnapshot(root.right, 260),
        panelStates,
        paneStates,
        convertiblePanelStates,
        sectionRatios: sectionRatios && Object.keys(sectionRatios).length > 0 ? sectionRatios : undefined,
        panelLayout,
    };
}

/**
 * @function getSidebarLayoutFromVaultConfig
 * @description 从完整仓库配置中读取侧边栏工作区快照。
 * @param config 仓库配置。
 * @returns 快照；不存在时返回 null。
 */
export function getSidebarLayoutFromVaultConfig(config: VaultConfig | null): SidebarLayoutSnapshot | null {
    if (!config) {
        return null;
    }
    return parseSidebarLayoutConfig(config.entries);
}

/**
 * @function buildSidebarLayoutConfigValue
 * @description 将快照转换为可写入 VaultConfig.entries 的普通对象。
 * @param snapshot 侧边栏工作区快照。
 * @returns 可序列化对象。
 */
export function buildSidebarLayoutConfigValue(
    snapshot: SidebarLayoutSnapshot,
): Record<string, unknown> {
    return {
        version: snapshot.version,
        left: { ...snapshot.left },
        right: { ...snapshot.right },
        panelStates: snapshot.panelStates.map((item) => ({ ...item })),
        paneStates: snapshot.paneStates.map((item) => ({ ...item })),
        convertiblePanelStates: snapshot.convertiblePanelStates.map((item) => ({
            ...item,
            sourceParams: item.sourceParams ? { ...item.sourceParams } : undefined,
        })),
        sectionRatios: snapshot.sectionRatios ? { ...snapshot.sectionRatios } : undefined,
        panelLayout: snapshot.panelLayout,
    };
}

/**
 * @function restorePanelStatesFromSidebarLayout
 * @description 用持久化快照覆盖当前可注册 panel 的默认运行时状态。
 * @param panels 当前已注册 panel 定义。
 * @param snapshot 侧边栏快照。
 * @returns 恢复后的 panelStates。
 */
export function restorePanelStatesFromSidebarLayout(
    panels: PanelDefinitionInfo[],
    snapshot: SidebarLayoutSnapshot | null,
): PanelRuntimeState[] {
    const persistedById = new Map(snapshot?.panelStates.map((item) => [item.id, item]) ?? []);

    return panels.map((panel, index) => {
        const persisted = persistedById.get(panel.id);
        if (persisted) {
            return persisted;
        }

        return {
            id: panel.id,
            position: panel.position ?? "left",
            order: panel.order ?? index,
            activityId: panel.activityId ?? panel.id,
        };
    });
}

/**
 * @function mergePanelStatesWithSidebarLayoutFallback
 * @description 在新增/注销 panel 定义后，优先保留当前运行时状态，缺失项回退到持久化快照。
 * @param prev 当前运行时状态。
 * @param panels 当前已注册 panel 定义。
 * @param snapshot 侧边栏快照。
 * @returns 合并后的 panelStates。
 */
export function mergePanelStatesWithSidebarLayoutFallback(
    prev: PanelRuntimeState[],
    panels: PanelDefinitionInfo[],
    snapshot: SidebarLayoutSnapshot | null,
): PanelRuntimeState[] {
    const prevById = new Map(prev.map((item) => [item.id, item]));
    const persistedById = new Map(snapshot?.panelStates.map((item) => [item.id, item]) ?? []);

    return panels.map((panel, index) => {
        const existing = prevById.get(panel.id);
        if (existing) {
            return existing;
        }

        const persisted = persistedById.get(panel.id);
        if (persisted) {
            return persisted;
        }

        return {
            id: panel.id,
            position: panel.position ?? "left",
            order: panel.order ?? index,
            activityId: panel.activityId ?? panel.id,
        };
    });
}

/**
 * @function saveSidebarLayoutSnapshot
 * @description 将侧边栏工作区快照保存到后端配置。
 * @param snapshot 侧边栏工作区快照。
 * @returns 保存后的配置。
 */
export async function saveSidebarLayoutSnapshot(snapshot: SidebarLayoutSnapshot): Promise<VaultConfig> {
    const { updateBackendConfig } = await import("../config/configStore");

    return updateBackendConfig((currentConfig) => ({
        ...currentConfig,
        entries: {
            ...currentConfig.entries,
            [SIDEBAR_LAYOUT_CONFIG_KEY]: buildSidebarLayoutConfigValue(snapshot),
        },
    }), {
        logLabel: "sidebar-layout.save",
    });
}