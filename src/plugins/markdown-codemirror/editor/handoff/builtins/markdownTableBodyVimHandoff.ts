/**
 * @module plugins/markdown-codemirror/editor/handoff/builtins/markdownTableBodyVimHandoff
 * @description Markdown table 正文边界的 Vim handoff 注册项。
 *   负责将正文相邻行上的 `j/k` 导航移交给隐藏表格 widget 的导航层。
 */

import { parseMarkdownTableLines } from "../../markdownTableModel";
import {
    registerVimHandoff,
    VIM_HANDOFF_PRIORITY,
    type VimHandoffContext,
} from "../vimHandoffRegistry";

interface MarkdownTableBoundaryMatch {
    blockFrom: number;
    position: "first" | "last";
}

function areOnlyBlankLinesBetween(
    lines: string[],
    startLineNumber: number,
    endLineNumber: number,
): boolean {
    if (endLineNumber <= startLineNumber + 1) {
        return true;
    }

    for (let lineNumber = startLineNumber + 1; lineNumber < endLineNumber; lineNumber += 1) {
        if ((lines[lineNumber - 1] ?? "").trim().length > 0) {
            return false;
        }
    }

    return true;
}

function resolveTableBoundaryMatch(
    context: VimHandoffContext,
): MarkdownTableBoundaryMatch | null {
    if (!context.isVimEnabled || !context.isVimNormalMode) {
        return null;
    }

    if (context.key !== "j" && context.key !== "k") {
        return null;
    }

    const lines = context.markdown.split("\n");
    const lineOffsets: number[] = [];
    let runningOffset = 0;
    for (const line of lines) {
        lineOffsets.push(runningOffset);
        runningOffset += line.length + 1;
    }

    let lineIndex = 0;
    while (lineIndex < lines.length - 1) {
        const line = lines[lineIndex] ?? "";
        if (!line.includes("|")) {
            lineIndex += 1;
            continue;
        }

        const candidateLines = [line, lines[lineIndex + 1] ?? ""];
        let endLineIndex = lineIndex + 1;
        for (let nextLineIndex = lineIndex + 2; nextLineIndex < lines.length; nextLineIndex += 1) {
            const candidate = lines[nextLineIndex] ?? "";
            if (candidate.trim().length === 0 || !candidate.includes("|")) {
                break;
            }

            candidateLines.push(candidate);
            endLineIndex = nextLineIndex;
        }

        const model = parseMarkdownTableLines(candidateLines);
        if (!model) {
            lineIndex += 1;
            continue;
        }

        const startLineNumber = lineIndex + 1;
        const endLineNumber = endLineIndex + 1;
        const enteredFromAbove = context.key === "j"
            && context.currentLineNumber < startLineNumber
            && areOnlyBlankLinesBetween(lines, context.currentLineNumber, startLineNumber);
        const enteredFromBelow = context.key === "k"
            && context.currentLineNumber > endLineNumber
            && areOnlyBlankLinesBetween(lines, endLineNumber, context.currentLineNumber);

        if (enteredFromAbove || enteredFromBelow) {
            return {
                blockFrom: lineOffsets[lineIndex] ?? 0,
                position: enteredFromAbove ? "first" : "last",
            };
        }

        lineIndex = endLineIndex + 1;
    }

    return null;
}

export function registerMarkdownTableBodyVimHandoff(): () => void {
    return registerVimHandoff({
        id: "markdown-table.body-enter-navigation",
        owner: "markdown-table",
        surface: "editor-body",
        priority: VIM_HANDOFF_PRIORITY.blockWidget,
        description: "当光标位于 Markdown 表格相邻行时，将 Vim 的 j/k 导航移交给表格导航层。",
        resolve: (context: VimHandoffContext) => {
            const match = resolveTableBoundaryMatch(context);
            if (!match) {
                return null;
            }

            return {
                kind: "focus-widget-navigation" as const,
                widget: "markdown-table" as const,
                position: match.position,
                blockFrom: match.blockFrom,
                reason: "enter-markdown-table-from-body",
            };
        },
    });
}