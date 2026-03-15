/**
 * @module plugins/command-palette
 * @description Command Palette 插件公共导出。
 * @dependencies
 *   - ./commandPaletteEvents
 *   - ./overlay/CommandPaletteOverlay
 */

export {
    COMMAND_PALETTE_OPEN_REQUESTED_EVENT,
    notifyCommandPaletteOpenRequested,
} from "./commandPaletteEvents";
export { CommandPaletteOverlay } from "./overlay/CommandPaletteOverlay";