/**
 * @module host/settings/settingsRegistry
 * @description 设置注册中心：支持模块按“选栏 + 设置项渲染器”注册设置能力。
 * @dependencies
 *  - react
 *
 * @example
 *   registerSettingsSection({ id: "graph", title: "知识图谱", order: 40, render: () => <GraphSettingsSection /> })
 *
 * @exports
 *  - registerSettingsSection
 *  - getSettingsSectionsSnapshot
 *  - useSettingsSections
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
    /** 选栏渲染器 */
    render: () => ReactNode;
}

const sectionsMap = new Map<string, SettingsSectionRegistration>();
const listeners = new Set<() => void>();
let cachedSectionsSnapshot: SettingsSectionRegistration[] = [];

/**
 * @function emit
 * @description 广播注册表变化。
 */
function emit(): void {
    cachedSectionsSnapshot = sortSections(Array.from(sectionsMap.values()));
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
 * @function getSettingsSectionsSnapshot
 * @description 获取设置选栏快照。
 * @returns 已排序的设置选栏列表。
 */
export function getSettingsSectionsSnapshot(): SettingsSectionRegistration[] {
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
export function useSettingsSections(): SettingsSectionRegistration[] {
    return useSyncExternalStore(
        (listener) => subscribeSettingsSections(listener),
        () => getSettingsSectionsSnapshot(),
        () => getSettingsSectionsSnapshot(),
    );
}
