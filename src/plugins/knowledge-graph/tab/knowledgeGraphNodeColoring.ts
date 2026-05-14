/**
 * @module plugins/knowledge-graph/tab/knowledgeGraphNodeColoring
 * @description 知识图谱节点颜色组：按 Obsidian 风格的查询规则为节点生成用户指定颜色。
 */

import type { KnowledgeGraphNodeColorGroup } from "./knowledgeGraphSettings";

export interface KnowledgeGraphColorNode {
    path: string;
    tags?: string[];
}

function normalizeQuery(value: string): string {
    return value.trim().toLowerCase();
}

function normalizeTag(value: string): string {
    return value.trim().replace(/^#+/, "").toLowerCase();
}

function getFileName(path: string): string {
    return path.split("/").pop()?.toLowerCase() ?? path.toLowerCase();
}

function parseHexColor(value: string): [number, number, number, number] | null {
    const trimmed = value.trim();
    const match = trimmed.match(/^#([0-9a-f]{6})$/i);
    if (!match) {
        return null;
    }

    const hex = match[1] ?? "";
    return [
        Number.parseInt(hex.slice(0, 2), 16) / 255,
        Number.parseInt(hex.slice(2, 4), 16) / 255,
        Number.parseInt(hex.slice(4, 6), 16) / 255,
        1,
    ];
}

function nodeMatchesQuery(node: KnowledgeGraphColorNode, rawQuery: string): boolean {
    const query = normalizeQuery(rawQuery);
    if (!query) {
        return false;
    }

    if (query.startsWith("tag:")) {
        const expectedTag = normalizeTag(query.slice("tag:".length));
        return node.tags?.some((tag) => normalizeTag(tag) === expectedTag) ?? false;
    }

    if (query.startsWith("path:")) {
        const expectedPath = query.slice("path:".length).trim();
        return node.path.toLowerCase().includes(expectedPath);
    }

    if (query.startsWith("dir:")) {
        const expectedDirectory = query.slice("dir:".length).trim();
        const directory = node.path.split("/").slice(0, -1).join("/").toLowerCase();
        return directory.includes(expectedDirectory);
    }

    if (query.startsWith("file:")) {
        const expectedFile = query.slice("file:".length).trim();
        return getFileName(node.path).includes(expectedFile);
    }

    const plain = query.replace(/^#/, "");
    return (
        node.path.toLowerCase().includes(query)
        || getFileName(node.path).includes(query)
        || (node.tags?.some((tag) => normalizeTag(tag).includes(plain)) ?? false)
    );
}

/**
 * @function buildKnowledgeGraphPointColors
 * @description 根据颜色组查询规则生成 Cosmos pointColors 数组。无颜色组时返回空数组，交由主题色处理。
 * @param nodes 图谱节点。
 * @param colorGroups 颜色组列表。
 * @returns RGBA 扁平数组。
 */
export function buildKnowledgeGraphPointColors(
    nodes: readonly KnowledgeGraphColorNode[],
    colorGroups: readonly KnowledgeGraphNodeColorGroup[],
): Float32Array {
    const validGroups = colorGroups.filter((group) => (
        group.query.trim().length > 0
        && parseHexColor(group.color) !== null
    ));
    if (validGroups.length === 0) {
        return new Float32Array();
    }

    const colors = new Float32Array(nodes.length * 4);
    colors.fill(Number.NaN);
    nodes.forEach((node, index) => {
        const matchedGroup = validGroups.find((group) => nodeMatchesQuery(node, group.query));
        const color = matchedGroup ? parseHexColor(matchedGroup.color) : null;
        if (!color) {
            return;
        }

        colors[index * 4] = color[0];
        colors[index * 4 + 1] = color[1];
        colors[index * 4 + 2] = color[2];
        colors[index * 4 + 3] = color[3];
    });

    return colors;
}
