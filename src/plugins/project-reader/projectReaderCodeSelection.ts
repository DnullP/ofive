import type { ProjectReaderWikiLinkRange } from "./projectReaderLinks";

export interface ProjectReaderCodeSelectionPayload {
    selectedText: string;
    range: ProjectReaderWikiLinkRange;
}

export function getElementFromNode(node: Node | EventTarget | null): Element | null {
    if (!node) {
        return null;
    }

    if (node instanceof Element) {
        return node;
    }

    if (node instanceof Node) {
        return node.parentElement;
    }

    return null;
}

export function resolveProjectReaderCodeSelection(
    scroller: HTMLElement,
    selection: Selection | null,
): ProjectReaderCodeSelectionPayload | null {
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
        return null;
    }

    const range = selection.getRangeAt(0);
    if (!scroller.contains(range.commonAncestorContainer)) {
        return null;
    }

    const start = resolveSelectionBoundaryLocation(range.startContainer, range.startOffset);
    const end = resolveSelectionBoundaryLocation(range.endContainer, range.endOffset);
    const selectedText = range.toString();
    if (!start || !end || selectedText.trim().length === 0) {
        return null;
    }

    return {
        selectedText,
        range: {
            lineNumber: start.lineNumber,
            columnNumber: start.columnNumber,
            endLineNumber: end.lineNumber,
            endColumnNumber: end.columnNumber,
        },
    };
}

export function clearCodeSelectionIfInside(scroller: HTMLElement): void {
    const selection = scroller.ownerDocument.defaultView?.getSelection() ?? null;
    if (!selection || selection.rangeCount === 0) {
        return;
    }

    if (scroller.contains(selection.getRangeAt(0).commonAncestorContainer)) {
        selection.removeAllRanges();
    }
}

export function selectProjectReaderCodeRange(
    scroller: HTMLElement,
    rangeInput: ProjectReaderWikiLinkRange,
): boolean {
    if (!rangeInput.endLineNumber || rangeInput.endLineNumber < rangeInput.lineNumber) {
        return false;
    }

    const startCodeElement = getCodeTextElementForLine(scroller, rangeInput.lineNumber);
    const endCodeElement = getCodeTextElementForLine(scroller, rangeInput.endLineNumber);
    if (!startCodeElement || !endCodeElement) {
        return false;
    }

    const startColumnNumber = rangeInput.columnNumber ?? 1;
    const endColumnNumber = rangeInput.endColumnNumber
        ?? ((endCodeElement.textContent?.length ?? 0) + 1);
    if (
        rangeInput.endLineNumber === rangeInput.lineNumber
        && endColumnNumber <= startColumnNumber
    ) {
        return false;
    }

    const startBoundary = findTextBoundaryAtCharacterOffset(startCodeElement, startColumnNumber - 1);
    const endBoundary = findTextBoundaryAtCharacterOffset(endCodeElement, endColumnNumber - 1);
    if (!startBoundary || !endBoundary) {
        return false;
    }

    const range = scroller.ownerDocument.createRange();
    range.setStart(startBoundary.node, startBoundary.offset);
    range.setEnd(endBoundary.node, endBoundary.offset);

    const selection = scroller.ownerDocument.defaultView?.getSelection() ?? null;
    if (!selection) {
        return false;
    }

    selection.removeAllRanges();
    selection.addRange(range);
    return true;
}

export function selectDomTextElementContents(element: HTMLElement | null): void {
    if (!element) {
        return;
    }

    const selection = element.ownerDocument.defaultView?.getSelection() ?? null;
    if (!selection) {
        return;
    }

    const range = element.ownerDocument.createRange();
    range.selectNodeContents(element);
    selection.removeAllRanges();
    selection.addRange(range);
}

export function normalizeSelectionDisplayText(selectedText: string): string {
    const trimmed = selectedText.trim();
    if (!trimmed || /[\r\n|\[\]]/.test(trimmed)) {
        return "";
    }
    return trimmed;
}

export function resolveSelectionBoundaryLocation(
    node: Node,
    offset: number,
): { lineNumber: number; columnNumber: number } | null {
    const element = getElementFromNode(node);
    const codeElement = element?.closest<HTMLElement>(".project-reader-code-text") ?? null;
    const lineElement = codeElement?.closest<HTMLElement>(".project-reader-code-line") ?? null;
    if (!codeElement || !lineElement) {
        return null;
    }

    const lineNumber = Number(lineElement.dataset.lineNumber);
    if (!Number.isFinite(lineNumber) || lineNumber <= 0) {
        return null;
    }

    const range = codeElement.ownerDocument.createRange();
    try {
        range.setStart(codeElement, 0);
        range.setEnd(node, offset);
    } catch {
        return null;
    }

    return {
        lineNumber,
        columnNumber: range.toString().length + 1,
    };
}

function getCodeTextElementForLine(scroller: HTMLElement, lineNumber: number): HTMLElement | null {
    return scroller.querySelector<HTMLElement>(
        `[data-line-number="${String(lineNumber)}"] .project-reader-code-text`,
    );
}

function findTextBoundaryAtCharacterOffset(
    root: HTMLElement,
    characterOffset: number,
): { node: Text; offset: number } | null {
    const textLength = root.textContent?.length ?? 0;
    const targetOffset = Math.max(0, Math.min(characterOffset, textLength));
    const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let remaining = targetOffset;
    let lastTextNode: Text | null = null;

    while (walker.nextNode()) {
        const textNode = walker.currentNode as Text;
        const nodeLength = textNode.textContent?.length ?? 0;
        lastTextNode = textNode;
        if (remaining <= nodeLength) {
            return {
                node: textNode,
                offset: remaining,
            };
        }
        remaining -= nodeLength;
    }

    if (!lastTextNode) {
        return null;
    }

    return {
        node: lastTextNode,
        offset: lastTextNode.textContent?.length ?? 0,
    };
}
