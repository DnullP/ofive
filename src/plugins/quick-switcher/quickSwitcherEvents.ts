/**
 * @module plugins/quick-switcher/quickSwitcherEvents
 * @description Quick Switcher 请求事件：用于跨模块打开快速切换浮层。
 * @dependencies
 *   - browser CustomEvent
 *
 * @exports
 *   - QUICK_SWITCHER_OPEN_REQUESTED_EVENT
 *   - notifyQuickSwitcherOpenRequested
 */

import type { FileOpenMode } from "../../host/config/configStore";

/**
 * @constant QUICK_SWITCHER_OPEN_REQUESTED_EVENT
 * @description 快速切换浮层打开请求事件名称。
 */
export const QUICK_SWITCHER_OPEN_REQUESTED_EVENT = "ofive:quick-switcher-open-requested";

export interface QuickSwitcherOpenRequestDetail {
    openMode?: FileOpenMode;
}

/**
 * @function notifyQuickSwitcherOpenRequested
 * @description 发送“打开快速切换浮层”请求事件。
 */
export function notifyQuickSwitcherOpenRequested(detail: QuickSwitcherOpenRequestDetail = {}): void {
    window.dispatchEvent(new CustomEvent<QuickSwitcherOpenRequestDetail>(
        QUICK_SWITCHER_OPEN_REQUESTED_EVENT,
        { detail },
    ));
}
