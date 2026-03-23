/**
 * @module plugins/vaultFsSyncPlugin
 * @description Vault 文件系统同步插件：负责将后端 fs 事件转换为前端持久态更新语义，
 *   并在当前聚焦 Markdown 文件被外部修改时刷新编辑器内容。
 *
 * @dependencies
 *   - ../api/vaultApi
 *   - ../host/events/appEventBus
 *   - ../host/store/editorContextStore
 *
 * @example
 *   import { activatePlugin } from "./vaultFsSyncPlugin";
 *   const dispose = activatePlugin();
 *
 * @exports
 *   - VaultFsSyncPluginDependencies
 *   - activateVaultFsSyncPluginRuntime
 *   - activatePlugin
 */

import {
    isSelfTriggeredVaultFsEvent,
    readVaultMarkdownFile,
    type VaultFsEventPayload,
} from "../api/vaultApi";
import {
    emitPersistedContentUpdatedEvent,
    subscribeVaultFsBusEvent,
} from "../host/events/appEventBus";
import {
    getFocusedArticleSnapshot,
    reportArticleContentByPath,
} from "../host/store/editorContextStore";

/**
 * @interface VaultFsSyncPluginDependencies
 * @description Vault fs 同步插件所需依赖，支持测试时注入替身实现。
 * @field isSelfTriggeredVaultFsEvent 判断事件是否由本地写入触发。
 * @field readVaultMarkdownFile 读取最新 Markdown 文件内容。
 * @field subscribeVaultFsBusEvent 订阅统一 fs 事件总线。
 * @field emitPersistedContentUpdatedEvent 发布持久态内容已更新事件。
 * @field getFocusedArticleSnapshot 获取当前聚焦文章快照。
 * @field reportArticleContentByPath 按路径刷新前端文章缓存。
 */
export interface VaultFsSyncPluginDependencies {
    isSelfTriggeredVaultFsEvent: (payload: VaultFsEventPayload) => boolean;
    readVaultMarkdownFile: (path: string) => Promise<{ content: string }>;
    subscribeVaultFsBusEvent: (
        listener: (payload: VaultFsEventPayload) => void,
    ) => () => void;
    emitPersistedContentUpdatedEvent: (payload: {
        relativePath: string;
        source: "external";
    }) => void;
    getFocusedArticleSnapshot: () => { path: string } | null;
    reportArticleContentByPath: (path: string, content: string) => void;
}

const defaultDependencies: VaultFsSyncPluginDependencies = {
    isSelfTriggeredVaultFsEvent,
    readVaultMarkdownFile,
    subscribeVaultFsBusEvent,
    emitPersistedContentUpdatedEvent,
    getFocusedArticleSnapshot,
    reportArticleContentByPath,
};

/**
 * @function isMarkdownPath
 * @description 判断路径是否为 Markdown 文件。
 * @param path 相对路径。
 * @returns 是否为 Markdown 文件。
 */
function isMarkdownPath(path: string): boolean {
    return path.endsWith(".md") || path.endsWith(".markdown");
}

/**
 * @function activateVaultFsSyncPluginRuntime
 * @description 激活 Vault fs 同步插件，接管后端 fs 事件到前端状态的桥接。
 * @param dependencies 可选依赖注入。
 * @returns 插件清理函数。
 */
export function activateVaultFsSyncPluginRuntime(
    dependencies: VaultFsSyncPluginDependencies = defaultDependencies,
): () => void {
    const unlisten = dependencies.subscribeVaultFsBusEvent((payload) => {
        if (dependencies.isSelfTriggeredVaultFsEvent(payload)) {
            console.info("[vaultFsSyncPlugin] skip self-triggered fs event", {
                eventId: payload.eventId,
                sourceTraceId: payload.sourceTraceId,
                eventType: payload.eventType,
                path: payload.relativePath,
            });
            return;
        }

        if (
            payload.relativePath &&
            ["modified", "created"].includes(payload.eventType)
        ) {
            dependencies.emitPersistedContentUpdatedEvent({
                relativePath: payload.relativePath,
                source: "external",
            });
        }

        const focusedArticle = dependencies.getFocusedArticleSnapshot();
        if (!focusedArticle || !isMarkdownPath(focusedArticle.path)) {
            return;
        }

        if (!payload.relativePath || payload.relativePath !== focusedArticle.path) {
            return;
        }

        if (!["modified", "created", "moved"].includes(payload.eventType)) {
            return;
        }

        void dependencies.readVaultMarkdownFile(payload.relativePath)
            .then((latest) => {
                dependencies.reportArticleContentByPath(payload.relativePath as string, latest.content);
                console.info("[vaultFsSyncPlugin] synced focused article by fs event", {
                    eventId: payload.eventId,
                    eventType: payload.eventType,
                    path: payload.relativePath,
                });
            })
            .catch((error) => {
                console.warn("[vaultFsSyncPlugin] sync focused article by fs event failed", {
                    eventId: payload.eventId,
                    path: payload.relativePath,
                    message: error instanceof Error ? error.message : String(error),
                });
            });
    });

    return () => {
        unlisten();
    };
}

/**
 * @function activatePlugin
 * @description Vault fs 同步插件入口，供插件运行时自动发现。
 * @returns 插件清理函数。
 */
export function activatePlugin(): () => void {
    return activateVaultFsSyncPluginRuntime();
}