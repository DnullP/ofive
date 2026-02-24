/**
 * @module commands/shortcutEvents
 * @description 快捷键事件桥接：用于跨子系统传递“关闭标签页快捷键已触发”的信号。
 */

/**
 * @constant TAB_CLOSE_SHORTCUT_TRIGGERED_EVENT
 * @description 关闭标签页快捷键触发事件名称。
 */
export const TAB_CLOSE_SHORTCUT_TRIGGERED_EVENT = "ofive:tab-close-shortcut-triggered";

/**
 * @constant QUICK_SWITCHER_OPEN_REQUESTED_EVENT
 * @description 快速切换浮窗打开请求事件名称。
 */
export const QUICK_SWITCHER_OPEN_REQUESTED_EVENT = "ofive:quick-switcher-open-requested";

/**
 * @constant COMMAND_PALETTE_OPEN_REQUESTED_EVENT
 * @description 指令搜索浮窗打开请求事件名称。
 */
export const COMMAND_PALETTE_OPEN_REQUESTED_EVENT = "ofive:command-palette-open-requested";

/**
 * @function notifyTabCloseShortcutTriggered
 * @description 发送“关闭标签页快捷键已触发”事件。
 */
export function notifyTabCloseShortcutTriggered(): void {
    window.dispatchEvent(new CustomEvent(TAB_CLOSE_SHORTCUT_TRIGGERED_EVENT));
}

/**
 * @function notifyQuickSwitcherOpenRequested
 * @description 发送“打开快速切换浮窗”请求事件。
 */
export function notifyQuickSwitcherOpenRequested(): void {
    window.dispatchEvent(new CustomEvent(QUICK_SWITCHER_OPEN_REQUESTED_EVENT));
}

/**
 * @function notifyCommandPaletteOpenRequested
 * @description 发送“打开指令搜索浮窗”请求事件。
 */
export function notifyCommandPaletteOpenRequested(): void {
    window.dispatchEvent(new CustomEvent(COMMAND_PALETTE_OPEN_REQUESTED_EVENT));
}
