/**
 * @module plugins/calendar/calendarViewState.test
 * @description 日历共享状态单元测试：验证同一状态键下的月份与选中日期可被复用。
 * @dependencies
 *  - bun:test
 *  - ./calendarViewState
 */

import { describe, expect, it } from "bun:test";
import { getCalendarViewState, setCalendarViewState } from "./calendarViewState";

describe("calendarViewState", () => {
    it("应按 stateKey 读取与更新共享状态", () => {
        setCalendarViewState("calendar-shared", {
            anchorDayKey: "2026-03-01",
            selectedDayKey: "2026-03-15",
        });

        expect(getCalendarViewState("calendar-shared")).toEqual({
            anchorDayKey: "2026-03-01",
            selectedDayKey: "2026-03-15",
        });
    });
});
