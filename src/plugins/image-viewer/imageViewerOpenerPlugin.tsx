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
 *   放入 src/plugins/ 后由 main.tsx 自动发现。
 */

import { ImageViewerTab } from "./tab/ImageViewerTab";
import { buildFileTabId, joinVaultAbsolutePath, normalizeRelativePath } from "../../host/layout/openFileService";
import { registerFileOpener } from "../../host/registry/fileOpenerRegistry";
import { registerTabComponent } from "../../host/registry/tabComponentRegistry";

function isImagePath(relativePath: string): boolean {
    return /\.(png|jpg|jpeg|gif|webp|bmp|svg|ico)$/i.test(relativePath);
}

registerTabComponent({
    id: "imageviewer",
    component: ImageViewerTab as any,
});

registerFileOpener({
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