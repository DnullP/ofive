/**
 * @module plugins/markdown-codemirror/editor/handoff/mermaidVimHandoff
 * @description Vim normal 模式下 Mermaid fenced block 相邻行 handoff 逻辑。
 */

const FENCE_OPEN_RE = /^ {0,3}(`{3,}|~{3,})(?:[ \t]*(.*?))?[ \t]*$/;

interface MermaidFenceLineRange {
    fromLine: number;
    toLine: number;
}

export interface ResolveMermaidVimHandoffLineOptions {
    markdown: string;
    currentLineNumber: number;
    key: string;
    isVimEnabled: boolean;
    isVimNormalMode: boolean;
}

function isMermaidFenceLanguage(language: string): boolean {
    return language.trim().toLowerCase() === "mermaid";
}

function findMermaidFenceLineRanges(markdown: string): MermaidFenceLineRange[] {
    const lines = markdown.split("\n");
    const ranges: MermaidFenceLineRange[] = [];
    let lineIndex = 0;

    while (lineIndex < lines.length) {
        const line = lines[lineIndex] ?? "";
        const openMatch = line.match(FENCE_OPEN_RE);
        if (!openMatch) {
            lineIndex += 1;
            continue;
        }

        const fence = openMatch[1] ?? "```";
        const fenceChar = fence.charAt(0);
        const fenceLength = fence.length;
        const language = ((openMatch[2] ?? "").trim().split(/\s+/)[0] ?? "").trim();
        const closeRe = new RegExp(
            `^ {0,3}${fenceChar === "\`" ? "`" : "~"}{${fenceLength},}[ \\t]*$`,
        );

        let closeLineIndex = -1;
        for (let searchIndex = lineIndex + 1; searchIndex < lines.length; searchIndex += 1) {
            if (closeRe.test(lines[searchIndex] ?? "")) {
                closeLineIndex = searchIndex;
                break;
            }
        }

        if (closeLineIndex < 0) {
            lineIndex += 1;
            continue;
        }

        if (isMermaidFenceLanguage(language)) {
            ranges.push({
                fromLine: lineIndex + 1,
                toLine: closeLineIndex + 1,
            });
        }

        lineIndex = closeLineIndex + 1;
    }

    return ranges;
}

export function resolveMermaidVimHandoffLine(
    options: ResolveMermaidVimHandoffLineOptions,
): number | null {
    if (!options.isVimEnabled || !options.isVimNormalMode) {
        return null;
    }

    if (options.key !== "j" && options.key !== "k") {
        return null;
    }

    const targetLineNumber = options.key === "j"
        ? options.currentLineNumber + 1
        : Math.max(1, options.currentLineNumber - 1);

    const mermaidRange = findMermaidFenceLineRanges(options.markdown).find((range) =>
        targetLineNumber >= range.fromLine && targetLineNumber <= range.toLine,
    );

    return mermaidRange ? targetLineNumber : null;
}
