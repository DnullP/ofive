import { detectExcludedLineRanges, isLineExcluded } from "../../../../utils/markdownBlockDetector";

export type WikiLinkSubtarget =
    | { kind: "line"; line: number; raw: string }
    | { kind: "title"; title: string; raw: string }
    | { kind: "paragraph"; index: number; raw: string };

export interface ParsedWikiLinkTarget {
    noteTarget: string;
    subtarget: WikiLinkSubtarget | null;
}

export interface ResolvedWikiLinkSubtarget {
    line: number;
    offset: number;
}

const HEADING_RE = /^ {0,3}(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/;
const HORIZONTAL_RULE_RE = /^ {0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/;
const WIKILINK_DISPLAY_RE = /\[\[([^\]\n]+?)\]\]/g;
const MARKDOWN_LINK_DISPLAY_RE = /!?\[([^\]\n]*?)\]\([^\)\n]*?\)/g;

export function parseWikiLinkTarget(rawTarget: string): ParsedWikiLinkTarget {
    const trimmedTarget = rawTarget.trim();
    const fragmentIndex = trimmedTarget.indexOf("#");
    if (fragmentIndex < 0) {
        return {
            noteTarget: trimmedTarget,
            subtarget: null,
        };
    }

    const noteTarget = trimmedTarget.slice(0, fragmentIndex).trim();
    const rawFragment = trimmedTarget.slice(fragmentIndex + 1).trim();
    if (rawFragment.length === 0) {
        return {
            noteTarget,
            subtarget: null,
        };
    }

    return {
        noteTarget,
        subtarget: parseWikiLinkSubtarget(rawFragment),
    };
}

export function parseWikiLinkSubtarget(rawFragment: string): WikiLinkSubtarget {
    const fragment = rawFragment.trim();
    const lineMatch = fragment.match(/^L(\d+)$/i)
        ?? fragment.match(/^line\s*[:=]\s*(\d+)$/i);
    if (lineMatch) {
        return {
            kind: "line",
            line: Math.max(1, Number.parseInt(lineMatch[1] ?? "1", 10)),
            raw: fragment,
        };
    }

    const paragraphMatch = fragment.match(/^P(\d+)$/i)
        ?? fragment.match(/^(?:para|paragraph)\s*[:=]\s*(\d+)$/i);
    if (paragraphMatch) {
        return {
            kind: "paragraph",
            index: Math.max(1, Number.parseInt(paragraphMatch[1] ?? "1", 10)),
            raw: fragment,
        };
    }

    const explicitTitleMatch = fragment.match(/^title\s*[:=]\s*(.+)$/i);
    return {
        kind: "title",
        title: (explicitTitleMatch?.[1] ?? fragment).trim(),
        raw: fragment,
    };
}

export function resolveWikiLinkSubtarget(
    markdown: string,
    subtarget: WikiLinkSubtarget | null,
): ResolvedWikiLinkSubtarget | null {
    if (!subtarget) {
        return null;
    }

    const lines = markdown.split("\n");
    if (subtarget.kind === "line") {
        const line = clampLineNumber(subtarget.line, lines.length);
        return {
            line,
            offset: lineToOffset(lines, line),
        };
    }

    if (subtarget.kind === "title") {
        const line = findHeadingLine(markdown, lines, subtarget.title);
        return line === null
            ? null
            : {
                line,
                offset: lineToOffset(lines, line),
            };
    }

    const line = findParagraphLine(markdown, lines, subtarget.index);
    return line === null
        ? null
        : {
            line,
            offset: lineToOffset(lines, line),
        };
}

export function normalizeWikiLinkAnchorText(text: string): string {
    return text
        .replace(WIKILINK_DISPLAY_RE, (_match, rawInner: string) => {
            const [targetPart, ...aliasParts] = rawInner.split("|");
            const alias = aliasParts.join("|").trim();
            return alias.length > 0 ? alias : (targetPart ?? "").trim();
        })
        .replace(MARKDOWN_LINK_DISPLAY_RE, "$1")
        .replace(/[`*_~=]/g, "")
        .replace(/<[^>]*>/g, "")
        .replace(/\\([\\`*_[\]{}()#+\-.!])/g, "$1")
        .replace(/\s+/g, " ")
        .trim()
        .toLocaleLowerCase();
}

function clampLineNumber(line: number, lineCount: number): number {
    return Math.min(Math.max(1, line), Math.max(1, lineCount));
}

function lineToOffset(lines: string[], line: number): number {
    const targetLine = clampLineNumber(line, lines.length);
    let offset = 0;
    for (let index = 1; index < targetLine; index += 1) {
        offset += (lines[index - 1] ?? "").length + 1;
    }
    return offset;
}

function findHeadingLine(markdown: string, lines: string[], title: string): number | null {
    const ranges = detectExcludedLineRanges(markdown);
    const normalizedTitle = normalizeWikiLinkAnchorText(title);
    if (normalizedTitle.length === 0) {
        return null;
    }

    for (let index = 0; index < lines.length; index += 1) {
        const lineNumber = index + 1;
        if (isLineExcluded(lineNumber, ranges)) {
            continue;
        }

        const headingMatch = lines[index]?.match(HEADING_RE);
        if (!headingMatch) {
            continue;
        }

        const headingText = headingMatch[2] ?? "";
        if (normalizeWikiLinkAnchorText(headingText) === normalizedTitle) {
            return lineNumber;
        }
    }

    return null;
}

function findParagraphLine(markdown: string, lines: string[], paragraphIndex: number): number | null {
    const ranges = detectExcludedLineRanges(markdown);
    let currentParagraphIndex = 0;
    let insideParagraph = false;

    for (let index = 0; index < lines.length; index += 1) {
        const lineNumber = index + 1;
        const lineText = lines[index] ?? "";
        const trimmedLine = lineText.trim();

        if (
            trimmedLine.length === 0
            || isLineExcluded(lineNumber, ranges)
            || HEADING_RE.test(lineText)
            || HORIZONTAL_RULE_RE.test(lineText)
        ) {
            insideParagraph = false;
            continue;
        }

        if (insideParagraph) {
            continue;
        }

        insideParagraph = true;
        currentParagraphIndex += 1;
        if (currentParagraphIndex === paragraphIndex) {
            return lineNumber;
        }
    }

    return null;
}
