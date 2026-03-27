/**
 * @module plugins/tasks/taskBoardPlugin.test
 * @description 任务看板插件测试：覆盖 activity、tab 和命令注册清理流程。
 * @dependencies
 *  - bun:test
 *  - ./taskBoardPluginRuntime
 *  - ../../host/registry/activityRegistry
 *  - ../../host/registry/tabComponentRegistry
 */

import { afterEach, describe, expect, it } from "bun:test";
import type { CommandDefinition } from "../../host/commands/commandSystem";
import { getActivitiesSnapshot, unregisterActivity } from "../../host/registry/activityRegistry";
import {
    getTabComponentsSnapshot,
    unregisterTabComponent,
} from "../../host/registry/tabComponentRegistry";
import { activateTaskBoardPluginRuntime } from "./taskBoardPluginRuntime";

interface RecordedCommand {
    id: string;
    title: string;
    execute: CommandDefinition["execute"];
}

describe("taskBoardPlugin", () => {
    afterEach(() => {
        unregisterActivity("task-board");
        unregisterTabComponent("task-board-tab");
    });

    it("应注册任务看板 activity、tab 和命令，并在 dispose 时清理", () => {
        const recordedCommands: RecordedCommand[] = [];

        const dispose = activateTaskBoardPluginRuntime(() => null, {
            registerCommand: (definition) => {
                recordedCommands.push({
                    id: definition.id,
                    title: definition.title,
                    execute: definition.execute,
                });
                return () => {
                    const index = recordedCommands.findIndex((item) => item.id === definition.id);
                    if (index >= 0) {
                        recordedCommands.splice(index, 1);
                    }
                };
            },
        });

        expect(getActivitiesSnapshot().some((item) => item.id === "task-board")).toBe(true);
        expect(getTabComponentsSnapshot().some((item) => item.id === "task-board-tab")).toBe(true);
        expect(recordedCommands.some((item) => item.id === "taskBoard.open")).toBe(true);
        expect(
            getTabComponentsSnapshot().find((item) => item.id === "task-board-tab")?.lifecycleScope,
        ).toBe("vault");

        dispose();

        expect(getActivitiesSnapshot().some((item) => item.id === "task-board")).toBe(false);
        expect(getTabComponentsSnapshot().some((item) => item.id === "task-board-tab")).toBe(false);
        expect(recordedCommands.some((item) => item.id === "taskBoard.open")).toBe(false);
    });
});