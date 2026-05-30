/**
 * @module plugins/markdown-codemirror/editor/editorServiceDocumentBridge
 * @description 小型桥接工具：把产品编辑器的文档事实同步到通用 EditorService。
 */

import type { MutableRefObject } from "react";
import type { EditorService } from "../../../../packages/editor/src";

export interface SyncEditorServiceDocumentOptions {
    editorService: EditorService;
    articleId: string;
    path: string;
    content: string;
    title?: string;
}

export function resolveEditorServiceDocumentTitle(path: string): string {
    return path.split("/").pop() ?? path;
}

export function syncEditorServiceDocument(options: SyncEditorServiceDocumentOptions): void {
    options.editorService.setDocument({
        id: options.articleId,
        path: options.path,
        title: options.title ?? resolveEditorServiceDocumentTitle(options.path),
        content: options.content,
        language: "markdown",
    });
}

export function withExternalEditorDocumentUpdate(
    applyingExternalDocumentRef: MutableRefObject<boolean>,
    update: () => void,
): void {
    applyingExternalDocumentRef.current = true;
    try {
        update();
    } finally {
        applyingExternalDocumentRef.current = false;
    }
}
