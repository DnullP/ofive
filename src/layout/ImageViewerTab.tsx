/**
 * @module layout/ImageViewerTab
 * @description 图片查看器 Tab：用于浏览资源管理器中打开的图片文件。
 * @dependencies
 *  - react
 *  - dockview
 *  - @tauri-apps/api/core
 */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { IDockviewPanelProps } from "dockview";
import { readVaultBinaryFile } from "../api/vaultApi";
import "./ImageViewerTab.css";

/**
 * @function isTauriRuntime
 * @description 判断当前是否运行在 Tauri runtime 中。
 * @returns 若在 Tauri runtime 中返回 true。
 */
function isTauriRuntime(): boolean {
    if (typeof window === "undefined") {
        return false;
    }

    const runtimeWindow = window as Window & {
        __TAURI_INTERNALS__?: unknown;
        __TAURI__?: unknown;
    };

    return Boolean(runtimeWindow.__TAURI_INTERNALS__ || runtimeWindow.__TAURI__);
}

/**
 * @function ImageViewerTab
 * @description Dockview 图片 Tab 渲染函数。
 * @param props Dockview 面板参数，支持 params.path 与 params.absolutePath。
 * @returns 图片查看器视图。
 */
export function ImageViewerTab(props: IDockviewPanelProps<Record<string, unknown>>): ReactNode {
    const [imageLoadError, setImageLoadError] = useState<string | null>(null);
    const [imageSource, setImageSource] = useState<string>("");
    const filePath = String(props.params.path ?? "");
    const absolutePath = String(props.params.absolutePath ?? "");

    const fallbackImageSource = useMemo(() => {
        if (!absolutePath) {
            return "";
        }

        return `file://${encodeURI(absolutePath)}`;
    }, [absolutePath]);

    useEffect(() => {
        setImageLoadError(null);

        if (!filePath) {
            setImageSource("");
            return;
        }

        if (!isTauriRuntime()) {
            setImageSource(fallbackImageSource);
            return;
        }

        void readVaultBinaryFile(filePath)
            .then((response) => {
                const dataSource = `data:${response.mimeType};base64,${response.base64Content}`;
                setImageSource(dataSource);
                console.info("[image-viewer] load image success", {
                    path: filePath,
                    mimeType: response.mimeType,
                    base64Length: response.base64Content.length,
                });
            })
            .catch((error) => {
                const message = error instanceof Error ? error.message : String(error);
                setImageSource("");
                setImageLoadError("图片加载失败");
                console.error("[image-viewer] load image failed", {
                    path: filePath,
                    message,
                });
            });
    }, [filePath, fallbackImageSource]);

    return (
        <div className="image-viewer-tab">
            <div className="image-viewer-header">{filePath}</div>
            <div className="image-viewer-body">
                {imageSource && !imageLoadError ? (
                    <img
                        className="image-viewer-image"
                        src={imageSource}
                        alt={filePath}
                        onError={() => {
                            setImageLoadError("图片加载失败");
                            console.error("[image-viewer] image element onError", {
                                path: filePath,
                                src: imageSource,
                            });
                        }}
                    />
                ) : null}
                {imageLoadError ? <div className="image-viewer-error">{imageLoadError}</div> : null}
            </div>
        </div>
    );
}
