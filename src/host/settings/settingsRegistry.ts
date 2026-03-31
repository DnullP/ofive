/**
 * @module host/settings/settingsRegistry
 * @description 设置注册中心：支持模块按“分类 + 设置项”两级注册设置能力。
 * @dependencies
 *  - react
 *
 * @example
 *   registerSettingsSection({ id: "graph", title: "知识图谱", order: 40 })
 *   registerSettingsItem({
 *     id: "graph-enabled",
 *     sectionId: "graph",
 *     order: 10,
 *     kind: "toggle",
 *     title: "settings.enableKnowledgeGraph",
 *     description: "settings.enableKnowledgeGraphDesc",
 *     useValue: () => useConfigState().featureSettings.knowledgeGraphEnabled,
 *     updateValue: (nextValue) => updateFeatureSetting("knowledgeGraphEnabled", nextValue),
 *   })
 *
 * @exports
 *  - registerSettingsSection
 *  - registerSettingsItem
 *  - registerSettingsItems
 *  - getSettingsSectionsSnapshot
 *  - useSettingsSections
 *  - __resetSettingsRegistryForTests
 */

import { useSyncExternalStore, type ReactNode } from "react";

/**
 * @interface SettingsSectionRegistration
 * @description 设置选栏注册定义。
 */
export interface SettingsSectionRegistration {
    /** 选栏唯一标识 */
    id: string;
    /** 选栏标题 */
    title: string;
    /** 排序值，数值越小越靠前 */
    order: number;
    /** 选栏可选描述（可传入 i18n key） */
    description?: string;
    /** 选栏搜索关键词（用于设置页快速筛选） */
    searchTerms?: string[];
    /** 选栏自定义渲染器：适用于复杂表格或非标准设置块 */
    render?: () => ReactNode;
}

/**
 * @interface SettingsOptionRegistration
 * @description 选择类设置项的候选项定义。
 */
export interface SettingsOptionRegistration<TValue extends string | number> {
    /** 选项值 */
    value: TValue;
    /** 选项标题（i18n key 或普通文案） */
    label: string;
    /** 选项补充说明（i18n key 或普通文案） */
    description?: string;
}

/**
 * @interface SettingsItemRegistrationBase
 * @description 设置项注册公共字段。
 */
interface SettingsItemRegistrationBase {
    /** 设置项唯一标识（在 section 内唯一即可） */
    id: string;
    /** 归属设置分类 id */
    sectionId: string;
    /** 排序值，数值越小越靠前 */
    order: number;
    /** 设置项标题（i18n key 或普通文案） */
    title: string;
    /** 设置项说明（i18n key 或普通文案） */
    description?: string;
    /** 设置项搜索关键词 */
    searchTerms?: string[];
    /** 条件渲染：返回 false 时不显示该项，可在内部订阅 store hook */
    useIsVisible?: () => boolean;
}

/**
 * @interface ToggleSettingsItemRegistration
 * @description 布尔开关设置项。
 */
export interface ToggleSettingsItemRegistration extends SettingsItemRegistrationBase {
    kind: "toggle";
    useValue: () => boolean;
    updateValue: (nextValue: boolean) => void | Promise<void>;
    disabled?: boolean | (() => boolean);
}

/**
 * @interface NumberSettingsItemRegistration
 * @description 数值输入设置项。
 */
export interface NumberSettingsItemRegistration extends SettingsItemRegistrationBase {
    kind: "number";
    useValue: () => number;
    updateValue: (nextValue: number) => void | Promise<void>;
    min: number;
    max: number;
    step: number;
    suffix?: string;
    normalizeValue?: (raw: string, currentValue: number) => number;
    disabled?: boolean | (() => boolean);
}

/**
 * @interface SelectSettingsItemRegistration
 * @description 单选设置项，支持按钮组或下拉框展示。
 */
export interface SelectSettingsItemRegistration<TValue extends string | number = string>
    extends SettingsItemRegistrationBase {
    kind: "select";
    useValue: () => TValue;
    updateValue: (nextValue: TValue) => void | Promise<void>;
    options: ReadonlyArray<SettingsOptionRegistration<TValue>>;
    presentation?: "buttons" | "select";
    disabled?: boolean | (() => boolean);
}

/**
 * @interface CustomSettingsItemRegistration
 * @description 自定义设置项，适用于错误提示、复杂组合控件等无法归一化的场景。
 */
export interface CustomSettingsItemRegistration extends SettingsItemRegistrationBase {
    kind: "custom";
    render: () => ReactNode;
}

/**
 * @type SettingsItemRegistration
 * @description 设置项注册联合类型。
 */
export type SettingsItemRegistration =
    | ToggleSettingsItemRegistration
    | NumberSettingsItemRegistration
    | SelectSettingsItemRegistration
    | CustomSettingsItemRegistration;

/**
 * @interface SettingsSectionSnapshot
 * @description 供 UI 消费的设置分类快照，包含分类下已排序的设置项。
 */
export interface SettingsSectionSnapshot extends SettingsSectionRegistration {
    items: SettingsItemRegistration[];
}

const sectionsMap = new Map<string, SettingsSectionRegistration>();
const itemsMap = new Map<string, SettingsItemRegistration>();
const listeners = new Set<() => void>();
let cachedSectionsSnapshot: SettingsSectionSnapshot[] = [];

/**
 * @function buildSettingsItemKey
 * @description 生成设置项的稳定注册键。
 * @param sectionId 分类 id。
 * @param itemId 设置项 id。
 * @returns 全局唯一键。
 */
function buildSettingsItemKey(sectionId: string, itemId: string): string {
    return `${sectionId}:${itemId}`;
}

/**
 * @function emit
 * @description 广播注册表变化。
 */
function emit(): void {
    cachedSectionsSnapshot = buildSectionsSnapshot();
    listeners.forEach((listener) => listener());
}

/**
 * @function sortSections
 * @description 对设置选栏进行稳定排序。
 * @param sections 选栏数组。
 * @returns 排序后的选栏数组。
 */
function sortSections(sections: SettingsSectionRegistration[]): SettingsSectionRegistration[] {
    return [...sections].sort((left, right) => {
        if (left.order !== right.order) {
            return left.order - right.order;
        }
        return left.id.localeCompare(right.id);
    });
}

/**
 * @function sortItems
 * @description 对设置项进行稳定排序。
 * @param items 设置项数组。
 * @returns 排序后的设置项数组。
 */
function sortItems(items: SettingsItemRegistration[]): SettingsItemRegistration[] {
    return [...items].sort((left, right) => {
        if (left.order !== right.order) {
            return left.order - right.order;
        }

        return left.id.localeCompare(right.id);
    });
}

/**
 * @function buildSectionsSnapshot
 * @description 根据当前分类和设置项注册表构建 UI 快照。
 * @returns 已排序的分类快照列表。
 */
function buildSectionsSnapshot(): SettingsSectionSnapshot[] {
    const itemsBySectionId = new Map<string, SettingsItemRegistration[]>();

    itemsMap.forEach((item) => {
        const current = itemsBySectionId.get(item.sectionId) ?? [];
        current.push(item);
        itemsBySectionId.set(item.sectionId, current);
    });

    return sortSections(Array.from(sectionsMap.values())).map((section) => ({
        ...section,
        items: sortItems(itemsBySectionId.get(section.id) ?? []),
    }));
}

/**
 * @function registerSettingsSection
 * @description 注册设置选栏；若 id 已存在则覆盖更新。
 * @param section 注册定义。
 * @returns 取消注册函数。
 */
export function registerSettingsSection(section: SettingsSectionRegistration): () => void {
    sectionsMap.set(section.id, section);
    emit();

    return () => {
        if (!sectionsMap.has(section.id)) {
            return;
        }
        sectionsMap.delete(section.id);
        emit();
    };
}

/**
 * @function registerSettingsItem
 * @description 注册单个设置项；若同一 sectionId + id 已存在则覆盖更新。
 * @param item 设置项注册定义。
 * @returns 取消注册函数。
 */
export function registerSettingsItem(item: SettingsItemRegistration): () => void {
    const itemKey = buildSettingsItemKey(item.sectionId, item.id);
    itemsMap.set(itemKey, item);
    emit();

    return () => {
        if (!itemsMap.has(itemKey)) {
            return;
        }

        itemsMap.delete(itemKey);
        emit();
    };
}

/**
 * @function registerSettingsItems
 * @description 批量注册设置项。
 * @param items 设置项数组。
 * @returns 统一取消注册函数。
 */
export function registerSettingsItems(items: SettingsItemRegistration[]): () => void {
    const unregisters = items.map((item) => registerSettingsItem(item));

    return () => {
        unregisters.forEach((unregister) => unregister());
    };
}

/**
 * @function getSettingsSectionsSnapshot
 * @description 获取设置选栏快照。
 * @returns 已排序的设置选栏列表。
 */
export function getSettingsSectionsSnapshot(): SettingsSectionSnapshot[] {
    return cachedSectionsSnapshot;
}

/**
 * @function subscribeSettingsSections
 * @description 订阅设置选栏变化。
 * @param listener 监听函数。
 * @returns 取消订阅函数。
 */
export function subscribeSettingsSections(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/**
 * @function useSettingsSections
 * @description React Hook：订阅并返回当前设置选栏列表。
 * @returns 设置选栏快照。
 */
export function useSettingsSections(): SettingsSectionSnapshot[] {
    return useSyncExternalStore(
        (listener) => subscribeSettingsSections(listener),
        () => getSettingsSectionsSnapshot(),
        () => getSettingsSectionsSnapshot(),
    );
}

/**
 * @function __resetSettingsRegistryForTests
 * @description 仅供单元测试使用：清空当前 settings registry 状态。
 */
export function __resetSettingsRegistryForTests(): void {
    sectionsMap.clear();
    itemsMap.clear();
    cachedSectionsSnapshot = [];
    listeners.clear();
}
