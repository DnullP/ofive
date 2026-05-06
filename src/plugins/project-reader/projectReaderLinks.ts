/**
 * @module plugins/project-reader/projectReaderLinks
 * @description 外部项目阅读器 tab 与 `[[projectName:/path/to/file:line:col-endLine:endCol]]` 链接工具。
 */

import type {
    TabInstanceDefinition,
    WorkbenchContainerApi,
} from "../../host/layout/workbenchContracts";
import {
    listProjectReaderProjects,
    readProjectReaderFile,
    type ProjectReaderProject,
    type ProjectReaderSymbolResolveContext,
    type ProjectReaderSymbolLocation,
} from "../../api/projectReaderApi";

export const PROJECT_READER_PANEL_ID = "project-reader";
export const PROJECT_READER_CODE_TAB_COMPONENT_ID = "project-reader.code";

export interface ProjectReaderLinkTarget {
    projectName: string;
    relativePath: string;
    lineNumber: number | null;
    columnNumber: number | null;
    endLineNumber: number | null;
    endColumnNumber: number | null;
}

export interface ProjectReaderWikiLinkRange {
    lineNumber: number;
    columnNumber?: number | null;
    endLineNumber?: number | null;
    endColumnNumber?: number | null;
}

export interface ProjectReaderWikiLinkPreviewLine {
    lineNumber: number;
    text: string;
    isTargetLine: boolean;
}

export interface ProjectReaderWikiLinkPreview {
    projectId: string;
    projectName: string;
    relativePath: string;
    resolvedPath: string;
    language: string | null;
    content: string;
    snippetLines: ProjectReaderWikiLinkPreviewLine[];
}

export interface ProjectReaderTabInput {
    projectId: string;
    projectName: string;
    rootPath: string;
    relativePath: string;
    lineNumber?: number | null;
    columnNumber?: number | null;
    endLineNumber?: number | null;
    endColumnNumber?: number | null;
}

export function normalizeProjectRelativePath(relativePath: string): string {
    return relativePath.replace(/\\/g, "/").trim().replace(/^\/+/, "");
}

export function buildProjectReaderTabId(projectId: string, relativePath: string): string {
    return `project-reader:${projectId}:${encodeURIComponent(normalizeProjectRelativePath(relativePath))}`;
}

export function buildProjectReaderTabDefinition(input: ProjectReaderTabInput): TabInstanceDefinition {
    const relativePath = normalizeProjectRelativePath(input.relativePath);
    const title = relativePath.split("/").pop() || relativePath;
    return {
        id: buildProjectReaderTabId(input.projectId, relativePath),
        title,
        component: PROJECT_READER_CODE_TAB_COMPONENT_ID,
        params: {
            projectId: input.projectId,
            projectName: input.projectName,
            rootPath: input.rootPath,
            relativePath,
            lineNumber: input.lineNumber ?? null,
            columnNumber: input.columnNumber ?? null,
            endLineNumber: input.endLineNumber ?? null,
            endColumnNumber: input.endColumnNumber ?? null,
        },
    };
}

export function buildProjectReaderWikiLinkTarget(
    projectName: string,
    relativePath: string,
    range: ProjectReaderWikiLinkRange | null | undefined = null,
): string {
    const normalizedPath = normalizeProjectRelativePath(relativePath);
    const lineNumber = range?.lineNumber ?? null;
    if (lineNumber === null) {
        return `${projectName}:/${normalizedPath}`;
    }

    const columnNumber = range?.columnNumber ?? null;
    const endLineNumber = range?.endLineNumber ?? null;
    const endColumnNumber = range?.endColumnNumber ?? null;

    const startSpec = columnNumber !== null ? `${lineNumber}:${columnNumber}` : String(lineNumber);
    if (endLineNumber === null) {
        return `${projectName}:/${normalizedPath}:${startSpec}`;
    }

    const endSpec = endColumnNumber !== null ? `${endLineNumber}:${endColumnNumber}` : String(endLineNumber);
    return `${projectName}:/${normalizedPath}:${startSpec}-${endSpec}`;
}

export function buildProjectReaderWikiLinkMarkup(
    projectName: string,
    relativePath: string,
    displayText = "",
    range: ProjectReaderWikiLinkRange | null | undefined = null,
): string {
    const target = buildProjectReaderWikiLinkTarget(projectName, relativePath, range);
    const normalizedDisplayText = displayText.trim();
    if (!normalizedDisplayText) {
        return `[[${target}]]`;
    }
    return `[[${target}|${normalizedDisplayText}]]`;
}

export function buildProjectReaderTabDefinitionFromLocation(
    project: ProjectReaderProject,
    location: ProjectReaderSymbolLocation,
): TabInstanceDefinition {
    const endLineNumber = location.endLineNumber ?? location.lineNumber;
    const endColumnNumber = location.endColumnNumber ?? (
        endLineNumber === location.lineNumber
            ? location.columnNumber + location.symbolName.length
            : null
    );
    return buildProjectReaderTabDefinition({
        projectId: project.id,
        projectName: project.name,
        rootPath: project.rootPath,
        relativePath: location.relativePath,
        lineNumber: location.lineNumber,
        columnNumber: location.columnNumber,
        endLineNumber,
        endColumnNumber,
    });
}

export function buildProjectReaderSymbolResolveContext(
    currentFilePath: string | null,
    currentLineNumber: number | null,
    currentColumnNumber: number | null,
    currentLineText: string | null = null,
    currentFileContent: string | null = null,
): ProjectReaderSymbolResolveContext {
    return {
        currentFilePath,
        currentLineNumber,
        currentColumnNumber,
        currentLineText,
        currentFileContent,
    };
}

export async function resolveProjectReaderWikiLinkTabDefinition(
    target: string,
): Promise<TabInstanceDefinition | null> {
    const parsed = parseProjectReaderWikiLinkTarget(target);
    if (!parsed) {
        return null;
    }

    const { projects } = await listProjectReaderProjects();
    const project = projects.find((candidate) =>
        candidate.name === parsed.projectName || candidate.id === parsed.projectName,
    );

    if (!project) {
        console.warn("[project-reader] wikilink project not found", {
            projectName: parsed.projectName,
            target,
        });
        return null;
    }

    return buildProjectReaderTabDefinition({
        projectId: project.id,
        projectName: project.name,
        rootPath: project.rootPath,
        relativePath: parsed.relativePath,
        lineNumber: parsed.lineNumber,
        columnNumber: parsed.columnNumber,
        endLineNumber: parsed.endLineNumber,
        endColumnNumber: parsed.endColumnNumber,
    });
}

export async function resolveProjectReaderWikiLinkPreview(
    target: string,
): Promise<ProjectReaderWikiLinkPreview | null> {
    const parsed = parseProjectReaderWikiLinkTarget(target);
    if (!parsed) {
        return null;
    }

    const { projects } = await listProjectReaderProjects();
    const project = projects.find((candidate) =>
        candidate.name === parsed.projectName || candidate.id === parsed.projectName,
    );
    if (!project) {
        console.warn("[project-reader] wikilink preview project not found", {
            projectName: parsed.projectName,
            target,
        });
        return null;
    }

    const file = await readProjectReaderFile(project.id, parsed.relativePath);
    const snippetLines = buildProjectReaderWikiLinkPreviewLines(file.content, parsed);
    const range = parsed.lineNumber !== null ? {
        lineNumber: parsed.lineNumber,
        columnNumber: parsed.columnNumber,
        endLineNumber: parsed.endLineNumber,
        endColumnNumber: parsed.endColumnNumber,
    } : null;

    return {
        projectId: project.id,
        projectName: project.name,
        relativePath: parsed.relativePath,
        resolvedPath: buildProjectReaderWikiLinkTarget(project.name, parsed.relativePath, range),
        language: file.language ?? null,
        content: snippetLines.map((line) => line.text).join("\n"),
        snippetLines,
    };
}

export function openProjectReaderLocationInWorkbench(
    containerApi: WorkbenchContainerApi,
    input: ProjectReaderTabInput,
): void {
    const tab = buildProjectReaderTabDefinition(input);
    const existing = containerApi.getPanel(tab.id);
    if (existing) {
        existing.api.updateParameters?.(tab.params ?? {});
        existing.api.setActive();
        return;
    }

    containerApi.addPanel({
        id: tab.id,
        title: tab.title,
        component: tab.component,
        params: tab.params,
    });
}

export function parseProjectReaderWikiLinkTarget(target: string): ProjectReaderLinkTarget | null {
    const normalizedTarget = target.trim();
    const projectSeparatorIndex = normalizedTarget.indexOf(":");
    if (projectSeparatorIndex <= 0) {
        return null;
    }

    const projectName = normalizedTarget.slice(0, projectSeparatorIndex).trim();
    const rawPathAndRange = normalizedTarget.slice(projectSeparatorIndex + 1).trim();
    if (!projectName || !rawPathAndRange.startsWith("/")) {
        return null;
    }

    const rangeMatch = rawPathAndRange.match(/^(\/.*?)(?::(\d+)(?::(\d+))?(?:-(\d+)(?::(\d+))?)?)?$/);
    if (!rangeMatch) {
        return null;
    }

    const relativePath = normalizeProjectRelativePath(rangeMatch[1] ?? "");
    const lineNumber = rangeMatch[2] ? Number(rangeMatch[2]) : null;
    const columnNumber = rangeMatch[3] ? Number(rangeMatch[3]) : null;
    const endLineNumber = rangeMatch[4] ? Number(rangeMatch[4]) : null;
    const endColumnNumber = rangeMatch[5] ? Number(rangeMatch[5]) : null;

    if (!relativePath) {
        return null;
    }

    return {
        projectName,
        relativePath,
        lineNumber: Number.isFinite(lineNumber) ? lineNumber : null,
        columnNumber: Number.isFinite(columnNumber) ? columnNumber : null,
        endLineNumber: Number.isFinite(endLineNumber) ? endLineNumber : null,
        endColumnNumber: Number.isFinite(endColumnNumber) ? endColumnNumber : null,
    };
}

function buildProjectReaderWikiLinkPreviewLines(
    content: string,
    target: ProjectReaderLinkTarget,
): ProjectReaderWikiLinkPreviewLine[] {
    const sourceLines = content.split("\n");
    if (sourceLines.length === 0) {
        return [];
    }

    const startLineNumber = target.lineNumber ?? 1;
    const endLineNumber = target.endLineNumber ?? target.lineNumber ?? Math.min(sourceLines.length, 80);
    const normalizedStartLine = Math.max(1, Math.min(startLineNumber, sourceLines.length));
    const normalizedEndLine = Math.max(
        normalizedStartLine,
        Math.min(endLineNumber, sourceLines.length),
    );

    const output: ProjectReaderWikiLinkPreviewLine[] = [];
    for (let lineNumber = normalizedStartLine; lineNumber <= normalizedEndLine; lineNumber += 1) {
        output.push({
            lineNumber,
            text: sourceLines[lineNumber - 1] ?? "",
            isTargetLine: target.lineNumber !== null
                && lineNumber >= normalizedStartLine
                && lineNumber <= normalizedEndLine,
        });
    }
    return output;
}

export async function openProjectReaderWikiLinkTarget(
    containerApi: WorkbenchContainerApi,
    target: string,
): Promise<boolean> {
    const tab = await resolveProjectReaderWikiLinkTabDefinition(target);
    if (!tab) {
        return false;
    }
    const existing = containerApi.getPanel(tab.id);
    if (existing) {
        existing.api.updateParameters?.(tab.params ?? {});
        existing.api.setActive();
        return true;
    }

    containerApi.addPanel({
        id: tab.id,
        title: tab.title,
        component: tab.component,
        params: tab.params,
    });
    return true;
}
