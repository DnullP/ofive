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
 *  - ../../host/layout/contextMenuCenter
 *  - ../../host/vault/vaultStore
 *  - ./calendarDateUtils
 *  - ./calendarViewState
 *  - ./CalendarTab.css
 *
 * @exports
 *  - CalendarView
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactElement } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { ChevronLeft, ChevronRight, RotateCcw } from "lucide-react";
import {
    createVaultMarkdownFile,
    queryVaultMarkdownFrontmatter,
    queryVaultTasks,
    type FrontmatterQueryMatchItem,
    type VaultTaskItem,
} from "../../api/vaultApi";
import {
    subscribePersistedContentUpdatedEvent,
    subscribeVaultFsBusEvent,
} from "../../host/events/appEventBus";
import {
    showRegisteredContextMenu,
    useContextMenuProvider,
} from "../../host/layout/contextMenuCenter";
import { useVaultState } from "../../host/vault/vaultStore";
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
import { formatTaskDueLabel, normalizeTaskMetadataValue } from "../../utils/taskSyntax";
import "./CalendarTab.css";

const CALENDAR_DAY_CONTEXT_MENU_ID = "calendar.day";
let nextCalendarContextMenuInstanceId = 0;

/** 日历详情面板中的条目。 */
interface CalendarDayItem {
    /** 条目唯一标识。 */
    id: string;
    /** 条目类型。 */
    kind: "note" | "task";
    /** 文件相对路径。 */
    relativePath: string;
    /** 显示标题。 */
    title: string;
    /** 任务条目；仅 kind=task 时存在。 */
    task?: VaultTaskItem;
    /** 是否计入日期格上的任务预算徽标。跨日 range 已由横条表达，不重复计数。 */
    countsTaskBudget?: boolean;
}

interface CalendarDateRange {
    start: Date;
    end: Date;
}

interface CalendarTaskBarSegment {
    id: string;
    title: string;
    weekIndex: number;
    columnStart: number;
    columnSpan: number;
    lane: number;
}

interface CalendarTaskBarRawSegment {
    id: string;
    title: string;
    weekIndex: number;
    columnStart: number;
    columnEnd: number;
    sortIndex: number;
}

interface CalendarTaskOccurrence {
    task: VaultTaskItem;
    start: Date;
    end: Date;
    occurrenceIndex: number;
    kind: "single" | "range";
}

interface CalendarDayContextPayload {
    dayKey: string;
    dailyNoteRelativePath: string;
    dailyNoteExists: boolean;
}

/** 日历数据加载状态。 */
interface CalendarLoadState {
    /** 是否加载中。 */
    loading: boolean;
    /** 错误信息。 */
    error: string | null;
    /** 查询命中列表。 */
    matches: FrontmatterQueryMatchItem[];
    /** 任务查询命中列表。 */
    taskItems: VaultTaskItem[];
    /** 是否已有一次可展示的数据快照。 */
    hasLoadedSnapshot: boolean;
    /** 已加载快照所属的 vault 路径。 */
    loadedVaultPath: string | null;
}

/** Panel 模式浮动笔记窗定位信息。 */
interface CalendarPanelPopoverPosition {
    /** 浮窗窗口级左偏移。 */
    left: number;
    /** 浮窗窗口级上偏移。 */
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
    /** 通知宿主该视图已具备首屏展示条件。 */
    onReady?: () => void;
}

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const PANEL_POPOVER_DISMISS_ANIMATION_MS = 160;

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

function groupCalendarItemsByDay(
    matches: FrontmatterQueryMatchItem[],
    tasks: VaultTaskItem[],
    calendarRange: CalendarDateRange,
): Map<string, CalendarDayItem[]> {
    const grouped = new Map<string, CalendarDayItem[]>();

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
                id: `note:${item.relativePath}:${dayKey}`,
                kind: "note",
                relativePath: item.relativePath,
                title: item.title,
            });
            grouped.set(dayKey, previousItems);
        });
    });

    buildCalendarTaskOccurrences(tasks, calendarRange).forEach((occurrence) => {
        const dayKeys = occurrence.kind === "range"
            ? enumerateOverlappingDayKeys(occurrence.start, occurrence.end, calendarRange)
            : [toCalendarDayKey(occurrence.start)];
        const countsTaskBudget = occurrence.kind !== "range";

        dayKeys.forEach((dayKey) => {
            const previousItems = grouped.get(dayKey) ?? [];
            previousItems.push({
                id: `task:${occurrence.task.relativePath}:${occurrence.task.line}:${occurrence.occurrenceIndex}:${dayKey}`,
                kind: "task",
                relativePath: occurrence.task.relativePath,
                title: occurrence.task.content,
                task: occurrence.task,
                countsTaskBudget,
            });
            grouped.set(dayKey, previousItems);
        });
    });

    grouped.forEach((items, dayKey) => {
        items.sort(compareCalendarDayItems);
        grouped.set(dayKey, items);
    });

    return grouped;
}

function compareCalendarDayItems(left: CalendarDayItem, right: CalendarDayItem): number {
    const leftKindOrder = left.kind === "task" ? 0 : 1;
    const rightKindOrder = right.kind === "task" ? 0 : 1;
    return leftKindOrder - rightKindOrder
        || left.title.localeCompare(right.title)
        || left.relativePath.localeCompare(right.relativePath);
}

function countCalendarDayItems(items: CalendarDayItem[]): {
    noteCount: number;
    taskCount: number;
} {
    return items.reduce((result, item) => {
        if (item.kind === "task") {
            if (item.countsTaskBudget !== false) {
                result.taskCount += 1;
            }
        } else {
            result.noteCount += 1;
        }

        return result;
    }, {
        noteCount: 0,
        taskCount: 0,
    });
}

function hasTaskCalendarMetadata(task: VaultTaskItem): boolean {
    return Boolean(
        normalizeTaskMetadataValue(task.start)
        || normalizeTaskMetadataValue(task.end)
        || normalizeTaskMetadataValue(task.due),
    );
}

function buildCalendarTaskBarSegments(
    tasks: VaultTaskItem[],
    calendarGrid: ReturnType<typeof buildCalendarMonthGrid>,
    calendarRange: CalendarDateRange,
): CalendarTaskBarSegment[] {
    const dayIndexByKey = new Map(
        calendarGrid.map((day, index) => [day.dayKey, index]),
    );
    const rawSegmentsByWeek = new Map<number, CalendarTaskBarRawSegment[]>();

    buildCalendarTaskOccurrences(tasks, calendarRange).forEach((occurrence) => {
        if (occurrence.kind !== "range") {
            return;
        }

        const startIndex = dayIndexByKey.get(toCalendarDayKey(new Date(Math.max(
            occurrence.start.getTime(),
            calendarRange.start.getTime(),
        ))));
        const endIndex = dayIndexByKey.get(toCalendarDayKey(new Date(Math.min(
            occurrence.end.getTime(),
            calendarRange.end.getTime(),
        ))));
        if (startIndex === undefined || endIndex === undefined || endIndex < startIndex) {
            return;
        }

        const startWeek = Math.floor(startIndex / 7);
        const endWeek = Math.floor(endIndex / 7);
        for (let weekIndex = startWeek; weekIndex <= endWeek; weekIndex += 1) {
            const weekStartIndex = weekIndex * 7;
            const weekEndIndex = weekStartIndex + 6;
            const segmentStartIndex = Math.max(startIndex, weekStartIndex);
            const segmentEndIndex = Math.min(endIndex, weekEndIndex);
            const segment: CalendarTaskBarRawSegment = {
                id: `task-bar:${occurrence.task.relativePath}:${occurrence.task.line}:${occurrence.occurrenceIndex}:${weekIndex}`,
                title: occurrence.task.content,
                weekIndex,
                columnStart: (segmentStartIndex % 7) + 1,
                columnEnd: (segmentEndIndex % 7) + 1,
                sortIndex: segmentStartIndex,
            };
            const previousSegments = rawSegmentsByWeek.get(weekIndex) ?? [];
            previousSegments.push(segment);
            rawSegmentsByWeek.set(weekIndex, previousSegments);
        }
    });

    return Array.from(rawSegmentsByWeek.entries()).flatMap(([, segments]) => {
        const laneEndColumns: number[] = [];
        return segments
            .sort((left, right) => (
                left.columnStart - right.columnStart
                || right.columnEnd - left.columnEnd
                || left.title.localeCompare(right.title)
                || left.sortIndex - right.sortIndex
            ))
            .map((segment) => {
                const lane = laneEndColumns.findIndex((endColumn) => endColumn < segment.columnStart);
                const nextLane = lane >= 0 ? lane : laneEndColumns.length;
                laneEndColumns[nextLane] = segment.columnEnd;
                return {
                    id: segment.id,
                    title: segment.title,
                    weekIndex: segment.weekIndex,
                    columnStart: segment.columnStart,
                    columnSpan: segment.columnEnd - segment.columnStart + 1,
                    lane: nextLane,
                };
            });
    });
}

function buildCalendarTaskOccurrences(
    tasks: VaultTaskItem[],
    calendarRange: CalendarDateRange,
): CalendarTaskOccurrence[] {
    const occurrences: CalendarTaskOccurrence[] = [];

    tasks.forEach((task) => {
        const recurrence = parseTaskRecurrence(task.recurrence);
        if (recurrence) {
            occurrences.push(...buildRecurringTaskOccurrences(task, recurrence, calendarRange));
            return;
        }

        const fullRange = resolveFullTaskDateRange(task);
        if (fullRange) {
            if (doesDateRangeOverlap(fullRange, calendarRange)) {
                occurrences.push({
                    task,
                    start: fullRange.start,
                    end: fullRange.end,
                    occurrenceIndex: 0,
                    kind: "range",
                });
            }
            return;
        }

        const singleDay = resolveSingleTaskDate(task);
        if (singleDay && doesDateRangeOverlap({ start: singleDay, end: singleDay }, calendarRange)) {
            occurrences.push({
                task,
                start: singleDay,
                end: singleDay,
                occurrenceIndex: 0,
                kind: "single",
            });
        }
    });

    return occurrences;
}

function buildRecurringTaskOccurrences(
    task: VaultTaskItem,
    recurrence: TaskRecurrenceRule,
    calendarRange: CalendarDateRange,
): CalendarTaskOccurrence[] {
    const anchor = resolveSingleTaskDate(task);
    if (!anchor) {
        return [];
    }

    const occurrences: CalendarTaskOccurrence[] = [];
    let candidate = resolveFirstRecurringCandidate(anchor, recurrence);
    let occurrenceIndex = 0;
    let guard = 0;

    while (candidate.getTime() < calendarRange.start.getTime() && guard < 5000) {
        candidate = addRecurrenceInterval(candidate, recurrence, anchor);
        occurrenceIndex += 1;
        guard += 1;
    }

    while (candidate.getTime() <= calendarRange.end.getTime() && guard < 5000) {
        if (doesTaskOccurrenceMatchRule(candidate, recurrence)) {
            occurrences.push({
                task,
                start: candidate,
                end: candidate,
                occurrenceIndex,
                kind: "single",
            });
        }

        candidate = addRecurrenceInterval(candidate, recurrence, anchor);
        occurrenceIndex += 1;
        guard += 1;
    }

    return occurrences;
}

function resolveSingleTaskDate(task: VaultTaskItem): Date | null {
    return parseTaskDate(task.start)
        ?? parseTaskDate(task.end)
        ?? parseTaskDate(task.due);
}

function resolveFullTaskDateRange(task: VaultTaskItem): CalendarDateRange | null {
    const start = parseTaskDate(task.start);
    const end = parseTaskDate(task.end);
    if (!start || !end) {
        return null;
    }

    return {
        start,
        end: end.getTime() >= start.getTime() ? end : start,
    };
}

function doesDateRangeOverlap(left: CalendarDateRange, right: CalendarDateRange): boolean {
    return left.start.getTime() <= right.end.getTime()
        && left.end.getTime() >= right.start.getTime();
}

function parseTaskDate(value: string | null | undefined): Date | null {
    const normalized = normalizeTaskMetadataValue(value);
    if (!normalized) {
        return null;
    }

    const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) {
        return null;
    }

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(year, month - 1, day);
    if (
        date.getFullYear() !== year
        || date.getMonth() !== month - 1
        || date.getDate() !== day
    ) {
        return null;
    }

    return date;
}

function enumerateOverlappingDayKeys(
    start: Date,
    end: Date,
    calendarRange: CalendarDateRange,
): string[] {
    const current = new Date(Math.max(start.getTime(), calendarRange.start.getTime()));
    const last = new Date(Math.min(end.getTime(), calendarRange.end.getTime()));
    const dayKeys: string[] = [];

    while (current.getTime() <= last.getTime()) {
        dayKeys.push(toCalendarDayKey(current));
        current.setDate(current.getDate() + 1);
    }

    return dayKeys;
}

type TaskRecurrenceUnit = "day" | "week" | "month" | "year";

interface TaskRecurrenceRule {
    unit: TaskRecurrenceUnit;
    step: number;
    weekday?: number;
    dayOfMonth?: number;
}

function parseTaskRecurrence(value: string | null | undefined): TaskRecurrenceRule | null {
    const normalized = normalizeTaskMetadataValue(value)?.toLowerCase();
    if (!normalized) {
        return null;
    }

    const namedIntervals: Record<string, TaskRecurrenceRule> = {
        daily: { unit: "day", step: 1 },
        weekly: { unit: "week", step: 1 },
        monthly: { unit: "month", step: 1 },
        yearly: { unit: "year", step: 1 },
    };
    if (namedIntervals[normalized]) {
        return namedIntervals[normalized];
    }

    const weeklyMatch = normalized.match(/^weekly-(sun|mon|tue|wed|thu|fri|sat)$/);
    if (weeklyMatch) {
        return {
            unit: "week",
            step: 1,
            weekday: weekdayTokenToIndex(weeklyMatch[1] ?? "mon"),
        };
    }

    const monthlyMatch = normalized.match(/^monthly-(\d{1,2})$/);
    if (monthlyMatch) {
        const dayOfMonth = Number(monthlyMatch[1]);
        if (dayOfMonth >= 1 && dayOfMonth <= 31) {
            return {
                unit: "month",
                step: 1,
                dayOfMonth,
            };
        }
    }

    const match = normalized.match(/^(\d+)([dwmy])$/);
    if (!match) {
        return null;
    }

    const step = Math.max(1, Number(match[1]));
    const unitByToken: Record<string, TaskRecurrenceUnit> = {
        d: "day",
        w: "week",
        m: "month",
        y: "year",
    };

    return {
        unit: unitByToken[match[2] ?? "d"],
        step,
    };
}

function addRecurrenceInterval(date: Date, recurrence: TaskRecurrenceRule, anchor?: Date): Date {
    if (recurrence.unit === "day") {
        return new Date(date.getFullYear(), date.getMonth(), date.getDate() + recurrence.step);
    }
    if (recurrence.unit === "week") {
        return new Date(date.getFullYear(), date.getMonth(), date.getDate() + recurrence.step * 7);
    }
    const preferredDay = recurrence.dayOfMonth ?? anchor?.getDate();
    if (recurrence.unit === "month") {
        return addMonthsClamped(date, recurrence.step, preferredDay);
    }

    return addMonthsClamped(date, recurrence.step * 12, preferredDay);
}

function resolveFirstRecurringCandidate(anchor: Date, recurrence: TaskRecurrenceRule): Date {
    const normalizedAnchor = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate());

    if (recurrence.weekday !== undefined) {
        const dayDelta = (recurrence.weekday - normalizedAnchor.getDay() + 7) % 7;
        return new Date(
            normalizedAnchor.getFullYear(),
            normalizedAnchor.getMonth(),
            normalizedAnchor.getDate() + dayDelta,
        );
    }

    if (recurrence.dayOfMonth !== undefined) {
        return resolveFirstMonthlyCandidate(normalizedAnchor, recurrence.dayOfMonth);
    }

    return normalizedAnchor;
}

function resolveFirstMonthlyCandidate(anchor: Date, dayOfMonth: number): Date {
    for (let monthOffset = 0; monthOffset < 24; monthOffset += 1) {
        const candidate = buildMonthDayCandidate(
            anchor.getFullYear(),
            anchor.getMonth() + monthOffset,
            dayOfMonth,
        );
        if (candidate && candidate.getTime() >= anchor.getTime()) {
            return candidate;
        }
    }

    return addMonthsClamped(anchor, 1, dayOfMonth);
}

function buildMonthDayCandidate(year: number, monthIndex: number, dayOfMonth: number): Date | null {
    const monthStart = new Date(year, monthIndex, 1);
    const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0);
    if (dayOfMonth > monthEnd.getDate()) {
        return null;
    }

    return new Date(monthStart.getFullYear(), monthStart.getMonth(), dayOfMonth);
}

function doesTaskOccurrenceMatchRule(date: Date, recurrence: TaskRecurrenceRule): boolean {
    if (recurrence.weekday !== undefined) {
        return date.getDay() === recurrence.weekday;
    }
    if (recurrence.dayOfMonth !== undefined) {
        return date.getDate() === recurrence.dayOfMonth;
    }

    return true;
}

function weekdayTokenToIndex(token: string): number {
    const weekdayIndexes: Record<string, number> = {
        sun: 0,
        mon: 1,
        tue: 2,
        wed: 3,
        thu: 4,
        fri: 5,
        sat: 6,
    };
    return weekdayIndexes[token] ?? 1;
}

function addMonthsClamped(date: Date, monthDelta: number, preferredDay?: number): Date {
    const targetMonthStart = new Date(date.getFullYear(), date.getMonth() + monthDelta, 1);
    const targetMonthEnd = new Date(targetMonthStart.getFullYear(), targetMonthStart.getMonth() + 1, 0);
    const day = Math.min(preferredDay ?? date.getDate(), targetMonthEnd.getDate());
    return new Date(targetMonthStart.getFullYear(), targetMonthStart.getMonth(), day);
}

function formatCalendarItemSubtitle(
    item: CalendarDayItem,
    t: (key: string, options?: Record<string, unknown>) => string,
): string {
    if (item.kind === "note" || !item.task) {
        return item.relativePath;
    }

    const task = item.task;
    const scheduleLabel = formatTaskScheduleForCalendar(task);
    const recurrence = normalizeTaskMetadataValue(task.recurrence);
    return [
        scheduleLabel,
        recurrence ? t("calendar.taskRepeats", { value: recurrence }) : null,
        t("calendar.taskSource", { path: task.relativePath, line: task.line }),
    ].filter((value): value is string => Boolean(value)).join(" · ");
}

function formatTaskScheduleForCalendar(task: VaultTaskItem): string | null {
    const start = formatTaskDueLabel(task.start);
    const end = formatTaskDueLabel(task.end);
    if (start && end) {
        return `${start} - ${end}`;
    }

    return start ?? end ?? formatTaskDueLabel(task.due);
}

/**
 * @function CalendarView
 * @description 渲染可在 tab/panel 之间复用的日历视图。
 * @param props 视图属性。
 * @returns React 元素。
 */
export function CalendarView(props: CalendarViewProps): ReactElement {
    const { mode, stateKey, openNote, onReady } = props;
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
        taskItems: [],
        hasLoadedSnapshot: false,
        loadedVaultPath: null,
    });
    const [isPanelNotesPopoverOpen, setIsPanelNotesPopoverOpen] = useState<boolean>(mode === "panel");
    const [isPanelNotesPopoverClosing, setIsPanelNotesPopoverClosing] = useState(false);
    const [panelPopoverPosition, setPanelPopoverPosition] = useState<CalendarPanelPopoverPosition | null>(null);
    const reloadRef = useRef<(() => Promise<void>) | null>(null);
    const rootRef = useRef<HTMLElement | null>(null);
    const hasMarkedReadyRef = useRef(false);
    const [dayContextMenuId] = useState(
        () => `${CALENDAR_DAY_CONTEXT_MENU_ID}:${String(++nextCalendarContextMenuInstanceId)}`,
    );
    const calendarSurfaceRef = useRef<HTMLElement | null>(null);
    const panelNotesPopoverRef = useRef<HTMLDivElement | null>(null);
    const panelPopoverDismissTimerRef = useRef<number | null>(null);
    const dayButtonRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

    const markdownPathSet = useMemo(() => {
        return new Set(
            files
                .filter((item) => !item.isDir)
                .map((item) => item.path.replace(/\\/g, "/")),
        );
    }, [files]);

    const calendarGrid = useMemo(() => buildCalendarMonthGrid(anchorDate), [anchorDate]);
    const calendarRange = useMemo<CalendarDateRange>(() => ({
        start: calendarGrid[0]?.date ?? anchorDate,
        end: calendarGrid[calendarGrid.length - 1]?.date ?? anchorDate,
    }), [anchorDate, calendarGrid]);
    const itemsByDay = useMemo(
        () => groupCalendarItemsByDay(loadState.matches, loadState.taskItems, calendarRange),
        [calendarRange, loadState.matches, loadState.taskItems],
    );
    const taskBarSegments = useMemo(
        () => buildCalendarTaskBarSegments(loadState.taskItems, calendarGrid, calendarRange),
        [calendarGrid, calendarRange, loadState.taskItems],
    );
    const taskBarLaneCount = useMemo(() => (
        taskBarSegments.reduce((maxLane, segment) => Math.max(maxLane, segment.lane + 1), 0)
    ), [taskBarSegments]);
    const calendarGridStyle = useMemo(() => ({
        "--calendar-task-lane-count": String(taskBarLaneCount),
    }) as CSSProperties, [taskBarLaneCount]);
    const selectedItems = itemsByDay.get(selectedDayKey) ?? [];
    const isPanelMode = mode === "panel";
    const hasCurrentVaultSnapshot = loadState.hasLoadedSnapshot && loadState.loadedVaultPath === currentVaultPath;
    const calendarSourceCount = useMemo(() => (
        loadState.matches.length + loadState.taskItems.filter(hasTaskCalendarMetadata).length
    ), [loadState.matches.length, loadState.taskItems]);
    const renderState = useMemo(() => deriveCalendarViewRenderState({
        loading: loadState.loading,
        error: loadState.error,
        currentVaultPath,
        matchCount: calendarSourceCount,
        hasLoadedSnapshot: hasCurrentVaultSnapshot,
    }), [calendarSourceCount, currentVaultPath, hasCurrentVaultSnapshot, loadState.error, loadState.loading]);
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
        if (panelPopoverDismissTimerRef.current !== null) {
            window.clearTimeout(panelPopoverDismissTimerRef.current);
            panelPopoverDismissTimerRef.current = null;
        }
        setIsPanelNotesPopoverClosing(false);
        setIsPanelNotesPopoverOpen(mode === "panel");
    }, [mode]);

    const dismissPanelNotesPopover = useCallback((): void => {
        if (!isPanelMode || !isPanelNotesPopoverOpen || isPanelNotesPopoverClosing) {
            return;
        }

        console.info("[calendar-view] panel popover dismissed by outside pointer", {
            selectedDayKey,
            stateKey,
        });
        setIsPanelNotesPopoverClosing(true);
        if (panelPopoverDismissTimerRef.current !== null) {
            window.clearTimeout(panelPopoverDismissTimerRef.current);
        }
        panelPopoverDismissTimerRef.current = window.setTimeout(() => {
            panelPopoverDismissTimerRef.current = null;
            setIsPanelNotesPopoverOpen(false);
            setIsPanelNotesPopoverClosing(false);
        }, PANEL_POPOVER_DISMISS_ANIMATION_MS);
    }, [isPanelMode, isPanelNotesPopoverClosing, isPanelNotesPopoverOpen, selectedDayKey, stateKey]);

    useEffect(() => {
        return () => {
            if (panelPopoverDismissTimerRef.current !== null) {
                window.clearTimeout(panelPopoverDismissTimerRef.current);
                panelPopoverDismissTimerRef.current = null;
            }
        };
    }, []);

    useEffect(() => {
        let cancelled = false;

        const loadCalendarNotes = async (): Promise<void> => {
            if (!currentVaultPath) {
                if (!cancelled) {
                    setLoadState({
                        loading: false,
                        error: null,
                        matches: [],
                        taskItems: [],
                        hasLoadedSnapshot: false,
                        loadedVaultPath: null,
                    });
                    if (!hasMarkedReadyRef.current) {
                        hasMarkedReadyRef.current = true;
                        onReady?.();
                    }
                }
                return;
            }

            if (!cancelled) {
                setLoadState((previous) => {
                    const canKeepSnapshot = previous.hasLoadedSnapshot && previous.loadedVaultPath === currentVaultPath;
                    return {
                        loading: true,
                        error: null,
                        matches: canKeepSnapshot ? previous.matches : [],
                        taskItems: canKeepSnapshot ? previous.taskItems : [],
                        hasLoadedSnapshot: canKeepSnapshot,
                        loadedVaultPath: canKeepSnapshot ? previous.loadedVaultPath : null,
                    };
                });
            }

            try {
                console.info("[calendar-view] load start", { currentVaultPath, mode, stateKey });
                const [response, taskItems] = await Promise.all([
                    queryVaultMarkdownFrontmatter("date"),
                    queryVaultTasks(),
                ]);
                if (cancelled) {
                    return;
                }

                setLoadState({
                    loading: false,
                    error: null,
                    matches: response.matches,
                    taskItems,
                    hasLoadedSnapshot: true,
                    loadedVaultPath: currentVaultPath,
                });
                if (!hasMarkedReadyRef.current) {
                    hasMarkedReadyRef.current = true;
                    onReady?.();
                }
                console.info("[calendar-view] load success", {
                    matchCount: response.matches.length,
                    taskCount: taskItems.length,
                    mode,
                    stateKey,
                });
            } catch (error) {
                const message = error instanceof Error ? error.message : t("calendar.loadFailed", { message: "unknown" });
                if (cancelled) {
                    return;
                }

                setLoadState((previous) => ({
                    loading: false,
                    error: message,
                    matches: previous.hasLoadedSnapshot && previous.loadedVaultPath === currentVaultPath ? previous.matches : [],
                    taskItems: previous.hasLoadedSnapshot && previous.loadedVaultPath === currentVaultPath ? previous.taskItems : [],
                    hasLoadedSnapshot: previous.hasLoadedSnapshot && previous.loadedVaultPath === currentVaultPath,
                    loadedVaultPath: previous.loadedVaultPath === currentVaultPath ? previous.loadedVaultPath : null,
                }));
                if (!hasMarkedReadyRef.current) {
                    hasMarkedReadyRef.current = true;
                    onReady?.();
                }
                console.error("[calendar-view] load failed", { message, mode, stateKey });
            }
        };

        reloadRef.current = loadCalendarNotes;
        void loadCalendarNotes();

        return () => {
            cancelled = true;
        };
    }, [currentVaultPath, mode, onReady, stateKey, t]);

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
        const unlisten = subscribePersistedContentUpdatedEvent((event) => {
            if (!isMarkdownRelativePath(event.relativePath)) {
                return;
            }

            console.info("[calendar-view] reload requested by persisted content event", {
                eventId: event.eventId,
                relativePath: event.relativePath,
                source: event.source,
            });
            void reloadRef.current?.();
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

            if (panelNotesPopoverRef.current?.contains(target)) {
                return;
            }

            dismissPanelNotesPopover();
        };

        document.addEventListener("pointerdown", handlePointerDown);
        return () => {
            document.removeEventListener("pointerdown", handlePointerDown);
        };
    }, [dismissPanelNotesPopover, isPanelMode, isPanelNotesPopoverOpen]);

    useLayoutEffect(() => {
        if (!isPanelMode || !isPanelNotesPopoverOpen) {
            setPanelPopoverPosition(null);
            return;
        }

        const selectedDayButton = dayButtonRefs.current.get(selectedDayKey);
        const popover = panelNotesPopoverRef.current;
        if (!selectedDayButton || !popover) {
            return;
        }

        const dayRect = selectedDayButton.getBoundingClientRect();
        const popoverRect = popover.getBoundingClientRect();
        const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
        const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
        const horizontalPadding = 8;
        const verticalGap = 8;

        let left = dayRect.left;
        const maxLeft = Math.max(horizontalPadding, viewportWidth - popoverRect.width - horizontalPadding);
        left = Math.min(Math.max(horizontalPadding, left), maxLeft);

        let placement: "above" | "below" = "below";
        let top = dayRect.bottom + verticalGap;
        if (top + popoverRect.height > viewportHeight - horizontalPadding && dayRect.top > popoverRect.height + verticalGap + horizontalPadding) {
            placement = "above";
            top = dayRect.top - popoverRect.height - verticalGap;
        }

        if (top < horizontalPadding) {
            top = dayRect.bottom + verticalGap;
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
    }, [isPanelMode, isPanelNotesPopoverOpen, selectedDayKey, selectedItems.length, calendarGrid, monthLabel]);

    useContextMenuProvider<CalendarDayContextPayload>({
        id: dayContextMenuId,
        buildMenu: (payload) => [
            {
                id: "calendar.daily-note",
                text: payload.dailyNoteExists ? t("calendar.openDailyNote") : t("calendar.createDailyNote"),
            },
        ],
        handleAction: async (selectedAction, payload) => {
            if (selectedAction !== "calendar.daily-note") {
                return;
            }

            if (!payload.dailyNoteExists) {
                const initialContent = buildDailyNoteInitialContent(payload.dayKey);
                await createVaultMarkdownFile(payload.dailyNoteRelativePath, initialContent);
                console.info("[calendar-view] daily note created", {
                    dayKey: payload.dayKey,
                    relativePath: payload.dailyNoteRelativePath,
                });
                void reloadRef.current?.();
            }

            await openNote(payload.dailyNoteRelativePath);
        },
    });

    const handleDayContextMenu = async (
        event: React.MouseEvent<HTMLButtonElement>,
        dayKey: string,
    ): Promise<void> => {
        const dailyNoteRelativePath = buildDailyNoteRelativePath(dayKey);
        const dailyNoteExists = markdownPathSet.has(dailyNoteRelativePath);
        await showRegisteredContextMenu(dayContextMenuId, event, {
            dayKey,
            dailyNoteRelativePath,
            dailyNoteExists,
        });
    };

    const panelNotesPopover = isPanelMode && isPanelNotesPopoverOpen ? createPortal(
        <div
            ref={panelNotesPopoverRef}
            className={[
                "calendar-tab__panel-popover",
                panelPopoverPosition ? "is-positioned" : "",
                isPanelNotesPopoverClosing ? "is-closing" : "",
            ].filter(Boolean).join(" ")}
            data-floating-surface="true"
            style={panelPopoverPosition ? {
                left: `${panelPopoverPosition.left}px`,
                top: `${panelPopoverPosition.top}px`,
            } : undefined}
            data-placement={panelPopoverPosition?.placement ?? "below"}
        >
            {selectedItems.length === 0 ? (
                <div className="calendar-tab__panel-popover-empty">{t("calendar.itemsForDayEmpty")}</div>
            ) : (
                <div className="calendar-tab__panel-popover-note-list">
                    {selectedItems.map((item) => (
                        <button
                            key={item.id}
                            type="button"
                            className="calendar-tab__note-button calendar-tab__note-button--panel-popover"
                            onClick={() => {
                                void openNote(item.relativePath);
                            }}
                        >
                            <span className={`calendar-tab__item-kind calendar-tab__item-kind--${item.kind}`}>
                                {item.kind === "task" ? t("calendar.taskItem") : t("calendar.noteItem")}
                            </span>
                            <span className="calendar-tab__note-title">{item.title}</span>
                            <span className="calendar-tab__note-path">{formatCalendarItemSubtitle(item, t)}</span>
                        </button>
                    ))}
                </div>
            )}
        </div>,
        document.body,
    ) : null;

    return (
        <section ref={rootRef} className={`calendar-tab calendar-tab--${mode}`}>
            <header className="calendar-tab__header">
                <div className="calendar-tab__month-nav">
                    <button
                        type="button"
                        className="calendar-tab__nav-button calendar-tab__nav-button--icon"
                        aria-label={t("calendar.previousMonth")}
                        title={t("calendar.previousMonth")}
                        onClick={() => {
                            setAnchorDate((previous) => shiftCalendarMonth(previous, -1));
                        }}
                    >
                        <ChevronLeft size={16} strokeWidth={2} aria-hidden="true" />
                    </button>
                    <span className="calendar-tab__month-label">{monthLabel}</span>
                    <button
                        type="button"
                        className="calendar-tab__nav-button calendar-tab__nav-button--icon"
                        aria-label={t("calendar.nextMonth")}
                        title={t("calendar.nextMonth")}
                        onClick={() => {
                            setAnchorDate((previous) => shiftCalendarMonth(previous, 1));
                        }}
                    >
                        <ChevronRight size={16} strokeWidth={2} aria-hidden="true" />
                    </button>
                    <button
                        type="button"
                        className="calendar-tab__nav-button calendar-tab__nav-button--today"
                        onClick={() => {
                            setAnchorDate(today);
                            setSelectedDayKey(toCalendarDayKey(today));
                        }}
                    >
                        <RotateCcw size={14} strokeWidth={2} aria-hidden="true" />
                        {t("calendar.today")}
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

                        <div className="calendar-tab__grid" style={calendarGridStyle}>
                            {calendarGrid.map((cell) => {
                                const dayItems = itemsByDay.get(cell.dayKey) ?? [];
                                const { noteCount, taskCount } = countCalendarDayItems(dayItems);
                                const itemCount = noteCount + taskCount;
                                const className = [
                                    "calendar-tab__day",
                                    cell.inCurrentMonth ? "" : "calendar-tab__day--outside",
                                    cell.isToday ? "calendar-tab__day--today" : "",
                                    noteCount > 0 ? "calendar-tab__day--has-notes" : "",
                                    taskCount > 0 ? "calendar-tab__day--has-tasks" : "",
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
                                            console.info("[calendar-view] day selected", { dayKey: cell.dayKey, itemCount, mode, stateKey });
                                            if (panelPopoverDismissTimerRef.current !== null) {
                                                window.clearTimeout(panelPopoverDismissTimerRef.current);
                                                panelPopoverDismissTimerRef.current = null;
                                            }
                                            setIsPanelNotesPopoverClosing(false);
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
                                        {!isPanelMode && itemCount > 0 ? (
                                            <span className="calendar-tab__day-badges">
                                                {noteCount > 0 ? (
                                                    <span
                                                        className="calendar-tab__day-badge calendar-tab__day-badge--note"
                                                        title={t("calendar.noteItem")}
                                                    >
                                                        {noteCount}
                                                    </span>
                                                ) : null}
                                                {taskCount > 0 ? (
                                                    <span
                                                        className="calendar-tab__day-badge calendar-tab__day-badge--task"
                                                        title={t("calendar.taskItem")}
                                                    >
                                                        {taskCount}
                                                    </span>
                                                ) : null}
                                            </span>
                                        ) : null}
                                    </button>
                                );
                            })}

                            {!isPanelMode && taskBarSegments.length > 0 ? (
                                <div className="calendar-tab__task-bars" aria-hidden="true">
                                    {taskBarSegments.map((segment) => (
                                        <div
                                            key={segment.id}
                                            className="calendar-tab__task-bar"
                                            style={{
                                                gridColumn: `${segment.columnStart} / span ${segment.columnSpan}`,
                                                gridRow: `${segment.weekIndex + 1}`,
                                                "--calendar-task-lane": String(segment.lane),
                                            } as CSSProperties}
                                            title={segment.title}
                                        >
                                            <span className="calendar-tab__task-bar-title">{segment.title}</span>
                                        </div>
                                    ))}
                                </div>
                            ) : null}
                        </div>

                        {panelNotesPopover}
                    </section>

                    {isPanelMode ? null : (
                        <section className="calendar-tab__details">
                            <div className="calendar-tab__details-header">
                                <h3 className="calendar-tab__details-title">{selectedDayKey}</h3>
                                <span className="calendar-tab__details-subtitle">{t("calendar.itemsForDayCount", { count: selectedItems.length })}</span>
                            </div>

                            {selectedItems.length === 0 ? (
                                <div className="calendar-tab__empty">{t("calendar.itemsForDayEmpty")}</div>
                            ) : (
                                <div className="calendar-tab__note-list">
                                    {selectedItems.map((item) => (
                                        <button
                                            key={item.id}
                                            type="button"
                                            className="calendar-tab__note-button"
                                            onClick={() => {
                                                void openNote(item.relativePath);
                                            }}
                                        >
                                            <span className={`calendar-tab__item-kind calendar-tab__item-kind--${item.kind}`}>
                                                {item.kind === "task" ? t("calendar.taskItem") : t("calendar.noteItem")}
                                            </span>
                                            <span className="calendar-tab__note-title">{item.title}</span>
                                            <span className="calendar-tab__note-path">{formatCalendarItemSubtitle(item, t)}</span>
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
