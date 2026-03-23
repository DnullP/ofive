/**
 * @module utils/taskSyntax
 * @description 任务看板语法工具：负责解析、格式化和更新 Markdown 任务行。
 * @dependencies 无外部依赖。
 *
 * @example
 * const parsed = parseTaskBoardLine(
 *   "- [ ] Ship release @2026-03-24 10:00 !high",
 * );
 *
 * const next = replaceTaskBoardMetadataInMarkdown(markdown, {
 *   line: 12,
 *   rawLine: "- [ ] Ship release `{$2026-03-24 10:00}` `{$high}`",
 * }, {
 *   due: "2026-03-25 09:00",
 *   priority: "medium",
 * });
 *
 * @exports
 *  - ParsedTaskBoardLine
 *  - parseTaskBoardLine
 *  - buildTaskBoardLine
 *  - replaceTaskBoardMetadataInMarkdown
 *  - taskDueValueToDateTimeLocalInput
 *  - dateTimeLocalInputToTaskDue
 *  - formatTaskDueLabel
 *  - normalizeTaskMetadataValue
 */

/**
 * @interface ParsedTaskBoardLine
 * @description 任务看板语法解析结果。
 */
export interface ParsedTaskBoardLine {
    /** 行缩进。 */
    indent: string;
    /** 列表 marker，例如 `-`。 */
    listMarker: string;
    /** 是否已完成。 */
    checked: boolean;
    /** 任务正文。 */
    content: string;
    /** 截止时间。 */
    due: string | null;
    /** 优先级。 */
    priority: string | null;
    /** 原始行文本。 */
    rawLine: string;
}

const TASK_PREFIX_RE = /^(\s*)([-*+]|\d+\.)\s+\[([ xX])\]\s+(.*)$/;

/**
 * @function normalizeTaskMetadataValue
 * @description 规范化任务元数据值，空字符串折叠为 null。
 * @param value 原始元数据值。
 * @returns 规范化后的字符串或 null。
 */
export function normalizeTaskMetadataValue(value: string | null | undefined): string | null {
    const normalized = value?.trim() ?? "";
    return normalized.length > 0 ? normalized : null;
}

/**
 * @function parseTaskBoardLine
 * @description 解析符合任务看板语法的 Markdown 任务行。
 * @param rawLine 原始行文本。
 * @returns 解析结果；不匹配时返回 null。
 */
export function parseTaskBoardLine(rawLine: string): ParsedTaskBoardLine | null {
    const prefixMatch = rawLine.match(TASK_PREFIX_RE);
    if (!prefixMatch) {
        return null;
    }

    const indent = prefixMatch[1] ?? "";
    const listMarker = prefixMatch[2] ?? "-";
    const checked = (prefixMatch[3] ?? " ").toLowerCase() === "x";
    const tail = prefixMatch[4] ?? "";
    const tailWithoutEdit = stripTrailingEditToken(tail);

    const priorityResult = popMetadataToken(tailWithoutEdit, "priority");
    const dueResult = popMetadataToken(priorityResult.remaining, "due");
    const content = dueResult.remaining.trim();
    if (!content) {
        return null;
    }

    return {
        indent,
        listMarker,
        checked,
        content,
        due: dueResult.value,
        priority: priorityResult.value,
        rawLine,
    };
}

/**
 * @function buildTaskBoardLine
 * @description 根据解析结果与新元数据重建任务行。
 * @param parsed 已解析的任务行。
 * @param updates 待覆盖的 due / priority。
 * @returns 重建后的任务行。
 */
export function buildTaskBoardLine(
    parsed: ParsedTaskBoardLine,
    updates: {
        due?: string | null;
        priority?: string | null;
    },
): string {
    const due = updates.due === undefined
        ? parsed.due
        : normalizeTaskMetadataValue(updates.due);
    const priority = updates.priority === undefined
        ? parsed.priority
        : normalizeTaskMetadataValue(updates.priority);
    const checkedToken = parsed.checked ? "x" : " ";
    const segments = [
        `${parsed.indent}${parsed.listMarker} [${checkedToken}] ${parsed.content}`,
    ];

    if (due) {
        segments.push(`@${due}`);
    }
    if (priority) {
        segments.push(`!${priority}`);
    }

    return segments.join(" ");
}

/**
 * @function replaceTaskBoardMetadataInMarkdown
 * @description 在整篇 Markdown 中定位目标任务并替换其 due / priority 元数据。
 * @param markdown 文档全文。
 * @param task 目标任务定位信息。
 * @param updates 元数据更新值。
 * @returns 更新后的文档与最新任务行。
 * @throws 当目标任务行无法定位或不再匹配任务语法时抛错。
 */
export function replaceTaskBoardMetadataInMarkdown(
    markdown: string,
    task: {
        line: number;
        rawLine: string;
    },
    updates: {
        due: string | null;
        priority: string | null;
    },
): {
    content: string;
    updatedLine: string;
    line: number;
} {
    const newline = markdown.includes("\r\n") ? "\r\n" : "\n";
    const lines = markdown.split(newline);
    const lineIndex = resolveTaskLineIndex(lines, task);
    const currentLine = lines[lineIndex];
    const parsed = parseTaskBoardLine(currentLine);
    if (!parsed) {
        throw new Error("目标任务行已不再符合任务看板语法");
    }

    const updatedLine = buildTaskBoardLine(parsed, updates);
    lines[lineIndex] = updatedLine;

    return {
        content: lines.join(newline),
        updatedLine,
        line: lineIndex + 1,
    };
}

/**
 * @function taskDueValueToDateTimeLocalInput
 * @description 将任务 due 字符串转换为 datetime-local 输入框值。
 * @param due 原始 due 文本。
 * @returns datetime-local 可接受的值；不支持时返回空字符串。
 */
export function taskDueValueToDateTimeLocalInput(due: string | null | undefined): string {
    const normalized = normalizeTaskMetadataValue(due);
    if (!normalized) {
        return "";
    }

    const match = normalized.match(/^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}))?$/);
    if (!match) {
        return "";
    }

    const date = match[1] ?? "";
    const time = match[2] ?? "00:00";
    return `${date}T${time}`;
}

/**
 * @function dateTimeLocalInputToTaskDue
 * @description 将 datetime-local 输入值转回任务 due 文本。
 * @param value 输入框值。
 * @returns 任务 due 文本；空输入返回 null。
 */
export function dateTimeLocalInputToTaskDue(value: string): string | null {
    const normalized = value.trim();
    if (!normalized) {
        return null;
    }

    const [datePart, timePart] = normalized.split("T");
    if (!datePart) {
        return null;
    }

    if (!timePart) {
        return datePart;
    }

    return `${datePart} ${timePart.slice(0, 5)}`;
}

/**
 * @function formatTaskDueLabel
 * @description 将任务 due 转为更适合展示的标签文本。
 * @param due 原始 due 文本。
 * @returns 可展示的时间标签；无法解析时返回原值或 null。
 */
export function formatTaskDueLabel(due: string | null | undefined): string | null {
    const normalized = normalizeTaskMetadataValue(due);
    if (!normalized) {
        return null;
    }

    const isoCandidate = normalized.replace(" ", "T");
    const date = new Date(isoCandidate);
    if (Number.isNaN(date.getTime())) {
        return normalized;
    }

    return new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    }).format(date);
}

/**
 * @function stripTrailingEditToken
 * @description 去掉任务语法尾部的旧版 `edit` 标记；未携带时原样返回。
 * @param input 任务正文尾部字符串。
 * @returns 去除旧标记后的正文。
 */
function stripTrailingEditToken(input: string): string {
    const trimmed = input.trimEnd();
    if (trimmed === "edit") {
        return "";
    }

    if (!trimmed.endsWith(" edit")) {
        return trimmed;
    }

    return trimmed.slice(0, -5).trimEnd();
}

/**
 * @function popMetadataToken
 * @description 从尾部提取一个简写或旧式元数据 token。
 * @param input 待处理字符串。
 * @param kind 元数据类型。
 * @returns 剩余正文与解析出的元数据值。
 */
function popMetadataToken(input: string, kind: "due" | "priority"): {
    remaining: string;
    value: string | null;
} {
    const trimmed = input.trimEnd();
    const shortTokenResult = popShortMetadataToken(trimmed, kind);
    if (shortTokenResult) {
        return shortTokenResult;
    }

    if (!trimmed.endsWith("}`")) {
        return {
            remaining: trimmed,
            value: null,
        };
    }

    const startIndex = trimmed.lastIndexOf("`{$");
    if (startIndex < 0) {
        return {
            remaining: trimmed,
            value: null,
        };
    }

    if (startIndex > 0 && !/\s/.test(trimmed[startIndex - 1] ?? "")) {
        return {
            remaining: trimmed,
            value: null,
        };
    }

    const value = normalizeTaskMetadataValue(
        trimmed.slice(startIndex + 3, trimmed.length - 2),
    );

    return {
        remaining: trimmed.slice(0, startIndex).trimEnd(),
        value,
    };
}

/**
 * @function popShortMetadataToken
 * @description 从尾部提取简写元数据 token，例如 `@2026-03-24 10:00` 或 `!high`。
 * @param input 待处理字符串。
 * @param kind 元数据类型。
 * @returns 命中时返回剩余正文与元数据，否则返回 null。
 */
function popShortMetadataToken(
    input: string,
    kind: "due" | "priority",
): {
    remaining: string;
    value: string | null;
} | null {
    const trimmed = input.trimEnd();
    const matcher = kind === "due"
        ? /^(.*?)(?:\s+)(@(\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2})?))$/
        : /^(.*?)(?:\s+)(!(high|medium|low))$/i;
    const match = trimmed.match(matcher);
    if (!match) {
        return null;
    }

    return {
        remaining: match[1]?.trimEnd() ?? "",
        value: normalizeTaskMetadataValue(match[3]),
    };
}

/**
 * @function resolveTaskLineIndex
 * @description 根据首选行号和原始行文本定位真实任务行。
 * @param lines 文档行数组。
 * @param task 目标任务定位信息。
 * @returns 命中的行索引（0-based）。
 * @throws 当无法稳定定位目标任务行时抛错。
 */
function resolveTaskLineIndex(
    lines: string[],
    task: {
        line: number;
        rawLine: string;
    },
): number {
    const preferredIndex = task.line - 1;
    if (preferredIndex >= 0 && preferredIndex < lines.length && lines[preferredIndex] === task.rawLine) {
        return preferredIndex;
    }

    const matchedIndexes = lines.reduce<number[]>((result, line, index) => {
        if (line === task.rawLine) {
            result.push(index);
        }
        return result;
    }, []);

    if (matchedIndexes.length === 1) {
        return matchedIndexes[0];
    }

    throw new Error("无法定位要更新的任务行，请先刷新任务看板");
}