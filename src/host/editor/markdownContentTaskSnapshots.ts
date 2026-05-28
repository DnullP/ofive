/**
 * @module host/editor/markdownContentTaskSnapshots
 * @description 从前端 canonical Markdown 内容快照派生任务条目。
 * @dependencies
 *  - ../../api/vaultApi
 *  - ../../utils/markdownBlockDetector
 *  - ../../utils/taskSyntax
 *  - ./editorContextStore
 */

import type { VaultTaskItem } from "../../api/vaultApi";
import { detectExcludedLineRanges, isLineExcluded } from "../../utils/markdownBlockDetector";
import { parseTaskBoardLine } from "../../utils/taskSyntax";
import { getArticleContentSnapshots } from "./editorContextStore";

function isMarkdownPath(path: string): boolean {
    const normalizedPath = path.toLowerCase();
    return normalizedPath.endsWith(".md") || normalizedPath.endsWith(".markdown");
}

function resolveTaskTitle(relativePath: string): string {
    return relativePath.split("/").pop()?.replace(/\.(md|markdown)$/i, "") ?? relativePath;
}

function buildTaskItemsFromMarkdownSnapshot(relativePath: string, content: string): VaultTaskItem[] {
    const excludedRanges = detectExcludedLineRanges(content);
    const title = resolveTaskTitle(relativePath);
    return content.split(/\r?\n/).flatMap<VaultTaskItem>((line, index) => {
        const lineNumber = index + 1;
        if (isLineExcluded(lineNumber, excludedRanges)) {
            return [];
        }

        const parsed = parseTaskBoardLine(line);
        if (!parsed) {
            return [];
        }

        return [{
            relativePath,
            title,
            line: lineNumber,
            rawLine: line,
            checked: parsed.checked,
            content: parsed.content,
            ...(parsed.due ? { due: parsed.due } : {}),
            ...(parsed.start ? { start: parsed.start } : {}),
            ...(parsed.end ? { end: parsed.end } : {}),
            ...(parsed.recurrence ? { recurrence: parsed.recurrence } : {}),
            ...(parsed.priority ? { priority: parsed.priority } : {}),
        }];
    });
}

/**
 * @function overlayMarkdownContentTaskSnapshots
 * @description 用前端 canonical Markdown 内容快照覆盖后端任务查询中的同路径任务。
 * @param persistedTasks 后端或 mock 持久态任务列表。
 * @returns 合并后的任务列表。
 */
export function overlayMarkdownContentTaskSnapshots(
    persistedTasks: VaultTaskItem[],
): VaultTaskItem[] {
    const contentSnapshots = getArticleContentSnapshots()
        .filter((snapshot) => snapshot.hasContentSnapshot && isMarkdownPath(snapshot.path));
    if (contentSnapshots.length === 0) {
        return persistedTasks;
    }

    const overlayPaths = new Set(contentSnapshots.map((snapshot) => snapshot.path));
    const overlayTasks = contentSnapshots.flatMap((snapshot) =>
        buildTaskItemsFromMarkdownSnapshot(snapshot.path, snapshot.content),
    );

    return [
        ...persistedTasks.filter((task) => !overlayPaths.has(task.relativePath)),
        ...overlayTasks,
    ].sort((left, right) =>
        left.relativePath.localeCompare(right.relativePath) || left.line - right.line,
    );
}
