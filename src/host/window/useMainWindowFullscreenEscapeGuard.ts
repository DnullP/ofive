/**
 * @module host/window/useMainWindowFullscreenEscapeGuard
 * @description macOS 主窗口全屏 Escape 保护 Hook。
 * @dependencies
 *   - react
 *   - ./mainWindowFullscreenController
 *   - ./windowRuntimeInfo
 */

import { useEffect, useMemo } from "react";
import { handleMacFullscreenEscapeKeydown } from "./mainWindowFullscreenController";
import { detectWindowRuntimeInfo } from "./windowRuntimeInfo";

/**
 * @function useMainWindowFullscreenEscapeGuard
 * @description 在 macOS Tauri 运行时捕获连续 Escape，避免系统退出应用全屏。
 */
export function useMainWindowFullscreenEscapeGuard(): void {
    const runtimeInfo = useMemo(() => detectWindowRuntimeInfo(), []);

    useEffect(() => {
        if (!runtimeInfo.isTauriRuntime || !runtimeInfo.isMacOS) {
            return;
        }

        const handleKeydown = (event: KeyboardEvent): void => {
            handleMacFullscreenEscapeKeydown(event, { runtimeInfo });
        };

        window.addEventListener("keydown", handleKeydown, { capture: true });
        return () => {
            window.removeEventListener("keydown", handleKeydown, { capture: true });
        };
    }, [runtimeInfo]);
}
