/**
 * @module plugins/tasks/task-board/taskBoardColumns
 * @description 任务看板列模型：负责默认优先级列、自定义过滤列和列宽归一化。
 * @dependencies
 *  - ../../../api/vaultApi
 *  - ../../../utils/taskSyntax
 *
 * @exports
 *  - TaskBoardStatusFilter
 *  - TaskPriorityBucket
 *  - TaskBoardCustomColumn
 *  - TaskBoardColumnModel
 *  - buildTaskBoardColumns
 *  - createDefaultCustomColumn
 *  - getTaskBoardFilterOperators
 *  - normalizeTaskBoardColumnWidth
 */

import type { VaultTaskItem } from "../../../api/vaultApi";
import { normalizeTaskMetadataValue } from "../../../utils/taskSyntax";

export type TaskBoardStatusFilter = "all" | "open" | "done";
export type TaskPriorityBucket = "high" | "medium" | "low" | "none";
export type TaskBoardFilterMatchMode = "all" | "any";
export type TaskBoardFilterField =
    | "content"
    | "title"
    | "path"
    | "directory"
    | "tag"
    | "status"
    | "priority"
    | "deadline"
    | "start"
    | "end"
    | "due"
    | "recurrence";
export type TaskBoardFilterOperator =
    | "contains"
    | "notContains"
    | "equals"
    | "notEquals"
    | "startsWith"
    | "isEmpty"
    | "isNotEmpty"
    | "before"
    | "after"
    | "on"
    | "between"
    | "overdue"
    | "today"
    | "next7Days";

export interface TaskBoardFilterCondition {
    id: string;
    field: TaskBoardFilterField;
    operator: TaskBoardFilterOperator;
    value: string;
    valueTo?: string;
}

export interface TaskBoardCustomColumn {
    id: string;
    name: string;
    matchMode: TaskBoardFilterMatchMode;
    conditions: TaskBoardFilterCondition[];
}

export interface TaskBoardColumnModel {
    id: string;
    titleKey?: string;
    title?: string;
    tasks: VaultTaskItem[];
    customColumn?: TaskBoardCustomColumn;
}

export const TASK_BOARD_COLUMN_MIN_WIDTH = 190;
export const TASK_BOARD_COLUMN_MAX_WIDTH = 560;
export const TASK_BOARD_COLUMN_DEFAULT_WIDTH = 260;

const TASK_BOARD_DEFAULT_COLUMNS: Array<{
    id: TaskPriorityBucket;
    titleKey: string;
}> = [
        { id: "high", titleKey: "taskBoard.columnHigh" },
        { id: "medium", titleKey: "taskBoard.columnMedium" },
        { id: "low", titleKey: "taskBoard.columnLow" },
        { id: "none", titleKey: "taskBoard.columnNone" },
    ];

export const TASK_BOARD_DEFAULT_COLUMN_IDS = TASK_BOARD_DEFAULT_COLUMNS.map((column) => column.id);

const TEXT_OPERATORS: TaskBoardFilterOperator[] = [
    "contains",
    "notContains",
    "equals",
    "notEquals",
    "startsWith",
    "isEmpty",
    "isNotEmpty",
];
const ENUM_OPERATORS: TaskBoardFilterOperator[] = [
    "equals",
    "notEquals",
    "isEmpty",
    "isNotEmpty",
];
const DATE_OPERATORS: TaskBoardFilterOperator[] = [
    "before",
    "on",
    "after",
    "between",
    "overdue",
    "today",
    "next7Days",
    "isEmpty",
    "isNotEmpty",
];

export function createDefaultCustomColumn(name: string): TaskBoardCustomColumn {
    const id = `custom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return {
        id,
        name,
        matchMode: "all",
        conditions: [{
            id: `${id}-condition-1`,
            field: "deadline",
            operator: "next7Days",
            value: "",
        }],
    };
}

export function buildTaskBoardColumns(
    tasks: VaultTaskItem[],
    statusFilter: TaskBoardStatusFilter,
    customColumns: TaskBoardCustomColumn[],
): TaskBoardColumnModel[] {
    const filteredTasks = tasks.filter((task) => matchesStatusFilter(task, statusFilter));
    const customColumnById = new Map(customColumns.map((column) => [column.id, column]));
    const buckets = new Map<TaskPriorityBucket, VaultTaskItem[]>(
        TASK_BOARD_DEFAULT_COLUMNS.map((definition) => [definition.id, []]),
    );

    filteredTasks.forEach((task) => {
        buckets.get(normalizePriorityBucket(task.priority))?.push(task);
    });

    const defaultColumns = TASK_BOARD_DEFAULT_COLUMNS.map((definition) => {
        const override = customColumnById.get(definition.id);
        if (override) {
            return {
                id: definition.id,
                title: override.name,
                tasks: filteredTasks
                    .filter((task) => matchesCustomColumn(task, override))
                    .sort(compareBoardTasks),
                customColumn: override,
            };
        }

        const columnTasks = buckets.get(definition.id) ?? [];
        columnTasks.sort(compareBoardTasks);
        return {
            id: definition.id,
            titleKey: definition.titleKey,
            tasks: columnTasks,
        };
    });

    const customColumnModels = customColumns
        .filter((column) => !isDefaultColumnId(column.id))
        .map((column) => ({
            id: column.id,
            title: column.name,
            tasks: filteredTasks
                .filter((task) => matchesCustomColumn(task, column))
                .sort(compareBoardTasks),
            customColumn: column,
        }));

    return [
        ...defaultColumns,
        ...customColumnModels,
    ];
}

export function getTaskBoardFilterOperators(
    field: TaskBoardFilterField,
): TaskBoardFilterOperator[] {
    if (isDateField(field)) {
        return DATE_OPERATORS;
    }
    if (field === "status" || field === "priority") {
        return ENUM_OPERATORS;
    }
    return TEXT_OPERATORS;
}

export function normalizeTaskBoardFilterCondition(
    condition: Partial<TaskBoardFilterCondition>,
): TaskBoardFilterCondition {
    const field = isTaskBoardFilterField(condition.field) ? condition.field : "deadline";
    const operators = getTaskBoardFilterOperators(field);
    const operator = condition.operator && operators.includes(condition.operator)
        ? condition.operator
        : operators[0]!;

    return {
        id: normalizeTaskMetadataValue(condition.id) ?? createConditionId(),
        field,
        operator,
        value: condition.value ?? "",
        valueTo: condition.valueTo ?? "",
    };
}

export function normalizeTaskBoardCustomColumns(
    value: unknown,
): TaskBoardCustomColumn[] {
    if (!Array.isArray(value)) {
        return [];
    }

    return value.flatMap((item): TaskBoardCustomColumn[] => {
        if (!item || typeof item !== "object") {
            return [];
        }

        const record = item as Partial<TaskBoardCustomColumn>;
        const id = normalizeTaskMetadataValue(record.id);
        const name = normalizeTaskMetadataValue(record.name);
        if (!id || !name) {
            return [];
        }

        const rawConditions = Array.isArray(record.conditions) ? record.conditions : [];
        const conditions = rawConditions
            .map((condition) => normalizeTaskBoardFilterCondition(condition))
            .filter((condition) => condition.id);
        if (conditions.length === 0) {
            conditions.push(normalizeTaskBoardFilterCondition({}));
        }

        return [{
            id,
            name,
            matchMode: record.matchMode === "any" ? "any" : "all",
            conditions,
        }];
    });
}

export function normalizeTaskBoardColumnWidth(value: unknown): number {
    const numeric = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(numeric)) {
        return TASK_BOARD_COLUMN_DEFAULT_WIDTH;
    }

    return Math.min(
        TASK_BOARD_COLUMN_MAX_WIDTH,
        Math.max(TASK_BOARD_COLUMN_MIN_WIDTH, Math.round(numeric)),
    );
}

export function isDefaultColumnId(value: string): value is TaskPriorityBucket {
    return TASK_BOARD_DEFAULT_COLUMN_IDS.includes(value as TaskPriorityBucket);
}

export function extractTaskTags(task: VaultTaskItem): string[] {
    const source = `${task.content} ${task.rawLine}`;
    const tags = new Set<string>();
    for (const match of source.matchAll(/(^|\s)#([\p{L}\p{N}_/-]+)/gu)) {
        const tag = normalizeTaskMetadataValue(match[2]?.replace(/^\/+|\/+$/g, ""));
        if (tag) {
            tags.add(tag.toLowerCase());
        }
    }
    return [...tags];
}

export function getTaskDirectory(task: VaultTaskItem): string {
    const slashIndex = task.relativePath.lastIndexOf("/");
    if (slashIndex < 0) {
        return "";
    }
    return task.relativePath.slice(0, slashIndex);
}

export function normalizePriorityBucket(priority: string | null | undefined): TaskPriorityBucket {
    const normalized = normalizeTaskMetadataValue(priority)?.toLowerCase();
    if (normalized === "high") {
        return "high";
    }
    if (normalized === "medium") {
        return "medium";
    }
    if (normalized === "low") {
        return "low";
    }
    return "none";
}

export function compareBoardTasks(left: VaultTaskItem, right: VaultTaskItem): number {
    const leftTime = getTaskSortTime(left);
    const rightTime = getTaskSortTime(right);

    if (left.checked !== right.checked) {
        return left.checked ? 1 : -1;
    }

    return leftTime.localeCompare(rightTime)
        || left.relativePath.localeCompare(right.relativePath)
        || left.line - right.line;
}

function matchesStatusFilter(task: VaultTaskItem, statusFilter: TaskBoardStatusFilter): boolean {
    if (statusFilter === "open") {
        return !task.checked;
    }
    if (statusFilter === "done") {
        return task.checked;
    }
    return true;
}

function matchesCustomColumn(task: VaultTaskItem, column: TaskBoardCustomColumn): boolean {
    if (column.conditions.length === 0) {
        return true;
    }

    const matcher = (condition: TaskBoardFilterCondition) => matchesCondition(task, condition);
    return column.matchMode === "any"
        ? column.conditions.some(matcher)
        : column.conditions.every(matcher);
}

function matchesCondition(task: VaultTaskItem, condition: TaskBoardFilterCondition): boolean {
    if (isDateField(condition.field)) {
        return matchesDateCondition(resolveDateFieldValue(task, condition.field), condition, task);
    }

    if (condition.field === "tag") {
        return matchesListCondition(extractTaskTags(task), condition);
    }

    return matchesTextCondition(resolveTextFieldValue(task, condition.field), condition);
}

function matchesListCondition(values: string[], condition: TaskBoardFilterCondition): boolean {
    if (condition.operator === "isEmpty") {
        return values.length === 0;
    }
    if (condition.operator === "isNotEmpty") {
        return values.length > 0;
    }

    const needle = normalizeTaskMetadataValue(condition.value)?.toLowerCase() ?? "";
    if (!needle) {
        return false;
    }

    const hasMatch = values.some((value) => {
        if (condition.operator === "equals" || condition.operator === "notEquals") {
            return value === normalizeTagValue(needle);
        }
        if (condition.operator === "startsWith") {
            return value.startsWith(normalizeTagValue(needle));
        }
        return value.includes(normalizeTagValue(needle));
    });

    if (condition.operator === "notContains" || condition.operator === "notEquals") {
        return !hasMatch;
    }
    return hasMatch;
}

function matchesTextCondition(value: string | null, condition: TaskBoardFilterCondition): boolean {
    const normalizedValue = normalizeTaskMetadataValue(value)?.toLowerCase() ?? "";
    const needle = normalizeTaskMetadataValue(condition.value)?.toLowerCase() ?? "";

    if (condition.operator === "isEmpty") {
        return normalizedValue.length === 0;
    }
    if (condition.operator === "isNotEmpty") {
        return normalizedValue.length > 0;
    }
    if (!needle) {
        return false;
    }

    if (condition.operator === "equals") {
        return normalizedValue === needle;
    }
    if (condition.operator === "notEquals") {
        return normalizedValue !== needle;
    }
    if (condition.operator === "startsWith") {
        return normalizedValue.startsWith(needle);
    }
    if (condition.operator === "notContains") {
        return !normalizedValue.includes(needle);
    }
    return normalizedValue.includes(needle);
}

function matchesDateCondition(
    value: string | null,
    condition: TaskBoardFilterCondition,
    task: VaultTaskItem,
): boolean {
    const date = parseTaskDate(value);
    const today = startOfDay(new Date());

    if (condition.operator === "isEmpty") {
        return date === null;
    }
    if (condition.operator === "isNotEmpty") {
        return date !== null;
    }
    if (!date) {
        return false;
    }
    if (condition.operator === "overdue") {
        return !task.checked && date.getTime() < today.getTime();
    }
    if (condition.operator === "today") {
        return isSameDay(date, today);
    }
    if (condition.operator === "next7Days") {
        const end = addDays(today, 7);
        return date.getTime() >= today.getTime() && date.getTime() <= end.getTime();
    }

    const target = parseTaskDate(condition.value);
    if (!target) {
        return false;
    }
    if (condition.operator === "before") {
        return date.getTime() < target.getTime();
    }
    if (condition.operator === "after") {
        return date.getTime() > target.getTime();
    }
    if (condition.operator === "on") {
        return isSameDay(date, target);
    }
    if (condition.operator === "between") {
        const targetEnd = parseTaskDate(condition.valueTo);
        if (!targetEnd) {
            return false;
        }
        return date.getTime() >= target.getTime() && date.getTime() <= targetEnd.getTime();
    }
    return false;
}

function resolveTextFieldValue(
    task: VaultTaskItem,
    field: TaskBoardFilterField,
): string | null {
    switch (field) {
    case "content":
        return task.content;
    case "title":
        return task.title;
    case "path":
        return task.relativePath;
    case "directory":
        return getTaskDirectory(task);
    case "status":
        return task.checked ? "done" : "open";
    case "priority":
        return normalizePriorityBucket(task.priority);
    case "recurrence":
        return task.recurrence ?? null;
    default:
        return null;
    }
}

function resolveDateFieldValue(
    task: VaultTaskItem,
    field: TaskBoardFilterField,
): string | null {
    switch (field) {
    case "deadline":
        return task.end ?? task.due ?? null;
    case "start":
        return task.start ?? null;
    case "end":
        return task.end ?? null;
    case "due":
        return task.due ?? null;
    default:
        return null;
    }
}

function getTaskSortTime(task: VaultTaskItem): string {
    return normalizeTaskMetadataValue(task.start)
        ?? normalizeTaskMetadataValue(task.end)
        ?? normalizeTaskMetadataValue(task.due)
        ?? "~~~~";
}

function parseTaskDate(value: string | null | undefined): Date | null {
    const normalized = normalizeTaskMetadataValue(value);
    if (!normalized) {
        return null;
    }

    const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T]\d{2}:\d{2})?$/);
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
    return startOfDay(date);
}

function startOfDay(date: Date): Date {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number): Date {
    const next = new Date(date);
    next.setDate(next.getDate() + days);
    return next;
}

function isSameDay(left: Date, right: Date): boolean {
    return left.getFullYear() === right.getFullYear()
        && left.getMonth() === right.getMonth()
        && left.getDate() === right.getDate();
}

function isDateField(field: TaskBoardFilterField): boolean {
    return field === "deadline" || field === "start" || field === "end" || field === "due";
}

function isTaskBoardFilterField(value: unknown): value is TaskBoardFilterField {
    return typeof value === "string" && [
        "content",
        "title",
        "path",
        "directory",
        "tag",
        "status",
        "priority",
        "deadline",
        "start",
        "end",
        "due",
        "recurrence",
    ].includes(value);
}

function normalizeTagValue(value: string): string {
    return value.trim().replace(/^#/, "").toLowerCase();
}

function createConditionId(): string {
    return `condition-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
