/**
 * @module host/notifications/notificationCenter
 * @description 宿主级消息中心：为各业务模块提供受控的全局消息发布接口，
 *   由消息插件统一消费并渲染。该模块只暴露稳定的数据契约与事件分发能力，
 *   避免业务模块直接依赖具体插件实现。
 *
 * @dependencies
 *   - browser EventTarget
 *
 * @example
 *   const notificationId = publishNotification({
 *     level: "warn",
 *     message: "索引构建存在部分失败项",
 *     source: "module",
 *   });
 *
 *   publishProgressNotification({
 *     notificationId,
 *     message: "索引构建中",
 *     progress: 64,
 *   });
 *
 *   dismissNotification(notificationId);
 *
 * @exports
 *   - NotificationLevel
 *   - NotificationSource
 *   - NotificationRecord
 *   - NotificationCenterEvent
 *   - NotificationPublishOptions
 *   - NotificationProgressOptions
 *   - publishNotification
 *   - publishProgressNotification
 *   - dismissNotification
 *   - subscribeNotificationCenter
 */

import { getConfigSnapshot } from "../config/configStore";

/**
 * @type NotificationLevel
 * @description 宿主消息级别。
 */
export type NotificationLevel = "info" | "warn" | "error";

/**
 * @type NotificationSource
 * @description 宿主消息来源。
 */
export type NotificationSource = "module" | "backend-log" | "frontend-log";

/**
 * @interface NotificationRecord
 * @description 归一化后的消息记录。
 */
export interface NotificationRecord {
    /** 消息唯一 ID；复用同一 ID 可更新已有消息。 */
    notificationId: string;
    /** 消息级别。 */
    level: NotificationLevel;
    /** 可选标题。 */
    title: string | null;
    /** 主消息正文。 */
    message: string;
    /** 消息来源。 */
    source: NotificationSource;
    /** 进度值，范围 0-100；为空表示无进度条。 */
    progress: number | null;
    /** 自动关闭毫秒数；为空表示默认由渲染端决定。 */
    autoCloseMs: number | null;
    /** 初次创建时间。 */
    createdAt: number;
    /** 最近一次更新时间。 */
    updatedAt: number;
}

/**
 * @type NotificationCenterEvent
 * @description 消息中心发布的事件类型。
 */
export type NotificationCenterEvent =
    | {
        type: "upsert";
        notification: NotificationRecord;
    }
    | {
        type: "dismiss";
        notificationId: string;
    };

/**
 * @interface NotificationPublishOptions
 * @description 发布或更新消息时允许传入的参数。
 */
export interface NotificationPublishOptions {
    /** 可选消息 ID；缺省时自动生成。 */
    notificationId?: string;
    /** 消息级别。 */
    level: NotificationLevel;
    /** 可选标题。 */
    title?: string | null;
    /** 主消息正文。 */
    message: string;
    /** 消息来源；缺省为模块消息。 */
    source?: NotificationSource;
    /** 可选进度值。 */
    progress?: number | null;
    /** 可选自动关闭毫秒数。 */
    autoCloseMs?: number | null;
    /** 可选创建时间。 */
    createdAt?: number;
    /** 可选更新时间。 */
    updatedAt?: number;
}

/**
 * @interface NotificationProgressOptions
 * @description 发布带进度条消息时的快捷参数。
 */
export interface NotificationProgressOptions {
    /** 可选消息 ID；复用后可更新同一进度消息。 */
    notificationId?: string;
    /** 主消息正文。 */
    message: string;
    /** 当前进度，范围 0-100。 */
    progress: number;
    /** 可选标题。 */
    title?: string | null;
    /** 可选级别；缺省为 info。 */
    level?: NotificationLevel;
    /** 消息来源；缺省为模块消息。 */
    source?: NotificationSource;
    /** 可选自动关闭毫秒数。 */
    autoCloseMs?: number | null;
}

const notificationEventTarget = new EventTarget();
let notificationSequence = 1;

/**
 * @function nextNotificationId
 * @description 生成宿主消息唯一 ID。
 * @returns 消息 ID。
 */
function nextNotificationId(): string {
    const notificationId = `notification-${notificationSequence}`;
    notificationSequence += 1;
    return notificationId;
}

/**
 * @function normalizeProgress
 * @description 归一化进度值。
 * @param progress 原始进度。
 * @returns 合法进度；非法值返回 null。
 */
function normalizeProgress(progress: number | null | undefined): number | null {
    if (typeof progress !== "number" || !Number.isFinite(progress)) {
        return null;
    }

    return Math.max(0, Math.min(100, Math.round(progress)));
}

/**
 * @function normalizeAutoCloseMs
 * @description 归一化自动关闭时间。
 * @param autoCloseMs 原始自动关闭时间。
 * @returns 合法毫秒值；非法值返回 null。
 */
function normalizeAutoCloseMs(autoCloseMs: number | null | undefined): number | null {
    if (typeof autoCloseMs !== "number" || !Number.isFinite(autoCloseMs)) {
        return null;
    }

    if (autoCloseMs <= 0) {
        return null;
    }

    return Math.max(250, Math.round(autoCloseMs));
}

/**
 * @function dispatchNotificationCenterEvent
 * @description 向消息中心广播事件。
 * @param event 消息中心事件。
 */
function dispatchNotificationCenterEvent(event: NotificationCenterEvent): void {
    notificationEventTarget.dispatchEvent(
        new CustomEvent<NotificationCenterEvent>("notification-center", {
            detail: event,
        }),
    );
}

function areFrontendNotificationsEnabled(): boolean {
    return getConfigSnapshot().featureSettings.notificationsEnabled;
}

/**
 * @function publishNotification
 * @description 发布一条消息；若复用已有 notificationId，则由消费方按更新语义处理。
 * @param options 发布参数。
 * @returns 最终使用的消息 ID。
 */
export function publishNotification(options: NotificationPublishOptions): string {
    const updatedAt = options.updatedAt ?? Date.now();
    const createdAt = options.createdAt ?? updatedAt;
    const notificationId = options.notificationId ?? nextNotificationId();
    const notification: NotificationRecord = {
        notificationId,
        level: options.level,
        title: options.title ?? null,
        message: options.message,
        source: options.source ?? "module",
        progress: normalizeProgress(options.progress),
        autoCloseMs: normalizeAutoCloseMs(options.autoCloseMs),
        createdAt,
        updatedAt,
    };

    if (!areFrontendNotificationsEnabled()) {
        return notificationId;
    }

    dispatchNotificationCenterEvent({
        type: "upsert",
        notification,
    });
    return notificationId;
}

/**
 * @function publishProgressNotification
 * @description 发布一条带进度条的消息。
 * @param options 进度消息参数。
 * @returns 最终使用的消息 ID。
 */
export function publishProgressNotification(options: NotificationProgressOptions): string {
    return publishNotification({
        notificationId: options.notificationId,
        level: options.level ?? "info",
        title: options.title ?? null,
        message: options.message,
        source: options.source ?? "module",
        progress: options.progress,
        autoCloseMs: options.autoCloseMs,
    });
}

/**
 * @function dismissNotification
 * @description 请求关闭指定消息。
 * @param notificationId 目标消息 ID。
 */
export function dismissNotification(notificationId: string): void {
    dispatchNotificationCenterEvent({
        type: "dismiss",
        notificationId,
    });
}

/**
 * @function subscribeNotificationCenter
 * @description 订阅宿主消息中心事件。
 * @param listener 监听器。
 * @returns 取消订阅函数。
 */
export function subscribeNotificationCenter(
    listener: (event: NotificationCenterEvent) => void,
): () => void {
    const handler = (event: Event): void => {
        const customEvent = event as CustomEvent<NotificationCenterEvent>;
        listener(customEvent.detail);
    };

    notificationEventTarget.addEventListener("notification-center", handler);
    return () => {
        notificationEventTarget.removeEventListener("notification-center", handler);
    };
}