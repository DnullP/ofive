/**
 * @module api/aiApi
 * @description AI 对话接口封装：通过 Tauri invoke 启动后端流式聊天，并通过事件订阅增量结果。
 * @dependencies
 *  - @tauri-apps/api/core
 *  - @tauri-apps/api/event
 *
 * @example
 *   const unlisten = await subscribeAiChatStreamEvents((payload) => {
 *     console.info(payload.streamId, payload.eventType, payload.deltaText);
 *   });
 *   const { streamId } = await startAiChatStream({ message: "Hello" });
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/**
 * @constant AI_CHAT_STREAM_EVENT_NAME
 * @description Rust 后端向前端推送 AI 流式对话事件的事件名。
 */
export const AI_CHAT_STREAM_EVENT_NAME = "ai://chat-stream";

/**
 * @type AiChatStreamEventType
 * @description AI 聊天流事件类型。
 */
export type AiChatStreamEventType = "started" | "delta" | "done" | "stopped" | "error" | "debug" | "confirmation";

/**
 * @interface AiSidecarHealthResponse
 * @description sidecar 健康检查响应。
 */
export interface AiSidecarHealthResponse {
    status: string;
    agentName: string;
    version: string;
    pid: number;
}

/**
 * @interface AiChatStreamStartResponse
 * @description 启动一次流式聊天后的返回值。
 */
export interface AiChatStreamStartResponse {
    streamId: string;
}

/**
 * @interface AiVendorFieldDefinition
 * @description 单个 vendor 配置字段定义。
 */
export interface AiVendorFieldDefinition {
    key: string;
    label: string;
    description: string;
    fieldType: "text" | "password";
    required: boolean;
    placeholder: string | null;
    defaultValue: string | null;
}

/**
 * @interface AiVendorDefinition
 * @description AI vendor 描述与动态表单定义。
 */
export interface AiVendorDefinition {
    id: string;
    title: string;
    description: string;
    defaultModel: string;
    fields: AiVendorFieldDefinition[];
}

/**
 * @interface AiVendorModelDefinition
 * @description 后端返回的 vendor 可用模型条目。
 */
export interface AiVendorModelDefinition {
    id: string;
    object: string | null;
    ownedBy: string | null;
    created: number | null;
}

/**
 * @interface AiChatSettings
 * @description 当前仓库的 AI 聊天配置。
 */
export interface AiChatSettings {
    vendorId: string;
    model: string;
    fieldValues: Record<string, string>;
}

/**
 * @interface AiChatHistoryMessage
 * @description 一条持久化的 AI 对话消息。
 */
export interface AiChatHistoryMessage {
    id: string;
    role: "assistant" | "user";
    text: string;
    createdAtUnixMs: number;
    reasoningText?: string;
    contentBlocks?: AiChatHistoryContentBlock[];
    interruptedByUser?: boolean;
}

/**
 * @interface AiChatHistoryContentBlock
 * @description 协议历史中的单个内容块，用于在重建 vendor 对话上下文时保留 thinking、tool_use 与 tool_result。
 */
export interface AiChatHistoryContentBlock {
    kind: "text" | "thinking" | "tool-use" | "tool-result";
    text?: string;
    signature?: string;
    toolUseId?: string;
    toolName?: string;
    inputJson?: string;
    resultJson?: string;
}

/**
 * @interface AiChatConversationRecord
 * @description 一条持久化的 AI 会话记录。
 */
export interface AiChatConversationRecord {
    id: string;
    sessionId: string;
    title: string;
    createdAtUnixMs: number;
    updatedAtUnixMs: number;
    messages: AiChatHistoryMessage[];
    protocolMessages?: AiChatHistoryMessage[];
}

/**
 * @interface AiChatHistoryState
 * @description 当前仓库的 AI 会话历史。
 */
export interface AiChatHistoryState {
    activeConversationId: string | null;
    conversations: AiChatConversationRecord[];
}

/**
 * @interface AiChatStreamEventPayload
 * @description Rust 后端转发给前端的流式 AI 事件。
 */
export interface AiChatStreamEventPayload {
    streamId: string;
    eventType: AiChatStreamEventType;
    sessionId: string | null;
    agentName: string | null;
    deltaText: string | null;
    accumulatedText: string | null;
    reasoningDeltaText: string | null;
    reasoningAccumulatedText: string | null;
    historyContentBlocksJson: string | null;
    debugTitle: string | null;
    debugLevel: string | null;
    debugText: string | null;
    confirmationId: string | null;
    confirmationHint: string | null;
    confirmationToolName: string | null;
    confirmationToolArgsJson: string | null;
    error: string | null;
    done: boolean;
}

/**
 * @interface SubmitAiChatConfirmationOptions
 * @description 提交一次 AI tool 确认结果所需的参数。
 */
export interface SubmitAiChatConfirmationOptions {
    confirmationId: string;
    confirmed: boolean;
    sessionId?: string;
    userId?: string;
}

/**
 * @interface StartAiChatStreamOptions
 * @description 启动流式聊天请求参数。
 */
export interface StartAiChatStreamOptions {
    message: string;
    sessionId?: string;
    userId?: string;
    history?: AiChatHistoryMessage[];
}

/**
 * @function isTauriRuntime
 * @description 判断当前是否运行在 Tauri runtime 中。
 * @returns 在 Tauri 中返回 true。
 */
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

/**
 * @function getAiSidecarHealth
 * @description 查询当前 Rust 后端维护的 AI sidecar 健康状态。
 * @returns 健康检查响应。
 */
export async function getAiSidecarHealth(): Promise<AiSidecarHealthResponse> {
    if (!isTauriRuntime()) {
        throw new Error("AI sidecar health is only available in Tauri runtime");
    }

    return invoke<AiSidecarHealthResponse>("get_ai_sidecar_health");
}

/**
 * @function getAiVendorCatalog
 * @description 获取后端提供的可用 AI vendor 列表。
 * @returns vendor 描述数组。
 */
export async function getAiVendorCatalog(): Promise<AiVendorDefinition[]> {
    if (!isTauriRuntime()) {
        throw new Error("AI vendor catalog is only available in Tauri runtime");
    }

    return invoke<AiVendorDefinition[]>("get_ai_vendor_catalog");
}

/**
 * @function getAiChatSettings
 * @description 获取当前仓库的 AI 聊天设置。
 * @returns AI 设置。
 */
export async function getAiChatSettings(): Promise<AiChatSettings> {
    if (!isTauriRuntime()) {
        throw new Error("AI settings are only available in Tauri runtime");
    }

    return invoke<AiChatSettings>("get_ai_chat_settings");
}

/**
 * @function getAiChatHistory
 * @description 获取当前仓库的 AI 对话历史。
 * @returns 对话历史状态。
 */
export async function getAiChatHistory(): Promise<AiChatHistoryState> {
    if (!isTauriRuntime()) {
        throw new Error("AI chat history is only available in Tauri runtime");
    }

    return invoke<AiChatHistoryState>("get_ai_chat_history");
}

/**
 * @function getAiVendorModels
 * @description 使用当前 vendor 配置向后端请求可用模型列表。
 * @param settings 当前设置或未保存草稿。
 * @returns 模型列表。
 */
export async function getAiVendorModels(settings: AiChatSettings): Promise<AiVendorModelDefinition[]> {
    if (!isTauriRuntime()) {
        throw new Error("AI vendor models are only available in Tauri runtime");
    }

    return invoke<AiVendorModelDefinition[]>("get_ai_vendor_models", { settings });
}

/**
 * @function saveAiChatSettings
 * @description 保存当前仓库的 AI 聊天设置。
 * @param settings 待保存设置。
 * @returns 保存后的设置。
 */
export async function saveAiChatSettings(settings: AiChatSettings): Promise<AiChatSettings> {
    if (!isTauriRuntime()) {
        throw new Error("AI settings are only available in Tauri runtime");
    }

    return invoke<AiChatSettings>("save_ai_chat_settings", { settings });
}

/**
 * @function saveAiChatHistory
 * @description 保存当前仓库的 AI 对话历史。
 * @param history 待保存历史。
 * @returns 保存后的历史。
 */
export async function saveAiChatHistory(history: AiChatHistoryState): Promise<AiChatHistoryState> {
    if (!isTauriRuntime()) {
        throw new Error("AI chat history is only available in Tauri runtime");
    }

    return invoke<AiChatHistoryState>("save_ai_chat_history", { history });
}

/**
 * @function startAiChatStream
 * @description 启动一次后端 AI 流式聊天。
 * @param options 启动参数。
 * @returns 流 ID。
 */
export async function startAiChatStream(
    options: StartAiChatStreamOptions,
): Promise<AiChatStreamStartResponse> {
    if (!isTauriRuntime()) {
        throw new Error("AI streaming is only available in Tauri runtime");
    }

    console.info("[ai-api] startAiChatStream invoke start", {
        sessionId: options.sessionId ?? null,
        userId: options.userId ?? null,
        messageLength: options.message.length,
    });

    const response = await invoke<AiChatStreamStartResponse>("start_ai_chat_stream", {
        message: options.message,
        sessionId: options.sessionId ?? null,
        userId: options.userId ?? null,
        history: options.history ?? null,
    });

    console.info("[ai-api] startAiChatStream invoke success", {
        streamId: response.streamId,
    });

    return response;
}

/**
 * @function stopAiChatStream
 * @description 终止当前仍在运行的一条 AI 流式对话。
 * @param streamId 待终止的流 ID。
 * @returns 若成功向后端发送停止信号则返回 true。
 */
export async function stopAiChatStream(streamId: string): Promise<boolean> {
    if (!isTauriRuntime()) {
        throw new Error("AI streaming stop is only available in Tauri runtime");
    }

    console.info("[ai-api] stopAiChatStream invoke start", {
        streamId,
    });

    const stopped = await invoke<boolean>("stop_ai_chat_stream", {
        streamId,
    });

    console.info("[ai-api] stopAiChatStream invoke success", {
        streamId,
        stopped,
    });

    return stopped;
}

/**
 * @function submitAiChatConfirmation
 * @description 提交一次工具确认结果，并继续当前 AI 会话。
 * @param options 确认参数。
 * @returns 新一轮流式结果的 streamId。
 */
export async function submitAiChatConfirmation(
    options: SubmitAiChatConfirmationOptions,
): Promise<AiChatStreamStartResponse> {
    if (!isTauriRuntime()) {
        throw new Error("AI confirmation is only available in Tauri runtime");
    }

    console.info("[ai-api] submitAiChatConfirmation invoke start", {
        sessionId: options.sessionId ?? null,
        userId: options.userId ?? null,
        confirmationId: options.confirmationId,
        confirmed: options.confirmed,
    });

    const response = await invoke<AiChatStreamStartResponse>("submit_ai_chat_confirmation", {
        confirmationId: options.confirmationId,
        confirmed: options.confirmed,
        sessionId: options.sessionId ?? null,
        userId: options.userId ?? null,
    });

    console.info("[ai-api] submitAiChatConfirmation invoke success", {
        streamId: response.streamId,
    });

    return response;
}

/**
 * @function subscribeAiChatStreamEvents
 * @description 订阅 Rust 后端转发的 AI 聊天流事件。
 * @param handler 事件处理函数。
 * @returns 取消订阅函数。
 */
export async function subscribeAiChatStreamEvents(
    handler: (payload: AiChatStreamEventPayload) => void,
): Promise<UnlistenFn> {
    if (!isTauriRuntime()) {
        return () => {
            // 浏览器回退模式下无后端 AI 事件。
        };
    }

    return listen<AiChatStreamEventPayload>(AI_CHAT_STREAM_EVENT_NAME, (event) => {
        handler(event.payload);
    });
}