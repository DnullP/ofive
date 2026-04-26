/**
 * @module plugins/calendar/calendarViewRenderState.test
 * @description 日历视图渲染状态测试：验证空命中、错误和未打开仓库时的主体与提示显示规则。
 * @dependencies
 *  - bun:test
 *  - ./calendarViewRenderState
 */

import { describe, expect, it } from "bun:test";
import { deriveCalendarViewRenderState } from "./calendarViewRenderState";

describe("calendarViewRenderState", () => {
    it("无日期笔记时仍应显示月历主体", () => {
        const renderState = deriveCalendarViewRenderState({
            loading: false,
            error: null,
            currentVaultPath: "E:/vault",
            matchCount: 0,
            hasLoadedSnapshot: true,
        });

        expect(renderState.showCalendarBody).toBe(true);
        expect(renderState.showNoDateNotesStatus).toBe(true);
    });

    it("加载中时仅显示加载提示", () => {
        const renderState = deriveCalendarViewRenderState({
            loading: true,
            error: null,
            currentVaultPath: "E:/vault",
            matchCount: 3,
            hasLoadedSnapshot: false,
        });

        expect(renderState.showLoadingStatus).toBe(true);
        expect(renderState.showCalendarBody).toBe(false);
        expect(renderState.showErrorStatus).toBe(false);
    });

    it("发生错误时不应显示月历主体", () => {
        const renderState = deriveCalendarViewRenderState({
            loading: false,
            error: "boom",
            currentVaultPath: "E:/vault",
            matchCount: 3,
            hasLoadedSnapshot: false,
        });

        expect(renderState.showErrorStatus).toBe(true);
        expect(renderState.showCalendarBody).toBe(false);
    });

    it("未打开仓库时不应显示月历主体", () => {
        const renderState = deriveCalendarViewRenderState({
            loading: false,
            error: null,
            currentVaultPath: null,
            matchCount: 0,
            hasLoadedSnapshot: false,
        });

        expect(renderState.showNoVaultStatus).toBe(true);
        expect(renderState.showCalendarBody).toBe(false);
    });

    it("当前 vault 尚无快照时不应显示旧月历主体", () => {
        const renderState = deriveCalendarViewRenderState({
            loading: false,
            error: null,
            currentVaultPath: "E:/vault-b",
            matchCount: 3,
            hasLoadedSnapshot: false,
        });

        expect(renderState.showCalendarBody).toBe(false);
        expect(renderState.showLoadingStatus).toBe(false);
        expect(renderState.showNoDateNotesStatus).toBe(false);
    });

    it("后台刷新时已有快照应继续显示月历主体", () => {
        const renderState = deriveCalendarViewRenderState({
            loading: true,
            error: null,
            currentVaultPath: "E:/vault",
            matchCount: 3,
            hasLoadedSnapshot: true,
        });

        expect(renderState.showLoadingStatus).toBe(false);
        expect(renderState.showCalendarBody).toBe(true);
        expect(renderState.showNoDateNotesStatus).toBe(false);
    });
});
