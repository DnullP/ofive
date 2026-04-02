/**
 * @module host/layout/SettingsTab
 * @description 设置页 Tab：基于注册中心动态渲染“左侧选栏 + 右侧设置项”。
 * @dependencies
 *  - react
 *  - ../settings/settingsRegistry
 *  - ../settings/registerBuiltinSettings
 */

import { useDeferredValue, useEffect, useMemo, useState, type ReactNode } from "react";
import { Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ensureBuiltinSettingsRegistered } from "../settings/registerBuiltinSettings";
import { SettingsRegisteredSection } from "../settings/SettingsRegisteredSection";
import { useSettingsSections, type SettingsSectionSnapshot } from "../settings/settingsRegistry";
import "./SettingsTab.css";

ensureBuiltinSettingsRegistered();

/**
 * @function normalizeSettingsQuery
 * @description 归一化设置搜索词，便于大小写无关匹配。
 * @param value 原始输入值。
 * @returns 归一化后的搜索词。
 */
function normalizeSettingsQuery(value: string): string {
    return value.trim().toLocaleLowerCase();
}

/**
 * @function matchesSettingsSection
 * @description 判断设置分区是否命中当前搜索词。
 * @param section 设置分区注册定义。
 * @param normalizedQuery 归一化后的搜索词。
 * @param translate i18n 翻译函数。
 * @returns 是否命中。
 */
function matchesSettingsSection(
    section: SettingsSectionSnapshot,
    normalizedQuery: string,
    translate: (key: string) => string,
): boolean {
    if (normalizedQuery.length === 0) {
        return true;
    }

    const itemCandidates = section.items.flatMap((item) => [
        translate(item.title),
        item.description ? translate(item.description) : "",
        ...(item.searchTerms ?? []),
    ]);

    const candidates = [
        translate(section.title),
        section.description ? translate(section.description) : "",
        ...(section.searchTerms ?? []),
        ...itemCandidates,
    ];

    return candidates.some((candidate) => candidate.toLocaleLowerCase().includes(normalizedQuery));
}

/**
 * @function SettingsTab
 * @description 渲染设置页 Tab。
 * @returns React 节点。
 */
export function SettingsTab(): ReactNode {
    const { t } = useTranslation();
    const sections = useSettingsSections();
    const [activeSectionId, setActiveSectionId] = useState<string>("");
    const [searchQuery, setSearchQuery] = useState<string>("");
    const deferredSearchQuery = useDeferredValue(searchQuery);

    const visibleSections = useMemo(() => {
        const normalizedQuery = normalizeSettingsQuery(deferredSearchQuery);
        return sections.filter((section) => matchesSettingsSection(section, normalizedQuery, t));
    }, [deferredSearchQuery, sections, t]);

    const activeSection = useMemo(
        () => visibleSections.find((section) => section.id === activeSectionId) ?? visibleSections[0],
        [visibleSections, activeSectionId],
    );

    useEffect(() => {
        if (visibleSections.length === 0) {
            if (activeSectionId !== "") {
                setActiveSectionId("");
            }
            return;
        }

        const currentExists = visibleSections.some((section) => section.id === activeSectionId);
        if (!currentExists) {
            setActiveSectionId(visibleSections[0].id);
        }
    }, [visibleSections, activeSectionId]);

    return (
        <div className="settings-tab">
            <aside className="settings-tab-sidebar">
                <div className="settings-tab-sidebar-header">
                    <span className="settings-tab-sidebar-caption">{t("settings.navigationLabel")}</span>
                    <span className="settings-tab-sidebar-summary">
                        {t("settings.searchResultsSummary", {
                            visible: visibleSections.length,
                            total: sections.length,
                        })}
                    </span>
                </div>

                <label className="settings-tab-search" htmlFor="settings-search-input">
                    <Search className="settings-tab-search-icon" aria-hidden="true" />
                    <input
                        id="settings-search-input"
                        className="settings-tab-search-input"
                        type="search"
                        value={searchQuery}
                        placeholder={t("settings.searchPlaceholder")}
                        onChange={(event) => {
                            setSearchQuery(event.target.value);
                        }}
                    />
                </label>

                <div className="settings-tab-sidebar-list">
                    {visibleSections.map((section) => {
                        const isActive = section.id === activeSection?.id;

                        return (
                            <button
                                key={section.id}
                                type="button"
                                className={`settings-tab-sidebar-item ${isActive ? "active" : ""}`}
                                onClick={() => {
                                    setActiveSectionId(section.id);
                                }}
                            >
                                {/* 左侧分区文本层：选中时通过按钮自身伪元素淡入上下横线。 */}
                                <span className="settings-tab-sidebar-item-body">
                                    <span className="settings-tab-sidebar-item-title">{t(section.title)}</span>
                                    {section.description ? (
                                        <span className="settings-tab-sidebar-item-desc">{t(section.description)}</span>
                                    ) : null}
                                </span>
                            </button>
                        );
                    })}
                </div>
            </aside>

            <section className="settings-tab-content">
                <header className="settings-tab-content-header">
                    <div className="settings-tab-content-title-group">
                        <div className="settings-tab-content-kicker">{t("settings.title")}</div>
                        <div className="settings-tab-content-title">
                            {activeSection ? t(activeSection.title) : t("settings.title")}
                        </div>
                        {activeSection?.description ? (
                            <div className="settings-tab-content-subtitle">{t(activeSection.description)}</div>
                        ) : null}
                    </div>

                    {normalizeSettingsQuery(searchQuery).length > 0 ? (
                        <div className="settings-tab-content-summary">
                            {t("settings.searchResultsSummary", {
                                visible: visibleSections.length,
                                total: sections.length,
                            })}
                        </div>
                    ) : null}
                </header>

                {activeSection ? <SettingsRegisteredSection section={activeSection} /> : (
                    <div className="settings-tab-empty-state">
                        <div className="settings-tab-empty-state-title">
                            {normalizeSettingsQuery(searchQuery).length > 0
                                ? t("settings.noSearchResults")
                                : t("settings.noSections")}
                        </div>
                        <div className="settings-tab-empty-state-desc">
                            {normalizeSettingsQuery(searchQuery).length > 0
                                ? t("settings.noSearchResultsHint")
                                : t("settings.noSectionsHint")}
                        </div>
                    </div>
                )}
            </section>
        </div>
    );
}
