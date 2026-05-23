/**
 * @module host/layout/SettingsTab
 * @description 设置页 Tab：基于注册中心动态渲染“左侧选栏 + 右侧设置项”。
 * @dependencies
 *  - react
 *  - ../settings/settingsRegistry
 *  - ../settings/registerBuiltinSettings
 */

import {
    useDeferredValue,
    useEffect,
    useMemo,
    useState,
    type ReactNode,
} from "react";
import { Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { WorkbenchTabProps } from "./workbenchContracts";
import { ensureBuiltinSettingsRegistered } from "../settings/registerBuiltinSettings";
import { SettingsRegisteredSection } from "../settings/SettingsRegisteredSection";
import { useSettingsSections, type SettingsSectionSnapshot } from "../settings/settingsRegistry";
import "./SettingsTab.css";

ensureBuiltinSettingsRegistered();

const SETTINGS_FOCUS_TARGET_ACTIVE_CLASS = "settings-focus-target-active";
const SETTINGS_FOCUS_TARGET_RETRY_COUNT = 40;
const SETTINGS_FOCUS_TARGET_RETRY_DELAY_MS = 50;
const SETTINGS_FOCUSABLE_SELECTOR = [
    "input",
    "textarea",
    "select",
    "button",
    "[tabindex]:not([tabindex='-1'])",
].join(",");

export interface SettingsTabParams {
    [key: string]: unknown;
    sectionId?: string;
    focusTarget?: string;
    focusRequestId?: string;
}

function normalizeSettingsQuery(value: string): string {
    return value.trim().toLocaleLowerCase();
}

function readSettingsTabStringParam(
    params: Record<string, unknown> | undefined,
    key: keyof SettingsTabParams,
): string {
    const value = params?.[key];
    return typeof value === "string" ? value : "";
}

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

function findSettingsFocusTarget(focusTarget: string): HTMLElement | null {
    if (typeof document === "undefined") {
        return null;
    }

    return Array
        .from(document.querySelectorAll<HTMLElement>("[data-settings-focus-target]"))
        .find((element) => element.getAttribute("data-settings-focus-target") === focusTarget)
        ?? null;
}

function focusSettingsTargetElement(target: HTMLElement): number {
    target.scrollIntoView({
        block: "center",
        inline: "nearest",
        behavior: "auto",
    });

    const focusable = target.matches(SETTINGS_FOCUSABLE_SELECTOR)
        ? target
        : target.querySelector<HTMLElement>(SETTINGS_FOCUSABLE_SELECTOR);
    focusable?.focus({ preventScroll: true });

    target.classList.add(SETTINGS_FOCUS_TARGET_ACTIVE_CLASS);
    return window.setTimeout(() => {
        target.classList.remove(SETTINGS_FOCUS_TARGET_ACTIVE_CLASS);
    }, 1_600);
}

/**
 * @function SettingsTab
 * @description 渲染设置页 Tab。
 * @returns React 节点。
 */
export function SettingsTab(props: Partial<WorkbenchTabProps<SettingsTabParams>> = {}): ReactNode {
    const { t } = useTranslation();
    const sections = useSettingsSections();
    const [activeSectionId, setActiveSectionId] = useState<string>("");
    const [searchQuery, setSearchQuery] = useState<string>("");
    const deferredSearchQuery = useDeferredValue(searchQuery);
    const requestedSectionId = readSettingsTabStringParam(props.params, "sectionId");
    const requestedFocusTarget = readSettingsTabStringParam(props.params, "focusTarget");
    const requestedFocusRequestId = readSettingsTabStringParam(props.params, "focusRequestId");

    const visibleSections = useMemo(() => {
        const normalizedQuery = normalizeSettingsQuery(deferredSearchQuery);
        return sections.filter((section) => matchesSettingsSection(section, normalizedQuery, t));
    }, [deferredSearchQuery, sections, t]);

    const activeSection = useMemo(
        () => visibleSections.find((section) => section.id === activeSectionId) ?? visibleSections[0],
        [visibleSections, activeSectionId],
    );

    useEffect(() => {
        if (!requestedSectionId) {
            return;
        }

        const requestedSectionExists = sections.some((section) => section.id === requestedSectionId);
        if (!requestedSectionExists) {
            return;
        }

        if (searchQuery) {
            setSearchQuery("");
        }
        if (activeSectionId !== requestedSectionId) {
            setActiveSectionId(requestedSectionId);
        }
    }, [activeSectionId, requestedSectionId, searchQuery, sections]);

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

    useEffect(() => {
        if (!requestedFocusTarget) {
            return undefined;
        }
        if (requestedSectionId && activeSection?.id !== requestedSectionId) {
            return undefined;
        }

        let disposed = false;
        let retryTimer = 0;
        let highlightTimer = 0;

        const attemptFocus = (remainingAttempts: number): void => {
            if (disposed) {
                return;
            }

            const target = findSettingsFocusTarget(requestedFocusTarget);
            if (target) {
                highlightTimer = focusSettingsTargetElement(target);
                return;
            }

            if (remainingAttempts <= 0) {
                return;
            }

            retryTimer = window.setTimeout(() => {
                attemptFocus(remainingAttempts - 1);
            }, SETTINGS_FOCUS_TARGET_RETRY_DELAY_MS);
        };

        retryTimer = window.setTimeout(() => {
            attemptFocus(SETTINGS_FOCUS_TARGET_RETRY_COUNT);
        }, 0);

        return () => {
            disposed = true;
            window.clearTimeout(retryTimer);
            window.clearTimeout(highlightTimer);
        };
    }, [activeSection?.id, requestedFocusRequestId, requestedFocusTarget, requestedSectionId]);

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
                                className={[
                                    "settings-tab-sidebar-item",
                                    isActive ? "active" : "",
                                ].filter(Boolean).join(" ")}
                                onClick={() => {
                                    setActiveSectionId(section.id);
                                }}
                            >
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

                {activeSection ? (
                    <div data-settings-section-id={activeSection.id}>
                        <SettingsRegisteredSection section={activeSection} />
                    </div>
                ) : (
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
