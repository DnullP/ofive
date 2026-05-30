/**
 * @module host/editor/ofiveEditorService
 * @description ofive 对通用 obeditor 服务接口的默认适配层。
 *
 * 该模块只负责把 ofive 的 vault 保存、editor context、active editor 和显示模式
 * 投影成通用编辑器 host bridge。真正的编辑器状态、插件注册和 UI 组件由
 * `obeditor` 提供。
 */

import {
    createEditorService,
    createDefaultMarkdownPlugins,
    type EditorDocument,
    type EditorHostAdapter,
    type EditorMode,
    type EditorPlugin,
    type EditorService,
} from "obeditor";
import { readVaultMarkdownFile } from "../../api/vaultApi";
import type { WorkbenchContainerApi } from "../layout/workbenchContracts";
import { reportActiveEditor } from "./activeEditorStore";
import {
    reportArticleContent,
    reportArticleFocus,
} from "./editorContextStore";
import { updateEditorDisplayMode } from "./editorDisplayModeStore";
import { savePersistedMarkdownContent } from "./persistedMarkdownContentSync";

export interface CreateDefaultOfiveEditorServiceOptions {
    articleId: string;
    path: string;
    title?: string;
    content?: string;
    mode?: EditorMode;
    containerApi?: WorkbenchContainerApi;
    plugins?: EditorPlugin[];
    dependencies?: Partial<DefaultOfiveEditorServiceDependencies>;
}

export interface DefaultOfiveEditorServiceDependencies {
    readMarkdown: (relativePath: string) => Promise<string>;
    saveMarkdown: (relativePath: string, content: string, containerApi?: WorkbenchContainerApi) => Promise<void>;
    reportArticleFocus: typeof reportArticleFocus;
    reportArticleContent: typeof reportArticleContent;
    reportActiveEditor: typeof reportActiveEditor;
    updateDisplayMode: typeof updateEditorDisplayMode;
    log: (level: "debug" | "info" | "warn" | "error", message: string, context?: Record<string, unknown>) => void;
}

export interface OfiveEditorHostBridge {
    readMarkdown: (relativePath: string) => Promise<string>;
    saveMarkdown: (relativePath: string, content: string) => Promise<void>;
    reportArticleFocus?: (payload: { articleId: string; path: string; content: string }) => void;
    reportArticleContent?: (payload: { articleId: string; path: string; content: string }) => void;
    reportActiveEditor?: (payload: { articleId: string; path: string }) => void;
    updateDisplayMode?: (mode: Extract<EditorMode, "edit" | "read">) => void;
    log?: EditorHostAdapter["log"];
}

const defaultDependencies: DefaultOfiveEditorServiceDependencies = {
    readMarkdown: async (relativePath) => {
        const response = await readVaultMarkdownFile(relativePath);
        return response.content;
    },
    saveMarkdown: async (relativePath, content, containerApi) => {
        await savePersistedMarkdownContent({
            containerApi,
            relativePath,
            content,
        });
    },
    reportArticleFocus,
    reportArticleContent,
    reportActiveEditor,
    updateDisplayMode: updateEditorDisplayMode,
    log: (level, message, context) => {
        const logger = level === "debug" ? console.info : console[level];
        logger("[ofive-editor-service]", message, context ?? {});
    },
};

function resolveDependencies(
    overrides: Partial<DefaultOfiveEditorServiceDependencies> | undefined,
): DefaultOfiveEditorServiceDependencies {
    return {
        ...defaultDependencies,
        ...overrides,
    };
}

export function createOfiveEditorHostAdapter(
    bridge: OfiveEditorHostBridge,
): EditorHostAdapter {
    return {
        async loadDocument(ref) {
            const relativePath = ref.path ?? ref.id;
            if (!relativePath) {
                throw new Error("Cannot load an ofive editor document without a path or id.");
            }

            return {
                id: ref.id ?? relativePath,
                path: relativePath,
                title: ref.title ?? relativePath.split("/").pop() ?? relativePath,
                content: await bridge.readMarkdown(relativePath),
            };
        },
        async saveDocument(document) {
            if (!document.path) {
                throw new Error("Cannot save an ofive editor document without a path.");
            }

            await bridge.saveMarkdown(document.path, document.content);
            return {
                savedVersion: document.version,
            };
        },
        onDocumentChanged(document) {
            if (!document.path) {
                return;
            }

            bridge.reportArticleContent?.({
                articleId: document.id,
                path: document.path,
                content: document.content,
            });
        },
        onDocumentFocused(document) {
            if (!document.path) {
                return;
            }

            const payload = {
                articleId: document.id,
                path: document.path,
                content: document.content,
            };
            bridge.reportArticleFocus?.(payload);
            bridge.reportActiveEditor?.({
                articleId: document.id,
                path: document.path,
            });
        },
        onModeChanged(mode) {
            if (mode === "split") {
                bridge.updateDisplayMode?.("edit");
                return;
            }

            bridge.updateDisplayMode?.(mode);
        },
        log: bridge.log,
    };
}

export function createOfiveEditorDocument(
    options: Pick<CreateDefaultOfiveEditorServiceOptions, "articleId" | "path" | "title" | "content">,
): EditorDocument {
    return {
        id: options.articleId,
        path: options.path,
        title: options.title ?? options.path.split("/").pop() ?? options.path,
        content: options.content ?? "",
        language: "markdown",
        version: 1,
        savedVersion: 1,
        updatedAt: Date.now(),
    };
}

/**
 * @function createDefaultOfiveEditorService
 * @description 创建接入 ofive 默认前后端同步能力的通用 Markdown editor service。
 * @param options 编辑器实例参数。
 * @returns 通用编辑器服务实例。
 */
export function createDefaultOfiveEditorService(
    options: CreateDefaultOfiveEditorServiceOptions,
): EditorService {
    const dependencies = resolveDependencies(options.dependencies);

    return createEditorService({
        document: createOfiveEditorDocument(options),
        mode: options.mode,
        adapter: createOfiveEditorHostAdapter({
            readMarkdown: dependencies.readMarkdown,
            saveMarkdown: (relativePath, content) => dependencies.saveMarkdown(
                relativePath,
                content,
                options.containerApi,
            ),
            reportArticleFocus: dependencies.reportArticleFocus,
            reportArticleContent: dependencies.reportArticleContent,
            reportActiveEditor: dependencies.reportActiveEditor,
            updateDisplayMode: (mode) => dependencies.updateDisplayMode(mode),
            log: dependencies.log,
        }),
        plugins: options.plugins ?? createDefaultMarkdownPlugins(),
    });
}
