import { describe, expect, test } from "bun:test";
import {
    createDetachedReadyGate,
    resolveDetachedWindowPosition,
    waitForDetachedWindowReady,
} from "./useTabWindowDragBridge";

describe("tab window drag bridge helpers", () => {
    test("positions the detached window so the tab remains under the pointer", () => {
        expect(resolveDetachedWindowPosition({
            clientX: 120,
            clientY: 32,
            screenX: 640,
            screenY: 300,
        })).toEqual({
            x: 420,
            y: 272,
        });
    });

    test("ready gate resolves when detached window reports ready", async () => {
        const gate = createDetachedReadyGate();

        const readyPromise = waitForDetachedWindowReady(gate, 100);
        gate.detachedWindowReady = true;
        gate.resolveDetachedReady();

        expect(await readyPromise).toBe(true);
    });

    test("ready gate times out so a hidden detached window can be destroyed", async () => {
        const gate = createDetachedReadyGate();

        expect(await waitForDetachedWindowReady(gate, 1)).toBe(false);
    });
});
