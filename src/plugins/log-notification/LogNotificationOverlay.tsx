/**
 * @module plugins/log-notification/LogNotificationOverlay
 * @description 右上角消息提示浮层：消费宿主消息中心并展示可倒计时、可悬停暂停的消息卡片。
 *   当消息携带 progress 时，会渲染额外进度条。
 * @dependencies
 *   - react
 *   - lucide-react
 *   - ../../host/notifications/notificationCenter
 *   - ./logNotificationState
 *   - ./logNotificationPlugin.css
 *
 * @example
 *   由 logNotificationPlugin 通过 overlayRegistry 统一挂载。
 *
 * @exports
 *   - LogNotificationOverlay
 */

import { CircleAlert, Info, TriangleAlert, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import {
    dismissNotification,
    subscribeNotificationCenter,
    type NotificationLevel,
} from "../../host/notifications/notificationCenter";
import {
    applyNotificationCenterEvent,
    setNotificationHovered,
    tickNotificationState,
    type NotificationViewModel,
} from "./logNotificationState";
import "./logNotificationPlugin.css";

const NOTIFICATION_TICK_MS = 100;

/**
 * @function formatCountdownSeconds
 * @description 将剩余毫秒格式化为秒数字符串。
 * @param remainingMs 剩余毫秒数。
 * @returns 秒数字符串。
 */
function formatCountdownSeconds(remainingMs: number | null): string | null {
    if (remainingMs === null) {
        return null;
    }

    return `${(remainingMs / 1000).toFixed(1)}s`;
}

/**
 * @function resolveNotificationIcon
 * @description 根据消息级别选择图标。
 * @param level 消息级别。
 * @returns 图标节点。
 */
function resolveNotificationIcon(level: NotificationLevel): ReactNode {
    if (level === "error") {
        return <CircleAlert size={18} strokeWidth={2.2} />;
    }

    if (level === "warn") {
        return <TriangleAlert size={18} strokeWidth={2.2} />;
    }

    return <Info size={18} strokeWidth={2.2} />;
}

/**
 * @function resolveTimerPercent
 * @description 计算倒计时剩余比例。
 * @param item 消息视图模型。
 * @returns 0-100 的剩余百分比。
 */
function resolveTimerPercent(item: NotificationViewModel): number {
    if (item.remainingMs === null || item.resolvedAutoCloseMs === null) {
        return 100;
    }

    return Math.max(0, Math.min(100, (item.remainingMs / item.resolvedAutoCloseMs) * 100));
}

/**
 * @function LogNotificationOverlay
 * @description 渲染右上角消息提示浮层。
 * @returns 浮层节点；无消息时返回 null。
 */
export function LogNotificationOverlay(): ReactNode {
    const { t } = useTranslation();
    const [items, setItems] = useState<NotificationViewModel[]>([]);

    useEffect(() => {
        return subscribeNotificationCenter((event) => {
            setItems((previous) => applyNotificationCenterEvent(previous, event));
        });
    }, []);

    useEffect(() => {
        const timer = window.setInterval(() => {
            setItems((previous) => tickNotificationState(previous, NOTIFICATION_TICK_MS));
        }, NOTIFICATION_TICK_MS);

        return () => {
            window.clearInterval(timer);
        };
    }, []);

    if (items.length === 0) {
        return null;
    }

    return (
        <div className="log-notification-stack" aria-live="polite" aria-atomic="false">
            {items.map((item) => {
                const countdownLabel = formatCountdownSeconds(item.remainingMs);
                const timerPercent = resolveTimerPercent(item);
                return (
                    <section
                        key={item.notificationId}
                        className={`log-notification-card log-notification-card--${item.level}`}
                        role="status"
                        onMouseEnter={() => {
                            setItems((previous) => setNotificationHovered(previous, item.notificationId, true));
                        }}
                        onMouseLeave={() => {
                            setItems((previous) => setNotificationHovered(previous, item.notificationId, false));
                        }}
                    >
                        <div className="log-notification-card__row">
                            <div className="log-notification-card__icon" aria-hidden="true">
                                {resolveNotificationIcon(item.level)}
                            </div>
                            <div className="log-notification-card__body">
                                <div className="log-notification-card__meta">
                                    <span className="log-notification-card__source">{item.source}</span>
                                    {countdownLabel ? (
                                        <span className="log-notification-card__countdown">{countdownLabel}</span>
                                    ) : null}
                                </div>
                                {item.title ? (
                                    <h4 className="log-notification-card__title">{item.title}</h4>
                                ) : null}
                                <p className="log-notification-card__message">{item.message}</p>
                                {item.progress !== null ? (
                                    <div
                                        className="log-notification-card__progress"
                                        aria-label={t("logNotification.progressAriaLabel")}
                                    >
                                        <div
                                            className="log-notification-card__progress-bar"
                                            style={{ width: `${item.progress}%` }}
                                        />
                                        <span className="log-notification-card__progress-label">
                                            {item.progress}%
                                        </span>
                                    </div>
                                ) : null}
                            </div>
                            <button
                                type="button"
                                className="log-notification-card__dismiss"
                                aria-label={t("logNotification.dismissAriaLabel")}
                                onClick={() => {
                                    dismissNotification(item.notificationId);
                                }}
                            >
                                <X size={16} strokeWidth={2.2} />
                            </button>
                        </div>
                        {item.resolvedAutoCloseMs !== null ? (
                            <div className="log-notification-card__timer-track" aria-hidden="true">
                                <div
                                    className="log-notification-card__timer-bar"
                                    style={{ width: `${timerPercent}%` }}
                                />
                            </div>
                        ) : null}
                    </section>
                );
            })}
        </div>
    );
}