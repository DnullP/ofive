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
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type CSSProperties,
    type ReactNode,
} from "react";
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

const SIDEBAR_ACTIVE_LINE_STEP_MS = 90;
const SIDEBAR_SEPARATOR_SHORT_LEFT = 18;
const SIDEBAR_SEPARATOR_SHORT_RIGHT = 22;
const SIDEBAR_SEPARATOR_LONG_LEFT = 8;
const SIDEBAR_SEPARATOR_LONG_RIGHT = 8;

type SidebarIndicatorDirection = "up" | "down";

interface SidebarIndicatorBounds {
    top: number;
    bottom: number;
}

interface SidebarIndicatorAnimation {
    oldBounds: SidebarIndicatorBounds;
    newBounds: SidebarIndicatorBounds;
    direction: SidebarIndicatorDirection;
    phase: 0 | 1 | 2 | 3 | 4;
}

/**
 * @function measureSidebarIndicatorBounds
 * @description 读取左侧分区按钮在滚动容器中的上下边线位置。
 * @param element 当前分区按钮元素。
 * @returns 上下边线位置；元素缺失时返回 null。
 */
function measureSidebarIndicatorBounds(
    element: HTMLButtonElement | null,
): SidebarIndicatorBounds | null {
    if (!element) {
        return null;
    }

    return {
        top: element.offsetTop,
        bottom: element.offsetTop + element.offsetHeight,
    };
}

/**
 * @function resolveIndicatorLineExpanded
 * @description 根据动画阶段判断某条活动边线应使用短线还是长线长度。
 * @param animation 当前活动边线动画状态。
 * @param lineKey 目标边线标识。
 * @returns `true` 表示长线，`false` 表示静态分隔线长度。
 */
function resolveIndicatorLineExpanded(
    animation: SidebarIndicatorAnimation,
    lineKey: "old-top" | "old-bottom" | "new-top" | "new-bottom",
): boolean {
    if (animation.direction === "up") {
        const phaseMap = {
            "old-top": [true, true, true, false, false],
            "old-bottom": [true, false, false, false, false],
            "new-top": [false, false, false, false, true],
            "new-bottom": [false, false, true, true, true],
        } as const;
        return phaseMap[lineKey][animation.phase];
    }

    const phaseMap = {
        "old-top": [true, false, false, false, false],
        "old-bottom": [true, true, true, false, false],
        "new-top": [false, false, true, true, true],
        "new-bottom": [false, false, false, false, true],
    } as const;
    return phaseMap[lineKey][animation.phase];
}

/**
 * @function buildIndicatorLineStyle
 * @description 生成活动边线的定位与长度样式。
 * @param position 边线在滚动容器中的纵向位置。
 * @param expanded 当前边线是否使用长线长度。
 * @returns 可直接挂到活动边线节点的内联样式。
 */
function buildIndicatorLineStyle(position: number, expanded: boolean): CSSProperties {
    return {
        top: `${position}px`,
        ["--settings-sidebar-line-left" as string]: `${expanded ? SIDEBAR_SEPARATOR_LONG_LEFT : SIDEBAR_SEPARATOR_SHORT_LEFT}px`,
        ["--settings-sidebar-line-right" as string]: `${expanded ? SIDEBAR_SEPARATOR_LONG_RIGHT : SIDEBAR_SEPARATOR_SHORT_RIGHT}px`,
    };
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
    const [sidebarIndicatorBounds, setSidebarIndicatorBounds] = useState<SidebarIndicatorBounds | null>(null);
    const [sidebarIndicatorAnimation, setSidebarIndicatorAnimation] = useState<SidebarIndicatorAnimation | null>(null);
    const sidebarItemRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
    const sidebarAnimationTimeoutsRef = useRef<number[]>([]);
    const sidebarAnimationFrameRef = useRef<number | null>(null);
    const previousActiveSectionIdRef = useRef<string>("");
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

    useEffect(() => {
        return () => {
            sidebarAnimationTimeoutsRef.current.forEach((timeoutId) => {
                window.clearTimeout(timeoutId);
            });
            sidebarAnimationTimeoutsRef.current = [];
            if (sidebarAnimationFrameRef.current !== null) {
                window.cancelAnimationFrame(sidebarAnimationFrameRef.current);
                sidebarAnimationFrameRef.current = null;
            }
        };
    }, []);

    useLayoutEffect(() => {
        sidebarAnimationTimeoutsRef.current.forEach((timeoutId) => {
            window.clearTimeout(timeoutId);
        });
        sidebarAnimationTimeoutsRef.current = [];
        if (sidebarAnimationFrameRef.current !== null) {
            window.cancelAnimationFrame(sidebarAnimationFrameRef.current);
            sidebarAnimationFrameRef.current = null;
        }

        if (!activeSection) {
            previousActiveSectionIdRef.current = "";
            setSidebarIndicatorBounds(null);
            setSidebarIndicatorAnimation(null);
            return;
        }

        const nextElement = sidebarItemRefs.current.get(activeSection.id) ?? null;
        const nextBounds = measureSidebarIndicatorBounds(nextElement);
        if (!nextBounds) {
            return;
        }

        const previousActiveSectionId = previousActiveSectionIdRef.current;
        const previousElement = previousActiveSectionId
            ? sidebarItemRefs.current.get(previousActiveSectionId) ?? null
            : null;
        const previousBounds = measureSidebarIndicatorBounds(previousElement);

        if (!previousBounds || previousActiveSectionId === activeSection.id) {
            previousActiveSectionIdRef.current = activeSection.id;
            setSidebarIndicatorBounds(nextBounds);
            setSidebarIndicatorAnimation(null);
            return;
        }

        const previousIndex = visibleSections.findIndex((section) => section.id === previousActiveSectionId);
        const nextIndex = visibleSections.findIndex((section) => section.id === activeSection.id);
        if (previousIndex === -1 || nextIndex === -1 || previousIndex === nextIndex) {
            previousActiveSectionIdRef.current = activeSection.id;
            setSidebarIndicatorBounds(nextBounds);
            setSidebarIndicatorAnimation(null);
            return;
        }

        const direction: SidebarIndicatorDirection = nextIndex < previousIndex ? "up" : "down";
        setSidebarIndicatorBounds(nextBounds);
        setSidebarIndicatorAnimation({
            oldBounds: previousBounds,
            newBounds: nextBounds,
            direction,
            phase: 0,
        });

        sidebarAnimationFrameRef.current = window.requestAnimationFrame(() => {
            setSidebarIndicatorAnimation((currentAnimation) => currentAnimation ? {
                ...currentAnimation,
                phase: 1,
            } : currentAnimation);
        });

        for (let phase = 2 as const; phase <= 4; phase += 1) {
            const timeoutId = window.setTimeout(() => {
                setSidebarIndicatorAnimation((currentAnimation) => currentAnimation ? {
                    ...currentAnimation,
                    phase,
                } : currentAnimation);
            }, SIDEBAR_ACTIVE_LINE_STEP_MS * (phase - 1));
            sidebarAnimationTimeoutsRef.current.push(timeoutId);
        }

        const settleTimeoutId = window.setTimeout(() => {
            setSidebarIndicatorAnimation(null);
        }, SIDEBAR_ACTIVE_LINE_STEP_MS * 4);
        sidebarAnimationTimeoutsRef.current.push(settleTimeoutId);
        previousActiveSectionIdRef.current = activeSection.id;
    }, [activeSection, visibleSections]);

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
                    {visibleSections.map((section, index) => {
                        const isActive = section.id === activeSection?.id;
                        const isLineAboveActive = visibleSections[index + 1]?.id === activeSection?.id;

                        return (
                            <button
                                key={section.id}
                                type="button"
                                className={[
                                    "settings-tab-sidebar-item",
                                    isActive ? "active" : "",
                                    isActive || isLineAboveActive ? "settings-tab-sidebar-item--separator-hidden" : "",
                                ].filter(Boolean).join(" ")}
                                onClick={() => {
                                    setActiveSectionId(section.id);
                                }}
                                ref={(element) => {
                                    if (element) {
                                        sidebarItemRefs.current.set(section.id, element);
                                        return;
                                    }
                                    sidebarItemRefs.current.delete(section.id);
                                }}
                            >
                                {/* 左侧分区文本层：单根分隔线位于条目下方，活动边线由独立覆盖层驱动。 */}
                                <span className="settings-tab-sidebar-item-body">
                                    <span className="settings-tab-sidebar-item-title">{t(section.title)}</span>
                                    {section.description ? (
                                        <span className="settings-tab-sidebar-item-desc">{t(section.description)}</span>
                                    ) : null}
                                </span>
                            </button>
                        );
                    })}

                    {sidebarIndicatorAnimation ? (
                        <>
                            <span
                                className="settings-tab-sidebar-active-line settings-tab-sidebar-active-line--old"
                                style={buildIndicatorLineStyle(
                                    sidebarIndicatorAnimation.oldBounds.top,
                                    resolveIndicatorLineExpanded(sidebarIndicatorAnimation, "old-top"),
                                )}
                            />
                            <span
                                className="settings-tab-sidebar-active-line settings-tab-sidebar-active-line--old"
                                style={buildIndicatorLineStyle(
                                    sidebarIndicatorAnimation.oldBounds.bottom,
                                    resolveIndicatorLineExpanded(sidebarIndicatorAnimation, "old-bottom"),
                                )}
                            />
                        </>
                    ) : null}

                    {sidebarIndicatorBounds ? (
                        <>
                            <span
                                className="settings-tab-sidebar-active-line settings-tab-sidebar-active-line--settled"
                                style={buildIndicatorLineStyle(
                                    sidebarIndicatorBounds.top,
                                    sidebarIndicatorAnimation
                                        ? resolveIndicatorLineExpanded(sidebarIndicatorAnimation, "new-top")
                                        : true,
                                )}
                            />
                            <span
                                className="settings-tab-sidebar-active-line settings-tab-sidebar-active-line--settled"
                                style={buildIndicatorLineStyle(
                                    sidebarIndicatorBounds.bottom,
                                    sidebarIndicatorAnimation
                                        ? resolveIndicatorLineExpanded(sidebarIndicatorAnimation, "new-bottom")
                                        : true,
                                )}
                            />
                        </>
                    ) : null}
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
