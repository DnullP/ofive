/**
 * @module host/layout/workspaceLayoutPersistence
 * @description 主工作区布局持久化模型与辅助函数。
 *   该模块负责主编辑区 tab split、打开的 tab 和活跃 tab group 的序列化/反序列化。
 *
 * @dependencies
 *   - ../../api/vaultApi
 *   - layout-v2
 */

import type { VaultConfig } from "../../api/vaultApi";
import type {
    SectionNode,
    WorkbenchLayoutSnapshot,
    WorkbenchSectionData,
    WorkbenchSectionRole,
    WorkbenchTabDefinition,
    WorkbenchTabSectionLayoutSnapshot,
} from "layout-v2";

/** 主工作区布局配置键。 */
export const WORKSPACE_LAYOUT_CONFIG_KEY = "workspaceLayout";

type SafeRecord = Record<string, unknown>;

export type WorkspaceLayoutTabResolver = (
    tab: WorkbenchTabDefinition,
) => Promise<WorkbenchTabDefinition | null>;

function toSafeObject(value: unknown): SafeRecord | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return null;
    }
    return value as SafeRecord;
}

function sanitizeJsonValue(value: unknown, depth = 0): unknown {
    if (depth > 8) {
        return undefined;
    }

    if (value === null || typeof value === "string" || typeof value === "boolean") {
        return value;
    }

    if (typeof value === "number") {
        return Number.isFinite(value) ? value : undefined;
    }

    if (Array.isArray(value)) {
        return value
            .map((item) => sanitizeJsonValue(item, depth + 1))
            .filter((item) => item !== undefined);
    }

    const objectValue = toSafeObject(value);
    if (!objectValue) {
        return undefined;
    }

    const result: SafeRecord = {};
    for (const [key, item] of Object.entries(objectValue)) {
        const sanitized = sanitizeJsonValue(item, depth + 1);
        if (sanitized !== undefined) {
            result[key] = sanitized;
        }
    }
    return result;
}

function sanitizeParamsForStorage(params: unknown): SafeRecord | undefined {
    const sanitized = sanitizeJsonValue(params);
    const objectValue = toSafeObject(sanitized);
    if (!objectValue) {
        return undefined;
    }

    delete objectValue.content;
    delete objectValue.absolutePath;
    delete objectValue.autoFocus;
    delete objectValue.initialCursorOffset;

    return Object.keys(objectValue).length > 0 ? objectValue : undefined;
}

function normalizeWorkbenchSectionRole(value: unknown): WorkbenchSectionRole {
    if (value === "root" || value === "container" || value === "activity-bar" || value === "sidebar" || value === "main") {
        return value;
    }
    return "container";
}

function normalizeSectionResizableEdges(value: unknown): SectionNode<WorkbenchSectionData>["resizableEdges"] {
    const edges = toSafeObject(value);
    return {
        top: typeof edges?.top === "boolean" ? edges.top : true,
        right: typeof edges?.right === "boolean" ? edges.right : true,
        bottom: typeof edges?.bottom === "boolean" ? edges.bottom : true,
        left: typeof edges?.left === "boolean" ? edges.left : true,
    };
}

function normalizeWorkspaceSectionNode(value: unknown): SectionNode<WorkbenchSectionData> | null {
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
        const first = normalizeWorkspaceSectionNode(children[0]);
        const second = normalizeWorkspaceSectionNode(children[1]);
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
                props: toSafeObject(sanitizeJsonValue(component.props)) ?? {},
            } as WorkbenchSectionData["component"],
        },
        resizableEdges: normalizeSectionResizableEdges(node.resizableEdges),
        meta: toSafeObject(sanitizeJsonValue(node.meta)) ?? undefined,
        split,
    };
}

function normalizeWorkspaceTab(value: unknown): WorkbenchTabDefinition | null {
    const item = toSafeObject(value);
    if (!item) {
        return null;
    }

    const id = typeof item.id === "string" ? item.id.trim() : "";
    const title = typeof item.title === "string" ? item.title : id;
    const component = typeof item.component === "string" ? item.component.trim() : "";
    if (!id || !component) {
        return null;
    }

    return {
        id,
        title,
        component,
        params: sanitizeParamsForStorage(item.params),
    };
}

function normalizeTabSection(value: unknown): WorkbenchTabSectionLayoutSnapshot | null {
    const item = toSafeObject(value);
    if (!item) {
        return null;
    }

    const id = typeof item.id === "string" ? item.id.trim() : "";
    if (!id) {
        return null;
    }

    const tabs = Array.isArray(item.tabs)
        ? item.tabs
              .map((tab) => normalizeWorkspaceTab(tab))
              .filter((tab): tab is WorkbenchTabDefinition => tab !== null)
        : [];
    const focusedTabId = typeof item.focusedTabId === "string" &&
        tabs.some((tab) => tab.id === item.focusedTabId)
        ? item.focusedTabId
        : (tabs[0]?.id ?? null);

    return {
        id,
        tabs,
        focusedTabId,
        isRoot: typeof item.isRoot === "boolean" ? item.isRoot : undefined,
    };
}

/**
 * @function parseWorkspaceLayoutConfig
 * @description 从 VaultConfig.entries 解析主工作区布局快照。
 * @param entries 仓库配置 entries。
 * @returns 解析结果；不存在或非法时返回 null。
 */
export function parseWorkspaceLayoutConfig(entries: Record<string, unknown>): WorkbenchLayoutSnapshot | null {
    const root = toSafeObject(entries[WORKSPACE_LAYOUT_CONFIG_KEY]);
    if (!root) {
        return null;
    }

    const sectionRoot = normalizeWorkspaceSectionNode(root.root);
    const tabSections = Array.isArray(root.tabSections)
        ? root.tabSections
              .map((section) => normalizeTabSection(section))
              .filter((section): section is WorkbenchTabSectionLayoutSnapshot => section !== null)
        : [];

    if (!sectionRoot || tabSections.length === 0) {
        return null;
    }

    return {
        version: 1,
        root: sectionRoot,
        tabSections,
        activeGroupId: typeof root.activeGroupId === "string" ? root.activeGroupId : null,
    };
}

/**
 * @function getWorkspaceLayoutFromVaultConfig
 * @description 从完整仓库配置中读取主工作区布局快照。
 * @param config 仓库配置。
 * @returns 快照；不存在时返回 null。
 */
export function getWorkspaceLayoutFromVaultConfig(config: VaultConfig | null): WorkbenchLayoutSnapshot | null {
    if (!config) {
        return null;
    }
    return parseWorkspaceLayoutConfig(config.entries);
}

/**
 * @function countWorkspaceLayoutTabs
 * @description 统计快照中的 tab 数量。
 * @param snapshot 工作区布局快照。
 * @returns tab 总数。
 */
export function countWorkspaceLayoutTabs(snapshot: WorkbenchLayoutSnapshot | null): number {
    return snapshot?.tabSections.reduce((sum, section) => sum + section.tabs.length, 0) ?? 0;
}

/**
 * @function buildWorkspaceLayoutConfigValue
 * @description 将快照转换为可写入 VaultConfig.entries 的普通对象。
 * @param snapshot 工作区布局快照。
 * @returns 可序列化对象。
 */
export function buildWorkspaceLayoutConfigValue(
    snapshot: WorkbenchLayoutSnapshot,
): Record<string, unknown> {
    const normalizedRoot = normalizeWorkspaceSectionNode(snapshot.root);
    const tabSections = snapshot.tabSections
        .map((section) => normalizeTabSection(section))
        .filter((section): section is WorkbenchTabSectionLayoutSnapshot => section !== null);

    return {
        version: 1,
        root: normalizedRoot ?? snapshot.root,
        tabSections,
        activeGroupId: typeof snapshot.activeGroupId === "string" ? snapshot.activeGroupId : null,
    };
}

/**
 * @function hydrateWorkspaceLayoutSnapshot
 * @description 重新解析快照中的文件 tab，使文件内容、绝对路径等运行时参数来自当前仓库。
 * @param snapshot 持久化快照。
 * @param resolveTab 单个 tab 的异步恢复器。
 * @returns 已恢复运行时参数的快照。
 */
export async function hydrateWorkspaceLayoutSnapshot(
    snapshot: WorkbenchLayoutSnapshot,
    resolveTab: WorkspaceLayoutTabResolver,
): Promise<WorkbenchLayoutSnapshot> {
    const tabSections = await Promise.all(snapshot.tabSections.map(async (section) => {
        const tabs = (
            await Promise.all(section.tabs.map((tab) => resolveTab(tab)))
        ).filter((tab): tab is WorkbenchTabDefinition => tab !== null);
        const focusedTabId = section.focusedTabId && tabs.some((tab) => tab.id === section.focusedTabId)
            ? section.focusedTabId
            : (tabs[0]?.id ?? null);

        return {
            ...section,
            tabs,
            focusedTabId,
        };
    }));

    return {
        ...snapshot,
        tabSections,
        activeGroupId: tabSections.some((section) => section.id === snapshot.activeGroupId)
            ? snapshot.activeGroupId
            : "main-tabs",
    };
}

/**
 * @function saveWorkspaceLayoutSnapshot
 * @description 将主工作区布局快照保存到后端配置。
 * @param snapshot 工作区布局快照。
 * @returns 保存后的配置。
 */
export async function saveWorkspaceLayoutSnapshot(snapshot: WorkbenchLayoutSnapshot): Promise<VaultConfig> {
    const { updateBackendConfig } = await import("../config/configStore");

    return updateBackendConfig((currentConfig) => ({
        ...currentConfig,
        entries: {
            ...currentConfig.entries,
            [WORKSPACE_LAYOUT_CONFIG_KEY]: buildWorkspaceLayoutConfigValue(snapshot),
        },
    }), {
        logLabel: "workspace-layout.save",
    });
}
