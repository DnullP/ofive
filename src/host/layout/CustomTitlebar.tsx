/**
 * @module host/layout/CustomTitlebar
 * @description 提供自定义窗口标题栏，承载拖拽区与系统化窗口控制按钮（最小化/全屏/关闭）。
 * @dependencies
 *   - react
 *   - lucide-react
 */

import { useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Expand, Minus, PanelRightClose, PanelRightOpen, Square, X } from "lucide-react";
import { requestApplicationQuit } from "../commands/systemShortcutSubsystem";
import {
    requestToggleRightSidebarVisibility,
    useRightSidebarVisibility,
} from "./rightSidebarVisibilityBridge";

/**
 * @function CustomTitlebar
 * @description 渲染自定义标题栏并提供结束应用能力。
 */
export function CustomTitlebar(): ReactNode {
    const { t } = useTranslation();
    const isRightSidebarVisible = useRightSidebarVisibility();
    const isMacOS = useMemo(() => {
        if (typeof navigator === "undefined") {
            return false;
        }
        const agent = `${navigator.userAgent} ${navigator.platform}`.toLowerCase();
        return agent.includes("mac");
    }, []);

    const handleMinimize = async (): Promise<void> => {
        const runtimeWindow = window as Window & {
            __TAURI_INTERNALS__?: unknown;
            __TAURI__?: unknown;
        };
        const isTauriRuntime = Boolean(runtimeWindow.__TAURI_INTERNALS__ || runtimeWindow.__TAURI__);
        if (!isTauriRuntime) {
            return;
        }

        try {
            const { getCurrentWindow } = await import("@tauri-apps/api/window");
            await getCurrentWindow().minimize();
        } catch (error) {
            console.error("[window] minimize failed", error);
        }
    };

    const handleToggleMaximize = async (): Promise<void> => {
        const runtimeWindow = window as Window & {
            __TAURI_INTERNALS__?: unknown;
            __TAURI__?: unknown;
        };
        const isTauriRuntime = Boolean(runtimeWindow.__TAURI_INTERNALS__ || runtimeWindow.__TAURI__);
        if (!isTauriRuntime) {
            return;
        }

        try {
            const { getCurrentWindow } = await import("@tauri-apps/api/window");
            await getCurrentWindow().toggleMaximize();
        } catch (error) {
            console.error("[window] toggle maximize failed", error);
        }
    };

    const handleToggleFullscreen = async (): Promise<void> => {
        const runtimeWindow = window as Window & {
            __TAURI_INTERNALS__?: unknown;
            __TAURI__?: unknown;
        };
        const isTauriRuntime = Boolean(runtimeWindow.__TAURI_INTERNALS__ || runtimeWindow.__TAURI__);
        if (!isTauriRuntime) {
            return;
        }

        try {
            const { getCurrentWindow } = await import("@tauri-apps/api/window");
            const appWindow = getCurrentWindow();
            const isFullscreen = await appWindow.isFullscreen();
            await appWindow.setFullscreen(!isFullscreen);
        } catch (error) {
            console.error("[window] toggle fullscreen failed", error);
        }
    };

    const handleClose = async (): Promise<void> => {
        try {
            await requestApplicationQuit();
        } catch (error) {
            console.error("[window] close app failed", error);
        }
    };

    const controls = isMacOS ? (
        <div className="app-titlebar__controls window-no-drag">
            <button
                type="button"
                className="app-titlebar__control app-titlebar__control--close window-no-drag"
                aria-label={t("titlebar.closeApp")}
                onClick={() => {
                    void handleClose();
                }}
            >
                <X size={12} strokeWidth={2.2} />
            </button>

            <button
                type="button"
                className="app-titlebar__control app-titlebar__control--minimize window-no-drag"
                aria-label={t("titlebar.minimizeWindow")}
                onClick={() => {
                    void handleMinimize();
                }}
            >
                <Minus size={12} strokeWidth={2.2} />
            </button>

            <button
                type="button"
                className="app-titlebar__control app-titlebar__control--maximize window-no-drag"
                aria-label={t("titlebar.toggleFullscreen")}
                onClick={() => {
                    void handleToggleFullscreen();
                }}
            >
                <Expand size={10} strokeWidth={2.2} />
            </button>
        </div>
    ) : (
        <div className="app-titlebar__controls window-no-drag">
            <button
                type="button"
                className="app-titlebar__control app-titlebar__control--minimize window-no-drag"
                aria-label={t("titlebar.minimizeWindow")}
                onClick={() => {
                    void handleMinimize();
                }}
            >
                <Minus size={12} strokeWidth={2.2} />
            </button>

            <button
                type="button"
                className="app-titlebar__control app-titlebar__control--maximize window-no-drag"
                aria-label={t("titlebar.maximizeWindow")}
                onClick={() => {
                    void handleToggleMaximize();
                }}
            >
                <Square size={10} strokeWidth={2.2} />
            </button>

            <button
                type="button"
                className="app-titlebar__control app-titlebar__control--close window-no-drag"
                aria-label={t("titlebar.closeApp")}
                onClick={() => {
                    void handleClose();
                }}
            >
                <X size={12} strokeWidth={2.2} />
            </button>
        </div>
    );

    return (
        <header
            className={`app-titlebar ${isMacOS ? "app-titlebar--mac" : "app-titlebar--windows"}`}
            data-tauri-drag-region
        >
            {isMacOS ? controls : <div className="app-titlebar__controls-spacer" data-tauri-drag-region />}

            <div className="app-titlebar__title" data-tauri-drag-region>
                <div className="app-titlebar__brand" data-tauri-drag-region>
                    <span className="app-titlebar__brand-mark" aria-hidden="true" />
                    <span className="app-titlebar__brand-title">{t("titlebar.appName")}</span>
                </div>
            </div>

            <div className="app-titlebar__right-slot window-no-drag">
                <div className="app-titlebar__actions window-no-drag">
                    <button
                        type="button"
                        className="app-titlebar__control app-titlebar__control--sidebar window-no-drag"
                        aria-label={t(
                            isRightSidebarVisible
                                ? "titlebar.hideRightSidebar"
                                : "titlebar.showRightSidebar",
                        )}
                        onClick={() => {
                            requestToggleRightSidebarVisibility();
                        }}
                    >
                        {isRightSidebarVisible ? <PanelRightClose size={18} strokeWidth={2} /> : <PanelRightOpen size={18} strokeWidth={2} />}
                    </button>
                </div>
                {!isMacOS ? controls : null}
            </div>
        </header>
    );
}
