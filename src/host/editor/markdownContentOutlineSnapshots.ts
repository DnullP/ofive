/**
 * @module host/editor/markdownContentOutlineSnapshots
 * @description 从前端 canonical Markdown 内容快照派生大纲条目。
 * @dependencies
 *  - ../../api/vaultApi
 *  - ../../utils/markdownBlockDetector
 *  - ./editorContextStore
 */

import type { OutlineHeading, OutlineResponse } from "../../api/vaultApi";
import { detectExcludedLineRanges, isLineExcluded } from "../../utils/markdownBlockDetector";
import { getArticleSnapshotByPath } from "./editorContextStore";

function isMarkdownPath(path: string): boolean {
    const normalizedPath = path.toLowerCase();
    return normalizedPath.endsWith(".md") || normalizedPath.endsWith(".markdown");
}

function normalizeRelativePath(path: string): string {
    return path.replace(/\\/g, "/");
}

function buildOutlineHeadingsFromMarkdownContent(content: string): OutlineHeading[] {
    const excludedRanges = detectExcludedLineRanges(content);
    return content.split(/\r?\n/).flatMap<OutlineHeading>((line, index) => {
        const lineNumber = index + 1;
        if (isLineExcluded(lineNumber, excludedRanges)) {
            return [];
        }

        const matched = line.match(/^(#{1,6})\s+(.+)$/);
        if (!matched) {
            return [];
        }

        const text = (matched[2] ?? "").trim();
        if (!text) {
            return [];
        }

        return [{
            level: Math.min(6, Math.max(1, (matched[1] ?? "#").length)),
            text,
            line: lineNumber,
        }];
    });
}

/**
 * @function buildMarkdownContentOutlineSnapshot
 * @description 从 Markdown 文本生成大纲响应。
 * @param relativePath 文件相对路径。
 * @param content Markdown 内容。
 * @returns 大纲响应。
 */
export function buildMarkdownContentOutlineSnapshot(
    relativePath: string,
    content: string,
): OutlineResponse {
    const normalizedPath = normalizeRelativePath(relativePath);
    return {
        relativePath: normalizedPath,
        headings: buildOutlineHeadingsFromMarkdownContent(content),
    };
}

/**
 * @function getMarkdownContentOutlineSnapshot
 * @description 读取指定路径的 canonical 编辑器内容并派生大纲。
 * @param relativePath 文件相对路径。
 * @returns 有 canonical 内容时返回大纲响应，否则返回 null。
 */
export function getMarkdownContentOutlineSnapshot(relativePath: string): OutlineResponse | null {
    const snapshot = getArticleSnapshotByPath(relativePath);
    if (!snapshot?.hasContentSnapshot || !isMarkdownPath(snapshot.path)) {
        return null;
    }

    return buildMarkdownContentOutlineSnapshot(snapshot.path, snapshot.content);
}

/**
 * @function overlayMarkdownContentOutlineSnapshot
 * @description 用前端 canonical Markdown 内容覆盖同路径后端大纲响应。
 * @param persistedOutline 后端或 mock 持久态大纲响应。
 * @returns 合并后的大纲响应。
 */
export function overlayMarkdownContentOutlineSnapshot(
    persistedOutline: OutlineResponse,
): OutlineResponse {
    return getMarkdownContentOutlineSnapshot(persistedOutline.relativePath) ?? persistedOutline;
}
