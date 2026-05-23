/**
 * @module host/commands/commandSystem.reload.test
 * @description commandSystem 中 app.reload 命令的回归测试。
 * @dependencies
 *  - bun:test
 *  - ./commandSystem
 *
 * @example
 *   bun test src/host/commands/commandSystem.reload.test.ts
 */

import { describe, expect, it } from "bun:test";
import { executeCommand, getCommandDefinition } from "./commandSystem";

describe("commandSystem app.reload", () => {
    /**
     * @function should_route_reload_command_to_lifecycle_capability
     * @description app.reload 应通过命令上下文调用统一 reload 生命周期能力。
     */
    it("should route reload command to lifecycle capability", () => {
        let reloadRequested = false;

        executeCommand("app.reload", {
            activeTabId: null,
            closeTab: () => undefined,
            openFileTab: () => undefined,
            getExistingMarkdownPaths: () => [],
            reloadApplication: () => {
                reloadRequested = true;
            },
        });

        expect(reloadRequested).toBe(true);
    });

    it("should expose reload as an editable command", () => {
        const command = getCommandDefinition("app.reload");

        expect(command?.title).toBe("commands.reloadApp");
        expect(command?.shortcut?.defaultBinding).toBe("Cmd+R");
        expect(command?.shortcut?.editableInSettings).toBe(true);
    });
});
