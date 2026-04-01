/**
 * @module plugins/log-notification/logNotificationState
 * @description 消息提示插件的纯状态演算模块：负责合并消息、处理倒计时与 hover 状态，
 *   不直接依赖 React 或具体渲染实现。
 * @dependencies
 *   - ../../host/notifications/notificationCenter
 *
 * @example
 *   const next = applyNotificationCenterEvent([], {
 *     type: "upsert",
 *     notification: record,
 *   });
 *
 * @exports
 *   - NotificationViewModel
 *   - resolveNotificationAutoCloseMs
 *   - applyNotificationCenterEvent
 *   - tickNotificationState
 *   - setNotificationHovered
 */

import type {
    NotificationCenterEvent,
    NotificationRecord,
} from "../../host/notifications/notificationCenter";

/**
 * @interface NotificationViewModel
 * @description 插件渲染层使用的消息视图模型。
 */
export interface NotificationViewModel extends NotificationRecord {
    /** 实际生效的自动关闭时间。 */
    resolvedAutoCloseMs: number | null;
    /** 剩余倒计时毫秒数。 */
    remainingMs: number | null;
    /** 当前是否处于 hover。 */
    isHovered: boolean;
}

/**
 * @function sortNotifications
 * @description 按最近更新时间倒序排列消息。
 * @param items 原始消息列表。
 * @returns 已排序消息列表。
 */
function sortNotifications(items: NotificationViewModel[]): NotificationViewModel[] {
    return [...items].sort((left, right) => right.updatedAt - left.updatedAt);
}

/**
 * @function resolveNotificationAutoCloseMs
 * @description 计算消息实际使用的自动关闭时间。
 * @param notification 消息记录。
 * @returns 自动关闭时间；为空表示不自动关闭。
 */
export function resolveNotificationAutoCloseMs(
    notification: NotificationRecord,
): number | null {
    if (notification.autoCloseMs !== null) {
        return notification.autoCloseMs;
    }

    if (notification.progress !== null && notification.progress < 100) {
        return null;
    }

    if (notification.level === "error") {
        return 9000;
    }

    if (notification.level === "warn") {
        return 6000;
    }

    return 4000;
}

/**
 * @function upsertNotification
 * @description 合并一条消息到当前状态中。
 * @param state 当前状态。
 * @param notification 新消息记录。
 * @returns 更新后的状态。
 */
function upsertNotification(
    state: NotificationViewModel[],
    notification: NotificationRecord,
): NotificationViewModel[] {
    const resolvedAutoCloseMs = resolveNotificationAutoCloseMs(notification);
    const previous = state.find((item) => item.notificationId === notification.notificationId) ?? null;
    const nextItem: NotificationViewModel = {
        ...previous,
        ...notification,
        resolvedAutoCloseMs,
        remainingMs: resolvedAutoCloseMs,
        isHovered: previous?.isHovered ?? false,
    };

    return sortNotifications([
        nextItem,
        ...state.filter((item) => item.notificationId !== notification.notificationId),
    ]);
}

/**
 * @function dismissNotificationById
 * @description 从当前状态中移除指定消息。
 * @param state 当前状态。
 * @param notificationId 消息 ID。
 * @returns 更新后的状态。
 */
function dismissNotificationById(
    state: NotificationViewModel[],
    notificationId: string,
): NotificationViewModel[] {
    return state.filter((item) => item.notificationId !== notificationId);
}

/**
 * @function applyNotificationCenterEvent
 * @description 将消息中心事件应用到当前插件状态。
 * @param state 当前状态。
 * @param event 消息中心事件。
 * @returns 更新后的状态。
 */
export function applyNotificationCenterEvent(
    state: NotificationViewModel[],
    event: NotificationCenterEvent,
): NotificationViewModel[] {
    if (event.type === "dismiss") {
        return dismissNotificationById(state, event.notificationId);
    }

    return upsertNotification(state, event.notification);
}

/**
 * @function tickNotificationState
 * @description 推进一帧倒计时状态；超时消息将被移除。
 * @param state 当前状态。
 * @param elapsedMs 经过的毫秒数。
 * @returns 更新后的状态。
 */
export function tickNotificationState(
    state: NotificationViewModel[],
    elapsedMs: number,
): NotificationViewModel[] {
    return state
        .map((item) => {
            if (
                item.isHovered ||
                item.remainingMs === null ||
                !Number.isFinite(elapsedMs) ||
                elapsedMs <= 0
            ) {
                return item;
            }

            return {
                ...item,
                remainingMs: Math.max(0, item.remainingMs - elapsedMs),
            };
        })
        .filter((item) => item.remainingMs === null || item.remainingMs > 0);
}

/**
 * @function setNotificationHovered
 * @description 更新一条消息的 hover 状态。
 *   离开 hover 时，倒计时从完整时长重新开始。
 * @param state 当前状态。
 * @param notificationId 消息 ID。
 * @param isHovered 是否 hover。
 * @returns 更新后的状态。
 */
export function setNotificationHovered(
    state: NotificationViewModel[],
    notificationId: string,
    isHovered: boolean,
): NotificationViewModel[] {
    return state.map((item) => {
        if (item.notificationId !== notificationId) {
            return item;
        }

        if (isHovered) {
            return {
                ...item,
                isHovered: true,
            };
        }

        return {
            ...item,
            isHovered: false,
            remainingMs: item.resolvedAutoCloseMs,
        };
    });
}