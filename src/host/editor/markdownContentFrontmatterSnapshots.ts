/**
 * @module host/editor/markdownContentFrontmatterSnapshots
 * @description 从前端 canonical Markdown 内容快照派生 frontmatter 查询结果。
 * @dependencies
 *  - yaml
 *  - ../../api/vaultApi
 *  - ./editorContextStore
 */

import YAML from "yaml";
import type { FrontmatterQueryMatchItem } from "../../api/vaultApi";
import { getArticleContentSnapshots } from "./editorContextStore";

function isMarkdownPath(path: string): boolean {
    const normalizedPath = path.toLowerCase();
    return normalizedPath.endsWith(".md") || normalizedPath.endsWith(".markdown");
}

function normalizeRelativePath(path: string): string {
    return path.replace(/\\/g, "/");
}

function resolveMarkdownTitle(relativePath: string, frontmatter: Record<string, unknown>): string {
    if (typeof frontmatter.title === "string" && frontmatter.title.trim()) {
        return frontmatter.title.trim();
    }

    return relativePath.split("/").pop()?.replace(/\.(md|markdown)$/i, "") ?? relativePath;
}

function extractFrontmatterText(content: string): string | null {
    const lines = content.split(/\r?\n/);
    if ((lines[0] ?? "").trimEnd() !== "---") {
        return null;
    }

    for (let index = 1; index < lines.length; index += 1) {
        if ((lines[index] ?? "").trimEnd() === "---") {
            return lines.slice(1, index).join("\n");
        }
    }

    return null;
}

function toFrontmatterMatchValues(value: unknown): string[] {
    if (Array.isArray(value)) {
        return value.flatMap((item) => toFrontmatterMatchValues(item));
    }

    if (value instanceof Date) {
        return [value.toISOString().slice(0, 10)];
    }

    if (value === null) {
        return ["null"];
    }

    if (typeof value === "string") {
        const normalized = value.trim();
        return normalized ? [normalized] : [];
    }

    if (typeof value === "number" || typeof value === "boolean") {
        return [String(value)];
    }

    return [];
}

function buildFrontmatterMatchFromMarkdownSnapshot(options: {
    relativePath: string;
    content: string;
    fieldName: string;
    fieldValue?: string;
}): FrontmatterQueryMatchItem | null {
    const frontmatterText = extractFrontmatterText(options.content);
    if (!frontmatterText) {
        return null;
    }

    try {
        const parsed = YAML.parse(frontmatterText);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            return null;
        }

        const frontmatter = parsed as Record<string, unknown>;
        const matchedValue = frontmatter[options.fieldName];
        if (matchedValue === undefined) {
            return null;
        }

        const matchedFieldValues = toFrontmatterMatchValues(matchedValue);
        if (matchedFieldValues.length === 0) {
            return null;
        }

        const normalizedFieldValue = options.fieldValue?.trim();
        if (normalizedFieldValue && !matchedFieldValues.includes(normalizedFieldValue)) {
            return null;
        }

        const relativePath = normalizeRelativePath(options.relativePath);
        return {
            relativePath,
            title: resolveMarkdownTitle(relativePath, frontmatter),
            matchedFieldName: options.fieldName,
            matchedFieldValues,
            frontmatter,
        };
    } catch (error) {
        console.warn("[markdownContentFrontmatterSnapshots] frontmatter parse failed", {
            relativePath: options.relativePath,
            fieldName: options.fieldName,
            message: error instanceof Error ? error.message : String(error),
        });
        return null;
    }
}

/**
 * @function overlayMarkdownContentFrontmatterMatches
 * @description 用前端 canonical Markdown 内容覆盖同路径后端 frontmatter 查询结果。
 * @param persistedMatches 后端或 mock 持久态查询命中。
 * @param options frontmatter 查询参数。
 * @returns 合并后的查询命中。
 */
export function overlayMarkdownContentFrontmatterMatches(
    persistedMatches: FrontmatterQueryMatchItem[],
    options: {
        fieldName: string;
        fieldValue?: string;
    },
): FrontmatterQueryMatchItem[] {
    const fieldName = options.fieldName.trim();
    if (!fieldName) {
        return persistedMatches;
    }

    const contentSnapshots = getArticleContentSnapshots()
        .filter((snapshot) => snapshot.hasContentSnapshot && isMarkdownPath(snapshot.path));
    if (contentSnapshots.length === 0) {
        return persistedMatches;
    }

    const overlayPaths = new Set(contentSnapshots.map((snapshot) => normalizeRelativePath(snapshot.path)));
    const overlayMatches = contentSnapshots.flatMap((snapshot) => {
        const match = buildFrontmatterMatchFromMarkdownSnapshot({
            relativePath: snapshot.path,
            content: snapshot.content,
            fieldName,
            fieldValue: options.fieldValue,
        });
        return match ? [match] : [];
    });

    return [
        ...persistedMatches.filter((match) => !overlayPaths.has(normalizeRelativePath(match.relativePath))),
        ...overlayMatches,
    ].sort((left, right) =>
        left.relativePath.localeCompare(right.relativePath)
        || left.matchedFieldName.localeCompare(right.matchedFieldName),
    );
}
