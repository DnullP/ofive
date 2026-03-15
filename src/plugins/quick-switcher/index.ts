/**
 * @module plugins/quick-switcher
 * @description Quick Switcher 插件公共导出。
 * @dependencies
 *   - ./quickSwitcherEvents
 *   - ./overlay/QuickSwitcherOverlay
 */

export {
    QUICK_SWITCHER_OPEN_REQUESTED_EVENT,
    notifyQuickSwitcherOpenRequested,
} from "./quickSwitcherEvents";
export { QuickSwitcherOverlay } from "./overlay/QuickSwitcherOverlay";