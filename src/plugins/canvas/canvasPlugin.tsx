/**
 * @module plugins/canvas/canvasPlugin
 * @description Canvas 插件入口：注册 Canvas Tab 组件与 `.canvas` opener。
 * @dependencies
 *   - ./CanvasTab
 *   - ../../host/layout/openFileService
 *   - ../../host/registry/fileOpenerRegistry
 *   - ../../host/registry/tabComponentRegistry
 */

import { CanvasTab } from "./CanvasTab";
import { buildFileTabId, normalizeRelativePath } from "../../host/layout/openFileService";
import { registerFileOpener } from "../../host/registry/fileOpenerRegistry";
import { registerTabComponent } from "../../host/registry/tabComponentRegistry";
import { isCanvasPath } from "../../utils/canvasFileSpec";

/**
 * @function activatePlugin
 * @description 注册 Canvas opener 与对应 tab 组件。
 * @returns 插件清理函数。
 */
export function activatePlugin(): () => void {
    const unregisterTabComponent = registerTabComponent({
        id: "canvas",
        component: CanvasTab as any,
        lifecycleScope: "vault",
    });

    const unregisterFileOpener = registerFileOpener({
        id: "canvas.default-viewer",
        label: "Canvas",
        kind: "canvas",
        priority: 100,
        matches: ({ relativePath }) => isCanvasPath(relativePath),
        async resolveTab({ relativePath, contentOverride }) {
            const normalizedPath = normalizeRelativePath(relativePath);
            return {
                id: buildFileTabId(normalizedPath),
                title: normalizedPath.split("/").pop() ?? normalizedPath,
                component: "canvas",
                params: {
                    path: normalizedPath,
                    content: contentOverride,
                },
            };
        },
    });

    console.info("[canvasPlugin] registered canvas opener plugin");

    return () => {
        unregisterFileOpener();
        unregisterTabComponent();
        console.info("[canvasPlugin] unregistered canvas opener plugin");
    };
}