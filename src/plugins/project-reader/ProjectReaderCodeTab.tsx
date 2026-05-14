import { createPortal } from "react-dom";
import {
    useEffect,
    useMemo,
    useRef,
    useState,
    type CSSProperties,
    type MouseEvent,
    type ReactNode,
} from "react";
import { ExternalLink, Loader2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { WorkbenchTabProps } from "../../host/layout/workbenchContracts";
import {
    showRegisteredContextMenu,
    useContextMenuProvider,
    type NativeContextMenuItem,
} from "../../host/layout/contextMenuCenter";
import {
    copyProjectReaderTextToClipboard,
    getProjectReaderCodeReferences,
    readProjectReaderFile,
    resolveProjectReaderSymbol,
    type ProjectReaderCodeReference,
    type ProjectReaderSymbolLocation,
} from "../../api/projectReaderApi";
import {
    buildProjectReaderWikiLinkMarkup,
    buildProjectReaderSymbolResolveContext,
    openProjectReaderLocationInWorkbench,
    normalizeProjectRelativePath,
    type ProjectReaderWikiLinkRange,
} from "./projectReaderLinks";
import { highlightProjectCodeLine } from "./projectReaderHighlight";
import "./projectReaderPlugin.css";

interface ProjectReaderCodeTabParams {
    projectId?: unknown;
    projectName?: unknown;
    rootPath?: unknown;
    relativePath?: unknown;
    lineNumber?: unknown;
    columnNumber?: unknown;
    endLineNumber?: unknown;
    endColumnNumber?: unknown;
}

interface CodeTabState {
    content: string;
    language: string | null;
    loading: boolean;
    error: string | null;
    references: ProjectReaderCodeReference[];
}

interface SymbolPopupState {
    symbol: string;
    locations: ProjectReaderSymbolLocation[];
    status: "loading" | "ready" | "empty" | "error";
    message?: string;
    x: number;
    y: number;
    anchorRect: PopupAnchorRect | null;
}

interface ProjectReaderCodeSelectionPayload {
    selectedText: string;
    range: ProjectReaderWikiLinkRange;
}

interface PopupAnchorRect {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
}

const PROJECT_READER_CODE_COPY_ACTION_ID = "copy";
const PROJECT_READER_CODE_CREATE_WIKILINK_ACTION_ID = "create-wikilink";
const PROJECT_READER_CODE_TOKEN_PATTERN = /[A-Za-z_$][A-Za-z0-9_$]*/g;
const PROJECT_READER_CODE_TOKEN_SELECTOR = "[data-project-reader-token-id]";
const PROJECT_READER_CODE_SKIP_TOKEN_CLASSES = new Set([
    "hljs-keyword",
    "hljs-comment",
    "hljs-doctag",
    "hljs-string",
    "hljs-regexp",
    "hljs-meta",
    "hljs-number",
    "hljs-literal",
    "hljs-operator",
    "hljs-punctuation",
]);

const PROJECT_READER_CODE_RESERVED_WORDS = new Set([
    "as",
    "async",
    "await",
    "break",
    "case",
    "catch",
    "class",
    "const",
    "continue",
    "declare",
    "default",
    "do",
    "else",
    "enum",
    "export",
    "extends",
    "false",
    "finally",
    "for",
    "from",
    "function",
    "if",
    "implements",
    "import",
    "in",
    "interface",
    "let",
    "match",
    "mod",
    "namespace",
    "new",
    "null",
    "private",
    "protected",
    "public",
    "readonly",
    "return",
    "self",
    "static",
    "struct",
    "super",
    "switch",
    "this",
    "throw",
    "trait",
    "true",
    "try",
    "type",
    "undefined",
    "var",
    "void",
    "while",
]);

function readStringParam(value: unknown): string {
    return typeof value === "string" ? value : "";
}

function readNullablePositiveInteger(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
        return Math.floor(value);
    }
    if (typeof value === "string" && /^\d+$/.test(value)) {
        return Number(value);
    }
    return null;
}

function resolveIdentifierFromText(value: string): string | null {
    const trimmed = value.trim();
    return isLikelyCodeIdentifier(trimmed) ? trimmed : null;
}

function isLikelyCodeIdentifier(value: string): boolean {
    return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(value) && !PROJECT_READER_CODE_RESERVED_WORDS.has(value);
}

function getElementFromNode(node: Node | EventTarget | null): Element | null {
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

function findProjectReaderTokenElement(target: EventTarget | null): HTMLElement | null {
    const element = getElementFromNode(target);
    return element?.closest<HTMLElement>(PROJECT_READER_CODE_TOKEN_SELECTOR) ?? null;
}

function shouldSkipTokenWrapping(textNode: Text, root: HTMLElement): boolean {
    let current = textNode.parentElement;
    while (current && current !== root) {
        for (const className of current.classList) {
            if (PROJECT_READER_CODE_SKIP_TOKEN_CLASSES.has(className)) {
                return true;
            }
        }
        current = current.parentElement;
    }
    return false;
}

function decorateProjectReaderCodeLineHtml(lineHtml: string, lineNumber: number): string {
    if (typeof document === "undefined") {
        return lineHtml;
    }

    const container = document.createElement("span");
    container.innerHTML = lineHtml;

    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    const textNodes: Text[] = [];
    while (walker.nextNode()) {
        textNodes.push(walker.currentNode as Text);
    }

    let tokenIndex = 0;
    for (const textNode of textNodes) {
        if (shouldSkipTokenWrapping(textNode, container)) {
            continue;
        }

        const text = textNode.textContent ?? "";
        PROJECT_READER_CODE_TOKEN_PATTERN.lastIndex = 0;
        const matches = Array.from(text.matchAll(PROJECT_READER_CODE_TOKEN_PATTERN))
            .filter((match) => isLikelyCodeIdentifier(match[0] ?? ""));
        if (matches.length === 0) {
            continue;
        }

        const fragment = document.createDocumentFragment();
        let cursor = 0;
        for (const match of matches) {
            const token = match[0] ?? "";
            const index = match.index ?? -1;
            if (index < 0) {
                continue;
            }

            if (index > cursor) {
                fragment.append(text.slice(cursor, index));
            }

            const tokenElement = document.createElement("span");
            tokenElement.className = "project-reader-code-token";
            tokenElement.dataset.projectReaderToken = token;
            tokenElement.dataset.projectReaderTokenId = `${String(lineNumber)}-${String(tokenIndex)}`;
            tokenElement.textContent = token;
            fragment.append(tokenElement);
            tokenIndex += 1;
            cursor = index + token.length;
        }

        if (cursor < text.length) {
            fragment.append(text.slice(cursor));
        }

        textNode.replaceWith(fragment);
    }

    return container.innerHTML;
}

function buildProjectReaderCodeReferenceLineClassName(
    isReferenced: boolean,
    isReferenceAnchor: boolean,
): string {
    return [
        "project-reader-code-line",
        isReferenced ? "is-referenced" : "",
        isReferenceAnchor ? "is-reference-anchor" : "",
    ].filter(Boolean).join(" ");
}

function rankProjectReaderCodeReferences(
    references: ProjectReaderCodeReference[],
): ProjectReaderCodeReference[] {
    return [...references].sort((left, right) => {
        const leftKey = getReferenceLineKey(left);
        const rightKey = getReferenceLineKey(right);
        return left.sourcePath
            .localeCompare(right.sourcePath)
            || left.sourceLineNumber - right.sourceLineNumber
            || left.sourceColumnNumber - right.sourceColumnNumber
            || leftKey.localeCompare(rightKey);
    });
}

function isCodeReferenceForCurrentFile(
    reference: ProjectReaderCodeReference,
    relativePath: string,
): boolean {
    return normalizeProjectRelativePath(reference.target.relativePath) === relativePath;
}

function isLineInsideProjectReaderReference(
    lineNumber: number,
    reference: ProjectReaderCodeReference,
): boolean {
    const startLine = reference.target.lineNumber ?? null;
    if (startLine === null) {
        return false;
    }
    const endLine = reference.target.endLineNumber ?? startLine;
    return lineNumber >= startLine && lineNumber <= endLine;
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

function resolveSelectionBoundaryLocation(
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

function readPopupAnchorRect(element: HTMLElement | null): PopupAnchorRect | null {
    if (!element) {
        return null;
    }

    const rect = element.getBoundingClientRect();
    return {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
    };
}

function getReferenceLineKey(reference: ProjectReaderCodeReference): string {
    return `${reference.sourcePath}:${String(reference.sourceLineNumber)}:${String(reference.sourceColumnNumber)}`;
}

function resolveSymbolPopupStyle(symbolPopup: SymbolPopupState): CSSProperties {
    const popupWidth = 310;
    const popupHeight = 250;
    const viewportWidth = typeof window === "undefined" ? 0 : window.innerWidth;
    const viewportHeight = typeof window === "undefined" ? 0 : window.innerHeight;
    const anchorRect = symbolPopup.anchorRect;
    const rawLeft = anchorRect
        ? anchorRect.left + (anchorRect.width / 2) - (popupWidth / 2)
        : symbolPopup.x;
    const rawBottom = anchorRect ? anchorRect.bottom + 8 : symbolPopup.y + 12;
    const rawTop = anchorRect ? anchorRect.top - popupHeight - 8 : symbolPopup.y + 12;

    const left = viewportWidth > 0
        ? Math.max(12, Math.min(rawLeft, viewportWidth - popupWidth - 12))
        : rawLeft;
    const top = viewportHeight > 0
        ? Math.max(
            12,
            Math.min(
                rawBottom + popupHeight <= viewportHeight - 12 ? rawBottom : rawTop,
                viewportHeight - popupHeight - 12,
            ),
        )
        : rawBottom;

    return {
        left,
        top,
    };
}

function resolveProjectReaderCodeSelection(
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

function clearCodeSelectionIfInside(scroller: HTMLElement): void {
    const selection = scroller.ownerDocument.defaultView?.getSelection() ?? null;
    if (!selection || selection.rangeCount === 0) {
        return;
    }

    if (scroller.contains(selection.getRangeAt(0).commonAncestorContainer)) {
        selection.removeAllRanges();
    }
}

function selectProjectReaderCodeRange(
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

function selectDomTextElementContents(element: HTMLElement | null): void {
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

function normalizeSelectionDisplayText(selectedText: string): string {
    const trimmed = selectedText.trim();
    if (!trimmed || /[\r\n|\[\]]/.test(trimmed)) {
        return "";
    }
    return trimmed;
}

function resolveTokenLocationFromElement(
    tokenElement: HTMLElement | null,
): { lineNumber: number | null; columnNumber: number | null } {
    const lineElement = tokenElement?.closest<HTMLElement>(".project-reader-code-line") ?? null;
    const lineNumber = Number(lineElement?.dataset.lineNumber);
    const codeElement = tokenElement?.closest<HTMLElement>(".project-reader-code-text") ?? null;
    if (!Number.isFinite(lineNumber) || lineNumber <= 0) {
        return {
            lineNumber: null,
            columnNumber: null,
        };
    }

    if (!codeElement || !tokenElement) {
        return {
            lineNumber,
            columnNumber: null,
        };
    }

    const ownerDocument = codeElement.ownerDocument;
    const range = ownerDocument.createRange();
    try {
        range.setStart(codeElement, 0);
        range.setEnd(tokenElement, 0);
        return {
            lineNumber,
            columnNumber: range.toString().length + 1,
        };
    } catch {
        return {
            lineNumber,
            columnNumber: null,
        };
    }
}

function resolveTokenFromPoint(event: MouseEvent<HTMLElement>): {
    symbol: string;
    lineNumber: number | null;
    columnNumber: number | null;
    lineText: string | null;
} | null {
    const targetTokenElement = findProjectReaderTokenElement(event.target);
    const targetToken = targetTokenElement
        ? resolveIdentifierFromText(
            targetTokenElement.dataset.projectReaderToken ?? targetTokenElement.textContent ?? "",
        )
        : null;
    if (targetToken) {
        const codeElement = targetTokenElement?.closest<HTMLElement>(".project-reader-code-text") ?? null;
        return {
            symbol: targetToken,
            lineText: codeElement?.textContent ?? null,
            ...resolveTokenLocationFromElement(targetTokenElement),
        };
    }

    const doc = event.currentTarget.ownerDocument;
    const docWithCaret = doc as Document & {
        caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
        caretRangeFromPoint?: (x: number, y: number) => Range | null;
    };

    let textNode: Node | null = null;
    let offset = 0;
    const position = docWithCaret.caretPositionFromPoint?.(event.clientX, event.clientY);
    if (position) {
        textNode = position.offsetNode;
        offset = position.offset;
    } else {
        const range = docWithCaret.caretRangeFromPoint?.(event.clientX, event.clientY);
        if (range) {
            textNode = range.startContainer;
            offset = range.startOffset;
        }
    }

    if (!textNode || textNode.nodeType !== Node.TEXT_NODE) {
        return null;
    }

    const text = textNode.textContent ?? "";
    if (!text) {
        return null;
    }

    const isIdentifierChar = (character: string): boolean => /[A-Za-z0-9_$]/.test(character);
    let start = Math.min(offset, text.length);
    let end = Math.min(offset, text.length);

    while (start > 0 && isIdentifierChar(text.charAt(start - 1))) {
        start -= 1;
    }
    while (end < text.length && isIdentifierChar(text.charAt(end))) {
        end += 1;
    }

    const symbol = resolveIdentifierFromText(text.slice(start, end));
    if (!symbol) {
        return null;
    }

    const element = getElementFromNode(textNode);
    const lineElement = element?.closest<HTMLElement>(".project-reader-code-line") ?? null;
    const codeElement = element?.closest<HTMLElement>(".project-reader-code-text") ?? null;
    const lineNumber = Number(lineElement?.dataset.lineNumber);
    const columnNumber = resolveSelectionBoundaryLocation(textNode, start)?.columnNumber ?? null;

    return {
        symbol,
        lineNumber: Number.isFinite(lineNumber) && lineNumber > 0 ? lineNumber : null,
        columnNumber,
        lineText: codeElement?.textContent ?? null,
    };
}

export function ProjectReaderCodeTab(
    props: WorkbenchTabProps<Record<string, unknown>>,
): ReactNode {
    const { t } = useTranslation();
    const params = props.params as ProjectReaderCodeTabParams;
    const projectId = readStringParam(params.projectId);
    const projectName = readStringParam(params.projectName);
    const rootPath = readStringParam(params.rootPath);
    const relativePath = normalizeProjectRelativePath(readStringParam(params.relativePath));
    const targetLineNumber = readNullablePositiveInteger(params.lineNumber);
    const targetColumnNumber = readNullablePositiveInteger(params.columnNumber);
    const targetEndLineNumber = readNullablePositiveInteger(params.endLineNumber);
    const targetEndColumnNumber = readNullablePositiveInteger(params.endColumnNumber);
    const scrollerRef = useRef<HTMLDivElement | null>(null);
    const hoveredTokenElementRef = useRef<HTMLElement | null>(null);
    const pointerTokenIdRef = useRef<string | null>(null);
    const pendingContextSelectionRef = useRef<ProjectReaderCodeSelectionPayload | null>(null);
    const codeModifierPressedRef = useRef(false);
    const symbolPopupRef = useRef<HTMLDivElement | null>(null);
    const [state, setState] = useState<CodeTabState>({
        content: "",
        language: null,
        loading: true,
        error: null,
        references: [],
    });
    const [symbolPopup, setSymbolPopup] = useState<SymbolPopupState | null>(null);
    const [hoveredTokenId, setHoveredTokenId] = useState<string | null>(null);
    const codeSelectionContextMenuId = useMemo(
        () => `project-reader.code-selection:${props.api.id}`,
        [props.api.id],
    );

    useContextMenuProvider<ProjectReaderCodeSelectionPayload>({
        id: codeSelectionContextMenuId,
        buildMenu: (): NativeContextMenuItem[] => [
            {
                id: PROJECT_READER_CODE_COPY_ACTION_ID,
                text: t("projectReader.copySelection"),
            },
            {
                id: PROJECT_READER_CODE_CREATE_WIKILINK_ACTION_ID,
                text: t("projectReader.createWikiLink"),
                enabled: Boolean(projectName && relativePath),
            },
        ],
        handleAction: async (actionId, payload) => {
            if (actionId === PROJECT_READER_CODE_COPY_ACTION_ID) {
                await copyProjectReaderTextToClipboard(payload.selectedText);
                return;
            }

            if (actionId === PROJECT_READER_CODE_CREATE_WIKILINK_ACTION_ID) {
                if (!projectName || !relativePath) {
                    return;
                }

                const markup = buildProjectReaderWikiLinkMarkup(
                    projectName,
                    relativePath,
                    normalizeSelectionDisplayText(payload.selectedText),
                    payload.range,
                );
                await copyProjectReaderTextToClipboard(markup);
            }
        },
    });

    useEffect(() => {
        let disposed = false;
        setSymbolPopup(null);
        setState((previous) => ({
            ...previous,
            loading: true,
            error: null,
        }));

        if (!projectId || !relativePath) {
            setState({
                content: "",
                language: null,
                loading: false,
                error: "Missing project file parameters.",
                references: [],
            });
            props.api.markContentReady?.();
            return;
        }

        void readProjectReaderFile(projectId, relativePath)
            .then((response) => {
                if (disposed) {
                    return;
                }
                setState({
                    content: response.content,
                    language: response.language ?? null,
                    loading: false,
                    error: null,
                    references: [],
                });
                props.api.markContentReady?.();
            })
            .catch((error) => {
                if (disposed) {
                    return;
                }
                setState({
                    content: "",
                    language: null,
                    loading: false,
                    error: error instanceof Error ? error.message : String(error),
                    references: [],
                });
                props.api.markContentReady?.();
            });

        return () => {
            disposed = true;
        };
    }, [projectId, relativePath]);

    useEffect(() => {
        if (!projectId || !relativePath || state.loading || state.error) {
            return;
        }

        let disposed = false;
        void getProjectReaderCodeReferences(projectId)
            .then((response) => {
                if (disposed) {
                    return;
                }
                const references = rankProjectReaderCodeReferences(
                    response.references.filter((reference) =>
                        isCodeReferenceForCurrentFile(reference, relativePath),
                    ),
                );
                setState((previous) => ({
                    ...previous,
                    references,
                }));
            })
            .catch(() => {
                if (disposed) {
                    return;
                }
                setState((previous) => ({
                    ...previous,
                    references: [],
                }));
            });

        return () => {
            disposed = true;
        };
    }, [projectId, relativePath, state.loading, state.error]);

    useEffect(() => {
        if (state.loading) {
            return;
        }

        const frame = window.requestAnimationFrame(() => {
            const scroller = scrollerRef.current;
            if (!scroller) {
                return;
            }

            if (!targetLineNumber) {
                clearCodeSelectionIfInside(scroller);
                return;
            }

            const target = scrollerRef.current?.querySelector<HTMLElement>(
                `[data-line-number="${String(targetLineNumber)}"]`,
            );
            target?.scrollIntoView({ block: "center" });

            const shouldSelectRange = targetEndLineNumber !== null;
            if (shouldSelectRange) {
                const selected = selectProjectReaderCodeRange(scroller, {
                    lineNumber: targetLineNumber,
                    columnNumber: targetColumnNumber,
                    endLineNumber: targetEndLineNumber,
                    endColumnNumber: targetEndColumnNumber,
                });
                if (selected) {
                    return;
                }
            }

            clearCodeSelectionIfInside(scroller);
        });

        return () => {
            window.cancelAnimationFrame(frame);
        };
    }, [
        state.loading,
        targetLineNumber,
        targetColumnNumber,
        targetEndLineNumber,
        targetEndColumnNumber,
        state.content,
    ]);

    useEffect(() => {
        hoveredTokenElementRef.current?.classList.remove("project-reader-code-token--hovered");
        hoveredTokenElementRef.current = null;

        if (!hoveredTokenId) {
            return;
        }

        const nextElement = scrollerRef.current?.querySelector<HTMLElement>(
            `[data-project-reader-token-id="${hoveredTokenId}"]`,
        ) ?? null;
        if (!nextElement) {
            return;
        }

        nextElement.classList.add("project-reader-code-token--hovered");
        hoveredTokenElementRef.current = nextElement;
    }, [hoveredTokenId, state.content, state.language]);

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent): void => {
            if (event.key !== "Control" && event.key !== "Meta") {
                return;
            }

            codeModifierPressedRef.current = true;
            const pointerTokenId = pointerTokenIdRef.current;
            if (pointerTokenId) {
                setHoveredTokenId(pointerTokenId);
            }
        };

        const handleKeyUp = (event: KeyboardEvent): void => {
            if (event.key !== "Control" && event.key !== "Meta") {
                return;
            }

            codeModifierPressedRef.current = event.ctrlKey || event.metaKey;
            if (!codeModifierPressedRef.current) {
                setHoveredTokenId(null);
            }
        };

        const handleBlur = (): void => {
            codeModifierPressedRef.current = false;
            setHoveredTokenId(null);
        };

        window.addEventListener("keydown", handleKeyDown);
        window.addEventListener("keyup", handleKeyUp);
        window.addEventListener("blur", handleBlur);
        return () => {
            window.removeEventListener("keydown", handleKeyDown);
            window.removeEventListener("keyup", handleKeyUp);
            window.removeEventListener("blur", handleBlur);
        };
    }, []);

    const lines = useMemo(() => {
        return state.content.split("\n").map((line, index) => ({
            number: index + 1,
            hasReference: state.references.some((reference) =>
                isLineInsideProjectReaderReference(index + 1, reference),
            ),
            html: decorateProjectReaderCodeLineHtml(
                highlightProjectCodeLine(line, state.language),
                index + 1,
            ),
        }));
    }, [state.content, state.language, state.references]);

    const openLocation = (location: ProjectReaderSymbolLocation): void => {
        const endLineNumber = location.endLineNumber ?? location.lineNumber;
        const endColumnNumber = location.endColumnNumber ?? (
            endLineNumber === location.lineNumber
                ? location.columnNumber + location.symbolName.length
                : null
        );
        openProjectReaderLocationInWorkbench(props.containerApi, {
            projectId,
            projectName,
            rootPath,
            relativePath: location.relativePath,
            lineNumber: location.lineNumber,
            columnNumber: location.columnNumber,
            endLineNumber,
            endColumnNumber,
        });
        setSymbolPopup(null);
    };

    const handleCodeModifierMouseDown = async (event: MouseEvent<HTMLElement>): Promise<void> => {
        if (event.button !== 0) {
            return;
        }
        if (!event.metaKey && !event.ctrlKey) {
            return;
        }

        const targetElement = event.target as HTMLElement | null;
        const targetTokenElement = findProjectReaderTokenElement(event.target);
        if (targetElement?.closest(".project-reader-code-gutter")) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();

        const tokenLocation = resolveTokenFromPoint(event);
        if (!tokenLocation || !projectId) {
            return;
        }
        const { symbol } = tokenLocation;

        const anchorElement = targetTokenElement
            ?? (targetElement?.closest(".project-reader-code-line") as HTMLElement | null)
            ?? null;

        const popupBase = {
            symbol,
            x: event.clientX,
            y: event.clientY,
            anchorRect: readPopupAnchorRect(anchorElement),
        };
        if (targetTokenElement) {
            selectDomTextElementContents(targetTokenElement);
        }
        setSymbolPopup({
            ...popupBase,
            locations: [],
            status: "loading",
        });

        try {
            const response = await resolveProjectReaderSymbol(
                projectId,
                symbol,
                buildProjectReaderSymbolResolveContext(
                    relativePath,
                    tokenLocation.lineNumber,
                    tokenLocation.columnNumber,
                    tokenLocation.lineText,
                    state.content,
                ),
            );
            if (response.locations.length === 1) {
                openLocation(response.locations[0]!);
                return;
            }

            setSymbolPopup({
                ...popupBase,
                locations: response.locations,
                status: response.locations.length > 0 ? "ready" : "empty",
            });
        } catch (error) {
            setSymbolPopup({
                ...popupBase,
                locations: [],
                status: "error",
                message: error instanceof Error ? error.message : String(error),
            });
        }
    };

    const handleCodeMouseDown = (event: MouseEvent<HTMLElement>): void => {
        if (event.button === 2) {
            const selection = event.currentTarget.ownerDocument.defaultView?.getSelection() ?? null;
            const payload = resolveProjectReaderCodeSelection(event.currentTarget, selection);
            pendingContextSelectionRef.current = payload;
            if (payload) {
                event.preventDefault();
                event.stopPropagation();
            }
            return;
        }

        if (event.button !== 0 || (!event.metaKey && !event.ctrlKey)) {
            return;
        }

        const targetElement = event.target as HTMLElement | null;
        if (targetElement?.closest(".project-reader-code-gutter")) {
            return;
        }

        event.preventDefault();
        event.stopPropagation();
    };

    const handleCodeMouseMove = (event: MouseEvent<HTMLElement>): void => {
        const tokenElement = findProjectReaderTokenElement(event.target);
        const tokenId = tokenElement?.dataset.projectReaderTokenId ?? null;
        const token = tokenElement?.dataset.projectReaderToken ?? tokenElement?.textContent ?? "";
        if (!tokenId || !resolveIdentifierFromText(token)) {
            pointerTokenIdRef.current = null;
            if (hoveredTokenId !== null) {
                setHoveredTokenId(null);
            }
            return;
        }

        pointerTokenIdRef.current = tokenId;
        if (!event.metaKey && !event.ctrlKey && !codeModifierPressedRef.current) {
            if (hoveredTokenId !== null) {
                setHoveredTokenId(null);
            }
            return;
        }

        if (hoveredTokenId !== tokenId) {
            setHoveredTokenId(tokenId);
        }
    };

    const handleCodeMouseLeave = (): void => {
        pointerTokenIdRef.current = null;
        if (hoveredTokenId !== null) {
            setHoveredTokenId(null);
        }
    };

    useEffect(() => {
        if (!symbolPopup) {
            return;
        }

        const handlePointerDown = (event: PointerEvent): void => {
            const target = event.target as Node | null;
            if (symbolPopupRef.current?.contains(target)) {
                return;
            }
            setSymbolPopup(null);
        };

        document.addEventListener("pointerdown", handlePointerDown, true);
        return () => {
            document.removeEventListener("pointerdown", handlePointerDown, true);
        };
    }, [symbolPopup]);

    const handleCodeContextMenu = async (event: MouseEvent<HTMLElement>): Promise<void> => {
        const scroller = event.currentTarget;
        const selection = scroller.ownerDocument.defaultView?.getSelection() ?? null;
        const payload = resolveProjectReaderCodeSelection(scroller, selection)
            ?? pendingContextSelectionRef.current;
        if (!payload) {
            event.preventDefault();
            event.stopPropagation();
            return;
        }

        selectProjectReaderCodeRange(scroller, payload.range);
        await showRegisteredContextMenu(codeSelectionContextMenuId, event, payload);
        pendingContextSelectionRef.current = null;
    };

    if (state.loading) {
        return (
            <div className="project-reader-code-tab project-reader-code-tab--status window-no-drag">
                <Loader2 size={15} className="project-reader-spin" />
                <span>{t("projectReader.loadingCode")}</span>
            </div>
        );
    }

    if (state.error) {
        return (
            <div className="project-reader-code-tab project-reader-code-tab--status window-no-drag">
                <span>{state.error}</span>
            </div>
        );
    }

    return (
        <div className="project-reader-code-tab window-no-drag">
            <div className="project-reader-code-meta">
                <span>{projectName}</span>
                <span>{relativePath}</span>
            </div>
            <div
                ref={scrollerRef}
                className={`project-reader-code-scroller window-no-drag${hoveredTokenId ? " is-command-hovering" : ""}`}
                onMouseDown={(event) => {
                    handleCodeMouseDown(event);
                }}
                onClick={(event) => {
                    void handleCodeModifierMouseDown(event);
                }}
                onMouseMove={handleCodeMouseMove}
                onMouseLeave={handleCodeMouseLeave}
                onContextMenu={(event) => {
                    void handleCodeContextMenu(event);
                }}
            >
                {lines.map((line) => (
                    <div
                        key={line.number}
                        className={[
                            buildProjectReaderCodeReferenceLineClassName(
                                line.hasReference,
                                line.number === targetLineNumber,
                            ),
                            line.number === targetLineNumber ? "is-target-line" : "",
                            targetLineNumber !== null
                            && targetEndLineNumber !== null
                            && line.number >= targetLineNumber
                            && line.number <= targetEndLineNumber
                                ? "is-target-range"
                                : "",
                        ].filter(Boolean).join(" ")}
                        data-line-number={String(line.number)}
                    >
                        <span className="project-reader-code-gutter">{line.number}</span>
                        <code
                            className={`project-reader-code-text language-${state.language ?? "plaintext"}`}
                            dangerouslySetInnerHTML={{ __html: line.html }}
                        />
                    </div>
                ))}
            </div>
            {symbolPopup && typeof document !== "undefined" ? createPortal(
                <div
                    ref={symbolPopupRef}
                    className="project-reader-symbol-popup"
                    style={resolveSymbolPopupStyle(symbolPopup)}
                >
                    <div className="project-reader-symbol-popup__header">
                        <span>{symbolPopup.symbol}</span>
                        <button
                            type="button"
                            onClick={() => {
                                setSymbolPopup(null);
                            }}
                        >
                            <X size={12} strokeWidth={2} />
                        </button>
                    </div>
                    {symbolPopup.status === "loading" ? (
                        <div className="project-reader-symbol-popup__state">
                            {t("projectReader.resolvingSymbol")}
                        </div>
                    ) : null}
                    {symbolPopup.status === "empty" ? (
                        <div className="project-reader-symbol-popup__state">
                            {t("projectReader.noIndexedDefinitionFound")}
                        </div>
                    ) : null}
                    {symbolPopup.status === "error" ? (
                        <div className="project-reader-symbol-popup__state">{symbolPopup.message}</div>
                    ) : null}
                    {symbolPopup.status === "ready" ? (
                        <div className="project-reader-symbol-list">
                            {symbolPopup.locations.map((location, index) => (
                                <button
                                    key={`${location.relativePath}:${String(location.lineNumber)}:${String(index)}`}
                                    type="button"
                                    className="project-reader-symbol-item"
                                    onClick={() => {
                                        openLocation(location);
                                    }}
                                >
                                    <span className="project-reader-symbol-item__kind">
                                        {location.kind}
                                        <ExternalLink size={12} strokeWidth={1.8} />
                                    </span>
                                    <span className="project-reader-symbol-item__path">
                                        {location.relativePath}:{location.lineNumber}
                                    </span>
                                    <span className="project-reader-symbol-item__preview">
                                        {location.preview}
                                    </span>
                                </button>
                            ))}
                        </div>
                    ) : null}
                </div>,
                document.body,
            ) : null}
        </div>
    );
}
