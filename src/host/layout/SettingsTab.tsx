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
import { ChevronDown, ChevronRight, Search } from "lucide-react";
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
    itemId?: string;
    focusTarget?: string;
    focusRequestId?: string;
}

interface SettingsActiveSelection {
    sectionId: string;
    itemId?: string;
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

function buildSettingsSelectionId(sectionId: string, itemId?: string): string {
    return itemId ? `${sectionId}:${itemId}` : sectionId;
}

function getDefaultSelection(sections: SettingsSectionSnapshot[]): SettingsActiveSelection {
    const firstSection = sections[0];
    if (!firstSection) {
        return { sectionId: "" };
    }

    if (firstSection.exposeItemsInNavigation && firstSection.items[0]) {
        return {
            sectionId: firstSection.id,
            itemId: firstSection.items[0].id,
        };
    }

    return { sectionId: firstSection.id };
}

function resolveSelection(
    sections: SettingsSectionSnapshot[],
    selection: SettingsActiveSelection,
): SettingsActiveSelection {
    const section = sections.find((candidate) => candidate.id === selection.sectionId);
    if (!section) {
        return getDefaultSelection(sections);
    }

    if (!section.exposeItemsInNavigation) {
        return { sectionId: section.id };
    }

    const item = section.items.find((candidate) => candidate.id === selection.itemId) ?? section.items[0];
    return {
        sectionId: section.id,
        itemId: item?.id,
    };
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
    const requestedSectionId = readSettingsTabStringParam(props.params, "sectionId");
    const requestedItemId = readSettingsTabStringParam(props.params, "itemId");
    const requestedFocusTarget = readSettingsTabStringParam(props.params, "focusTarget");
    const requestedFocusRequestId = readSettingsTabStringParam(props.params, "focusRequestId");
    const [activeSelection, setActiveSelection] = useState<SettingsActiveSelection>(() => (
        requestedSectionId
            ? resolveSelection(sections, {
                sectionId: requestedSectionId,
                itemId: requestedItemId || undefined,
            })
            : { sectionId: "" }
    ));
    const [expandedSectionIds, setExpandedSectionIds] = useState<ReadonlySet<string>>(() => (
        requestedSectionId ? new Set([requestedSectionId]) : new Set()
    ));
    const [searchQuery, setSearchQuery] = useState<string>("");
    const deferredSearchQuery = useDeferredValue(searchQuery);

    const visibleSections = useMemo(() => {
        const normalizedQuery = normalizeSettingsQuery(deferredSearchQuery);
        return sections.filter((section) => matchesSettingsSection(section, normalizedQuery, t));
    }, [deferredSearchQuery, sections, t]);

    const resolvedActiveSelection = useMemo(
        () => resolveSelection(visibleSections, activeSelection),
        [visibleSections, activeSelection],
    );

    const activeSection = useMemo(
        () => visibleSections.find((section) => section.id === resolvedActiveSelection.sectionId) ?? null,
        [resolvedActiveSelection.sectionId, visibleSections],
    );

    const activeItem = useMemo(
        () => activeSection?.items.find((item) => item.id === resolvedActiveSelection.itemId) ?? null,
        [activeSection, resolvedActiveSelection.itemId],
    );

    useEffect(() => {
        if (!requestedSectionId) {
            return;
        }

        const requestedSection = sections.find((section) => section.id === requestedSectionId);
        if (!requestedSection) {
            return;
        }

        const requestedSelection = resolveSelection(sections, {
            sectionId: requestedSectionId,
            itemId: requestedItemId || undefined,
        });

        if (searchQuery) {
            setSearchQuery("");
        }
        setExpandedSectionIds((current) => {
            if (current.has(requestedSectionId)) {
                return current;
            }

            return new Set([...current, requestedSectionId]);
        });
        if (
            activeSelection.sectionId !== requestedSelection.sectionId
            || activeSelection.itemId !== requestedSelection.itemId
        ) {
            setActiveSelection(requestedSelection);
        }
    }, [activeSelection, requestedItemId, requestedSectionId, searchQuery, sections]);

    useEffect(() => {
        if (visibleSections.length === 0) {
            if (activeSelection.sectionId !== "") {
                setActiveSelection({ sectionId: "" });
            }
            return;
        }

        if (
            activeSelection.sectionId !== resolvedActiveSelection.sectionId
            || activeSelection.itemId !== resolvedActiveSelection.itemId
        ) {
            setActiveSelection(resolvedActiveSelection);
        }
    }, [activeSelection, resolvedActiveSelection, visibleSections]);

    useEffect(() => {
        const sectionsToExpand = visibleSections
            .filter((section) => (
                (section.exposeItemsInNavigation && section.items.length > 0)
                && (
                    normalizeSettingsQuery(deferredSearchQuery).length > 0
                    || section.id === resolvedActiveSelection.sectionId
                )
            ))
            .map((section) => section.id);

        if (sectionsToExpand.length === 0) {
            return;
        }

        setExpandedSectionIds((current) => {
            const next = new Set(current);
            sectionsToExpand.forEach((sectionId) => {
                next.add(sectionId);
            });

            return next.size === current.size ? current : next;
        });
    }, [deferredSearchQuery, resolvedActiveSelection.sectionId, visibleSections]);

    useEffect(() => {
        if (!requestedFocusTarget) {
            return undefined;
        }
        if (requestedSectionId && activeSection?.id !== requestedSectionId) {
            return undefined;
        }
        if (requestedItemId && activeItem?.id !== requestedItemId) {
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
    }, [
        activeItem?.id,
        activeSection?.id,
        requestedFocusRequestId,
        requestedFocusTarget,
        requestedItemId,
        requestedSectionId,
    ]);

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
                        const exposesItems = section.exposeItemsInNavigation && section.items.length > 0;
                        const isExpanded = expandedSectionIds.has(section.id) || (exposesItems && isActive);

                        return (
                            <div
                                key={section.id}
                                className={[
                                    "settings-tab-sidebar-section",
                                    isActive ? "active" : "",
                                    exposesItems ? "has-children" : "",
                                    isExpanded ? "expanded" : "",
                                ].filter(Boolean).join(" ")}
                            >
                                <button
                                    type="button"
                                    className={[
                                        "settings-tab-sidebar-item",
                                        isActive ? "active" : "",
                                    ].filter(Boolean).join(" ")}
                                    aria-expanded={exposesItems ? isExpanded : undefined}
                                    onClick={() => {
                                        if (!exposesItems) {
                                            setActiveSelection({ sectionId: section.id });
                                            return;
                                        }

                                        const willExpand = !expandedSectionIds.has(section.id);
                                        setExpandedSectionIds((current) => {
                                            const next = new Set(current);
                                            if (next.has(section.id)) {
                                                next.delete(section.id);
                                            } else {
                                                next.add(section.id);
                                            }
                                            return next;
                                        });
                                        if (willExpand) {
                                            setActiveSelection(resolveSelection(sections, { sectionId: section.id }));
                                        }
                                    }}
                                >
                                    {exposesItems ? (
                                        isExpanded
                                            ? <ChevronDown className="settings-tab-sidebar-disclosure" aria-hidden="true" />
                                            : <ChevronRight className="settings-tab-sidebar-disclosure" aria-hidden="true" />
                                    ) : null}
                                    <span className="settings-tab-sidebar-item-body">
                                        <span className="settings-tab-sidebar-item-title">{t(section.title)}</span>
                                        {section.description ? (
                                            <span className="settings-tab-sidebar-item-desc">{t(section.description)}</span>
                                        ) : null}
                                    </span>
                                </button>

                                {exposesItems && isExpanded ? (
                                    <div className="settings-tab-sidebar-sublist">
                                        {section.items.map((item) => {
                                            const isItemActive = section.id === activeSection?.id
                                                && item.id === resolvedActiveSelection.itemId;

                                            return (
                                                <button
                                                    key={item.id}
                                                    type="button"
                                                    className={[
                                                        "settings-tab-sidebar-subitem",
                                                        isItemActive ? "active" : "",
                                                    ].filter(Boolean).join(" ")}
                                                    onClick={() => {
                                                        setActiveSelection({
                                                            sectionId: section.id,
                                                            itemId: item.id,
                                                        });
                                                        setExpandedSectionIds((current) => {
                                                            if (current.has(section.id)) {
                                                                return current;
                                                            }

                                                            return new Set([...current, section.id]);
                                                        });
                                                    }}
                                                >
                                                    <span className="settings-tab-sidebar-subitem-title">{t(item.title)}</span>
                                                    {item.description ? (
                                                        <span className="settings-tab-sidebar-subitem-desc">{t(item.description)}</span>
                                                    ) : null}
                                                </button>
                                            );
                                        })}
                                    </div>
                                ) : null}
                            </div>
                        );
                    })}
                </div>
            </aside>

            <section className="settings-tab-content">
                <header className="settings-tab-content-header">
                    <div className="settings-tab-content-title-group">
                        <div className="settings-tab-content-kicker">{t("settings.title")}</div>
                        <div className="settings-tab-content-title">
                            {activeItem ? t(activeItem.title) : activeSection ? t(activeSection.title) : t("settings.title")}
                        </div>
                        {(activeItem?.description ?? activeSection?.description) ? (
                            <div className="settings-tab-content-subtitle">
                                {t(activeItem?.description ?? activeSection?.description ?? "")}
                            </div>
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
                    <div
                        data-settings-section-id={activeSection.id}
                        data-settings-item-id={resolvedActiveSelection.itemId}
                        data-settings-active-selection={buildSettingsSelectionId(
                            activeSection.id,
                            resolvedActiveSelection.itemId,
                        )}
                    >
                        <SettingsRegisteredSection
                            section={activeSection}
                            activeItemId={resolvedActiveSelection.itemId}
                        />
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
