/**
 * @module host/editor/ofiveEditorCapabilities
 * @description ofive 注入给 obeditor 的宿主能力适配层。
 *
 * ofive 只提供 vault、workbench、i18n、project-reader 等宿主能力；
 * 编辑器插件本体由 obeditor 拥有。
 */

import { createElement } from "react";
import type {
    EditorCapabilities,
    EditorWikiLinkResolvedTarget,
    EditorWikiLinkTargetContext,
} from "obeditor";
import {
    buildImageEmbedSyntax,
    parseWikiLinkTarget,
    resolveParentDirectory,
    resolveWikiLinkSubtarget,
} from "obeditor";
import {
    createVaultBinaryFile,
    readVaultBinaryFile,
    readVaultMarkdownFile,
    resolveMediaEmbedTarget,
    resolveWikiLinkTarget,
    suggestWikiLinkTargets,
} from "../../api/vaultApi";
import { emitEditorRevealRequestedEvent } from "../events/appEventBus";
import {
    buildFileTabId,
    openFileInWorkbench,
} from "../layout/openFileService";
import { showNativeContextMenu } from "../layout/nativeContextMenu";
import type { WorkbenchContainerApi } from "../layout/workbenchContracts";
import i18n from "../../i18n";
import { ProjectReaderWikiLinkPreviewContent } from "../../plugins/project-reader/ProjectReaderWikiLinkPreviewContent";
import {
    openProjectReaderWikiLinkTarget,
    resolveProjectReaderWikiLinkPreview,
} from "../../plugins/project-reader/projectReaderLinks";

export interface OfiveEditorCapabilitiesContext {
    containerApi?: WorkbenchContainerApi;
    getCurrentFilePath?: () => string;
    getCurrentDocumentContent?: () => string;
}

function normalizeRelativePath(path: string): string {
    return path.replace(/\\/g, "/");
}

function resolveContextCurrentFilePath(
    context: OfiveEditorCapabilitiesContext,
    targetContext?: EditorWikiLinkTargetContext,
): string {
    return targetContext?.currentFilePath
        ?? context.getCurrentFilePath?.()
        ?? "";
}

function readExistingPanelContent(
    containerApi: WorkbenchContainerApi | undefined,
    relativePath: string,
): string | null {
    if (!containerApi) {
        return null;
    }

    const normalizedPath = normalizeRelativePath(relativePath);
    const panel = containerApi.getPanel(buildFileTabId(normalizedPath))
        ?? containerApi.panels?.find((candidate) =>
            typeof candidate.params?.path === "string"
            && normalizeRelativePath(candidate.params.path) === normalizedPath,
        );

    return typeof panel?.params?.content === "string"
        ? panel.params.content
        : null;
}

async function readWikiLinkResolvedContent(
    containerApi: WorkbenchContainerApi | undefined,
    relativePath: string,
): Promise<string> {
    const existingContent = readExistingPanelContent(containerApi, relativePath);
    if (existingContent !== null) {
        return existingContent;
    }

    return (await readVaultMarkdownFile(relativePath)).content;
}

async function resolveOfiveWikiLinkTarget(
    context: OfiveEditorCapabilitiesContext,
    target: string,
    targetContext: EditorWikiLinkTargetContext = {},
): Promise<EditorWikiLinkResolvedTarget | null> {
    const currentFilePath = resolveContextCurrentFilePath(context, targetContext);
    const currentDirectory = resolveParentDirectory(currentFilePath);
    const parsedTarget = parseWikiLinkTarget(target);
    const resolved = parsedTarget.noteTarget.length === 0 && parsedTarget.subtarget !== null
        ? { relativePath: normalizeRelativePath(currentFilePath) }
        : await resolveWikiLinkTarget(currentDirectory, parsedTarget.noteTarget);

    if (!resolved) {
        return null;
    }

    const content = await readWikiLinkResolvedContent(context.containerApi, resolved.relativePath);
    const subtarget = resolveWikiLinkSubtarget(content, parsedTarget.subtarget);

    return {
        relativePath: resolved.relativePath,
        content,
        revealLine: subtarget?.line,
        cursorOffset: subtarget?.offset,
    };
}

function scheduleEditorRevealRequest(options: {
    articleId: string;
    path: string;
    line: number;
}): void {
    const emitReveal = (): void => {
        emitEditorRevealRequestedEvent(options);
    };

    if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
        window.requestAnimationFrame(emitReveal);
        return;
    }

    emitReveal();
}

async function openOfiveWikiLinkTarget(
    context: OfiveEditorCapabilitiesContext,
    target: string,
    targetContext: EditorWikiLinkTargetContext,
): Promise<void> {
    if (!context.containerApi) {
        console.warn("[ofive-editor-capabilities] wikilink open skipped: missing containerApi", {
            target,
        });
        return;
    }

    if (await openProjectReaderWikiLinkTarget(context.containerApi, target)) {
        return;
    }

    const currentFilePath = resolveContextCurrentFilePath(context, targetContext);
    const parsedTarget = parseWikiLinkTarget(target);
    const resolved = await resolveOfiveWikiLinkTarget(context, target, targetContext);
    if (!resolved) {
        console.warn("[ofive-editor-capabilities] wikilink target not found", {
            currentFilePath,
            target,
            noteTarget: parsedTarget.noteTarget,
        });
        return;
    }

    await openFileInWorkbench({
        containerApi: context.containerApi,
        relativePath: resolved.relativePath,
        tabParams: typeof resolved.cursorOffset === "number" || typeof resolved.revealLine === "number"
            ? {
                initialCursorOffset: resolved.cursorOffset,
                initialRevealLine: resolved.revealLine,
                autoFocus: true,
            }
            : undefined,
    });

    if (typeof resolved.revealLine === "number") {
        scheduleEditorRevealRequest({
            articleId: buildFileTabId(resolved.relativePath),
            path: resolved.relativePath,
            line: resolved.revealLine,
        });
    }

    console.info("[ofive-editor-capabilities] wikilink opened", {
        currentFilePath,
        target,
        resolvedPath: resolved.relativePath,
        revealLine: resolved.revealLine ?? null,
    });
}

export function createOfiveEditorCapabilities(
    context: OfiveEditorCapabilitiesContext = {},
): EditorCapabilities {
    return {
        localization: {
            t(key, options, fallback) {
                const translated = i18n.t(key, options ?? {});
                return typeof translated === "string" ? translated : fallback ?? key;
            },
        },
        contextMenu: {
            show(items) {
                return showNativeContextMenu(items);
            },
        },
        mediaEmbeds: {
            async createAsset(file, mediaContext) {
                const relativePath = mediaContext.suggestedRelativePath
                    ?? `Images/${mediaContext.suggestedFileName ?? file.name}`;
                const base64Content = mediaContext.base64Content;
                if (!base64Content) {
                    throw new Error("Cannot create a pasted image asset without base64 content.");
                }

                await createVaultBinaryFile(relativePath, base64Content);
                return {
                    relativePath,
                    markdown: mediaContext.markdown ?? buildImageEmbedSyntax(relativePath),
                };
            },
            async resolveTarget(target, mediaContext) {
                const currentFilePath = mediaContext.currentFilePath ?? context.getCurrentFilePath?.() ?? "";
                const currentDirectory = resolveParentDirectory(currentFilePath);
                const resolved = await resolveMediaEmbedTarget(currentDirectory, target);
                return resolved ? { relativePath: resolved.relativePath } : null;
            },
            readBinary: readVaultBinaryFile,
        },
        wikiLinks: {
            suggestTargets: suggestWikiLinkTargets,
            resolveTarget: (target, targetContext) =>
                resolveOfiveWikiLinkTarget(context, target, targetContext),
            async previewTarget(target, targetContext) {
                const projectPreview = await resolveProjectReaderWikiLinkPreview(target);
                if (projectPreview !== null) {
                    return {
                        kind: "custom",
                        resolvedPath: projectPreview.resolvedPath,
                        content: projectPreview.content,
                        render: () => createElement(ProjectReaderWikiLinkPreviewContent, {
                            preview: projectPreview,
                        }),
                    };
                }

                const resolved = await resolveOfiveWikiLinkTarget(context, target, targetContext);
                if (!resolved?.content) {
                    return null;
                }

                return {
                    kind: "markdown",
                    resolvedPath: resolved.relativePath,
                    content: resolved.content,
                    revealLine: resolved.revealLine,
                };
            },
            readTargetContent: async (relativePath) =>
                readWikiLinkResolvedContent(context.containerApi, relativePath),
            openTarget: (target, targetContext) =>
                openOfiveWikiLinkTarget(context, target, targetContext),
        },
    };
}

export const ofiveEditorCapabilities = createOfiveEditorCapabilities();
