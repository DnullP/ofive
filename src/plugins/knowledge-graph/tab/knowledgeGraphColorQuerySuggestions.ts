/**
 * @module plugins/knowledge-graph/tab/knowledgeGraphColorQuerySuggestions
 * @description 知识图谱颜色组查询补全：基于当前图谱节点生成 tag 与目录分组建议。
 */

import type { VaultMarkdownGraphNode } from "../../../api/vaultApi";

export type KnowledgeGraphColorQuerySuggestionKind = "scope" | "tag" | "directory";

export interface KnowledgeGraphColorQuerySuggestion {
    id: string;
    kind: KnowledgeGraphColorQuerySuggestionKind;
    value: string;
    label: string;
}

const DEFAULT_SUGGESTION_LIMIT = 8;

function normalizeValue(value: string): string {
    return value.trim().toLowerCase();
}

function normalizeTag(value: string): string {
    return normalizeValue(value).replace(/^#+/, "");
}

function uniqueSorted(values: Iterable<string>): string[] {
    return Array.from(new Set(values))
        .filter((value) => value.trim().length > 0)
        .sort((left, right) => left.localeCompare(right));
}

function collectTags(nodes: readonly VaultMarkdownGraphNode[]): string[] {
    return uniqueSorted(nodes.flatMap((node) => node.tags ?? []));
}

function collectDirectories(nodes: readonly VaultMarkdownGraphNode[]): string[] {
    const directories = new Set<string>();
    nodes.forEach((node) => {
        const segments = node.path.split("/").filter(Boolean);
        for (let index = 1; index < segments.length; index += 1) {
            const directory = segments.slice(0, index).join("/");
            directories.add(directory);
            directories.add(segments[index - 1] ?? directory);
        }
    });

    return uniqueSorted(directories);
}

function matchesPrefix(value: string, prefix: string): boolean {
    return normalizeValue(value).startsWith(normalizeValue(prefix));
}

function createScopeSuggestions(query: string): KnowledgeGraphColorQuerySuggestion[] {
    const normalizedQuery = normalizeValue(query);
    const suggestions: KnowledgeGraphColorQuerySuggestion[] = [];

    if ("tag:".startsWith(normalizedQuery)) {
        suggestions.push({
            id: "scope-tag",
            kind: "scope",
            value: "tag:",
            label: "tag",
        });
    }

    if (
        "path:".startsWith(normalizedQuery)
        || "dir:".startsWith(normalizedQuery)
        || normalizedQuery.length === 0
    ) {
        suggestions.push({
            id: "scope-directory",
            kind: "scope",
            value: "path:",
            label: "directory",
        });
    }

    return suggestions;
}

/**
 * @function buildKnowledgeGraphColorQuerySuggestions
 * @description 根据当前输入返回颜色组查询建议；先建议分组类型，再按前缀建议 tag 或目录。
 * @param nodes 当前图谱节点。
 * @param query 用户输入的查询文本。
 * @param limit 最大建议数量。
 * @returns 查询建议列表。
 */
export function buildKnowledgeGraphColorQuerySuggestions(
    nodes: readonly VaultMarkdownGraphNode[],
    query: string,
    limit = DEFAULT_SUGGESTION_LIMIT,
): KnowledgeGraphColorQuerySuggestion[] {
    const trimmedQuery = query.trim();
    const colonIndex = trimmedQuery.indexOf(":");
    const safeLimit = Math.max(1, limit);

    if (colonIndex < 0) {
        if (trimmedQuery.startsWith("#")) {
            const tagPrefix = normalizeTag(trimmedQuery);
            return collectTags(nodes)
                .filter((tag) => normalizeTag(tag).startsWith(tagPrefix))
                .slice(0, safeLimit)
                .map((tag) => ({
                    id: `tag-${tag}`,
                    kind: "tag",
                    value: `tag:#${normalizeTag(tag)}`,
                    label: tag,
                }));
        }

        return createScopeSuggestions(trimmedQuery).slice(0, safeLimit);
    }

    const scope = normalizeValue(trimmedQuery.slice(0, colonIndex + 1));
    const prefix = trimmedQuery.slice(colonIndex + 1).trim();

    if (scope === "tag:") {
        const tagPrefix = normalizeTag(prefix);
        return collectTags(nodes)
            .filter((tag) => normalizeTag(tag).startsWith(tagPrefix))
            .slice(0, safeLimit)
            .map((tag) => ({
                id: `tag-${tag}`,
                kind: "tag",
                value: `tag:#${normalizeTag(tag)}`,
                label: tag,
            }));
    }

    if (scope === "path:" || scope === "dir:") {
        const directoryPrefix = normalizeValue(prefix);
        return collectDirectories(nodes)
            .filter((directory) => matchesPrefix(directory, directoryPrefix))
            .slice(0, safeLimit)
            .map((directory) => ({
                id: `directory-${directory}`,
                kind: "directory",
                value: `${scope}${directory}`,
                label: directory,
            }));
    }

    return [];
}
