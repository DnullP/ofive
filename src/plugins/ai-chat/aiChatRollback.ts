/**
 * @module plugins/ai-chat/aiChatRollback
 * @description In-memory rollback checkpoints for AI chat turns.
 */

export type AiChatRollbackFileKind = "markdown" | "canvas";

export interface AiChatRollbackVaultEntry {
    path: string;
    isDir: boolean;
}

export interface AiChatRollbackFileSnapshot {
    relativePath: string;
    kind: AiChatRollbackFileKind;
    content: string;
}

export interface AiChatRollbackCheckpoint {
    id: string;
    createdAtUnixMs: number;
    files: AiChatRollbackFileSnapshot[];
}

export interface AiChatRollbackCaptureDependencies {
    files: AiChatRollbackVaultEntry[];
    readMarkdownFile: (relativePath: string) => Promise<{ content: string }>;
    readCanvasFile: (relativePath: string) => Promise<{ content: string }>;
    checkpointId: string;
    nowUnixMs: number;
}

export interface AiChatRollbackRestoreDependencies {
    files: AiChatRollbackVaultEntry[];
    saveMarkdownFile: (relativePath: string, content: string) => Promise<unknown>;
    saveCanvasFile: (relativePath: string, content: string) => Promise<unknown>;
    deleteMarkdownFile: (relativePath: string) => Promise<unknown>;
    deleteCanvasFile: (relativePath: string) => Promise<unknown>;
}

export interface AiChatRollbackRestoreResult {
    restoredPaths: string[];
    deletedPaths: string[];
}

/**
 * @function isRollbackableAiChatFilePath
 * @description Returns whether a vault path can be snapshotted and restored by AI chat rollback.
 */
export function isRollbackableAiChatFilePath(path: string): boolean {
    return resolveRollbackFileKind(path) !== null;
}

/**
 * @function captureAiChatRollbackCheckpoint
 * @description Captures the current saved contents of rollbackable vault files.
 */
export async function captureAiChatRollbackCheckpoint(
    dependencies: AiChatRollbackCaptureDependencies,
): Promise<AiChatRollbackCheckpoint> {
    const files = listRollbackableFileEntries(dependencies.files);
    const snapshots = await Promise.all(files.map(async (file) => {
        const content = file.kind === "markdown"
            ? (await dependencies.readMarkdownFile(file.relativePath)).content
            : (await dependencies.readCanvasFile(file.relativePath)).content;
        return {
            relativePath: file.relativePath,
            kind: file.kind,
            content,
        };
    }));

    return {
        id: dependencies.checkpointId,
        createdAtUnixMs: dependencies.nowUnixMs,
        files: snapshots,
    };
}

/**
 * @function restoreAiChatRollbackCheckpoint
 * @description Restores all files from a checkpoint and removes rollbackable files created after it.
 */
export async function restoreAiChatRollbackCheckpoint(
    checkpoint: AiChatRollbackCheckpoint,
    dependencies: AiChatRollbackRestoreDependencies,
): Promise<AiChatRollbackRestoreResult> {
    const snapshotPaths = new Set(checkpoint.files.map((file) => file.relativePath));
    const currentFiles = listRollbackableFileEntries(dependencies.files);
    const deletedPaths: string[] = [];
    const restoredPaths: string[] = [];

    for (const file of currentFiles) {
        if (snapshotPaths.has(file.relativePath)) {
            continue;
        }

        if (file.kind === "markdown") {
            await dependencies.deleteMarkdownFile(file.relativePath);
        } else {
            await dependencies.deleteCanvasFile(file.relativePath);
        }
        deletedPaths.push(file.relativePath);
    }

    for (const snapshot of checkpoint.files) {
        if (snapshot.kind === "markdown") {
            await dependencies.saveMarkdownFile(snapshot.relativePath, snapshot.content);
        } else {
            await dependencies.saveCanvasFile(snapshot.relativePath, snapshot.content);
        }
        restoredPaths.push(snapshot.relativePath);
    }

    return {
        restoredPaths,
        deletedPaths,
    };
}

function listRollbackableFileEntries(
    entries: AiChatRollbackVaultEntry[],
): AiChatRollbackFileSnapshotPath[] {
    const seenPaths = new Set<string>();
    const files: AiChatRollbackFileSnapshotPath[] = [];

    entries.forEach((entry) => {
        if (entry.isDir) {
            return;
        }

        const relativePath = normalizeRollbackPath(entry.path);
        const kind = resolveRollbackFileKind(relativePath);
        if (!kind || seenPaths.has(relativePath)) {
            return;
        }

        seenPaths.add(relativePath);
        files.push({ relativePath, kind });
    });

    return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

interface AiChatRollbackFileSnapshotPath {
    relativePath: string;
    kind: AiChatRollbackFileKind;
}

function normalizeRollbackPath(path: string): string {
    return path.replace(/\\/g, "/").replace(/^\/+/, "").trim();
}

function resolveRollbackFileKind(path: string): AiChatRollbackFileKind | null {
    const normalizedPath = normalizeRollbackPath(path).toLowerCase();
    if (normalizedPath.endsWith(".md") || normalizedPath.endsWith(".markdown")) {
        return "markdown";
    }
    if (normalizedPath.endsWith(".canvas")) {
        return "canvas";
    }
    return null;
}
