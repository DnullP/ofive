/**
 * @module api/projectReaderApi
 * @description 外部项目只读阅读器前端 API，桥接 Tauri command 与 web-mock fallback。
 */

import { invoke } from "@tauri-apps/api/core";
import { writeText as writeClipboardText } from "@tauri-apps/plugin-clipboard-manager";

export interface ProjectReaderProject {
    id: string;
    name: string;
    rootPath: string;
    createdAtUnixMs: number;
    updatedAtUnixMs: number;
}

export interface ProjectReaderProjectListResponse {
    projects: ProjectReaderProject[];
}

export interface ProjectReaderTreeEntry {
    relativePath: string;
    isDir: boolean;
    sizeBytes?: number | null;
    modifiedAtUnixMs?: number | null;
    language?: string | null;
}

export interface ProjectReaderTreeResponse {
    projectId: string;
    rootPath: string;
    entries: ProjectReaderTreeEntry[];
}

export interface ProjectReaderFileResponse {
    projectId: string;
    relativePath: string;
    content: string;
    language?: string | null;
    sizeBytes: number;
    modifiedAtUnixMs?: number | null;
}

export interface ProjectReaderSymbolLocation {
    projectId: string;
    relativePath: string;
    lineNumber: number;
    columnNumber: number;
    endLineNumber?: number | null;
    endColumnNumber?: number | null;
    symbolName: string;
    kind: string;
    preview: string;
}

export interface ProjectReaderLinkTarget {
    projectName: string;
    relativePath: string;
    lineNumber?: number | null;
    columnNumber?: number | null;
    endLineNumber?: number | null;
    endColumnNumber?: number | null;
}

export interface ProjectReaderCodeReference {
    sourcePath: string;
    title: string;
    sourceLineNumber: number;
    sourceColumnNumber: number;
    linkText: string;
    target: ProjectReaderLinkTarget;
}

export interface ProjectReaderCodeReferenceResponse {
    projectId: string;
    references: ProjectReaderCodeReference[];
}

export interface ProjectReaderSymbolResolveResponse {
    projectId: string;
    symbol: string;
    locations: ProjectReaderSymbolLocation[];
}

export interface ProjectReaderSymbolResolveContext {
    currentFilePath?: string | null;
    currentLineNumber?: number | null;
    currentColumnNumber?: number | null;
    currentLineText?: string | null;
    currentFileContent?: string | null;
}

export type ProjectReaderSearchMode = "text" | "symbol" | "astGrep";

export interface ProjectReaderSearchMatch {
    projectId: string;
    relativePath: string;
    lineNumber: number;
    columnNumber: number;
    endLineNumber: number;
    endColumnNumber: number;
    kind: string;
    language?: string | null;
    preview: string;
}

export interface ProjectReaderSearchResponse {
    projectId: string;
    query: string;
    mode: ProjectReaderSearchMode;
    matches: ProjectReaderSearchMatch[];
}

function isTauriRuntime(): boolean {
    if (typeof window === "undefined") {
        return false;
    }

    const runtimeWindow = window as Window & {
        __TAURI_INTERNALS__?: unknown;
        __TAURI__?: unknown;
    };

    return Boolean(runtimeWindow.__TAURI_INTERNALS__ || runtimeWindow.__TAURI__);
}

async function writeBrowserClipboardText(value: string): Promise<void> {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        try {
            await navigator.clipboard.writeText(value);
            return;
        } catch {
            // Browser mock can lose transient activation after async context-menu handling.
            // Keep a DOM fallback for mock-web; Tauri runtime uses the official plugin path.
        }
    }

    if (typeof document === "undefined") {
        throw new Error("clipboard API unavailable");
    }

    const selection = document.defaultView?.getSelection() ?? null;
    const savedRanges = selection
        ? Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index).cloneRange())
        : [];
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.setAttribute("readonly", "true");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    textarea.style.top = "0";
    textarea.style.opacity = "0";
    textarea.style.pointerEvents = "none";
    document.body.append(textarea);

    try {
        textarea.select();
        textarea.setSelectionRange(0, textarea.value.length);
        const copySucceeded = Boolean(document.execCommand("copy"));
        if (!copySucceeded) {
            throw new Error("clipboard API unavailable");
        }
    } finally {
        textarea.remove();
        if (selection && savedRanges.length > 0) {
            selection.removeAllRanges();
            savedRanges.forEach((range) => selection.addRange(range));
        }
    }
}

const mockProject: ProjectReaderProject = {
    id: "mock-ofive-project",
    name: "mock-ofive",
    rootPath: "/mock/ofive",
    createdAtUnixMs: 1,
    updatedAtUnixMs: 1,
};

let browserProjects: ProjectReaderProject[] = [mockProject];

const browserMockFiles: Record<string, string> = {
    "src/main.ts": [
        "import { createApp } from './runtime';",
        "",
        "export interface AppRuntime {",
        "  start(): void;",
        "}",
        "",
        "export function createMainRuntime(): AppRuntime {",
        "  return createApp();",
        "}",
        "",
    ].join("\n"),
    "src/long-scroll.ts": [
        "export const longScrollFixture = [",
        ...Array.from({ length: 160 }, (_, index) =>
            `  "Project reader scroll fixture line ${String(index + 1).padStart(3, "0")}",`,
        ),
        "];",
        "",
        "export function readLongScrollFixture(): string[] {",
        "  return longScrollFixture;",
        "}",
        "",
    ].join("\n"),
    "src/runtime.ts": [
        "export class BrowserRuntime {",
        "  start(): void {}",
        "}",
        "",
        "export function createApp(): AppRuntime {",
        "  return new BrowserRuntime();",
        "}",
        "",
    ].join("\n"),
    "src/alternate.ts": [
        "export interface AppRuntime {",
        "  stop(): void;",
        "}",
        "",
        "export function createAlternateRuntime(): AppRuntime {",
        "  return {",
        "    stop() {},",
        "  };",
        "}",
        "",
    ].join("\n"),
    "src/domain/service.ts": [
        "export interface Service {",
        "  load(): void;",
        "}",
        "",
    ].join("\n"),
    "src/memory/service.ts": [
        "export interface Service {",
        "  remember(): void;",
        "}",
        "",
    ].join("\n"),
    "src/session/service.ts": [
        "export interface Service {",
        "  open(): void;",
        "}",
        "",
    ].join("\n"),
    "src/runner.ts": [
        "import * as memory from './memory/service';",
        "",
        "export interface RunnerConfig {",
        "  memoryService: memory.Service;",
        "}",
        "",
    ].join("\n"),
    "README.md": [
        "# mock-ofive",
        "",
        "代码引用：[[mock-ofive:/src/main.ts:7:1-9:1|createMainRuntime]]",
        "另一个引用：[[mock-ofive:/src/alternate.ts:5:1-9:1|createAlternateRuntime]]",
        "再一个引用：[[mock-ofive:/src/main.ts:7:1-9:1|main runtime]]",
        "",
    ].join("\n"),
};

const browserMockProjectReaderReferences: ProjectReaderCodeReference[] = [
    {
        sourcePath: "README.md",
        title: "README.md",
        sourceLineNumber: 3,
        sourceColumnNumber: 7,
        linkText: "createMainRuntime",
        target: {
            projectName: "mock-ofive",
            relativePath: "src/main.ts",
            lineNumber: 7,
            columnNumber: 1,
            endLineNumber: 9,
            endColumnNumber: 1,
        },
    },
    {
        sourcePath: "README.md",
        title: "README.md",
        sourceLineNumber: 4,
        sourceColumnNumber: 9,
        linkText: "createAlternateRuntime",
        target: {
            projectName: "mock-ofive",
            relativePath: "src/alternate.ts",
            lineNumber: 5,
            columnNumber: 1,
            endLineNumber: 9,
            endColumnNumber: 1,
        },
    },
    {
        sourcePath: "test-resources/notes/note1.md",
        title: "note1.md",
        sourceLineNumber: 17,
        sourceColumnNumber: 24,
        linkText: "Session",
        target: {
            projectName: "mock-ofive",
            relativePath: "src/main.ts",
            lineNumber: 7,
            columnNumber: 1,
            endLineNumber: 9,
            endColumnNumber: 1,
        },
    },
    {
        sourcePath: "test-resources/notes/note2.md",
        title: "note2.md",
        sourceLineNumber: 17,
        sourceColumnNumber: 24,
        linkText: "Session",
        target: {
            projectName: "mock-ofive",
            relativePath: "src/alternate.ts",
            lineNumber: 5,
            columnNumber: 1,
            endLineNumber: 9,
            endColumnNumber: 1,
        },
    },
];

function normalizeBrowserSymbolResolveContext(
    context?: ProjectReaderSymbolResolveContext,
): {
    currentFilePath: string | null;
    currentLineNumber: number | null;
    currentColumnNumber: number | null;
    currentLineText: string | null;
    currentFileContent: string | null;
} {
    return {
        currentFilePath: context?.currentFilePath?.replace(/\\/g, "/").replace(/^\/+/, "").trim() ?? null,
        currentLineNumber: typeof context?.currentLineNumber === "number" ? context.currentLineNumber : null,
        currentColumnNumber: typeof context?.currentColumnNumber === "number" ? context.currentColumnNumber : null,
        currentLineText: typeof context?.currentLineText === "string" ? context.currentLineText : null,
        currentFileContent: typeof context?.currentFileContent === "string" ? context.currentFileContent : null,
    };
}

function getBrowserRelativePathSegments(relativePath: string): string[] {
    return relativePath.split("/").filter(Boolean);
}

function rankBrowserSymbolLocation(
    location: ProjectReaderSymbolLocation,
    context: ReturnType<typeof normalizeBrowserSymbolResolveContext>,
): number[] {
    const sameFilePenalty = context.currentFilePath && location.relativePath === context.currentFilePath ? 0 : 1;
    const lineDistance = context.currentLineNumber !== null
        ? Math.abs(location.lineNumber - context.currentLineNumber)
        : Number.MAX_SAFE_INTEGER;
    const columnDistance = context.currentColumnNumber !== null
        ? Math.abs(location.columnNumber - context.currentColumnNumber)
        : Number.MAX_SAFE_INTEGER;
    const kindPenalty = location.kind === "implementation" ? 1 : 0;

    return [sameFilePenalty, kindPenalty, lineDistance, columnDistance];
}

function resolveQualifiedSymbolPrefix(
    context: ReturnType<typeof normalizeBrowserSymbolResolveContext>,
): string | null {
    if (!context.currentLineText || context.currentColumnNumber === null) {
        return null;
    }

    const symbolStart = context.currentColumnNumber - 1;
    if (symbolStart <= 0 || symbolStart > context.currentLineText.length) {
        return null;
    }

    const prefixBeforeSymbol = context.currentLineText.slice(0, symbolStart).trimEnd();
    if (!prefixBeforeSymbol.endsWith(".")) {
        return null;
    }

    const source = prefixBeforeSymbol.slice(0, -1).trimEnd();
    const match = source.match(/[A-Za-z_$][A-Za-z0-9_$]*$/);
    return match?.[0] ?? null;
}

function matchesBrowserQualifiedPackageRoot(packageRoot: string, locationPath: string): boolean {
    const normalizedLocationPath = locationPath.replace(/\\/g, "/").replace(/^\/+/, "");
    const normalizedPackageRoot = packageRoot.replace(/\\/g, "/").replace(/^\/+/, "");
    if (!normalizedPackageRoot) {
        return false;
    }

    return normalizedLocationPath === `${normalizedPackageRoot}.ts`
        || normalizedLocationPath === `${normalizedPackageRoot}.tsx`
        || normalizedLocationPath === `${normalizedPackageRoot}.js`
        || normalizedLocationPath === `${normalizedPackageRoot}.jsx`
        || normalizedLocationPath === `${normalizedPackageRoot}/index.ts`
        || normalizedLocationPath === `${normalizedPackageRoot}/index.tsx`
        || normalizedLocationPath === `${normalizedPackageRoot}/index.js`
        || normalizedLocationPath === `${normalizedPackageRoot}/index.jsx`
        || normalizedLocationPath.startsWith(`${normalizedPackageRoot}/`);
}

function resolveBrowserPackageRootCandidates(
    currentFilePath: string | null,
    qualifier: string,
): string[] {
    const candidates: string[] = [];
    const pushCandidate = (candidate: string | null | undefined): void => {
        const normalized = candidate?.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/g, "");
        if (normalized && !candidates.includes(normalized)) {
            candidates.push(normalized);
        }
    };

    if (!currentFilePath) {
        pushCandidate(qualifier);
        return candidates;
    }

    const segments = getBrowserRelativePathSegments(currentFilePath);
    const lastSegment = segments.length >= 2
        ? segments[segments.length - 2]
        : segments[segments.length - 1] ?? "";
    if (lastSegment === qualifier) {
        pushCandidate(segments.slice(0, -1).join("/"));
    }

    if (segments.includes(qualifier)) {
        const qualifierIndex = segments.lastIndexOf(qualifier);
        pushCandidate(segments.slice(0, qualifierIndex + 1).join("/"));
    }

    const currentDirectory = segments.slice(0, -1).join("/");
    pushCandidate(currentDirectory ? `${currentDirectory}/${qualifier}` : qualifier);
    pushCandidate(qualifier);
    return candidates;
}

function isBrowserLocationInQualifiedPackage(
    location: ProjectReaderSymbolLocation,
    context: ReturnType<typeof normalizeBrowserSymbolResolveContext>,
    qualifier: string,
): boolean {
    return resolveBrowserPackageRootCandidates(context.currentFilePath, qualifier).some((packageRoot) =>
        matchesBrowserQualifiedPackageRoot(packageRoot, location.relativePath),
    );
}

function filterBrowserSymbolLocations(
    locations: ProjectReaderSymbolLocation[],
    context: ReturnType<typeof normalizeBrowserSymbolResolveContext>,
): ProjectReaderSymbolLocation[] {
    const qualifier = resolveQualifiedSymbolPrefix(context);
    if (qualifier) {
        const qualifiedLocations = locations.filter((location) =>
            isBrowserLocationInQualifiedPackage(location, context, qualifier),
        );
        if (qualifiedLocations.length > 0) {
            return qualifiedLocations;
        }
    }

    if (!context.currentFilePath) {
        return locations;
    }

    const sameFileLocations = locations.filter((location) => location.relativePath === context.currentFilePath);
    return sameFileLocations.length > 0 ? sameFileLocations : locations;
}

function resolveBrowserSymbolLocations(
    projectId: string,
    symbol: string,
    context: ReturnType<typeof normalizeBrowserSymbolResolveContext>,
): ProjectReaderSymbolLocation[] {
    const locations: ProjectReaderSymbolLocation[] = [];
    const escapedSymbol = symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const symbolPattern = new RegExp(`\\b(class|function|interface|type|const|let|var)\\s+${escapedSymbol}\\b`);

    Object.entries(browserMockFiles).forEach(([relativePath, content]) => {
        content.split("\n").forEach((line, index) => {
            if (!symbolPattern.test(line)) {
                return;
            }

            const columnNumber = Math.max(1, line.indexOf(symbol) + 1);
            locations.push({
                projectId,
                relativePath,
                lineNumber: index + 1,
                columnNumber,
                endLineNumber: index + 1,
                endColumnNumber: columnNumber + symbol.length,
                symbolName: symbol,
                kind: "definition",
                preview: line.trim(),
            });
        });
    });

    return filterBrowserSymbolLocations(locations, context)
        .sort((left, right) => {
            const leftRank = rankBrowserSymbolLocation(left, context);
            const rightRank = rankBrowserSymbolLocation(right, context);
            for (let index = 0; index < leftRank.length; index += 1) {
                const diff = leftRank[index]! - rightRank[index]!;
                if (diff !== 0) {
                    return diff;
                }
            }
            return left.relativePath.localeCompare(right.relativePath)
                || left.lineNumber - right.lineNumber
                || left.columnNumber - right.columnNumber;
        });
}

function browserSearchProject(
    projectId: string,
    query: string,
    mode: ProjectReaderSearchMode,
    limit: number,
): ProjectReaderSearchMatch[] {
    const normalizedQuery = query.trim();
    const matches: ProjectReaderSearchMatch[] = [];
    if (!normalizedQuery) {
        return matches;
    }
    const pushMatch = (match: ProjectReaderSearchMatch): void => {
        if (matches.length < limit) {
            matches.push(match);
        }
    };

    if (mode === "symbol") {
        const queryLowercase = normalizedQuery.toLowerCase();
        const seenKeys = new Set<string>();
        Object.entries(browserMockFiles).forEach(([relativePath, content]) => {
            content.split("\n").forEach((line) => {
                const symbolMatch = line.match(/\b(class|function|interface|type|const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\b/);
                const symbol = symbolMatch?.[2] ?? "";
                if (!symbol.toLowerCase().includes(queryLowercase)) {
                    return;
                }
                const key = `${relativePath}:${symbol}`;
                if (seenKeys.has(key)) {
                    return;
                }
                seenKeys.add(key);
                resolveBrowserSymbolLocations(
                    projectId,
                    symbol,
                    normalizeBrowserSymbolResolveContext(),
                ).forEach((location) => {
                    pushMatch({
                        projectId,
                        relativePath: location.relativePath,
                        lineNumber: location.lineNumber,
                        columnNumber: location.columnNumber,
                        endLineNumber: location.endLineNumber ?? location.lineNumber,
                        endColumnNumber: location.endColumnNumber ?? location.columnNumber + location.symbolName.length,
                        kind: location.kind,
                        language: detectLanguage(location.relativePath),
                        preview: location.preview,
                    });
                });
            });
        });
        return matches;
    }

    Object.entries(browserMockFiles).forEach(([relativePath, content]) => {
        if (matches.length >= limit) {
            return;
        }
        content.split("\n").forEach((line, index) => {
            if (matches.length >= limit) {
                return;
            }
            const astGrepNeedle = normalizedQuery
                .replace(/\$\w+/g, "")
                .replace(/[{}()[\];:,.]/g, " ")
                .split(/\s+/)
                .find((part) => part.length > 1)
                ?? normalizedQuery;
            const columnIndex = mode === "astGrep"
                ? line.indexOf(astGrepNeedle)
                : line.toLowerCase().indexOf(normalizedQuery.toLowerCase());
            if (columnIndex < 0) {
                return;
            }
            const columnNumber = columnIndex + 1;
            pushMatch({
                projectId,
                relativePath,
                lineNumber: index + 1,
                columnNumber,
                endLineNumber: index + 1,
                endColumnNumber: columnNumber + Math.max(1, normalizedQuery.length),
                kind: mode === "astGrep" ? "ast-grep:mock" : "text",
                language: detectLanguage(relativePath),
                preview: line.trim(),
            });
        });
    });

    return matches;
}

function buildBrowserTreeEntries(): ProjectReaderTreeEntry[] {
    const entries = new Map<string, ProjectReaderTreeEntry>();

    Object.entries(browserMockFiles).forEach(([relativePath, content]) => {
        const parts = relativePath.split("/");
        let current = "";
        parts.slice(0, -1).forEach((part) => {
            current = current ? `${current}/${part}` : part;
            if (!entries.has(current)) {
                entries.set(current, {
                    relativePath: current,
                    isDir: true,
                    sizeBytes: null,
                    modifiedAtUnixMs: null,
                    language: null,
                });
            }
        });

        entries.set(relativePath, {
            relativePath,
            isDir: false,
            sizeBytes: content.length,
            modifiedAtUnixMs: null,
            language: detectLanguage(relativePath),
        });
    });

    return Array.from(entries.values()).sort((left, right) =>
        left.relativePath.localeCompare(right.relativePath),
    );
}

function detectLanguage(relativePath: string): string | null {
    if (/\.tsx?$/i.test(relativePath)) return "typescript";
    if (/\.jsx?$/i.test(relativePath)) return "javascript";
    if (/\.rs$/i.test(relativePath)) return "rust";
    if (/\.md$/i.test(relativePath)) return "markdown";
    if (/\.json$/i.test(relativePath)) return "json";
    if (/\.ya?ml$/i.test(relativePath)) return "yaml";
    return null;
}

function browserAddProject(rootPath: string): ProjectReaderProject {
    const normalizedRoot = rootPath.trim() || "/mock/external-project";
    const name = normalizedRoot.replace(/\\/g, "/").replace(/\/+$/g, "").split("/").pop() || "external-project";
    const existing = browserProjects.find((project) => project.rootPath === normalizedRoot);
    if (existing) {
        return existing;
    }

    const now = Date.now();
    const project: ProjectReaderProject = {
        id: `mock-${name}-${String(browserProjects.length + 1)}`,
        name,
        rootPath: normalizedRoot,
        createdAtUnixMs: now,
        updatedAtUnixMs: now,
    };
    browserProjects = [...browserProjects, project];
    return project;
}

export async function listProjectReaderProjects(): Promise<ProjectReaderProjectListResponse> {
    if (!isTauriRuntime()) {
        return { projects: browserProjects };
    }

    return invoke<ProjectReaderProjectListResponse>("list_project_reader_projects");
}

export async function addProjectReaderProject(rootPath: string): Promise<ProjectReaderProject> {
    if (!isTauriRuntime()) {
        return browserAddProject(rootPath);
    }

    return invoke<ProjectReaderProject>("add_project_reader_project", {
        rootPath,
    });
}

export async function getProjectReaderTree(projectId: string): Promise<ProjectReaderTreeResponse> {
    if (!isTauriRuntime()) {
        const project = browserProjects.find((item) => item.id === projectId) ?? mockProject;
        return {
            projectId: project.id,
            rootPath: project.rootPath,
            entries: buildBrowserTreeEntries(),
        };
    }

    return invoke<ProjectReaderTreeResponse>("get_project_reader_tree", {
        projectId,
    });
}

export async function getProjectReaderCodeReferences(
    projectId: string,
): Promise<ProjectReaderCodeReferenceResponse> {
    if (!isTauriRuntime()) {
        return {
            projectId,
            references: browserMockProjectReaderReferences,
        };
    }

    return invoke<ProjectReaderCodeReferenceResponse>("get_project_reader_code_references", {
        projectId,
    });
}

export async function readProjectReaderFile(
    projectId: string,
    relativePath: string,
): Promise<ProjectReaderFileResponse> {
    if (!isTauriRuntime()) {
        const content = browserMockFiles[relativePath] ?? "";
        return {
            projectId,
            relativePath,
            content,
            language: detectLanguage(relativePath),
            sizeBytes: content.length,
            modifiedAtUnixMs: null,
        };
    }

    return invoke<ProjectReaderFileResponse>("read_project_reader_file", {
        projectId,
        relativePath,
    });
}

export async function resolveProjectReaderSymbol(
    projectId: string,
    symbol: string,
    context?: ProjectReaderSymbolResolveContext,
): Promise<ProjectReaderSymbolResolveResponse> {
    if (!isTauriRuntime()) {
        const normalizedContext = normalizeBrowserSymbolResolveContext(context);
        const filteredLocations = resolveBrowserSymbolLocations(projectId, symbol, normalizedContext);

        return { projectId, symbol, locations: filteredLocations };
    }

    return invoke<ProjectReaderSymbolResolveResponse>("resolve_project_reader_symbol", {
        projectId,
        symbol,
        context,
    });
}

export async function searchProjectReader(
    projectId: string,
    query: string,
    mode: ProjectReaderSearchMode,
    limit = 80,
): Promise<ProjectReaderSearchResponse> {
    if (!isTauriRuntime()) {
        const normalizedLimit = Math.max(1, Math.min(Math.floor(limit), 200));
        const matches = browserSearchProject(projectId, query, mode, normalizedLimit);
        return {
            projectId,
            query,
            mode,
            matches,
        };
    }

    return invoke<ProjectReaderSearchResponse>("search_project_reader", {
        request: {
            projectId,
            query,
            mode,
            limit,
        },
    });
}

export async function copyProjectReaderTextToClipboard(text: string): Promise<void> {
    if (!isTauriRuntime()) {
        await writeBrowserClipboardText(text);
        return;
    }

    await writeClipboardText(text);
}
