/**
 * @module plugins/ai-chat/aiChatConfirmationPreview
 * @description AI 工具确认预览辅助模块：负责解析确认参数并在适用时生成 Markdown patch 的 diff 预览。
 * @dependencies
 *   - ./aiChatStreamState
 *
 * @example
 *   const preview = buildConfirmationPreview(confirmation);
 *   if (preview?.kind === "markdown-patch") {
 *       console.log(preview.diffText);
 *   }
 */

import type { PendingToolConfirmation } from "./aiChatStreamState";

interface MarkdownPatchArgsPreview {
    relativePath: string;
    unifiedDiff: string;
}

export interface MarkdownPatchConfirmationPreview {
    kind: "markdown-patch";
    relativePath: string;
    hunkCount: number;
    diffText: string;
    rawArgsJson: string;
}

export interface GenericConfirmationPreview {
    kind: "generic";
    rawArgsJson: string;
}

export type ConfirmationPreview = MarkdownPatchConfirmationPreview | GenericConfirmationPreview;

const MARKDOWN_PATCH_TOOL_NAMES = new Set([
    "vault_apply_markdown_patch",
    "vault.apply_markdown_patch",
]);

/**
 * @function buildConfirmationPreview
 * @description 根据待确认的工具调用生成可视化预览。
 * @param confirmation 待确认的工具请求。
 * @returns 结构化确认预览；无法解析时返回 null。
 */
export function buildConfirmationPreview(
    confirmation: PendingToolConfirmation,
): ConfirmationPreview | null {
    const rawArgsJson = confirmation.toolArgsJson?.trim() ?? "";
    if (!rawArgsJson || rawArgsJson === "{}") {
        return null;
    }

    const parsed = parseJson(rawArgsJson);
    if (!parsed) {
        return {
            kind: "generic",
            rawArgsJson,
        };
    }

    if (isMarkdownPatchTool(confirmation.toolName) && isMarkdownPatchArgs(parsed)) {
        return {
            kind: "markdown-patch",
            relativePath: parsed.relativePath,
            hunkCount: countUnifiedDiffHunks(parsed.unifiedDiff),
            diffText: parsed.unifiedDiff,
            rawArgsJson,
        };
    }

    return {
        kind: "generic",
        rawArgsJson,
    };
}

function parseJson(value: string): unknown | null {
    try {
        return JSON.parse(value) as unknown;
    } catch {
        return null;
    }
}

function isMarkdownPatchTool(toolName: string): boolean {
    return MARKDOWN_PATCH_TOOL_NAMES.has(toolName.trim());
}

function isMarkdownPatchArgs(value: unknown): value is MarkdownPatchArgsPreview {
    if (!value || typeof value !== "object") {
        return false;
    }

    const candidate = value as Partial<MarkdownPatchArgsPreview>;
    return typeof candidate.relativePath === "string"
        && typeof candidate.unifiedDiff === "string"
        && candidate.unifiedDiff.trim().length > 0;
}

function countUnifiedDiffHunks(unifiedDiff: string): number {
    return unifiedDiff
        .split(/\r?\n/u)
        .filter((line) => line.startsWith("@@"))
        .length;
}