/**
 * @module plugins/tasks/task-board/TaskBoardTab
 * @description 任务看板 Tab：查询整个仓库中的任务，并支持基于气泡框编辑起止时间、周期和优先级。
 * @dependencies
 *  - react
 *  - ../../../host/layout/workbenchContracts
 *  - lucide-react
 *  - ../../../api/vaultApi
 *  - ../../../host/events/appEventBus
 *  - ../../../host/layout/openFileService
 *  - ../../../i18n
 *  - ../../../utils/taskSyntax
 *  - ./taskBoard.css
 *
 * @exports
 *  - TaskBoardTab
 */

import {
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type Dispatch,
    type ReactElement,
    type PointerEvent as ReactPointerEvent,
    type SetStateAction,
} from "react";
import type { WorkbenchTabProps } from "../../../host/layout/workbenchContracts";
import {
    CalendarRange,
    CheckCircle2,
    ExternalLink,
    GripVertical,
    ListTodo,
    Plus,
    Repeat2,
    Settings,
    SlidersHorizontal,
    SquarePen,
    Trash2,
    X,
} from "lucide-react";
import {
    queryVaultTasks,
    readVaultMarkdownFile,
    type VaultTaskItem,
} from "../../../api/vaultApi";
import { getArticleSnapshotByPath } from "../../../host/editor/editorContextStore";
import { savePersistedMarkdownContent } from "../../../host/editor/persistedMarkdownContentSync";
import { subscribePersistedContentUpdatedEvent } from "../../../host/events/appEventBus";
import { openFileInWorkbench } from "../../../host/layout/openFileService";
import { useWorkbenchOverlayLayer, WorkbenchOverlayPortal } from "../../../host/layout/workbenchOverlayLayer";
import i18n from "../../../i18n";
import {
    dateTimeLocalInputToTaskDue,
    formatTaskDueLabel,
    normalizeTaskMetadataValue,
    replaceTaskBoardMetadataInMarkdown,
    taskDueValueToDateTimeLocalInput,
} from "../../../utils/taskSyntax";
import {
    TASK_BOARD_COLUMN_DEFAULT_WIDTH,
    buildTaskBoardColumns,
    createDefaultCustomColumn,
    getTaskBoardFilterOperators,
    isDefaultColumnId,
    normalizePriorityBucket,
    normalizeTaskBoardColumnWidth,
    normalizeTaskBoardCustomColumns,
    normalizeTaskBoardFilterCondition,
    type TaskBoardColumnModel,
    type TaskBoardCustomColumn,
    type TaskBoardFilterCondition,
    type TaskBoardFilterField,
    type TaskBoardFilterMatchMode,
    type TaskBoardFilterOperator,
    type TaskBoardStatusFilter,
    type TaskPriorityBucket,
} from "./taskBoardColumns";
import "./taskBoard.css";

type TaskRecurrenceOptionKind = "none" | "daily" | "weekly" | "monthly" | "yearly";

interface TaskRecurrenceOption {
    kind: TaskRecurrenceOptionKind;
    value: string;
    dayName?: string;
    dayOfMonth?: number;
}

interface PopoverPosition {
    left: number;
    top: number;
    placement: "above" | "below";
}

interface ColumnResizeState {
    columnId: string;
    startX: number;
    startWidth: number;
}

interface ColumnReorderState {
    columnId: string;
}

interface ColumnSettingsModalState {
    mode: "add" | "edit";
    column: TaskBoardCustomColumn;
}

const PRIORITY_OPTIONS: Array<{
    value: TaskPriorityBucket;
    labelKey: string;
}> = [
        { value: "none", labelKey: "taskBoard.priorityNone" },
        { value: "high", labelKey: "taskBoard.priorityHigh" },
        { value: "medium", labelKey: "taskBoard.priorityMedium" },
        { value: "low", labelKey: "taskBoard.priorityLow" },
    ];

const FILTER_OPTIONS: Array<{
    value: TaskBoardStatusFilter;
    labelKey: string;
}> = [
        { value: "all", labelKey: "taskBoard.statusAll" },
        { value: "open", labelKey: "taskBoard.statusOpen" },
        { value: "done", labelKey: "taskBoard.statusDone" },
    ];

const CUSTOM_FILTER_FIELDS: Array<{
    value: TaskBoardFilterField;
    titleKey: string;
}> = [
        { value: "deadline", titleKey: "taskBoard.filterFieldDeadline" },
        { value: "start", titleKey: "taskBoard.filterFieldStart" },
        { value: "end", titleKey: "taskBoard.filterFieldEnd" },
        { value: "due", titleKey: "taskBoard.filterFieldDue" },
        { value: "tag", titleKey: "taskBoard.filterFieldTag" },
        { value: "directory", titleKey: "taskBoard.filterFieldDirectory" },
        { value: "path", titleKey: "taskBoard.filterFieldPath" },
        { value: "content", titleKey: "taskBoard.filterFieldContent" },
        { value: "title", titleKey: "taskBoard.filterFieldTitle" },
        { value: "status", titleKey: "taskBoard.filterFieldStatus" },
        { value: "priority", titleKey: "taskBoard.filterFieldPriority" },
        { value: "recurrence", titleKey: "taskBoard.filterFieldRecurrence" },
    ];

const CUSTOM_FILTER_OPERATOR_KEYS: Record<TaskBoardFilterOperator, string> = {
    contains: "taskBoard.filterOperatorContains",
    notContains: "taskBoard.filterOperatorNotContains",
    equals: "taskBoard.filterOperatorEquals",
    notEquals: "taskBoard.filterOperatorNotEquals",
    startsWith: "taskBoard.filterOperatorStartsWith",
    isEmpty: "taskBoard.filterOperatorIsEmpty",
    isNotEmpty: "taskBoard.filterOperatorIsNotEmpty",
    before: "taskBoard.filterOperatorBefore",
    after: "taskBoard.filterOperatorAfter",
    on: "taskBoard.filterOperatorOn",
    between: "taskBoard.filterOperatorBetween",
    overdue: "taskBoard.filterOperatorOverdue",
    today: "taskBoard.filterOperatorToday",
    next7Days: "taskBoard.filterOperatorNext7Days",
};

const TASK_BOARD_COLUMN_SETTINGS_STORAGE_KEY = "ofive.taskBoard.columns.v1";

interface TaskBoardColumnSettings {
    customColumns: TaskBoardCustomColumn[];
    columnWidths: Record<string, number>;
    columnOrder: string[];
}

interface StoredTaskBoardColumnSettings {
    customColumns?: unknown;
    columnWidths?: Record<string, unknown>;
    columnOrder?: unknown;
}

const FILTER_OPERATORS_WITH_VALUE = new Set<TaskBoardFilterOperator>([
    "contains",
    "notContains",
    "equals",
    "notEquals",
    "startsWith",
    "before",
    "after",
    "on",
    "between",
]);

const DATE_FILTER_FIELDS = new Set<TaskBoardFilterField>([
    "deadline",
    "start",
    "end",
    "due",
]);

const ENUM_FILTER_FIELDS = new Set<TaskBoardFilterField>([
    "status",
    "priority",
]);

const STATUS_FILTER_VALUES = ["open", "done"] as const;
const PRIORITY_FILTER_VALUES = ["high", "medium", "low", "none"] as const;

function createEmptyCondition(): TaskBoardFilterCondition {
    return normalizeTaskBoardFilterCondition({
        id: `condition-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        field: "tag",
        operator: "contains",
        value: "",
    });
}

function cloneTaskBoardCustomColumns(
    columns: TaskBoardCustomColumn[],
): TaskBoardCustomColumn[] {
    return columns.map((column) => ({
        ...column,
        conditions: column.conditions.map((condition) => ({ ...condition })),
    }));
}

function cloneTaskBoardCustomColumn(column: TaskBoardCustomColumn): TaskBoardCustomColumn {
    return cloneTaskBoardCustomColumns([column])[0]!;
}

function createEditableColumnFromModel(
    column: TaskBoardColumnModel,
    title: string,
): TaskBoardCustomColumn {
    if (column.customColumn) {
        return cloneTaskBoardCustomColumn(column.customColumn);
    }

    const priority = isDefaultColumnId(column.id) ? column.id : "none";
    return {
        id: column.id,
        name: title,
        matchMode: "all",
        conditions: [{
            id: `${column.id}-priority`,
            field: "priority",
            operator: "equals",
            value: priority,
        }],
    };
}

function prepareCustomColumnsForSave(
    columns: TaskBoardCustomColumn[],
    fallbackName: string,
): TaskBoardCustomColumn[] {
    return columns.map((column) => {
        const conditions = column.conditions.map((condition) => (
            normalizeTaskBoardFilterCondition(condition)
        ));

        return {
            ...column,
            name: normalizeTaskMetadataValue(column.name) ?? fallbackName,
            matchMode: column.matchMode === "any" ? "any" : "all",
            conditions: conditions.length > 0 ? conditions : [createEmptyCondition()],
        };
    });
}

function upsertTaskBoardCustomColumn(
    columns: TaskBoardCustomColumn[],
    nextColumn: TaskBoardCustomColumn,
): TaskBoardCustomColumn[] {
    const existingIndex = columns.findIndex((column) => column.id === nextColumn.id);
    if (existingIndex < 0) {
        return [...columns, nextColumn];
    }

    return columns.map((column, index) => {
        return index === existingIndex ? nextColumn : column;
    });
}

function loadTaskBoardColumnSettings(): TaskBoardColumnSettings {
    if (typeof window === "undefined") {
        return {
            customColumns: [],
            columnWidths: {},
            columnOrder: [],
        };
    }

    try {
        const raw = window.localStorage.getItem(TASK_BOARD_COLUMN_SETTINGS_STORAGE_KEY);
        if (!raw) {
            return {
                customColumns: [],
                columnWidths: {},
                columnOrder: [],
            };
        }

        const parsed = JSON.parse(raw) as StoredTaskBoardColumnSettings;
        return {
            customColumns: normalizeTaskBoardCustomColumns(parsed.customColumns),
            columnWidths: normalizeColumnWidthRecord(parsed.columnWidths),
            columnOrder: normalizeColumnOrder(parsed.columnOrder),
        };
    } catch {
        return {
            customColumns: [],
            columnWidths: {},
            columnOrder: [],
        };
    }
}

function saveTaskBoardColumnSettings(settings: TaskBoardColumnSettings): void {
    if (typeof window === "undefined") {
        return;
    }

    window.localStorage.setItem(TASK_BOARD_COLUMN_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
}

function normalizeColumnWidthRecord(value: unknown): Record<string, number> {
    if (!value || typeof value !== "object") {
        return {};
    }

    return Object.fromEntries(
        Object.entries(value).map(([key, width]) => [
            key,
            normalizeTaskBoardColumnWidth(width),
        ]),
    );
}

function normalizeColumnOrder(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [];
    }

    const seen = new Set<string>();
    return value.flatMap((item): string[] => {
        const id = normalizeTaskMetadataValue(String(item));
        if (!id || seen.has(id)) {
            return [];
        }

        seen.add(id);
        return [id];
    });
}

function reconcileColumnOrder(columnIds: string[], columnOrder: string[]): string[] {
    const knownIds = new Set(columnIds);
    const ordered = columnOrder.filter((id) => knownIds.has(id));
    const orderedSet = new Set(ordered);
    return [
        ...ordered,
        ...columnIds.filter((id) => !orderedSet.has(id)),
    ];
}

function orderTaskBoardColumns(
    columns: TaskBoardColumnModel[],
    columnOrder: string[],
): TaskBoardColumnModel[] {
    const orderedIds = reconcileColumnOrder(columns.map((column) => column.id), columnOrder);
    const columnById = new Map(columns.map((column) => [column.id, column]));
    return orderedIds.flatMap((id): TaskBoardColumnModel[] => {
        const column = columnById.get(id);
        return column ? [column] : [];
    });
}

function shouldShowConditionValueInput(condition: TaskBoardFilterCondition): boolean {
    return FILTER_OPERATORS_WITH_VALUE.has(condition.operator);
}

function shouldShowConditionRangeEndInput(condition: TaskBoardFilterCondition): boolean {
    return condition.operator === "between";
}

function getConditionInputType(field: TaskBoardFilterField): "date" | "text" {
    return DATE_FILTER_FIELDS.has(field) ? "date" : "text";
}

function getConditionValuePlaceholder(
    field: TaskBoardFilterField,
    t: (key: string, options?: Record<string, unknown>) => string,
): string {
    if (field === "tag") {
        return t("taskBoard.filterValueTagPlaceholder");
    }
    if (field === "directory") {
        return t("taskBoard.filterValueDirectoryPlaceholder");
    }
    if (DATE_FILTER_FIELDS.has(field)) {
        return "2026-03-24";
    }
    return t("taskBoard.filterValuePlaceholder");
}

function normalizeConditionValueForField(
    field: TaskBoardFilterField,
    value: string,
): string {
    if (field === "tag") {
        return value.trim().replace(/^#/, "");
    }
    return value;
}

function getColumnTitle(
    column: TaskBoardColumnModel,
    t: (key: string, options?: Record<string, unknown>) => string,
): string {
    if (column.titleKey) {
        return t(column.titleKey);
    }
    return column.title ?? t("taskBoard.customColumnFallbackTitle");
}

function getColumnWidth(columnId: string, columnWidths: Record<string, number>): number {
    return normalizeTaskBoardColumnWidth(columnWidths[columnId] ?? TASK_BOARD_COLUMN_DEFAULT_WIDTH);
}

function applyColumnResize(
    resizeState: ColumnResizeState,
    clientX: number,
    setColumnWidths: Dispatch<SetStateAction<Record<string, number>>>,
): void {
    const nextWidth = normalizeTaskBoardColumnWidth(
        resizeState.startWidth + clientX - resizeState.startX,
    );

    setColumnWidths((previous) => {
        if (previous[resizeState.columnId] === nextWidth) {
            return previous;
        }
        return {
            ...previous,
            [resizeState.columnId]: nextWidth,
        };
    });
}

function moveColumnId(columnOrder: string[], columnId: string, targetIndex: number): string[] {
    const withoutColumn = columnOrder.filter((id) => id !== columnId);
    const boundedIndex = Math.max(0, Math.min(targetIndex, withoutColumn.length));
    return [
        ...withoutColumn.slice(0, boundedIndex),
        columnId,
        ...withoutColumn.slice(boundedIndex),
    ];
}

function hasEditableConditionValue(condition: TaskBoardFilterCondition): boolean {
    return shouldShowConditionValueInput(condition) || shouldShowConditionRangeEndInput(condition);
}

function getEnumFilterValues(field: TaskBoardFilterField): readonly string[] {
    if (field === "status") {
        return STATUS_FILTER_VALUES;
    }
    if (field === "priority") {
        return PRIORITY_FILTER_VALUES;
    }
    return [];
}

function getEnumFilterLabelKey(field: TaskBoardFilterField, value: string): string {
    if (field === "status") {
        return value === "done" ? "taskBoard.statusDone" : "taskBoard.statusOpen";
    }
    if (field === "priority") {
        const keyByValue: Record<string, string> = {
            high: "taskBoard.priorityHigh",
            medium: "taskBoard.priorityMedium",
            low: "taskBoard.priorityLow",
            none: "taskBoard.priorityNone",
        };
        return keyByValue[value] ?? "taskBoard.priorityNone";
    }
    return "taskBoard.filterValuePlaceholder";
}

function isEnumFilterField(field: TaskBoardFilterField): boolean {
    return ENUM_FILTER_FIELDS.has(field);
}

function updateConditionForField(
    condition: TaskBoardFilterCondition,
    field: TaskBoardFilterField,
): TaskBoardFilterCondition {
    const operator = getTaskBoardFilterOperators(field)[0]!;
    const firstEnumValue = getEnumFilterValues(field)[0];
    return {
        ...condition,
        field,
        operator,
        value: firstEnumValue ?? "",
        valueTo: "",
    };
}

function updateConditionForOperator(
    condition: TaskBoardFilterCondition,
    operator: TaskBoardFilterOperator,
): TaskBoardFilterCondition {
    return {
        ...condition,
        operator,
        value: hasEditableConditionValue({ ...condition, operator }) ? condition.value : "",
        valueTo: operator === "between" ? condition.valueTo ?? "" : "",
    };
}

/**
 * @function TaskBoardTab
 * @description 渲染任务看板 tab，并处理任务查询、自动刷新和气泡编辑。
 * @param props Dockview 面板属性。
 * @returns React 元素。
 */
export function TaskBoardTab(
    props: WorkbenchTabProps<Record<string, unknown>>,
): ReactElement {
    const [tasks, setTasks] = useState<VaultTaskItem[]>([]);
    const [loading, setLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);
    const [errorKind, setErrorKind] = useState<"load" | "save" | null>(null);
    const [statusFilter, setStatusFilter] = useState<TaskBoardStatusFilter>("open");
    const [editingTask, setEditingTask] = useState<VaultTaskItem | null>(null);
    const [popoverPosition, setPopoverPosition] = useState<PopoverPosition | null>(null);
    const [startInput, setStartInput] = useState<string>("");
    const [endInput, setEndInput] = useState<string>("");
    const [recurrenceInput, setRecurrenceInput] = useState<string>("");
    const [priorityInput, setPriorityInput] = useState<TaskPriorityBucket>("none");
    const [saving, setSaving] = useState<boolean>(false);
    const [isBoardEditing, setIsBoardEditing] = useState<boolean>(false);
    const [columnSettingsModal, setColumnSettingsModal] = useState<ColumnSettingsModalState | null>(null);
    const [draftCustomColumns, setDraftCustomColumns] = useState<TaskBoardCustomColumn[]>([]);
    const [draftColumnOrder, setDraftColumnOrder] = useState<string[]>([]);
    const [customColumns, setCustomColumns] = useState<TaskBoardCustomColumn[]>(() => {
        return loadTaskBoardColumnSettings().customColumns;
    });
    const [columnWidths, setColumnWidths] = useState<Record<string, number>>(() => {
        return loadTaskBoardColumnSettings().columnWidths;
    });
    const [columnOrder, setColumnOrder] = useState<string[]>(() => {
        return loadTaskBoardColumnSettings().columnOrder;
    });
    const [resizeState, setResizeState] = useState<ColumnResizeState | null>(null);
    const [reorderState, setReorderState] = useState<ColumnReorderState | null>(null);
    const overlayLayer = useWorkbenchOverlayLayer();
    const popoverRef = useRef<HTMLDivElement | null>(null);
    const editButtonRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
    const columnRefs = useRef<Map<string, HTMLElement>>(new Map());
    const customColumnsRef = useRef<TaskBoardCustomColumn[]>(customColumns);
    const columnWidthsRef = useRef<Record<string, number>>(columnWidths);
    const columnOrderRef = useRef<string[]>(columnOrder);
    const visibleColumnIdsRef = useRef<string[]>([]);
    const resizeStateRef = useRef<ColumnResizeState | null>(null);
    const reorderStateRef = useRef<ColumnReorderState | null>(null);
    const requestIdRef = useRef<number>(0);

    const t = useCallback((key: string, options?: Record<string, unknown>) => {
        return i18n.t(key, options);
    }, []);

    const loadTasks = useCallback(async () => {
        const requestId = requestIdRef.current + 1;
        requestIdRef.current = requestId;
        setLoading(true);
        setError(null);
        setErrorKind(null);

        console.info("[taskBoardTab] load tasks start", {
            requestId,
        });

        try {
            const nextTasks = await queryVaultTasks();
            if (requestIdRef.current !== requestId) {
                return;
            }

            setTasks(nextTasks);
            setLoading(false);
            console.info("[taskBoardTab] load tasks success", {
                requestId,
                taskCount: nextTasks.length,
            });
        } catch (loadError) {
            if (requestIdRef.current !== requestId) {
                return;
            }

            const message = loadError instanceof Error ? loadError.message : String(loadError);
            setError(message);
            setErrorKind("load");
            setLoading(false);
            console.error("[taskBoardTab] load tasks failed", {
                requestId,
                error: message,
            });
        }
    }, []);

    useEffect(() => {
        void loadTasks();
    }, [loadTasks]);

    useEffect(() => {
        customColumnsRef.current = customColumns;
        columnWidthsRef.current = columnWidths;
        columnOrderRef.current = columnOrder;
        saveTaskBoardColumnSettings({
            customColumns,
            columnWidths,
            columnOrder,
        });
    }, [columnOrder, columnWidths, customColumns]);

    useEffect(() => {
        resizeStateRef.current = resizeState;
    }, [resizeState]);

    useEffect(() => {
        reorderStateRef.current = reorderState;
    }, [reorderState]);

    useEffect(() => {
        if (!resizeState) {
            return;
        }

        const handlePointerMove = (event: PointerEvent): void => {
            const current = resizeStateRef.current;
            if (!current) {
                return;
            }

            applyColumnResize(current, event.clientX, setColumnWidths);
        };

        const stopResize = (): void => {
            resizeStateRef.current = null;
            setResizeState(null);
        };

        document.body.classList.add("task-board-resizing");
        window.addEventListener("pointermove", handlePointerMove);
        window.addEventListener("pointerup", stopResize);
        window.addEventListener("pointercancel", stopResize);

        return () => {
            document.body.classList.remove("task-board-resizing");
            window.removeEventListener("pointermove", handlePointerMove);
            window.removeEventListener("pointerup", stopResize);
            window.removeEventListener("pointercancel", stopResize);
        };
    }, [resizeState]);

    useEffect(() => {
        if (!reorderState) {
            return;
        }

        const stopReorder = (): void => {
            reorderStateRef.current = null;
            setReorderState(null);
        };

        document.body.classList.add("task-board-reordering");
        window.addEventListener("pointerup", stopReorder);
        window.addEventListener("pointercancel", stopReorder);

        return () => {
            document.body.classList.remove("task-board-reordering");
            window.removeEventListener("pointerup", stopReorder);
            window.removeEventListener("pointercancel", stopReorder);
        };
    }, [reorderState]);

    useEffect(() => {
        const unlisten = subscribePersistedContentUpdatedEvent((event) => {
            console.info("[taskBoardTab] persisted content updated, reload task board", {
                eventId: event.eventId,
                relativePath: event.relativePath,
                source: event.source,
            });
            void loadTasks();
        });

        return unlisten;
    }, [loadTasks]);

    useEffect(() => {
        if (!editingTask) {
            setPopoverPosition(null);
            return;
        }

        setStartInput(taskDueValueToDateTimeLocalInput(editingTask.start));
        setEndInput(taskDueValueToDateTimeLocalInput(editingTask.end));
        setRecurrenceInput(normalizeTaskMetadataValue(editingTask.recurrence) ?? "");
        setPriorityInput(normalizePriorityBucket(editingTask.priority));
    }, [editingTask]);

    useEffect(() => {
        if (!editingTask) {
            return;
        }

        const handlePointerDown = (event: PointerEvent): void => {
            const target = event.target;
            if (!(target instanceof Node)) {
                return;
            }

            if (popoverRef.current?.contains(target)) {
                return;
            }

            const editButton = editButtonRefs.current.get(getTaskKey(editingTask));
            if (editButton?.contains(target)) {
                return;
            }

            setEditingTask(null);
        };

        document.addEventListener("pointerdown", handlePointerDown);
        return () => {
            document.removeEventListener("pointerdown", handlePointerDown);
        };
    }, [editingTask]);

    useEffect(() => {
        if (!columnSettingsModal) {
            return;
        }

        const handleKeyDown = (event: KeyboardEvent): void => {
            if (event.key !== "Escape") {
                return;
            }

            event.stopPropagation();
            setColumnSettingsModal(null);
        };

        document.addEventListener("keydown", handleKeyDown);
        return () => {
            document.removeEventListener("keydown", handleKeyDown);
        };
    }, [columnSettingsModal]);

    const updatePopoverPosition = useCallback(() => {
        if (!editingTask) {
            return;
        }

        const surface = overlayLayer;
        const popover = popoverRef.current;
        const anchor = editButtonRefs.current.get(getTaskKey(editingTask));
        if (!surface || !popover || !anchor) {
            return;
        }

        const surfaceRect = surface.getBoundingClientRect();
        const anchorRect = anchor.getBoundingClientRect();
        const popoverRect = popover.getBoundingClientRect();
        const horizontalPadding = 12;
        const verticalGap = 8;

        let left = anchorRect.left - surfaceRect.left;
        const maxLeft = Math.max(
            horizontalPadding,
            surfaceRect.width - popoverRect.width - horizontalPadding,
        );
        left = Math.min(Math.max(horizontalPadding, left), maxLeft);

        let placement: "above" | "below" = "below";
        const belowTop = anchorRect.bottom - surfaceRect.top + verticalGap;
        let top = belowTop;
        if (
            top + popoverRect.height > surfaceRect.height
            && anchorRect.top - surfaceRect.top > popoverRect.height + verticalGap
        ) {
            placement = "above";
            top = anchorRect.top - surfaceRect.top - popoverRect.height - verticalGap;
        }

        if (top < horizontalPadding) {
            top = anchorRect.bottom - surfaceRect.top + verticalGap;
            placement = "below";
        }
        const maxTop = Math.max(horizontalPadding, surfaceRect.height - popoverRect.height - horizontalPadding);
        top = Math.min(Math.max(horizontalPadding, top), maxTop);
        if (top < belowTop) {
            placement = "above";
        }

        setPopoverPosition((previous) => {
            if (
                previous
                && previous.left === left
                && previous.top === top
                && previous.placement === placement
            ) {
                return previous;
            }

            return {
                left,
                top,
                placement,
            };
        });
    }, [editingTask, overlayLayer]);

    useLayoutEffect(() => {
        updatePopoverPosition();
    }, [updatePopoverPosition, tasks, statusFilter]);

    useEffect(() => {
        if (!editingTask) {
            return;
        }

        const frameId = window.requestAnimationFrame(updatePopoverPosition);
        const resizeObserver = typeof ResizeObserver === "undefined"
            ? null
            : new ResizeObserver(updatePopoverPosition);

        if (popoverRef.current) {
            resizeObserver?.observe(popoverRef.current);
        }

        if (overlayLayer) {
            resizeObserver?.observe(overlayLayer);
        }

        window.addEventListener("resize", updatePopoverPosition);
        window.addEventListener("scroll", updatePopoverPosition, true);

        return () => {
            window.cancelAnimationFrame(frameId);
            resizeObserver?.disconnect();
            window.removeEventListener("resize", updatePopoverPosition);
            window.removeEventListener("scroll", updatePopoverPosition, true);
        };
    }, [editingTask, overlayLayer, updatePopoverPosition]);

    const activeCustomColumns = isBoardEditing ? draftCustomColumns : customColumns;
    const activeColumnOrder = isBoardEditing ? draftColumnOrder : columnOrder;

    const columns = useMemo<TaskBoardColumnModel[]>(() => {
        const builtColumns = buildTaskBoardColumns(tasks, statusFilter, activeCustomColumns);
        return orderTaskBoardColumns(builtColumns, activeColumnOrder);
    }, [activeColumnOrder, activeCustomColumns, statusFilter, tasks]);

    useEffect(() => {
        visibleColumnIdsRef.current = columns.map((column) => column.id);
    }, [columns]);

    const gridTemplateColumns = useMemo(() => {
        return columns.map((column) => {
            return `${getColumnWidth(column.id, columnWidths)}px`;
        }).join(" ");
    }, [columnWidths, columns]);

    const handleStartColumnResize = useCallback((
        columnId: string,
        width: number,
        event: ReactPointerEvent<HTMLButtonElement>,
    ) => {
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        const nextResizeState = {
            columnId,
            startX: event.clientX,
            startWidth: width,
        };
        resizeStateRef.current = nextResizeState;
        setResizeState(nextResizeState);
    }, []);

    const handleColumnResizeMove = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
        const current = resizeStateRef.current;
        if (!current) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        applyColumnResize(current, event.clientX, setColumnWidths);
    }, []);

    const handleStopColumnResize = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
        if (!resizeStateRef.current) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        resizeStateRef.current = null;
        setResizeState(null);
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }
    }, []);

    const handleStartColumnReorder = useCallback((
        columnId: string,
        event: ReactPointerEvent<HTMLButtonElement>,
    ) => {
        if (!isBoardEditing) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        const nextReorderState = { columnId };
        reorderStateRef.current = nextReorderState;
        setReorderState(nextReorderState);
    }, [isBoardEditing]);

    const handleColumnReorderMove = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
        const current = reorderStateRef.current;
        if (!current) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        const visibleIds = visibleColumnIdsRef.current;
        const targetIndex = visibleIds
            .filter((id) => id !== current.columnId)
            .reduce((index, id) => {
                const rect = columnRefs.current.get(id)?.getBoundingClientRect();
                if (!rect) {
                    return index;
                }

                return event.clientX > rect.left + rect.width / 2 ? index + 1 : index;
            }, 0);

        setDraftColumnOrder((previous) => {
            const nextOrder = reconcileColumnOrder(visibleIds, previous);
            const moved = moveColumnId(nextOrder, current.columnId, targetIndex);
            if (moved.join("\u0000") === nextOrder.join("\u0000")) {
                return previous;
            }
            return moved;
        });
    }, []);

    const handleStopColumnReorder = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
        if (!reorderStateRef.current) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
        reorderStateRef.current = null;
        setReorderState(null);
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }
    }, []);

    const handleEnterBoardEdit = useCallback(() => {
        const currentColumns = orderTaskBoardColumns(
            buildTaskBoardColumns(tasks, statusFilter, customColumns),
            columnOrder,
        );
        setDraftCustomColumns(cloneTaskBoardCustomColumns(customColumns));
        setDraftColumnOrder(currentColumns.map((column) => column.id));
        setIsBoardEditing(true);
    }, [columnOrder, customColumns, statusFilter, tasks]);

    const handleSaveBoardEdit = useCallback(() => {
        const nextColumns = prepareCustomColumnsForSave(
            draftCustomColumns,
            t("taskBoard.customColumnFallbackTitle"),
        );
        setCustomColumns(nextColumns);
        setColumnOrder(reconcileColumnOrder(visibleColumnIdsRef.current, draftColumnOrder));
        setIsBoardEditing(false);
        setColumnSettingsModal(null);
    }, [draftColumnOrder, draftCustomColumns, t]);

    const handleAddCustomColumn = useCallback(() => {
        const nextColumn = createDefaultCustomColumn(t("taskBoard.newCustomColumnName"));
        setColumnSettingsModal({
            mode: "add",
            column: nextColumn,
        });
    }, [t]);

    const handleOpenColumnConfig = useCallback((column: TaskBoardColumnModel, title: string) => {
        setColumnSettingsModal({
            mode: "edit",
            column: createEditableColumnFromModel(column, title),
        });
    }, []);

    const handleCloseColumnSettings = useCallback(() => {
        setColumnSettingsModal(null);
    }, []);

    const handleUpdateColumnSettingsModal = useCallback((
        updater: (column: TaskBoardCustomColumn) => TaskBoardCustomColumn,
    ) => {
        setColumnSettingsModal((previous) => {
            if (!previous) {
                return previous;
            }

            return {
                ...previous,
                column: updater(previous.column),
            };
        });
    }, []);

    const handleSaveColumnSettings = useCallback(() => {
        if (!columnSettingsModal) {
            return;
        }

        const [nextColumn] = prepareCustomColumnsForSave(
            [columnSettingsModal.column],
            t("taskBoard.customColumnFallbackTitle"),
        );
        if (!nextColumn) {
            return;
        }

        setDraftCustomColumns((previous) => upsertTaskBoardCustomColumn(previous, nextColumn));
        setDraftColumnOrder((previous) => {
            if (previous.includes(nextColumn.id)) {
                return previous;
            }
            return [...previous, nextColumn.id];
        });
        if (columnSettingsModal.mode === "add") {
            setColumnWidths((previous) => ({
                ...previous,
                [nextColumn.id]: getColumnWidth(nextColumn.id, previous),
            }));
        }
        setColumnSettingsModal(null);
    }, [columnSettingsModal, t]);

    const handleAddCondition = useCallback(() => {
        handleUpdateColumnSettingsModal((column) => ({
            ...column,
            conditions: [
                ...column.conditions,
                createEmptyCondition(),
            ],
        }));
    }, [handleUpdateColumnSettingsModal]);

    const handleRemoveCondition = useCallback((conditionId: string) => {
        handleUpdateColumnSettingsModal((column) => {
            const conditions = column.conditions.filter((condition) => condition.id !== conditionId);
            return {
                ...column,
                conditions: conditions.length ? conditions : [createEmptyCondition()],
            };
        });
    }, [handleUpdateColumnSettingsModal]);

    const handleUpdateCondition = useCallback((
        conditionId: string,
        updater: (condition: TaskBoardFilterCondition) => TaskBoardFilterCondition,
    ) => {
        handleUpdateColumnSettingsModal((column) => ({
            ...column,
            conditions: column.conditions.map((condition) => {
                return condition.id === conditionId ? updater(condition) : condition;
            }),
        }));
    }, [handleUpdateColumnSettingsModal]);

    const handleOpenTask = useCallback(async (task: VaultTaskItem) => {
        console.info("[taskBoardTab] open task note", {
            relativePath: task.relativePath,
            line: task.line,
        });

        await openFileInWorkbench({
            containerApi: props.containerApi,
            relativePath: task.relativePath,
        });
    }, [props.containerApi]);

    const handleEditTask = useCallback((task: VaultTaskItem) => {
        console.info("[taskBoardTab] edit task", {
            relativePath: task.relativePath,
            line: task.line,
        });
        setEditingTask(task);
    }, []);

    const handleSaveEdit = useCallback(async () => {
        if (!editingTask) {
            return;
        }

        const nextStart = dateTimeLocalInputToTaskDue(startInput);
        const nextEnd = dateTimeLocalInputToTaskDue(endInput);
        const nextRecurrence = normalizeTaskMetadataValue(recurrenceInput);
        const nextPriority = normalizeTaskMetadataValue(
            priorityInput === "none" ? null : priorityInput,
        );
        setSaving(true);
        setError(null);
        setErrorKind(null);

        console.info("[taskBoardTab] save task metadata start", {
            relativePath: editingTask.relativePath,
            line: editingTask.line,
            start: nextStart,
            end: nextEnd,
            recurrence: nextRecurrence,
            priority: nextPriority,
        });

        try {
            const articleSnapshot = getArticleSnapshotByPath(editingTask.relativePath);
            const baseContent = articleSnapshot?.hasContentSnapshot
                ? articleSnapshot.content
                : await readVaultMarkdownFile(editingTask.relativePath).then((file) => file.content);
            const replacement = replaceTaskBoardMetadataInMarkdown(baseContent, {
                line: editingTask.line,
                rawLine: editingTask.rawLine,
            }, {
                due: null,
                start: nextStart,
                end: nextEnd,
                recurrence: nextRecurrence,
                priority: nextPriority,
            });

            await savePersistedMarkdownContent({
                containerApi: props.containerApi,
                relativePath: editingTask.relativePath,
                content: replacement.content,
            });

            setTasks((previousTasks) => previousTasks.map((task) => {
                if (
                    task.relativePath !== editingTask.relativePath
                    || task.line !== editingTask.line
                ) {
                    return task;
                }

                const {
                    due: _due,
                    start: _start,
                    end: _end,
                    recurrence: _recurrence,
                    priority: _priority,
                    ...restTask
                } = task;

                return {
                    ...restTask,
                    rawLine: replacement.updatedLine,
                    ...(nextStart ? { start: nextStart } : {}),
                    ...(nextEnd ? { end: nextEnd } : {}),
                    ...(nextRecurrence ? { recurrence: nextRecurrence } : {}),
                    ...(nextPriority ? { priority: nextPriority } : {}),
                };
            }));
            setEditingTask(null);
            console.info("[taskBoardTab] save task metadata success", {
                relativePath: editingTask.relativePath,
                line: editingTask.line,
            });
        } catch (saveError) {
            const message = saveError instanceof Error ? saveError.message : String(saveError);
            setError(message);
            setErrorKind("save");
            console.error("[taskBoardTab] save task metadata failed", {
                relativePath: editingTask.relativePath,
                line: editingTask.line,
                error: message,
            });
        } finally {
            setSaving(false);
        }
    }, [editingTask, endInput, priorityInput, props.containerApi, recurrenceInput, startInput]);

    const recurrenceOptions = useMemo(() => {
        return buildRecurrenceOptions(startInput, endInput);
    }, [endInput, startInput]);

    const totalTaskCount = tasks.length;

    return (
        /* task-board: 任务看板根容器 */
        <section className="task-board">
            {/* task-board__header: 看板头部 */}
            <header className="task-board__header">
                {/* task-board__header-copy: 标题与统计区域 */}
                <div className="task-board__header-copy">
                    {/* task-board__title-row: 看板标题与统计，保持头部单行密度。 */}
                    <div className="task-board__title-row">
                        <h1 className="task-board__title">{t("taskBoard.title")}</h1>
                        <span className="task-board__total-count">
                            {t("taskBoard.totalCount", { count: totalTaskCount })}
                        </span>
                    </div>
                </div>

                {/* task-board__toolbar: 操作区 */}
                <div className="task-board__toolbar">
                    {/* task-board__filters: 状态过滤器组 */}
                    <div className="task-board__filters" role="tablist" aria-label={t("taskBoard.title")}>
                        {FILTER_OPTIONS.map((option) => (
                            <button
                                key={option.value}
                                type="button"
                                className={`task-board__filter${statusFilter === option.value ? " is-active" : ""}`}
                                onClick={() => {
                                    setStatusFilter(option.value);
                                }}
                            >
                                {t(option.labelKey)}
                            </button>
                        ))}
                    </div>

                    {isBoardEditing ? (
                        <button
                            type="button"
                            className="task-board__refresh"
                            onClick={handleAddCustomColumn}
                        >
                            <Plus size={14} />
                            {t("taskBoard.addColumn")}
                        </button>
                    ) : null}

                    <button
                        type="button"
                        className="task-board__refresh"
                        title={isBoardEditing ? t("taskBoard.saveBoardEdit") : t("taskBoard.editBoard")}
                        aria-label={isBoardEditing ? t("taskBoard.saveBoardEdit") : t("taskBoard.editBoard")}
                        onClick={isBoardEditing ? handleSaveBoardEdit : handleEnterBoardEdit}
                    >
                        <SlidersHorizontal size={14} />
                        {isBoardEditing ? t("taskBoard.saveBoardEdit") : t("taskBoard.editBoard")}
                    </button>
                </div>
            </header>

            <WorkbenchOverlayPortal interactive>
                {columnSettingsModal ? (
                    <div className="task-board__modal-backdrop" data-floating-backdrop="true">
                        <section
                            className="task-board__column-settings"
                            role="dialog"
                            aria-modal="true"
                            aria-labelledby="task-board-column-settings-title"
                            data-floating-surface="true"
                        >
                        <div className="task-board__column-settings-header">
                            <div className="task-board__column-settings-title-group">
                                <h2
                                    id="task-board-column-settings-title"
                                    className="task-board__column-settings-title"
                                >
                                    {columnSettingsModal.mode === "add"
                                        ? t("taskBoard.addColumnTitle")
                                        : t("taskBoard.editColumnTitle")}
                                </h2>
                                <span className="task-board__column-settings-summary">
                                    {t("taskBoard.customColumnsSummary")}
                                </span>
                            </div>
                            <button
                                type="button"
                                className="task-board__icon-button"
                                title={t("taskBoard.closeColumnSettings")}
                                aria-label={t("taskBoard.closeColumnSettings")}
                                onClick={handleCloseColumnSettings}
                            >
                                <X size={15} />
                            </button>
                        </div>

                        <div className="task-board__column-settings-body">
                            <div className="task-board__custom-column-list">
                                    {[columnSettingsModal.column].map((column) => (
                                        <section key={column.id} className="task-board__custom-column-editor">
                                            <div className="task-board__custom-column-top">
                                                <label className="task-board__field task-board__custom-column-name">
                                                    <span className="task-board__label">{t("taskBoard.columnNameLabel")}</span>
                                                    <input
                                                        className="task-board__input"
                                                        value={column.name}
                                                        onChange={(event) => {
                                                            const value = event.target.value;
                                                            handleUpdateColumnSettingsModal((current) => ({
                                                                ...current,
                                                                name: value,
                                                            }));
                                                        }}
                                                    />
                                                </label>

                                                <label className="task-board__field task-board__custom-column-mode">
                                                    <span className="task-board__label">{t("taskBoard.matchModeLabel")}</span>
                                                    <select
                                                        className="task-board__select"
                                                        value={column.matchMode}
                                                        onChange={(event) => {
                                                            const value = event.target.value as TaskBoardFilterMatchMode;
                                                            handleUpdateColumnSettingsModal((current) => ({
                                                                ...current,
                                                                matchMode: value === "any" ? "any" : "all",
                                                            }));
                                                        }}
                                                    >
                                                        <option value="all">{t("taskBoard.matchModeAll")}</option>
                                                        <option value="any">{t("taskBoard.matchModeAny")}</option>
                                                    </select>
                                                </label>

                                            </div>

                                            <div className="task-board__condition-list">
                                                {column.conditions.map((condition) => (
                                                    <div key={condition.id} className="task-board__condition-row">
                                                        <select
                                                            className="task-board__select"
                                                            value={condition.field}
                                                            aria-label={t("taskBoard.filterFieldLabel")}
                                                            onChange={(event) => {
                                                                const field = event.target.value as TaskBoardFilterField;
                                                                handleUpdateCondition(condition.id, (current) => (
                                                                    updateConditionForField(current, field)
                                                                ));
                                                            }}
                                                        >
                                                            {CUSTOM_FILTER_FIELDS.map((field) => (
                                                                <option key={field.value} value={field.value}>
                                                                    {t(field.titleKey)}
                                                                </option>
                                                            ))}
                                                        </select>

                                                        <select
                                                            className="task-board__select"
                                                            value={condition.operator}
                                                            aria-label={t("taskBoard.filterOperatorLabel")}
                                                            onChange={(event) => {
                                                                const operator = event.target.value as TaskBoardFilterOperator;
                                                                handleUpdateCondition(condition.id, (current) => (
                                                                    updateConditionForOperator(current, operator)
                                                                ));
                                                            }}
                                                        >
                                                            {getTaskBoardFilterOperators(condition.field).map((operator) => (
                                                                <option key={operator} value={operator}>
                                                                    {t(CUSTOM_FILTER_OPERATOR_KEYS[operator])}
                                                                </option>
                                                            ))}
                                                        </select>

                                                        {shouldShowConditionValueInput(condition) ? (
                                                            isEnumFilterField(condition.field) ? (
                                                                <select
                                                                    className="task-board__select"
                                                                    value={condition.value}
                                                                    aria-label={t("taskBoard.filterValueLabel")}
                                                                    onChange={(event) => {
                                                                        const value = event.target.value;
                                                                        handleUpdateCondition(condition.id, (current) => ({
                                                                            ...current,
                                                                            value,
                                                                        }));
                                                                    }}
                                                                >
                                                                    {getEnumFilterValues(condition.field).map((value) => (
                                                                        <option key={value} value={value}>
                                                                            {t(getEnumFilterLabelKey(condition.field, value))}
                                                                        </option>
                                                                    ))}
                                                                </select>
                                                            ) : (
                                                                <input
                                                                    className="task-board__input task-board__condition-value"
                                                                    type={getConditionInputType(condition.field)}
                                                                    value={condition.value}
                                                                    placeholder={getConditionValuePlaceholder(condition.field, t)}
                                                                    aria-label={t("taskBoard.filterValueLabel")}
                                                                    onChange={(event) => {
                                                                        const value = normalizeConditionValueForField(
                                                                            condition.field,
                                                                            event.target.value,
                                                                        );
                                                                        handleUpdateCondition(condition.id, (current) => ({
                                                                            ...current,
                                                                            value,
                                                                        }));
                                                                    }}
                                                                />
                                                            )
                                                        ) : (
                                                            <span className="task-board__condition-spacer" />
                                                        )}

                                                        {shouldShowConditionRangeEndInput(condition) ? (
                                                            <input
                                                                className="task-board__input task-board__condition-value"
                                                                type="date"
                                                                value={condition.valueTo ?? ""}
                                                                placeholder={t("taskBoard.filterValueToPlaceholder")}
                                                                aria-label={t("taskBoard.filterValueToLabel")}
                                                                onChange={(event) => {
                                                                    const valueTo = event.target.value;
                                                                    handleUpdateCondition(condition.id, (current) => ({
                                                                        ...current,
                                                                        valueTo,
                                                                    }));
                                                                }}
                                                            />
                                                        ) : null}

                                                        <button
                                                            type="button"
                                                            className="task-board__icon-button"
                                                            title={t("taskBoard.removeCondition")}
                                                            aria-label={t("taskBoard.removeCondition")}
                                                            onClick={() => {
                                                                handleRemoveCondition(condition.id);
                                                            }}
                                                        >
                                                            <Trash2 size={14} />
                                                        </button>
                                                    </div>
                                                ))}
                                            </div>

                                            <button
                                                type="button"
                                                className="task-board__condition-add"
                                                onClick={handleAddCondition}
                                            >
                                                <Plus size={13} />
                                                {t("taskBoard.addCondition")}
                                            </button>
                                        </section>
                                    ))}
                                </div>
                        </div>

                        <div className="task-board__column-settings-footer">
                            <div className="task-board__column-settings-actions">
                                <button
                                    type="button"
                                    className="task-board__secondary-button"
                                    onClick={handleCloseColumnSettings}
                                >
                                    {t("taskBoard.cancel")}
                                </button>
                                <button
                                    type="button"
                                    className="task-board__primary-button"
                                    onClick={handleSaveColumnSettings}
                                >
                                    {t("taskBoard.saveColumn")}
                                </button>
                            </div>
                        </div>
                        </section>
                    </div>
                ) : null}
            </WorkbenchOverlayPortal>

            {loading ? (
                /* task-board__status: 加载状态 */
                <div className="task-board__status">{t("taskBoard.loading")}</div>
            ) : null}

            {!loading && error ? (
                /* task-board__status: 错误状态 */
                <div className="task-board__status">
                    {errorKind === "save"
                        ? t("taskBoard.saveFailed", { message: error })
                        : t("taskBoard.loadFailed", { message: error })}
                </div>
            ) : null}

            {!loading && !error && totalTaskCount === 0 ? (
                /* task-board__status: 空状态 */
                <div className="task-board__status">{t("taskBoard.empty")}</div>
            ) : null}

            {/* task-board__grid: 看板列容器，同时作为编辑气泡定位参考面 */}
            <div
                className="task-board__grid"
                style={{ gridTemplateColumns }}
            >
                {columns.map((column) => {
                    const columnTitle = getColumnTitle(column, t);
                    const columnWidth = getColumnWidth(column.id, columnWidths);

                    return (
                    /* task-board__column: 单个优先级列 */
                    <section
                        key={column.id}
                        ref={(node) => {
                            if (node) {
                                columnRefs.current.set(column.id, node);
                                return;
                            }

                            columnRefs.current.delete(column.id);
                        }}
                        className={`task-board__column${column.customColumn ? " is-custom" : ""}${resizeState?.columnId === column.id ? " is-resizing" : ""}${reorderState?.columnId === column.id ? " is-reordering" : ""}`}
                    >
                        {/* task-board__column-header: 列头 */}
                        <header className="task-board__column-header">
                            {isBoardEditing ? (
                                <button
                                    type="button"
                                    className="task-board__column-drag-handle"
                                    title={t("taskBoard.reorderColumn", { column: columnTitle })}
                                    aria-label={t("taskBoard.reorderColumn", { column: columnTitle })}
                                    onPointerDown={(event) => {
                                        handleStartColumnReorder(column.id, event);
                                    }}
                                    onPointerMove={handleColumnReorderMove}
                                    onPointerUp={handleStopColumnReorder}
                                    onPointerCancel={handleStopColumnReorder}
                                >
                                    <GripVertical size={14} />
                                </button>
                            ) : null}
                            {/* task-board__column-title: 列标题 */}
                            <h2 className="task-board__column-title">{columnTitle}</h2>
                            <div className="task-board__column-header-actions">
                                {/* task-board__column-count: 数量徽标 */}
                                <span className="task-board__column-count">{column.tasks.length}</span>
                                {isBoardEditing ? (
                                    <button
                                        type="button"
                                        className="task-board__column-config-button"
                                        title={t("taskBoard.configureColumn", { column: columnTitle })}
                                        aria-label={t("taskBoard.configureColumn", { column: columnTitle })}
                                        onClick={() => {
                                            handleOpenColumnConfig(column, columnTitle);
                                        }}
                                    >
                                        <Settings size={14} />
                                    </button>
                                ) : null}
                            </div>
                        </header>

                        {column.tasks.length === 0 ? (
                            /* task-board__column-empty: 列空状态 */
                            <div className="task-board__column-empty" aria-label={t("taskBoard.columnEmpty")} />
                        ) : (
                            /* task-board__task-list: 列任务列表 */
                            <div className="task-board__task-list">
                                {column.tasks.map((task) => {
                                    const taskKey = getTaskKey(task);
                                    const scheduleLabel = formatTaskRangeLabel(task.start, task.end);
                                    const recurrenceLabel = formatTaskRecurrenceLabel(task.recurrence, t);
                                    const taskStatusLabel = task.checked ? t("taskBoard.checked") : t("taskBoard.unchecked");

                                    return (
                                        /* task-board__task-card: 任务卡片 */
                                        <article
                                            key={taskKey}
                                            className={`task-board__task-card${task.checked ? " is-checked" : ""}`}
                                        >
                                            {/* task-board__task-meta: 顶部元信息 */}
                                            <div className="task-board__task-meta">
                                                {/* task-board__task-status: 状态标签 */}
                                                <div
                                                    className="task-board__task-status"
                                                    aria-label={taskStatusLabel}
                                                    title={taskStatusLabel}
                                                >
                                                    {task.checked ? (
                                                        <CheckCircle2 size={14} />
                                                    ) : (
                                                        <ListTodo size={14} />
                                                    )}
                                                </div>
                                                {/* task-board__task-path: 文件路径 */}
                                                <span className="task-board__task-path" title={task.relativePath}>{task.relativePath}</span>
                                            </div>

                                            {/* task-board__task-content: 任务正文 */}
                                            <p className="task-board__task-content">{task.content}</p>

                                            {/* task-board__task-footer: 底部信息和操作 */}
                                            <div className="task-board__task-footer">
                                                {/* task-board__task-tags: 时间、周期和行号 */}
                                                <div className="task-board__task-tags">
                                                    {scheduleLabel ? (
                                                        <span className="task-board__task-tag">
                                                            <CalendarRange size={12} />
                                                            {scheduleLabel}
                                                        </span>
                                                    ) : null}
                                                    {recurrenceLabel ? (
                                                        <span className="task-board__task-tag">
                                                            <Repeat2 size={12} />
                                                            {recurrenceLabel}
                                                        </span>
                                                    ) : null}
                                                    <span className="task-board__task-tag">
                                                        {t("taskBoard.lineLabel", { line: task.line })}
                                                    </span>
                                                </div>

                                                {/* task-board__task-actions: 打开与编辑按钮组 */}
                                                <div className="task-board__task-actions">
                                                    <button
                                                        type="button"
                                                        className="task-board__task-button"
                                                        onClick={() => {
                                                            void handleOpenTask(task);
                                                        }}
                                                        title={t("taskBoard.open")}
                                                        aria-label={t("taskBoard.open")}
                                                    >
                                                        <ExternalLink size={13} />
                                                        <span className="task-board__button-label">{t("taskBoard.open")}</span>
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className="task-board__task-button"
                                                        ref={(node) => {
                                                            if (node) {
                                                                editButtonRefs.current.set(taskKey, node);
                                                                return;
                                                            }

                                                            editButtonRefs.current.delete(taskKey);
                                                        }}
                                                        onClick={() => {
                                                            handleEditTask(task);
                                                        }}
                                                        title={t("taskBoard.edit")}
                                                        aria-label={t("taskBoard.edit")}
                                                    >
                                                        <SquarePen size={13} />
                                                        <span className="task-board__button-label">{t("taskBoard.edit")}</span>
                                                    </button>
                                                </div>
                                            </div>
                                        </article>
                                    );
                                })}
                            </div>
                        )}
                        <button
                            type="button"
                            className="task-board__column-resizer"
                            aria-label={t("taskBoard.resizeColumn", { column: columnTitle })}
                            title={t("taskBoard.resizeColumn", { column: columnTitle })}
                            onPointerDown={(event) => {
                                handleStartColumnResize(column.id, columnWidth, event);
                            }}
                            onPointerMove={handleColumnResizeMove}
                            onPointerUp={handleStopColumnResize}
                            onPointerCancel={handleStopColumnResize}
                        />
                    </section>
                    );
                })}

                <WorkbenchOverlayPortal>
                    {editingTask ? (
                        /* task-board__popover: 任务编辑气泡 */
                        <div
                            ref={popoverRef}
                            className={`task-board__popover${popoverPosition ? " is-positioned" : ""}`}
                            data-floating-surface="true"
                            style={popoverPosition ? {
                                left: `${popoverPosition.left}px`,
                                top: `${popoverPosition.top}px`,
                            } : undefined}
                            data-placement={popoverPosition?.placement ?? "below"}
                        >
                        {/* task-board__popover-header: 气泡头部 */}
                        <div className="task-board__popover-header">
                            {/* task-board__popover-title-group: 标题组 */}
                            <div className="task-board__popover-title-group">
                                {/* task-board__popover-title: 气泡标题 */}
                                <h3 className="task-board__popover-title">{t("taskBoard.editTitle")}</h3>
                                {/* task-board__popover-subtitle: 气泡副标题 */}
                                <span className="task-board__popover-subtitle">
                                    {editingTask.content}
                                </span>
                            </div>
                            {/* task-board__popover-close: 关闭按钮 */}
                            <button
                                type="button"
                                className="task-board__popover-close"
                                onClick={() => {
                                    setEditingTask(null);
                                }}
                                aria-label={t("taskBoard.cancel")}
                            >
                                ×
                            </button>
                        </div>

                        {/* task-board__popover-subtitle: 说明文字 */}
                        <span className="task-board__popover-subtitle">
                            {t("taskBoard.editSubtitle")}
                        </span>

                        {/* task-board__hint: 简化后的任务元数据语法提示 */}
                        <span className="task-board__hint">{t("taskBoard.syntaxHint")}</span>

                        {/* task-board__form: 编辑表单 */}
                        <div className="task-board__form">
                            {/* task-board__field-grid: 任务起止时间字段 */}
                            <div className="task-board__field-grid">
                                <div className="task-board__field">
                                    <div className="task-board__field-row">
                                        <span className="task-board__label">{t("taskBoard.startLabel")}</span>
                                        <button
                                            type="button"
                                            className="task-board__field-action"
                                            onClick={() => {
                                                setStartInput("");
                                            }}
                                        >
                                            {t("taskBoard.clearTime")}
                                        </button>
                                    </div>
                                    <input
                                        className="task-board__input"
                                        type="datetime-local"
                                        value={startInput}
                                        onChange={(event) => {
                                            setStartInput(event.target.value);
                                        }}
                                    />
                                </div>

                                <div className="task-board__field">
                                    <div className="task-board__field-row">
                                        <span className="task-board__label">{t("taskBoard.endLabel")}</span>
                                        <button
                                            type="button"
                                            className="task-board__field-action"
                                            onClick={() => {
                                                setEndInput("");
                                            }}
                                        >
                                            {t("taskBoard.clearTime")}
                                        </button>
                                    </div>
                                    <input
                                        className="task-board__input"
                                        type="datetime-local"
                                        value={endInput}
                                        onChange={(event) => {
                                            setEndInput(event.target.value);
                                        }}
                                    />
                                </div>
                            </div>

                            {/* task-board__field: 周期字段 */}
                            <div className="task-board__field">
                                <span className="task-board__label">{t("taskBoard.recurrenceLabel")}</span>
                                <div className="task-board__choice-group" role="group" aria-label={t("taskBoard.recurrenceLabel")}>
                                    {recurrenceOptions.map((option) => (
                                        <button
                                            key={option.value || "none"}
                                            type="button"
                                            className={`task-board__choice${recurrenceInput === option.value ? " is-active" : ""}`}
                                            onClick={() => {
                                                setRecurrenceInput(option.value);
                                            }}
                                        >
                                            {formatRecurrenceOptionLabel(option, t)}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* task-board__field: 优先级字段 */}
                            <div className="task-board__field">
                                <span className="task-board__label">{t("taskBoard.priorityLabel")}</span>
                                <div className="task-board__choice-group" role="group" aria-label={t("taskBoard.priorityLabel")}>
                                    {PRIORITY_OPTIONS.map((option) => (
                                        <button
                                            key={option.value}
                                            type="button"
                                            className={`task-board__choice${priorityInput === option.value ? " is-active" : ""}`}
                                            onClick={() => {
                                                setPriorityInput(option.value);
                                            }}
                                        >
                                            {t(option.labelKey)}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>

                        {/* task-board__popover-actions: 底部操作 */}
                        <div className="task-board__popover-actions">
                            <button
                                type="button"
                                className="task-board__secondary-button"
                                onClick={() => {
                                    setEditingTask(null);
                                }}
                            >
                                {t("taskBoard.cancel")}
                            </button>
                            <button
                                type="button"
                                className="task-board__primary-button"
                                onClick={() => {
                                    void handleSaveEdit();
                                }}
                                disabled={saving}
                            >
                                {saving ? t("taskBoard.saving") : t("taskBoard.save")}
                            </button>
                        </div>
                        </div>
                    ) : null}
                </WorkbenchOverlayPortal>
            </div>
        </section>
    );
}

/**
 * @function getTaskKey
 * @description 为任务条目生成稳定 key。
 * @param task 任务条目。
 * @returns key 字符串。
 */
function getTaskKey(task: VaultTaskItem): string {
    return `${task.relativePath}:${task.line}`;
}

function formatTaskRangeLabel(
    start: string | null | undefined,
    end: string | null | undefined,
): string | null {
    const startLabel = formatTaskDueLabel(start);
    const endLabel = formatTaskDueLabel(end);
    if (startLabel && endLabel) {
        return `${startLabel} - ${endLabel}`;
    }

    return startLabel ?? endLabel;
}

function formatTaskRecurrenceLabel(
    recurrence: string | null | undefined,
    t: (key: string, options?: Record<string, unknown>) => string,
): string | null {
    const normalized = normalizeTaskMetadataValue(recurrence)?.toLowerCase();
    if (!normalized) {
        return null;
    }

    return t("taskBoard.recurrenceTag", {
        value: formatTaskRecurrenceValue(normalized, t),
    });
}

function buildRecurrenceOptions(startInput: string, endInput: string): TaskRecurrenceOption[] {
    const anchor = parseDateTimeLocalInput(startInput) ?? parseDateTimeLocalInput(endInput);
    const weeklyValue = anchor ? `weekly-${getWeekdayToken(anchor)}` : "weekly";
    const monthlyValue = anchor ? `monthly-${String(anchor.getDate())}` : "monthly";

    return [
        { kind: "none", value: "" },
        { kind: "daily", value: "daily" },
        {
            kind: "weekly",
            value: weeklyValue,
            dayName: anchor ? formatWeekdayName(anchor) : undefined,
        },
        {
            kind: "monthly",
            value: monthlyValue,
            dayOfMonth: anchor?.getDate(),
        },
        { kind: "yearly", value: "yearly" },
    ];
}

function formatRecurrenceOptionLabel(
    option: TaskRecurrenceOption,
    t: (key: string, options?: Record<string, unknown>) => string,
): string {
    if (option.kind === "weekly" && option.dayName) {
        return t("taskBoard.recurrenceWeeklyOn", { day: option.dayName });
    }
    if (option.kind === "monthly" && option.dayOfMonth) {
        return t("taskBoard.recurrenceMonthlyOn", { day: option.dayOfMonth });
    }

    const labelKeyByKind: Record<TaskRecurrenceOptionKind, string> = {
        none: "taskBoard.recurrenceNone",
        daily: "taskBoard.recurrenceDaily",
        weekly: "taskBoard.recurrenceWeekly",
        monthly: "taskBoard.recurrenceMonthly",
        yearly: "taskBoard.recurrenceYearly",
    };
    return t(labelKeyByKind[option.kind]);
}

function formatTaskRecurrenceValue(
    recurrence: string,
    t: (key: string, options?: Record<string, unknown>) => string,
): string {
    const weeklyMatch = recurrence.match(/^weekly-([a-z]{3})$/);
    if (weeklyMatch) {
        return t("taskBoard.recurrenceWeeklyOn", {
            day: t(`taskBoard.weekday.${weeklyMatch[1]}`),
        });
    }

    const monthlyMatch = recurrence.match(/^monthly-(\d{1,2})$/);
    if (monthlyMatch) {
        return t("taskBoard.recurrenceMonthlyOn", {
            day: Number(monthlyMatch[1]),
        });
    }

    const labelKeyByValue: Record<string, string> = {
        daily: "taskBoard.recurrenceDaily",
        weekly: "taskBoard.recurrenceWeekly",
        monthly: "taskBoard.recurrenceMonthly",
        yearly: "taskBoard.recurrenceYearly",
    };

    return labelKeyByValue[recurrence] ? t(labelKeyByValue[recurrence]) : recurrence;
}

function parseDateTimeLocalInput(value: string): Date | null {
    const normalized = value.trim();
    if (!normalized) {
        return null;
    }

    const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})T\d{2}:\d{2}$/);
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

function getWeekdayToken(date: Date): string {
    return ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][date.getDay()] ?? "mon";
}

function formatWeekdayName(date: Date): string {
    return new Intl.DateTimeFormat(i18n.language, { weekday: "short" }).format(date);
}
