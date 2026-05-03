/**
 * @module host/layout/CustomTitlebar
 * @description 提供自定义窗口标题栏，承载拖拽区与系统化窗口控制按钮（最小化/全屏/关闭）。
 * @dependencies
 *   - react
 *   - lucide-react
 */

import { useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Minus, Square, X } from "lucide-react";
import { requestApplicationQuit } from "../commands/systemShortcutSubsystem";

/**
 * @function CustomTitlebar
 * @description 渲染覆盖在工作区上方的窗口控制按钮。
 */
export function CustomTitlebar(): ReactNode {
    const { t } = useTranslation();
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

    const handleClose = async (): Promise<void> => {
        try {
            await requestApplicationQuit();
        } catch (error) {
            console.error("[window] close app failed", error);
        }
    };

    const controls = (
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

    if (isMacOS) {
        return (
            <header
                className="app-titlebar app-titlebar--mac app-titlebar--native-controls"
                aria-label={t("titlebar.windowControls")}
                data-tauri-drag-region
            />
        );
    }

    return (
        <header
            className="app-titlebar app-titlebar--windows"
            aria-label={t("titlebar.windowControls")}
            data-tauri-drag-region
        >
            <div className="app-titlebar__right-slot window-no-drag">
                {controls}
            </div>
        </header>
    );
}
