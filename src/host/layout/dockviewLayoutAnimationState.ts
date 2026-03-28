/**
 * @module host/layout/dockviewLayoutAnimationState
 * @description Dockview 主区 FLIP 动画的事务状态工具，负责处理拖拽型捕获的释放时机与过期判定。
 * @dependencies
 *   - 无运行时外部依赖
 *
 * @example
 *   const pending = createPendingDockviewLayoutAnimation({
 *     id: 1,
 *     reason: "split-entering",
 *     source: "drag",
 *     previousRects: [],
 *     capturedAt: Date.now(),
 *   });
 *
 * @exports
 *   - DockviewGroupRectSnapshot
 *   - PendingDockviewLayoutAnimation
 *   - createPendingDockviewLayoutAnimation
 *   - markPendingDockviewLayoutAnimationReleased
 *   - isPendingDockviewLayoutAnimationReady
 *   - hasPendingDockviewLayoutAnimationExpired
 */

/** Dockview FLIP 动画来源：程序化触发或手动拖拽。 */
export type DockviewLayoutAnimationSource = "programmatic" | "drag";

/** Dockview FLIP 动画原因：新建 split 或关闭/收拢 split。 */
export type DockviewLayoutAnimationReason = "split-entering" | "split-settling";

/**
 * @interface DockviewGroupRectSnapshot
 * @description 单个 Dockview group 的几何与 tab 文本快照。
 */
export interface DockviewGroupRectSnapshot {
    left: number;
    top: number;
    width: number;
    height: number;
    tabLabels: string[];
}

/**
 * @interface PendingDockviewLayoutAnimation
 * @description 一次待消费的 Dockview FLIP 动画事务。
 */
export interface PendingDockviewLayoutAnimation {
    id: number;
    reason: DockviewLayoutAnimationReason;
    source: DockviewLayoutAnimationSource;
    previousRects: DockviewGroupRectSnapshot[];
    capturedAt: number;
    releasedAt: number | null;
}

/**
 * @function createPendingDockviewLayoutAnimation
 * @description 创建一次新的 Dockview FLIP 动画事务。
 * @param input 事务输入参数。
 * @returns 初始化后的待消费动画事务。
 */
export function createPendingDockviewLayoutAnimation(input: {
    id: number;
    reason: DockviewLayoutAnimationReason;
    source: DockviewLayoutAnimationSource;
    previousRects: DockviewGroupRectSnapshot[];
    capturedAt: number;
}): PendingDockviewLayoutAnimation {
    return {
        id: input.id,
        reason: input.reason,
        source: input.source,
        previousRects: input.previousRects,
        capturedAt: input.capturedAt,
        releasedAt: input.source === "programmatic" ? input.capturedAt : null,
    };
}

/**
 * @function markPendingDockviewLayoutAnimationReleased
 * @description 将拖拽型动画事务标记为已释放，仅当事务 ID 匹配时生效。
 * @param pending 当前待消费事务。
 * @param pendingId 期望释放的事务 ID。
 * @param releasedAt 释放时间。
 * @returns 更新后的事务；若事务不存在或 ID 不匹配则原样返回。
 */
export function markPendingDockviewLayoutAnimationReleased(
    pending: PendingDockviewLayoutAnimation | null,
    pendingId: number,
    releasedAt: number,
): PendingDockviewLayoutAnimation | null {
    if (!pending || pending.id !== pendingId) {
        return pending;
    }

    if (pending.source !== "drag" || pending.releasedAt !== null) {
        return pending;
    }

    return {
        ...pending,
        releasedAt,
    };
}

/**
 * @function isPendingDockviewLayoutAnimationReady
 * @description 判断待消费动画事务当前是否允许进入播放阶段。
 * @param pending 当前待消费事务。
 * @returns 若可播放则返回 true。
 */
export function isPendingDockviewLayoutAnimationReady(
    pending: PendingDockviewLayoutAnimation,
): boolean {
    return pending.source === "programmatic" || pending.releasedAt !== null;
}

/**
 * @function hasPendingDockviewLayoutAnimationExpired
 * @description 判断待消费动画事务是否已经过期。
 * @param pending 当前待消费事务。
 * @param now 当前时间。
 * @param maxAgeMs 允许的最大存活时间。
 * @returns 若事务已过期则返回 true。
 */
export function hasPendingDockviewLayoutAnimationExpired(
    pending: PendingDockviewLayoutAnimation,
    now: number,
    maxAgeMs: number,
): boolean {
    if (pending.source === "drag" && pending.releasedAt === null) {
        return false;
    }

    const ageStart = pending.releasedAt ?? pending.capturedAt;
    return now - ageStart > maxAgeMs;
}