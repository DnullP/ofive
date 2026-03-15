/**
 * @module plugins/markdown-codemirror/editor/editorPasteImageHandler
 * @description 编辑器粘贴图片处理模块：
 *   拦截 CodeMirror 编辑器上的 paste 事件，当剪贴板含图片时
 *   自动在 vault 的 Images 目录创建图片文件，并在光标位置插入 `![[Images/filename]]` 嵌入语法。
 * @dependencies
 *  - @codemirror/view (EditorView)
 *
 * @example
 *   // 在 EditorView 创建后绑定：
 *   const cleanup = attachPasteImageHandler(view, {
 *       getCurrentFilePath: () => currentFilePathRef.current,
 *       createBinaryFile: createVaultBinaryFile,
 *   });
 *   // 组件卸载时调用 cleanup()
 *
 * @exports
 *  - attachPasteImageHandler: 绑定 paste 事件，返回 cleanup 函数
 *  - generatePastedImageFileName: 根据 MIME 生成唯一文件名（可测试）
 *  - resolveImageRelativePath: 解析图片相对路径（可测试）
 *  - buildImageEmbedSyntax: 构建 ![[...]] 嵌入语法（可测试）
 */

import type { EditorView } from "@codemirror/view";
import i18n from "../../../i18n";

/**
 * @interface PasteImageDependencies
 * @description 粘贴图片处理器的外部依赖，通过依赖注入方式提供。
 */
export interface PasteImageDependencies {
    /** 获取当前编辑文件路径（用于日志） */
    getCurrentFilePath: () => string;
    /** 创建二进制文件的后端 API 回调 */
    createBinaryFile: (relativePath: string, base64Content: string) => Promise<unknown>;
}

/**
 * @constant IMAGE_DIRECTORY
 * @description 图片文件默认存放目录（相对 vault 根）。
 */
const IMAGE_DIRECTORY = "Images";

/**
 * @constant SUPPORTED_PASTE_IMAGE_TYPES
 * @description 支持的剪贴板图片 MIME 类型及对应扩展名。
 */
const SUPPORTED_PASTE_IMAGE_TYPES: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/bmp": "bmp",
};

/**
 * @function generatePastedImageFileName
 * @description 根据 MIME 类型生成唯一的粘贴图片文件名。
 *   格式：pasted-image-{yyyyMMdd-HHmmss}-{随机后缀}.{ext}
 * @param mimeType 图片 MIME 类型。
 * @returns 文件名字符串。
 */
export function generatePastedImageFileName(mimeType: string): string {
    const extension = SUPPORTED_PASTE_IMAGE_TYPES[mimeType] ?? "png";
    const now = new Date();
    const pad2 = (n: number): string => n.toString().padStart(2, "0");
    const timestamp = [
        now.getFullYear(),
        pad2(now.getMonth() + 1),
        pad2(now.getDate()),
        "-",
        pad2(now.getHours()),
        pad2(now.getMinutes()),
        pad2(now.getSeconds()),
    ].join("");
    const randomSuffix = Math.random().toString(36).slice(2, 8);
    return `pasted-image-${timestamp}-${randomSuffix}.${extension}`;
}

/**
 * @function resolveImageRelativePath
 * @description 拼接图片存放目录与文件名，返回相对 vault 的路径。
 * @param fileName 图片文件名。
 * @returns 相对 vault 根的图片路径。
 */
export function resolveImageRelativePath(fileName: string): string {
    return `${IMAGE_DIRECTORY}/${fileName}`;
}

/**
 * @function buildImageEmbedSyntax
 * @description 构建图片嵌入 Markdown 语法。
 * @param imageRelativePath 图片相对 vault 路径。
 * @returns `![[路径]]` 格式字符串。
 */
export function buildImageEmbedSyntax(imageRelativePath: string): string {
    return `![[${imageRelativePath}]]`;
}

/**
 * 从剪贴板项中查找第一个受支持的图片项。
 * @param items DataTransferItemList。
 * @returns 图片 DataTransferItem 或 null。
 */
function findImageClipboardItem(items: DataTransferItemList): DataTransferItem | null {
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind === "file" && item.type in SUPPORTED_PASTE_IMAGE_TYPES) {
            return item;
        }
    }
    return null;
}

/**
 * 将 Blob 转为 Base64 字符串（不含前缀 data:...;base64, ）。
 * @param blob 图片 Blob。
 * @returns Base64 字符串 Promise。
 */
function blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const result = reader.result as string;
            // 格式: data:image/png;base64,iVBOR...
            const commaIndex = result.indexOf(",");
            if (commaIndex < 0) {
                reject(new Error(i18n.t("editorPlugins.fileReaderAbnormal")));
                return;
            }
            resolve(result.slice(commaIndex + 1));
        };
        reader.onerror = () => {
            reject(reader.error ?? new Error(i18n.t("editorPlugins.fileReaderFailed")));
        };
        reader.readAsDataURL(blob);
    });
}

/**
 * @function attachPasteImageHandler
 * @description 在 EditorView 的 DOM 上挂载 paste 事件处理器。
 *   当剪贴板包含图片时：
 *   1. 阻止默认粘贴行为
 *   2. 生成唯一文件名
 *   3. 调用后端 createVaultBinaryFile 创建图片文件
 *   4. 在光标位置插入 `![[Images/filename]]`
 *
 *   当剪贴板仅含文本时，不拦截，交由 CodeMirror 默认处理。
 *
 * @param view CodeMirror EditorView 实例。
 * @param deps 外部依赖（getCurrentFilePath + createBinaryFile）。
 * @returns cleanup 函数，调用后移除事件监听。
 */
export function attachPasteImageHandler(
    view: EditorView,
    deps: PasteImageDependencies,
): () => void {
    const handlePaste = (event: ClipboardEvent): void => {
        const clipboardData = event.clipboardData;
        if (!clipboardData) {
            return;
        }

        const imageItem = findImageClipboardItem(clipboardData.items);
        if (!imageItem) {
            // 无图片 → 不拦截，让 CodeMirror 处理文本粘贴
            return;
        }

        const imageFile = imageItem.getAsFile();
        if (!imageFile) {
            console.warn("[editor-paste] 获取图片文件失败");
            return;
        }

        // 有图片 → 阻止默认粘贴行为
        event.preventDefault();
        event.stopPropagation();

        const mimeType = imageItem.type;
        const fileName = generatePastedImageFileName(mimeType);
        const imageRelativePath = resolveImageRelativePath(fileName);
        const embedSyntax = buildImageEmbedSyntax(imageRelativePath);

        console.info("[editor-paste] paste image detected", {
            mimeType,
            fileName,
            imageRelativePath,
            currentFilePath: deps.getCurrentFilePath(),
        });

        void (async () => {
            try {
                const base64Content = await blobToBase64(imageFile);
                await deps.createBinaryFile(imageRelativePath, base64Content);

                // 在光标位置插入嵌入语法
                const cursor = view.state.selection.main.head;
                view.dispatch({
                    changes: {
                        from: cursor,
                        to: cursor,
                        insert: embedSyntax,
                    },
                    selection: {
                        anchor: cursor + embedSyntax.length,
                    },
                });

                console.info("[editor-paste] paste image success", {
                    imageRelativePath,
                    embedSyntax,
                });
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                console.error("[editor-paste] paste image failed", {
                    imageRelativePath,
                    message,
                });
            }
        })();
    };

    view.dom.addEventListener("paste", handlePaste);
    return () => {
        view.dom.removeEventListener("paste", handlePaste);
    };
}
