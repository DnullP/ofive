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

import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
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
    const reloadRef = useRef<(() => Promise<void>) | null>(null);

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
        <section className={`calendar-tab calendar-tab--${mode}`}>
            <header className="calendar-tab__header">
                <div className="calendar-tab__header-copy">
                    <h2 className="calendar-tab__title">{t("calendar.title")}</h2>
                    {mode === "tab" ? (
                        <>
                            <p className="calendar-tab__description">{t("calendar.description")}</p>
                            <p className="calendar-tab__description">{t("calendar.sourceHint")}</p>
                            <p className="calendar-tab__description">{t("calendar.clickDayHint")}</p>
                        </>
                    ) : (
                        <p className="calendar-tab__description">{t("calendar.clickDayHint")}</p>
                    )}
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

            {loadState.loading ? <div className="calendar-tab__status">{t("calendar.loading")}</div> : null}

            {!loadState.loading && loadState.error ? (
                <div className="calendar-tab__status">{t("calendar.loadFailed", { message: loadState.error })}</div>
            ) : null}

            {!loadState.loading && !loadState.error && !currentVaultPath ? (
                <div className="calendar-tab__status">{t("calendar.noVault")}</div>
            ) : null}

            {!loadState.loading && !loadState.error && currentVaultPath && loadState.matches.length === 0 ? (
                <div className="calendar-tab__status">{t("calendar.noDateNotes")}</div>
            ) : null}

            {!loadState.loading && !loadState.error && currentVaultPath && loadState.matches.length > 0 ? (
                <div className="calendar-tab__body">
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
                                cell.dayKey === selectedDayKey ? "calendar-tab__day--selected" : "",
                            ].filter(Boolean).join(" ");

                            return (
                                <button
                                    key={cell.dayKey}
                                    type="button"
                                    className={className}
                                    onClick={() => {
                                        console.info("[calendar-view] day selected", { dayKey: cell.dayKey, noteCount, mode, stateKey });
                                        setSelectedDayKey(cell.dayKey);
                                    }}
                                    onContextMenu={(event) => {
                                        void handleDayContextMenu(event, cell.dayKey);
                                    }}
                                >
                                    <span className="calendar-tab__day-number">{cell.date.getDate()}</span>
                                    <div className="calendar-tab__day-meta">
                                        {noteCount > 0 ? <span className="calendar-tab__day-count">{noteCount}</span> : null}
                                        <span className="calendar-tab__day-key">{cell.dayKey}</span>
                                    </div>
                                </button>
                            );
                        })}
                    </div>

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
                </div>
            ) : null}
        </section>
    );
}
