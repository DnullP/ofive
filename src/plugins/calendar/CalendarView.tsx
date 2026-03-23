/**
 * @module plugins/calendar/CalendarView
 * @description 日历共享视图：封装 tab/panel 两种容器共用的数据加载、日期选择、右键创建每日笔记
 *   与笔记列表展示逻辑；通过 `mode` 切换不同密度和布局。
 *
 * @dependencies
 *  - react
 *  - react-i18next
 *  - ../../api/vaultApi
 *  - ../../host/events/appEventBus
 *  - ../../host/layout/nativeContextMenu
 *  - ../../host/store/vaultStore
 *  - ./calendarDateUtils
 *  - ./calendarViewState
 *  - ./CalendarTab.css
 *
 * @exports
 *  - CalendarView
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import {
    createVaultMarkdownFile,
    queryVaultMarkdownFrontmatter,
    type FrontmatterQueryMatchItem,
} from "../../api/vaultApi";
import { subscribeVaultFsBusEvent } from "../../host/events/appEventBus";
import { showNativeContextMenu } from "../../host/layout/nativeContextMenu";
import { useVaultState } from "../../host/store/vaultStore";
import {
    buildCalendarMonthGrid,
    buildDailyNoteInitialContent,
    buildDailyNoteRelativePath,
    normalizeFrontmatterDateToDayKey,
    shiftCalendarMonth,
    toCalendarDayKey,
} from "./calendarDateUtils";
import { deriveCalendarViewRenderState } from "./calendarViewRenderState";
import { getCalendarViewState, setCalendarViewState } from "./calendarViewState";
import "./CalendarTab.css";

/** 日历详情面板中的笔记条目。 */
interface CalendarNoteItem {
    /** 文件相对路径。 */
    relativePath: string;
    /** 显示标题。 */
    title: string;
}

/** 日历数据加载状态。 */
interface CalendarLoadState {
    /** 是否加载中。 */
    loading: boolean;
    /** 错误信息。 */
    error: string | null;
    /** 查询命中列表。 */
    matches: FrontmatterQueryMatchItem[];
}

/** Panel 模式浮动笔记窗定位信息。 */
interface CalendarPanelPopoverPosition {
    /** 浮窗左偏移。 */
    left: number;
    /** 浮窗上偏移。 */
    top: number;
    /** 浮窗相对选中日期的朝向。 */
    placement: "above" | "below";
}

/** 日历视图模式。 */
export type CalendarViewMode = "tab" | "panel";

/** 日历共享视图组件属性。 */
export interface CalendarViewProps {
    /** 当前容器模式。 */
    mode: CalendarViewMode;
    /** 共享状态键。 */
    stateKey: string;
    /** 打开目标 Markdown 笔记。 */
    openNote: (relativePath: string) => Promise<void>;
}

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

function isMarkdownRelativePath(path: string | null | undefined): boolean {
    if (!path) {
        return false;
    }

    const normalized = path.toLowerCase();
    return normalized.endsWith(".md") || normalized.endsWith(".markdown");
}

function dayKeyToDate(dayKey: string): Date {
    const [year, month, day] = dayKey.split("-").map((value) => Number(value));
    return new Date(year, (month || 1) - 1, day || 1);
}

function groupMatchesByDay(matches: FrontmatterQueryMatchItem[]): Map<string, CalendarNoteItem[]> {
    const grouped = new Map<string, CalendarNoteItem[]>();

    matches.forEach((item) => {
        const matchedDays = Array.from(new Set(
            item.matchedFieldValues
                .map((value) => normalizeFrontmatterDateToDayKey(value))
                .filter((value): value is string => value !== null),
        ));

        if (matchedDays.length === 0) {
            console.warn("[calendar-view] matched note has no valid day key", {
                relativePath: item.relativePath,
            });
            return;
        }

        matchedDays.forEach((dayKey) => {
            const previousItems = grouped.get(dayKey) ?? [];
            previousItems.push({
                relativePath: item.relativePath,
                title: item.title,
            });
            grouped.set(dayKey, previousItems);
        });
    });

    grouped.forEach((notes, dayKey) => {
        notes.sort((left, right) => left.title.localeCompare(right.title) || left.relativePath.localeCompare(right.relativePath));
        grouped.set(dayKey, notes);
    });

    return grouped;
}

/**
 * @function CalendarView
 * @description 渲染可在 tab/panel 之间复用的日历视图。
 * @param props 视图属性。
 * @returns React 元素。
 */
export function CalendarView(props: CalendarViewProps): ReactElement {
    const { mode, stateKey, openNote } = props;
    const { t, i18n } = useTranslation();
    const { currentVaultPath, files } = useVaultState();
    const today = useMemo(() => new Date(), []);
    const persistedState = useMemo(() => getCalendarViewState(stateKey), [stateKey]);
    const [anchorDate, setAnchorDate] = useState<Date>(() =>
        persistedState ? dayKeyToDate(persistedState.anchorDayKey) : today,
    );
    const [selectedDayKey, setSelectedDayKey] = useState<string>(() =>
        persistedState?.selectedDayKey ?? toCalendarDayKey(today),
    );
    const [loadState, setLoadState] = useState<CalendarLoadState>({
        loading: true,
        error: null,
        matches: [],
    });
    const [isPanelNotesPopoverOpen, setIsPanelNotesPopoverOpen] = useState<boolean>(mode === "panel");
    const [panelPopoverPosition, setPanelPopoverPosition] = useState<CalendarPanelPopoverPosition | null>(null);
    const reloadRef = useRef<(() => Promise<void>) | null>(null);
    const rootRef = useRef<HTMLElement | null>(null);
    const calendarSurfaceRef = useRef<HTMLElement | null>(null);
    const panelNotesPopoverRef = useRef<HTMLDivElement | null>(null);
    const dayButtonRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

    const markdownPathSet = useMemo(() => {
        return new Set(
            files
                .filter((item) => !item.isDir)
                .map((item) => item.path.replace(/\\/g, "/")),
        );
    }, [files]);

    const notesByDay = useMemo(() => groupMatchesByDay(loadState.matches), [loadState.matches]);
    const calendarGrid = useMemo(() => buildCalendarMonthGrid(anchorDate), [anchorDate]);
    const selectedNotes = notesByDay.get(selectedDayKey) ?? [];
    const isPanelMode = mode === "panel";
    const renderState = useMemo(() => deriveCalendarViewRenderState({
        loading: loadState.loading,
        error: loadState.error,
        currentVaultPath,
        matchCount: loadState.matches.length,
    }), [currentVaultPath, loadState.error, loadState.loading, loadState.matches.length]);
    const monthLabel = useMemo(() => {
        return new Intl.DateTimeFormat(i18n.language, {
            year: "numeric",
            month: "long",
        }).format(anchorDate);
    }, [anchorDate, i18n.language]);

    useEffect(() => {
        setCalendarViewState(stateKey, {
            anchorDayKey: toCalendarDayKey(anchorDate),
            selectedDayKey,
        });
    }, [anchorDate, selectedDayKey, stateKey]);

    useEffect(() => {
        setIsPanelNotesPopoverOpen(mode === "panel");
    }, [mode]);

    useEffect(() => {
        let cancelled = false;

        const loadCalendarNotes = async (): Promise<void> => {
            if (!currentVaultPath) {
                if (!cancelled) {
                    setLoadState({ loading: false, error: null, matches: [] });
                }
                return;
            }

            if (!cancelled) {
                setLoadState((previous) => ({ ...previous, loading: true, error: null }));
            }

            try {
                console.info("[calendar-view] load start", { currentVaultPath, mode, stateKey });
                const response = await queryVaultMarkdownFrontmatter("date");
                if (cancelled) {
                    return;
                }

                setLoadState({ loading: false, error: null, matches: response.matches });
                console.info("[calendar-view] load success", { matchCount: response.matches.length, mode, stateKey });
            } catch (error) {
                const message = error instanceof Error ? error.message : t("calendar.loadFailed", { message: "unknown" });
                if (cancelled) {
                    return;
                }

                setLoadState({ loading: false, error: message, matches: [] });
                console.error("[calendar-view] load failed", { message, mode, stateKey });
            }
        };

        reloadRef.current = loadCalendarNotes;
        void loadCalendarNotes();

        return () => {
            cancelled = true;
        };
    }, [currentVaultPath, mode, stateKey, t]);

    useEffect(() => {
        const unlisten = subscribeVaultFsBusEvent((payload) => {
            if (isMarkdownRelativePath(payload.relativePath) || isMarkdownRelativePath(payload.oldRelativePath)) {
                console.info("[calendar-view] reload requested by vault fs event", {
                    eventType: payload.eventType,
                    relativePath: payload.relativePath,
                    oldRelativePath: payload.oldRelativePath,
                });
                void reloadRef.current?.();
            }
        });

        return () => {
            unlisten();
        };
    }, []);

    useEffect(() => {
        if (!isPanelMode || !isPanelNotesPopoverOpen) {
            return;
        }

        const handlePointerDown = (event: PointerEvent): void => {
            const target = event.target;
            if (!(target instanceof Node)) {
                return;
            }

            if (rootRef.current?.contains(target)) {
                return;
            }

            console.info("[calendar-view] panel popover dismissed by outside pointer", {
                selectedDayKey,
                stateKey,
            });
            setIsPanelNotesPopoverOpen(false);
        };

        document.addEventListener("pointerdown", handlePointerDown);
        return () => {
            document.removeEventListener("pointerdown", handlePointerDown);
        };
    }, [isPanelMode, isPanelNotesPopoverOpen, selectedDayKey, stateKey]);

    useLayoutEffect(() => {
        if (!isPanelMode || !isPanelNotesPopoverOpen) {
            setPanelPopoverPosition(null);
            return;
        }

        const calendarSurface = calendarSurfaceRef.current;
        const selectedDayButton = dayButtonRefs.current.get(selectedDayKey);
        const popover = panelNotesPopoverRef.current;
        if (!calendarSurface || !selectedDayButton || !popover) {
            return;
        }

        const surfaceRect = calendarSurface.getBoundingClientRect();
        const dayRect = selectedDayButton.getBoundingClientRect();
        const popoverRect = popover.getBoundingClientRect();
        const horizontalPadding = 8;
        const verticalGap = 8;

        let left = dayRect.left - surfaceRect.left;
        const maxLeft = Math.max(horizontalPadding, surfaceRect.width - popoverRect.width - horizontalPadding);
        left = Math.min(Math.max(horizontalPadding, left), maxLeft);

        let placement: "above" | "below" = "below";
        let top = dayRect.bottom - surfaceRect.top + verticalGap;
        if (top + popoverRect.height > surfaceRect.height && dayRect.top - surfaceRect.top > popoverRect.height + verticalGap) {
            placement = "above";
            top = dayRect.top - surfaceRect.top - popoverRect.height - verticalGap;
        }

        if (top < horizontalPadding) {
            top = dayRect.bottom - surfaceRect.top + verticalGap;
            placement = "below";
        }

        setPanelPopoverPosition((previous) => {
            if (
                previous
                && previous.left === left
                && previous.top === top
                && previous.placement === placement
            ) {
                return previous;
            }

            return { left, top, placement };
        });
    }, [isPanelMode, isPanelNotesPopoverOpen, selectedDayKey, selectedNotes.length, calendarGrid, monthLabel]);

    const handleDayContextMenu = async (
        event: React.MouseEvent<HTMLButtonElement>,
        dayKey: string,
    ): Promise<void> => {
        event.preventDefault();

        const dailyNoteRelativePath = buildDailyNoteRelativePath(dayKey);
        const dailyNoteExists = markdownPathSet.has(dailyNoteRelativePath);
        const selectedAction = await showNativeContextMenu([
            {
                id: "calendar.daily-note",
                text: dailyNoteExists ? t("calendar.openDailyNote") : t("calendar.createDailyNote"),
            },
        ]);

        if (selectedAction !== "calendar.daily-note") {
            return;
        }

        if (!dailyNoteExists) {
            const initialContent = buildDailyNoteInitialContent(dayKey);
            await createVaultMarkdownFile(dailyNoteRelativePath, initialContent);
            console.info("[calendar-view] daily note created", { dayKey, relativePath: dailyNoteRelativePath });
            void reloadRef.current?.();
        }

        await openNote(dailyNoteRelativePath);
    };

    return (
        <section ref={rootRef} className={`calendar-tab calendar-tab--${mode}`}>
            <header className="calendar-tab__header">
                <div className="calendar-tab__header-copy">
                    {mode === "tab" ? (
                        <>
                            <h2 className="calendar-tab__title">{t("calendar.title")}</h2>
                            <p className="calendar-tab__description">{t("calendar.description")}</p>
                            <p className="calendar-tab__description">{t("calendar.sourceHint")}</p>
                            <p className="calendar-tab__description">{t("calendar.clickDayHint")}</p>
                        </>
                    ) : null}
                </div>

                <div className="calendar-tab__month-nav">
                    <button
                        type="button"
                        className="calendar-tab__nav-button"
                        onClick={() => {
                            setAnchorDate((previous) => shiftCalendarMonth(previous, -1));
                        }}
                    >
                        {t("calendar.previousMonth")}
                    </button>
                    <button
                        type="button"
                        className="calendar-tab__nav-button"
                        onClick={() => {
                            setAnchorDate(today);
                            setSelectedDayKey(toCalendarDayKey(today));
                        }}
                    >
                        {t("calendar.today")}
                    </button>
                    <span className="calendar-tab__month-label">{monthLabel}</span>
                    <button
                        type="button"
                        className="calendar-tab__nav-button"
                        onClick={() => {
                            setAnchorDate((previous) => shiftCalendarMonth(previous, 1));
                        }}
                    >
                        {t("calendar.nextMonth")}
                    </button>
                </div>
            </header>

            {renderState.showLoadingStatus ? <div className="calendar-tab__status">{t("calendar.loading")}</div> : null}

            {renderState.showErrorStatus ? (
                <div className="calendar-tab__status">{t("calendar.loadFailed", { message: loadState.error })}</div>
            ) : null}

            {renderState.showNoVaultStatus ? (
                <div className="calendar-tab__status">{t("calendar.noVault")}</div>
            ) : null}

            {renderState.showNoDateNotesStatus ? (
                <div className="calendar-tab__status">{t("calendar.noDateNotes")}</div>
            ) : null}

            {renderState.showCalendarBody ? (
                <div className="calendar-tab__body">
                    <section ref={calendarSurfaceRef} className="calendar-tab__calendar-surface">
                        <div className="calendar-tab__weekdays">
                            {WEEKDAY_LABELS.map((label) => (
                                <div key={label} className="calendar-tab__weekday">{label}</div>
                            ))}
                        </div>

                        <div className="calendar-tab__grid">
                            {calendarGrid.map((cell) => {
                                const noteCount = notesByDay.get(cell.dayKey)?.length ?? 0;
                                const className = [
                                    "calendar-tab__day",
                                    cell.inCurrentMonth ? "" : "calendar-tab__day--outside",
                                    cell.isToday ? "calendar-tab__day--today" : "",
                                    noteCount > 0 ? "calendar-tab__day--has-notes" : "",
                                    cell.dayKey === selectedDayKey ? "calendar-tab__day--selected" : "",
                                ].filter(Boolean).join(" ");

                                return (
                                    <button
                                        key={cell.dayKey}
                                        type="button"
                                        className={className}
                                        ref={(node) => {
                                            if (node) {
                                                dayButtonRefs.current.set(cell.dayKey, node);
                                                return;
                                            }

                                            dayButtonRefs.current.delete(cell.dayKey);
                                        }}
                                        onClick={() => {
                                            console.info("[calendar-view] day selected", { dayKey: cell.dayKey, noteCount, mode, stateKey });
                                            setSelectedDayKey(cell.dayKey);
                                            if (isPanelMode) {
                                                setIsPanelNotesPopoverOpen(true);
                                            }
                                        }}
                                        onContextMenu={(event) => {
                                            void handleDayContextMenu(event, cell.dayKey);
                                        }}
                                    >
                                        <span className="calendar-tab__day-number">{cell.date.getDate()}</span>
                                        {isPanelMode ? null : (
                                            <div className="calendar-tab__day-meta">
                                                {noteCount > 0 ? <span className="calendar-tab__day-count">{noteCount}</span> : null}
                                                <span className="calendar-tab__day-key">{cell.dayKey}</span>
                                            </div>
                                        )}
                                    </button>
                                );
                            })}
                        </div>

                        {isPanelMode && isPanelNotesPopoverOpen ? (
                            <div
                                ref={panelNotesPopoverRef}
                                className={`calendar-tab__panel-popover${panelPopoverPosition ? " is-positioned" : ""}`}
                                data-floating-surface="true"
                                style={panelPopoverPosition ? {
                                    left: `${panelPopoverPosition.left}px`,
                                    top: `${panelPopoverPosition.top}px`,
                                } : undefined}
                                data-placement={panelPopoverPosition?.placement ?? "below"}
                            >
                                <div className="calendar-tab__panel-popover-header">
                                    <div className="calendar-tab__panel-popover-heading-group">
                                        <h3 className="calendar-tab__panel-popover-title">{t("calendar.notesForDay", { day: selectedDayKey })}</h3>
                                        <span className="calendar-tab__panel-popover-subtitle">{t("calendar.notesForDayCount", { count: selectedNotes.length })}</span>
                                    </div>
                                    <button
                                        type="button"
                                        className="calendar-tab__panel-popover-close"
                                        onClick={() => {
                                            console.info("[calendar-view] panel popover dismissed by close button", {
                                                selectedDayKey,
                                                stateKey,
                                            });
                                            setIsPanelNotesPopoverOpen(false);
                                        }}
                                        aria-label={t("common.close")}
                                    >
                                        ×
                                    </button>
                                </div>

                                {selectedNotes.length === 0 ? (
                                    <div className="calendar-tab__panel-popover-empty">{t("calendar.notesForDayEmpty")}</div>
                                ) : (
                                    <div className="calendar-tab__panel-popover-note-list">
                                        {selectedNotes.map((note) => (
                                            <button
                                                key={note.relativePath}
                                                type="button"
                                                className="calendar-tab__note-button calendar-tab__note-button--panel-popover"
                                                onClick={() => {
                                                    void openNote(note.relativePath);
                                                }}
                                            >
                                                <span className="calendar-tab__note-title">{note.title}</span>
                                                <span className="calendar-tab__note-path">{note.relativePath}</span>
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        ) : null}
                    </section>

                    {isPanelMode ? null : (
                        <section className="calendar-tab__details">
                            <div className="calendar-tab__details-header">
                                <h3 className="calendar-tab__details-title">{t("calendar.notesForDay", { day: selectedDayKey })}</h3>
                                <span className="calendar-tab__details-subtitle">{t("calendar.notesForDayCount", { count: selectedNotes.length })}</span>
                            </div>

                            {selectedNotes.length === 0 ? (
                                <div className="calendar-tab__empty">{t("calendar.notesForDayEmpty")}</div>
                            ) : (
                                <div className="calendar-tab__note-list">
                                    {selectedNotes.map((note) => (
                                        <button
                                            key={note.relativePath}
                                            type="button"
                                            className="calendar-tab__note-button"
                                            onClick={() => {
                                                void openNote(note.relativePath);
                                            }}
                                        >
                                            <span className="calendar-tab__note-title">{note.title}</span>
                                            <span className="calendar-tab__note-path">{note.relativePath}</span>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </section>
                    )}
                </div>
            ) : null}
        </section>
    );
}
