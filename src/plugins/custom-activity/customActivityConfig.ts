/**
 * @module plugins/custom-activity/customActivityConfig
 * @description 自定义 activity 配置模型与持久化辅助函数。
 *   该模块将“静态注册”和“运行时新增”统一为同一套 activity contribution 语义：
 *   最终都转换为 registerActivity + 可选 registerPanel。
 *
 * @dependencies
 *   - ../../api/vaultApi
 *
 * @example
 *   const items = parseCustomActivitiesConfig(config.entries);
 *   await appendCustomActivityToVaultConfig(draft);
 *
 * @exports
 *   - CUSTOM_ACTIVITY_CONFIG_KEY
 *   - CustomActivityDefinition
 *   - CustomActivityIconKey
 *   - parseCustomActivitiesConfig
 *   - appendCustomActivityToVaultConfig
 *   - removeCustomActivityFromEntries
 *   - removeCustomActivityFromVaultConfig
 *   - createCustomActivityDefinition
 */

import type { VaultConfig } from "../../api/vaultApi";
import { getPanelsSnapshot } from "../../host/registry";
import {
    removeActivityReferencesFromPanelStates,
    type PanelDefinitionInfo,
} from "../../host/layout/layoutStateReducers";
import {
    buildSidebarLayoutConfigValue,
    parseSidebarLayoutConfig,
} from "../../host/layout/sidebarLayoutPersistence";
import type { CustomActivityIconKey } from "./iconCatalog";

/** 自定义 activity 配置存储键。 */
export const CUSTOM_ACTIVITY_CONFIG_KEY = "customActivities";

/** 自定义 activity 类型。 */
export type CustomActivityKind = "panel-container" | "callback";

/**
 * @interface CustomActivityDefinition
 * @description 单个自定义 activity 的持久化定义。
 */
export interface CustomActivityDefinition {
    /** 配置唯一 ID。 */
    id: string;
    /** UI 显示名称。 */
    name: string;
    /** 图标键名。 */
    iconKey: CustomActivityIconKey;
    /** activity 类型。 */
    kind: CustomActivityKind;
    /** callback 绑定的命令 ID。 */
    commandId?: string;
    /** 默认所在 activity bar。 */
    defaultBar: "left" | "right";
    /** 默认所在区域。 */
    defaultSection: "top" | "bottom";
    /** 默认顺序。 */
    defaultOrder: number;
    /** panel-container 对应的默认侧栏位置。 */
    panelPosition: "left" | "right";
}

/**
 * @interface CreateCustomActivityInput
 * @description 新建自定义 activity 所需输入。
 */
export interface CreateCustomActivityInput {
    /** UI 显示名称。 */
    name: string;
    /** 图标键名。 */
    iconKey: CustomActivityIconKey;
    /** activity 类型。 */
    kind: CustomActivityKind;
    /** callback 绑定的命令 ID。 */
    commandId?: string;
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
 * @function normalizeName
 * @description 规范化自定义 activity 名称。
 * @param name 原始名称。
 * @returns 去首尾空白后的名称。
 */
function normalizeName(name: string): string {
    return name.trim();
}

/**
 * @function toCustomActivityRegistrationId
 * @description 将自定义 activity 配置 id 转为运行时 activity 注册 id。
 * @param activityConfigId 自定义 activity 配置 id。
 * @returns activity 注册 id。
 */
function toCustomActivityRegistrationId(activityConfigId: string): string {
    return `custom-activity:${activityConfigId}`;
}

/**
 * @function toCustomPanelRegistrationId
 * @description 将自定义 activity 配置 id 转为运行时 panel 注册 id。
 * @param activityConfigId 自定义 activity 配置 id。
 * @returns panel 注册 id。
 */
function toCustomPanelRegistrationId(activityConfigId: string): string {
    return `custom-panel:${activityConfigId}`;
}

/**
 * @function slugifyName
 * @description 将名称转为安全 slug 片段。
 * @param name activity 名称。
 * @returns slug 结果。
 */
function slugifyName(name: string): string {
    return normalizeName(name)
        .toLowerCase()
        .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
        .replace(/^-+|-+$/g, "") || "activity";
}

/**
 * @function createCustomActivityDefinition
 * @description 根据 UI 输入构造规范化的持久化定义。
 * @param input 新建输入。
 * @param order 默认顺序值。
 * @returns 规范化定义。
 */
export function createCustomActivityDefinition(
    input: CreateCustomActivityInput,
    order: number,
): CustomActivityDefinition {
    const now = Date.now().toString(36);
    const normalizedName = normalizeName(input.name);
    return {
        id: `custom-${slugifyName(normalizedName)}-${now}`,
        name: normalizedName,
        iconKey: input.iconKey,
        kind: input.kind,
        commandId: input.kind === "callback" ? input.commandId?.trim() : undefined,
        defaultBar: "left",
        defaultSection: "top",
        defaultOrder: order,
        panelPosition: "left",
    };
}

/**
 * @function parseCustomActivitiesConfig
 * @description 从 VaultConfig.entries 中解析自定义 activity 列表。
 * @param entries 仓库配置 entries。
 * @returns 通过校验的 activity 定义列表。
 */
export function parseCustomActivitiesConfig(entries: Record<string, unknown>): CustomActivityDefinition[] {
    const root = toSafeObject(entries[CUSTOM_ACTIVITY_CONFIG_KEY]);
    const rawItems = root?.items;
    if (!Array.isArray(rawItems)) {
        return [];
    }

    const items: CustomActivityDefinition[] = [];
    for (const rawItem of rawItems) {
        const item = toSafeObject(rawItem);
        if (!item) {
            continue;
        }

        const id = typeof item.id === "string" ? item.id.trim() : "";
        const name = typeof item.name === "string" ? normalizeName(item.name) : "";
        const iconKey = typeof item.iconKey === "string" ? item.iconKey.trim() as CustomActivityIconKey : "" as CustomActivityIconKey;
        const kind = item.kind === "panel-container" || item.kind === "callback"
            ? item.kind
            : null;
        const commandId = typeof item.commandId === "string" ? item.commandId.trim() : undefined;
        const defaultBar = item.defaultBar === "right" ? "right" : "left";
        const defaultSection = item.defaultSection === "bottom" ? "bottom" : "top";
        const panelPosition = item.panelPosition === "right" ? "right" : "left";
        const defaultOrder = typeof item.defaultOrder === "number" && Number.isFinite(item.defaultOrder)
            ? item.defaultOrder
            : 1000 + items.length;

        if (!id || !name || !iconKey || !kind) {
            continue;
        }
        if (kind === "callback" && !commandId) {
            continue;
        }

        items.push({
            id,
            name,
            iconKey,
            kind,
            commandId,
            defaultBar,
            defaultSection,
            defaultOrder,
            panelPosition,
        });
    }

    return items;
}

/**
 * @function getCustomActivitiesFromVaultConfig
 * @description 从完整仓库配置中读取自定义 activity 列表。
 * @param config 仓库配置。
 * @returns 自定义 activity 列表。
 */
export function getCustomActivitiesFromVaultConfig(config: VaultConfig | null): CustomActivityDefinition[] {
    if (!config) {
        return [];
    }
    return parseCustomActivitiesConfig(config.entries);
}

/**
 * @function removeCustomActivityFromEntries
 * @description 从 entries.customActivities 中删除指定 id 的自定义 activity。
 * @param entries 原始配置 entries。
 * @param activityConfigId 自定义 activity 配置 id。
 * @returns 删除后的 entries 副本。
 */
export function removeCustomActivityFromEntries(
    entries: Record<string, unknown>,
    activityConfigId: string,
    panelDefinitions?: PanelDefinitionInfo[],
): Record<string, unknown> {
    const currentItems = parseCustomActivitiesConfig(entries);
    const nextItems = currentItems.filter((item) => item.id !== activityConfigId);
    const activityRegistrationId = toCustomActivityRegistrationId(activityConfigId);
    const panelRegistrationId = toCustomPanelRegistrationId(activityConfigId);
    const activePanels = panelDefinitions ?? getPanelsSnapshot().map((panel) => ({
        id: panel.id,
        activityId: panel.activityId,
        position: panel.defaultPosition,
        order: panel.defaultOrder,
    }));

    const sidebarLayoutSnapshot = parseSidebarLayoutConfig(entries);
    const nextSidebarLayout = sidebarLayoutSnapshot
        ? {
            ...sidebarLayoutSnapshot,
            left: {
                ...sidebarLayoutSnapshot.left,
                activeActivityId: sidebarLayoutSnapshot.left.activeActivityId === activityRegistrationId
                    ? null
                    : sidebarLayoutSnapshot.left.activeActivityId,
                activePanelId: sidebarLayoutSnapshot.left.activePanelId === panelRegistrationId
                    ? null
                    : sidebarLayoutSnapshot.left.activePanelId,
            },
            right: {
                ...sidebarLayoutSnapshot.right,
                activeActivityId: sidebarLayoutSnapshot.right.activeActivityId === activityRegistrationId
                    ? null
                    : sidebarLayoutSnapshot.right.activeActivityId,
                activePanelId: sidebarLayoutSnapshot.right.activePanelId === panelRegistrationId
                    ? null
                    : sidebarLayoutSnapshot.right.activePanelId,
            },
            panelStates: removeActivityReferencesFromPanelStates(
                sidebarLayoutSnapshot.panelStates,
                activePanels,
                activityRegistrationId,
                panelRegistrationId,
            ),
            paneStates: sidebarLayoutSnapshot.paneStates.filter((item) => item.id !== panelRegistrationId),
        }
        : null;

    const activityBarRoot = toSafeObject(entries.activityBar);
    const nextActivityBarItems = Array.isArray(activityBarRoot?.items)
        ? activityBarRoot.items.filter((item) => toSafeObject(item)?.id !== activityRegistrationId)
        : [];

    return {
        ...entries,
        [CUSTOM_ACTIVITY_CONFIG_KEY]: {
            items: nextItems,
        },
        activityBar: {
            items: nextActivityBarItems,
        },
        ...(nextSidebarLayout
            ? {
                sidebarLayout: buildSidebarLayoutConfigValue(nextSidebarLayout),
            }
            : {}),
    };
}

/**
 * @function appendCustomActivityToVaultConfig
 * @description 追加一条自定义 activity 到仓库配置并持久化。
 * @param nextItem 待保存的定义。
 * @returns 保存后的仓库配置。
 */
export async function appendCustomActivityToVaultConfig(nextItem: CustomActivityDefinition): Promise<VaultConfig> {
    const { updateBackendConfig } = await import("../../host/store/configStore");
    return updateBackendConfig((currentConfig) => {
        const currentItems = parseCustomActivitiesConfig(currentConfig.entries);
        return {
            ...currentConfig,
            entries: {
                ...currentConfig.entries,
                [CUSTOM_ACTIVITY_CONFIG_KEY]: {
                    items: [...currentItems, nextItem],
                },
            },
        };
    }, {
        logLabel: "custom-activity.append",
        fallbackErrorI18nKey: "customActivity.saveFailed",
    });
}

/**
 * @function removeCustomActivityFromVaultConfig
 * @description 从仓库配置中删除指定的自定义 activity。
 * @param activityConfigId 自定义 activity 配置 id。
 * @returns 保存后的仓库配置。
 */
export async function removeCustomActivityFromVaultConfig(activityConfigId: string): Promise<VaultConfig> {
    const { updateBackendConfig } = await import("../../host/store/configStore");
    return updateBackendConfig((currentConfig) => ({
        ...currentConfig,
        entries: removeCustomActivityFromEntries(currentConfig.entries, activityConfigId),
    }), {
        logLabel: "custom-activity.remove",
        fallbackErrorI18nKey: "customActivity.deleteFailed",
    });
}