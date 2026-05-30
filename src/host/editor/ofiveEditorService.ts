/**
 * @module host/editor/ofiveEditorService
 * @description ofive 对通用 @ofive/editor 服务接口的默认适配层。
 *
 * 该模块只负责把 ofive 的 vault 保存、editor context、active editor 和显示模式
 * 投影成通用编辑器 host bridge。真正的编辑器状态、插件注册和 UI 组件由
 * `packages/editor` 提供。
 */

import {
    createDefaultMarkdownPlugins,
    type EditorMode,
    type EditorPlugin,
    type EditorService,
} from "../../../packages/editor/src";
import { createOfiveMarkdownEditorService } from "../../../packages/editor/src/adapters/ofive";
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

    return createOfiveMarkdownEditorService({
        articleId: options.articleId,
        path: options.path,
        title: options.title,
        content: options.content,
        mode: options.mode,
        plugins: options.plugins ?? createDefaultMarkdownPlugins(),
        bridge: {
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
        },
    });
}
