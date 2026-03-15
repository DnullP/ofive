/**
 * @module plugins/calendar/calendarViewState
 * @description 日历视图共享状态缓存：让同一个 `stateKey` 下的 Tab/Panel
 *   视图可选择性复用当前月份与选中日期。
 *
 * @dependencies
 *  - 无
 *
 * @example
 *   const snapshot = getCalendarViewState("calendar");
 *   setCalendarViewState("calendar", { anchorDayKey: "2026-03-01", selectedDayKey: "2026-03-15" });
 *
 * @exports
 *  - CalendarViewStateSnapshot
 *  - getCalendarViewState
 *  - setCalendarViewState
 */

/**
 * @interface CalendarViewStateSnapshot
 * @description 日历视图缓存的最小共享状态。
 */
export interface CalendarViewStateSnapshot {
    /** 当前月锚点日期。 */
    anchorDayKey: string;
    /** 当前选中的日期。 */
    selectedDayKey: string;
}

const stateByKey = new Map<string, CalendarViewStateSnapshot>();

/**
 * @function getCalendarViewState
 * @description 读取指定状态键的日历共享状态。
 * @param stateKey 状态键。
 * @returns 共享状态；不存在时返回 null。
 */
export function getCalendarViewState(stateKey: string): CalendarViewStateSnapshot | null {
    return stateByKey.get(stateKey) ?? null;
}

/**
 * @function setCalendarViewState
 * @description 写入指定状态键的日历共享状态。
 * @param stateKey 状态键。
 * @param snapshot 状态快照。
 */
export function setCalendarViewState(stateKey: string, snapshot: CalendarViewStateSnapshot): void {
    stateByKey.set(stateKey, snapshot);
}
