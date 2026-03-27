/**
 * @module plugins/tasks/task-board/TaskBoardTab
 * @description 任务看板 Tab：查询整个仓库中的任务，并支持基于气泡框编辑 due 和 priority。
 * @dependencies
 *  - react
 *  - dockview
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
    type ReactElement,
} from "react";
import type { IDockviewPanelProps } from "dockview";
import {
    CheckCircle2,
    Clock3,
    ListTodo,
    RefreshCcw,
    SquarePen,
} from "lucide-react";
import {
    queryVaultTasks,
    readVaultMarkdownFile,
    saveVaultMarkdownFile,
    type VaultTaskItem,
} from "../../../api/vaultApi";
import { subscribePersistedContentUpdatedEvent } from "../../../host/events/appEventBus";
import { openFileInDockview } from "../../../host/layout/openFileService";
import i18n from "../../../i18n";
import {
    dateTimeLocalInputToTaskDue,
    formatTaskDueLabel,
    normalizeTaskMetadataValue,
    replaceTaskBoardMetadataInMarkdown,
    taskDueValueToDateTimeLocalInput,
} from "../../../utils/taskSyntax";
import "./taskBoard.css";

type TaskStatusFilter = "all" | "open" | "done";
type TaskPriorityBucket = "high" | "medium" | "low" | "none";

interface TaskBoardColumn {
    id: TaskPriorityBucket;
    titleKey: string;
    tasks: VaultTaskItem[];
}

interface PopoverPosition {
    left: number;
    top: number;
    placement: "above" | "below";
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
    value: TaskStatusFilter;
    labelKey: string;
}> = [
        { value: "all", labelKey: "taskBoard.statusAll" },
        { value: "open", labelKey: "taskBoard.statusOpen" },
        { value: "done", labelKey: "taskBoard.statusDone" },
    ];

const COLUMN_DEFINITIONS: Array<{
    id: TaskPriorityBucket;
    titleKey: string;
}> = [
        { id: "high", titleKey: "taskBoard.columnHigh" },
        { id: "medium", titleKey: "taskBoard.columnMedium" },
        { id: "low", titleKey: "taskBoard.columnLow" },
        { id: "none", titleKey: "taskBoard.columnNone" },
    ];

/**
 * @function TaskBoardTab
 * @description 渲染任务看板 tab，并处理任务查询、自动刷新和气泡编辑。
 * @param props Dockview 面板属性。
 * @returns React 元素。
 */
export function TaskBoardTab(
    props: IDockviewPanelProps<Record<string, unknown>>,
): ReactElement {
    const [tasks, setTasks] = useState<VaultTaskItem[]>([]);
    const [loading, setLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);
    const [errorKind, setErrorKind] = useState<"load" | "save" | null>(null);
    const [statusFilter, setStatusFilter] = useState<TaskStatusFilter>("open");
    const [editingTask, setEditingTask] = useState<VaultTaskItem | null>(null);
    const [popoverPosition, setPopoverPosition] = useState<PopoverPosition | null>(null);
    const [dueInput, setDueInput] = useState<string>("");
    const [priorityInput, setPriorityInput] = useState<TaskPriorityBucket>("none");
    const [saving, setSaving] = useState<boolean>(false);
    const surfaceRef = useRef<HTMLDivElement | null>(null);
    const popoverRef = useRef<HTMLDivElement | null>(null);
    const editButtonRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
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

        setDueInput(taskDueValueToDateTimeLocalInput(editingTask.due));
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

    useLayoutEffect(() => {
        if (!editingTask) {
            return;
        }

        const surface = surfaceRef.current;
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
        let top = anchorRect.bottom - surfaceRect.top + verticalGap;
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
    }, [editingTask, tasks, statusFilter]);

    const columns = useMemo<TaskBoardColumn[]>(() => {
        const filteredTasks = tasks.filter((task) => {
            if (statusFilter === "open") {
                return !task.checked;
            }
            if (statusFilter === "done") {
                return task.checked;
            }
            return true;
        });

        const buckets = new Map<TaskPriorityBucket, VaultTaskItem[]>(
            COLUMN_DEFINITIONS.map((definition) => [definition.id, []]),
        );

        filteredTasks.forEach((task) => {
            buckets.get(normalizePriorityBucket(task.priority))?.push(task);
        });

        COLUMN_DEFINITIONS.forEach((definition) => {
            buckets.get(definition.id)?.sort(compareBoardTasks);
        });

        return COLUMN_DEFINITIONS.map((definition) => ({
            id: definition.id,
            titleKey: definition.titleKey,
            tasks: buckets.get(definition.id) ?? [],
        }));
    }, [statusFilter, tasks]);

    const handleOpenTask = useCallback(async (task: VaultTaskItem) => {
        console.info("[taskBoardTab] open task note", {
            relativePath: task.relativePath,
            line: task.line,
        });

        await openFileInDockview({
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

        const nextDue = dateTimeLocalInputToTaskDue(dueInput);
        const nextPriority = normalizeTaskMetadataValue(
            priorityInput === "none" ? null : priorityInput,
        );
        setSaving(true);
        setError(null);
        setErrorKind(null);

        console.info("[taskBoardTab] save task metadata start", {
            relativePath: editingTask.relativePath,
            line: editingTask.line,
            due: nextDue,
            priority: nextPriority,
        });

        try {
            const file = await readVaultMarkdownFile(editingTask.relativePath);
            const replacement = replaceTaskBoardMetadataInMarkdown(file.content, {
                line: editingTask.line,
                rawLine: editingTask.rawLine,
            }, {
                due: nextDue,
                priority: nextPriority,
            });

            await saveVaultMarkdownFile(editingTask.relativePath, replacement.content);

            setTasks((previousTasks) => previousTasks.map((task) => {
                if (
                    task.relativePath !== editingTask.relativePath
                    || task.line !== editingTask.line
                ) {
                    return task;
                }

                const { due: _due, priority: _priority, ...restTask } = task;

                return {
                    ...restTask,
                    rawLine: replacement.updatedLine,
                    ...(nextDue ? { due: nextDue } : {}),
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
    }, [dueInput, editingTask, priorityInput]);

    const totalTaskCount = tasks.length;

    return (
        /* task-board: 任务看板根容器 */
        <section className="task-board">
            {/* task-board__header: 看板头部 */}
            <header className="task-board__header">
                {/* task-board__header-copy: 标题和描述区域 */}
                <div className="task-board__header-copy">
                    {/* task-board__eyebrow: 仓库任务前导标签 */}
                    <span className="task-board__eyebrow">{t("taskBoard.eyebrow")}</span>
                    {/* task-board__title: 看板标题 */}
                    <h1 className="task-board__title">{t("taskBoard.title")}</h1>
                    {/* task-board__description: 看板说明 */}
                    <p className="task-board__description">
                        {t("taskBoard.description")}
                    </p>
                    {/* task-board__description: 任务总数摘要 */}
                    <p className="task-board__description">
                        {t("taskBoard.totalCount", { count: totalTaskCount })}
                    </p>
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

                    {/* task-board__refresh: 刷新按钮 */}
                    <button
                        type="button"
                        className="task-board__refresh"
                        onClick={() => {
                            void loadTasks();
                        }}
                    >
                        <RefreshCcw size={14} />
                        {t("taskBoard.refresh")}
                    </button>
                </div>
            </header>

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
            <div ref={surfaceRef} className="task-board__grid">
                {columns.map((column) => (
                    /* task-board__column: 单个优先级列 */
                    <section key={column.id} className="task-board__column">
                        {/* task-board__column-header: 列头 */}
                        <header className="task-board__column-header">
                            {/* task-board__column-title: 列标题 */}
                            <h2 className="task-board__column-title">{t(column.titleKey)}</h2>
                            {/* task-board__column-count: 数量徽标 */}
                            <span className="task-board__column-count">{column.tasks.length}</span>
                        </header>

                        {column.tasks.length === 0 ? (
                            /* task-board__column-empty: 列空状态 */
                            <div className="task-board__column-empty">{t("taskBoard.columnEmpty")}</div>
                        ) : (
                            /* task-board__task-list: 列任务列表 */
                            <div className="task-board__task-list">
                                {column.tasks.map((task) => {
                                    const taskKey = getTaskKey(task);
                                    const dueLabel = formatTaskDueLabel(task.due) ?? t("taskBoard.noDue");

                                    return (
                                        /* task-board__task-card: 任务卡片 */
                                        <article
                                            key={taskKey}
                                            className={`task-board__task-card${task.checked ? " is-checked" : ""}`}
                                        >
                                            {/* task-board__task-meta: 顶部元信息 */}
                                            <div className="task-board__task-meta">
                                                {/* task-board__task-status: 状态标签 */}
                                                <div className="task-board__task-status">
                                                    {task.checked ? (
                                                        <CheckCircle2 size={14} />
                                                    ) : (
                                                        <ListTodo size={14} />
                                                    )}
                                                    {task.checked ? t("taskBoard.checked") : t("taskBoard.unchecked")}
                                                </div>
                                                {/* task-board__task-path: 文件路径 */}
                                                <span className="task-board__task-path">{task.relativePath}</span>
                                            </div>

                                            {/* task-board__task-content: 任务正文 */}
                                            <p className="task-board__task-content">{task.content}</p>

                                            {/* task-board__task-footer: 底部信息和操作 */}
                                            <div className="task-board__task-footer">
                                                {/* task-board__task-tags: 截止时间和行号 */}
                                                <div className="task-board__task-tags">
                                                    <span className="task-board__task-tag">
                                                        <Clock3 size={12} />
                                                        {dueLabel}
                                                    </span>
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
                                                    >
                                                        {t("taskBoard.open")}
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
                                                    >
                                                        <SquarePen size={13} />
                                                        {t("taskBoard.edit")}
                                                    </button>
                                                </div>
                                            </div>
                                        </article>
                                    );
                                })}
                            </div>
                        )}
                    </section>
                ))}

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
                            {/* task-board__field: 截止时间字段 */}
                            <div className="task-board__field">
                                <div className="task-board__field-row">
                                    <span className="task-board__label">{t("taskBoard.dueLabel")}</span>
                                    <button
                                        type="button"
                                        className="task-board__field-action"
                                        onClick={() => {
                                            setDueInput("");
                                        }}
                                    >
                                        {t("taskBoard.clearDue")}
                                    </button>
                                </div>
                                <input
                                    className="task-board__input"
                                    type="datetime-local"
                                    value={dueInput}
                                    onChange={(event) => {
                                        setDueInput(event.target.value);
                                    }}
                                />
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

/**
 * @function normalizePriorityBucket
 * @description 将任意 priority 文本映射到看板列桶。
 * @param priority 原始 priority 文本。
 * @returns 归一化后的优先级桶。
 */
function normalizePriorityBucket(priority: string | null | undefined): TaskPriorityBucket {
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

/**
 * @function compareBoardTasks
 * @description 对同列任务按完成态、due、路径和行号排序。
 * @param left 左侧任务。
 * @param right 右侧任务。
 * @returns 排序比较值。
 */
function compareBoardTasks(left: VaultTaskItem, right: VaultTaskItem): number {
    const leftDue = normalizeTaskMetadataValue(left.due) ?? "~~~~";
    const rightDue = normalizeTaskMetadataValue(right.due) ?? "~~~~";

    if (left.checked !== right.checked) {
        return left.checked ? 1 : -1;
    }

    return leftDue.localeCompare(rightDue)
        || left.relativePath.localeCompare(right.relativePath)
        || left.line - right.line;
}