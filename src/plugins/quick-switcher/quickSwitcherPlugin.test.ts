/**
 * @module plugins/quick-switcher/quickSwitcherPlugin.test
 * @description Quick Switcher 命令注册测试，覆盖新标签打开命令的默认快捷键。
 */

import { afterEach, describe, expect, it } from "bun:test";
import { getCommandDefinition } from "../../host/commands/commandSystem";
import { activatePlugin } from "./quickSwitcherPlugin";

let cleanup: (() => void) | null = null;

afterEach(() => {
    cleanup?.();
    cleanup = null;
});

describe("quickSwitcherPlugin", () => {
    it("should register open note in new tab command with Cmd+Shift+N", () => {
        cleanup = activatePlugin();

        const command = getCommandDefinition("note.openInNewTab");

        expect(command?.title).toBe("commands.openNoteInNewTab");
        expect(command?.shortcut?.defaultBinding).toBe("Cmd+Shift+N");
        expect(command?.shortcut?.editableInSettings).toBe(true);
    });
});
