/**
 * @module plugins/imageViewerOpenerPlugin
 * @description 图片 viewer opener 插件：注册图片查看器 opener 与对应 Tab 组件。
 *
 *   该插件将图片打开能力从宿主内置逻辑迁移为可替换 opener：
 *   - Tab 组件 id: imageviewer
 *   - opener id: image.default-viewer
 *   - kind: image
 *
 * @dependencies
 *   - ./tab/ImageViewerTab
 *   - ../../host/layout/openFileService
 *   - ../../host/registry/fileOpenerRegistry
 *   - ../../host/registry/tabComponentRegistry
 *
 * @example
 *   放入 src/plugins/ 后由插件运行时自动发现并激活。
 *
 * @exports
 *   - activatePlugin 注册并返回清理函数
 */

import { ImageViewerTab } from "./tab/ImageViewerTab";
import { buildFileTabId, joinVaultAbsolutePath, normalizeRelativePath } from "../../host/layout/openFileService";
import { registerFileOpener } from "../../host/registry/fileOpenerRegistry";
import { registerTabComponent } from "../../host/registry/tabComponentRegistry";

function isImagePath(relativePath: string): boolean {
    return /\.(png|jpg|jpeg|gif|webp|bmp|svg|ico)$/i.test(relativePath);
}

/**
 * @function activatePlugin
 * @description 注册图片查看器 opener 与对应 Tab 组件。
 * @returns 插件清理函数。
 */
export function activatePlugin(): () => void {
    const unregisterTabComponent = registerTabComponent({
        id: "imageviewer",
        component: ImageViewerTab as any,
        lifecycleScope: "vault",
    });

    const unregisterFileOpener = registerFileOpener({
        id: "image.default-viewer",
        label: "Default Image Viewer",
        kind: "image",
        priority: 100,
        matches: ({ relativePath }) => isImagePath(relativePath),
        async resolveTab({ relativePath, currentVaultPath }) {
            const normalizedPath = normalizeRelativePath(relativePath);
            return {
                id: buildFileTabId(normalizedPath),
                title: normalizedPath.split("/").pop() ?? normalizedPath,
                component: "imageviewer",
                params: {
                    path: normalizedPath,
                    absolutePath: joinVaultAbsolutePath(currentVaultPath, normalizedPath),
                },
            };
        },
    });

    console.info("[imageViewerOpenerPlugin] registered image opener plugin");

    return () => {
        unregisterFileOpener();
        unregisterTabComponent();
        console.info("[imageViewerOpenerPlugin] unregistered image opener plugin");
    };
}