/**
 * @module host/commands/shortcutEvents
 * @description 快捷键事件桥接：用于跨子系统传递“关闭标签页快捷键已触发”的信号。
 */

/**
 * @constant TAB_CLOSE_SHORTCUT_TRIGGERED_EVENT
 * @description 关闭标签页快捷键触发事件名称。
 */
export const TAB_CLOSE_SHORTCUT_TRIGGERED_EVENT = "ofive:tab-close-shortcut-triggered";

/**
 * @function notifyTabCloseShortcutTriggered
 * @description 发送“关闭标签页快捷键已触发”事件。
 */
export function notifyTabCloseShortcutTriggered(): void {
    window.dispatchEvent(new CustomEvent(TAB_CLOSE_SHORTCUT_TRIGGERED_EVENT));
}

