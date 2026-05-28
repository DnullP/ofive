/**
 * @module plugins/markdown-codemirror/codemirrorOpenerPlugin.test
 * @description CodeMirror opener registration tests.
 */

import { afterEach, expect, test } from "bun:test";
import { getTabComponentById } from "../../host/registry/tabComponentRegistry";
import { activatePlugin } from "./codemirrorOpenerPlugin";

let cleanupPlugin: (() => void) | null = null;

afterEach(() => {
    cleanupPlugin?.();
    cleanupPlugin = null;
});

test("registers markdown editor without blocking first presentation", () => {
    cleanupPlugin = activatePlugin();

    const descriptor = getTabComponentById("codemirror");

    expect(descriptor).toBeDefined();
    expect(descriptor?.lifecycleScope).toBe("vault");
    expect(descriptor?.showNavigationControls).toBe(true);
    expect(descriptor?.deferPresentationUntilReady).toBeUndefined();
});
