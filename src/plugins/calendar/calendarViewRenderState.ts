/**
 * @module plugins/calendar/calendarViewRenderState
 * @description 日历视图渲染状态工具：根据加载状态、仓库状态与命中数量，决定提示信息与月历主体是否显示。
 * @dependencies
 *  - 无
 *
 * @example
 *   const renderState = deriveCalendarViewRenderState({
 *       loading: false,
 *       error: null,
 *       currentVaultPath: "E:/vault",
 *       matchCount: 0,
 *   });
 *
 * @exports
 *  - CalendarViewRenderStateInput
 *  - CalendarViewRenderState
 *  - deriveCalendarViewRenderState
 */

/**
 * @interface CalendarViewRenderStateInput
 * @description 日历视图渲染状态计算输入。
 */
export interface CalendarViewRenderStateInput {
    /** 是否仍在加载数据。 */
    loading: boolean;
    /** 错误信息；无错误时为 null。 */
    error: string | null;
    /** 当前仓库路径；未打开仓库时为 null。 */
    currentVaultPath: string | null;
    /** 当前命中的日期笔记数量。 */
    matchCount: number;
}

/**
 * @interface CalendarViewRenderState
 * @description 日历视图各区域的显示决策结果。
 */
export interface CalendarViewRenderState {
    /** 是否显示加载提示。 */
    showLoadingStatus: boolean;
    /** 是否显示错误提示。 */
    showErrorStatus: boolean;
    /** 是否显示未打开仓库提示。 */
    showNoVaultStatus: boolean;
    /** 是否显示未命中日期笔记提示。 */
    showNoDateNotesStatus: boolean;
    /** 是否显示月历主体。 */
    showCalendarBody: boolean;
}

/**
 * @function deriveCalendarViewRenderState
 * @description 计算日历视图在当前状态下应显示的提示和主体。
 * @param input 渲染状态计算输入。
 * @returns 供组件直接消费的渲染决策结果。
 */
export function deriveCalendarViewRenderState(
    input: CalendarViewRenderStateInput,
): CalendarViewRenderState {
    const hasVault = Boolean(input.currentVaultPath);
    const hasError = Boolean(input.error);
    const ready = !input.loading && !hasError && hasVault;

    return {
        showLoadingStatus: input.loading,
        showErrorStatus: !input.loading && hasError,
        showNoVaultStatus: !input.loading && !hasError && !hasVault,
        showNoDateNotesStatus: ready && input.matchCount === 0,
        showCalendarBody: ready,
    };
}