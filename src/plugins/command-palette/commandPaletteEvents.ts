/**
 * @module plugins/command-palette/commandPaletteEvents
 * @description Command Palette 请求事件：用于跨模块打开指令搜索浮层。
 * @dependencies
 *   - browser CustomEvent
 *
 * @exports
 *   - COMMAND_PALETTE_OPEN_REQUESTED_EVENT
 *   - notifyCommandPaletteOpenRequested
 */

/**
 * @constant COMMAND_PALETTE_OPEN_REQUESTED_EVENT
 * @description 指令搜索浮层打开请求事件名称。
 */
export const COMMAND_PALETTE_OPEN_REQUESTED_EVENT = "ofive:command-palette-open-requested";

/**
 * @function notifyCommandPaletteOpenRequested
 * @description 发送“打开指令搜索浮层”请求事件。
 */
export function notifyCommandPaletteOpenRequested(): void {
    window.dispatchEvent(new CustomEvent(COMMAND_PALETTE_OPEN_REQUESTED_EVENT));
}