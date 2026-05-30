/**
 * @module plugins/markdown-codemirror/editor/useOfiveEditorServiceBridge
 * @description 为 ofive 产品编辑器创建并清理通用 EditorService 实例。
 */

import { useEffect, useMemo } from "react";
import type { EditorMode, EditorService } from "../../../../packages/editor/src";
import { createDefaultOfiveEditorService } from "../../../host/editor/ofiveEditorService";
import type { WorkbenchContainerApi } from "../../../host/layout/workbenchContracts";

export interface UseOfiveEditorServiceBridgeOptions {
    articleId: string;
    path: string;
    title: string;
    content: string;
    mode: Extract<EditorMode, "edit" | "read">;
    containerApi: WorkbenchContainerApi;
}

export function useOfiveEditorServiceBridge(
    options: UseOfiveEditorServiceBridgeOptions,
): EditorService {
    const editorService = useMemo(
        () => createDefaultOfiveEditorService({
            articleId: options.articleId,
            path: options.path,
            title: options.title,
            content: options.content,
            mode: options.mode,
            containerApi: options.containerApi,
        }),
        [options.articleId, options.containerApi],
    );

    useEffect(() => {
        return () => {
            editorService.dispose();
        };
    }, [editorService]);

    return editorService;
}
