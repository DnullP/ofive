/**
 * @module layout/nativeContextMenu
 * @description 原生右键菜单桥接：在 Tauri 环境调用系统原生 Menu，在浏览器环境回退为无操作。
 * @dependencies
 *  - @tauri-apps/api/menu
 */

/**
 * @interface NativeContextMenuItem
 * @description 单个右键菜单项配置。
 */
export interface NativeContextMenuItem {
    /** 菜单项唯一 ID */
    id: string;
    /** 菜单项显示文案 */
    text: string;
    /** 是否可用 */
    enabled?: boolean;
}

/**
 * @function isTauriRuntime
 * @description 判断当前是否在 Tauri 运行时。
 * @returns Tauri 运行时返回 true。
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

let isContextMenuPopupOpening = false;

/**
 * @function showNativeContextMenu
 * @description 弹出系统原生右键菜单并返回用户选择的菜单项 ID。
 * @param items 菜单项列表。
 * @returns 用户选择结果；取消时返回 null。
 */
export async function showNativeContextMenu(items: NativeContextMenuItem[]): Promise<string | null> {
    if (!isTauriRuntime()) {
        console.debug("[native-context-menu] skipped: not tauri runtime");
        return null;
    }

    if (isContextMenuPopupOpening) {
        console.warn("[native-context-menu] skipped: popup already opening");
        return null;
    }

    isContextMenuPopupOpening = true;

    console.info("[native-context-menu] popup start", {
        itemCount: items.length,
        itemIds: items.map((item) => item.id),
    });

    const { Menu } = await import("@tauri-apps/api/menu");

    let selectedId: string | null = null;
    const menu = await Menu.new({
        items: items.map((item) => ({
            id: item.id,
            text: item.text,
            enabled: item.enabled ?? true,
            action: (id: string) => {
                selectedId = id;
                console.info("[native-context-menu] action selected", { id });
            },
        })),
    });

    try {
        await menu.popup();
        console.info("[native-context-menu] popup closed", {
            selectedId,
        });
    } catch (error) {
        console.error("[native-context-menu] popup failed", {
            message: error instanceof Error ? error.message : String(error),
        });
    } finally {
        isContextMenuPopupOpening = false;
        // 注意：popup() 返回后菜单已经结束交互，此处不再同步 await close，
        // 以避免在部分平台上出现关闭阶段阻塞 UI 线程的问题。
        void menu.close().catch((error) => {
            console.warn("[native-context-menu] close failed", {
                message: error instanceof Error ? error.message : String(error),
            });
        });
    }

    return selectedId;
}
