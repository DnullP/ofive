/**
 * @module host/layout/contextMenuCenter
 * @description 右键菜单中心：默认禁用应用内浏览器右键菜单，并要求组件显式注册后才能弹出菜单。
 * @dependencies
 *  - react
 *  - ./nativeContextMenu
 */

import { useEffect } from "react";
import {
    showNativeContextMenu,
    type NativeContextMenuItem,
} from "./nativeContextMenu";

export type { NativeContextMenuItem } from "./nativeContextMenu";

export interface ContextMenuTrigger {
    clientX: number;
    clientY: number;
    preventDefault?: () => void;
    stopPropagation?: () => void;
}

export interface ContextMenuProvider<TPayload = unknown> {
    id: string;
    buildMenu: (payload: TPayload, trigger: ContextMenuTrigger) =>
        NativeContextMenuItem[] | Promise<NativeContextMenuItem[]>;
    handleAction?: (
        actionId: string,
        payload: TPayload,
        trigger: ContextMenuTrigger,
    ) => void | Promise<void>;
}

const providerRegistry = new Map<string, ContextMenuProvider<unknown>>();

/**
 * @function registerContextMenuProvider
 * @description 注册一个右键菜单 provider；同 id 后注册者覆盖旧注册。
 */
export function registerContextMenuProvider<TPayload>(
    provider: ContextMenuProvider<TPayload>,
): () => void {
    const normalizedProvider = provider as ContextMenuProvider<unknown>;
    providerRegistry.set(provider.id, normalizedProvider);
    console.info("[context-menu-center] provider registered", { providerId: provider.id });

    return () => {
        if (providerRegistry.get(provider.id) === normalizedProvider) {
            providerRegistry.delete(provider.id);
            console.info("[context-menu-center] provider unregistered", { providerId: provider.id });
        }
    };
}

/**
 * @function clearContextMenuProvidersForTest
 * @description 清空 provider 注册表，仅供测试使用。
 */
export function clearContextMenuProvidersForTest(): void {
    providerRegistry.clear();
}

/**
 * @function getRegisteredContextMenuProviderIds
 * @description 返回当前已注册 provider id 列表，便于测试和诊断。
 */
export function getRegisteredContextMenuProviderIds(): string[] {
    return Array.from(providerRegistry.keys());
}

/**
 * @function useContextMenuProvider
 * @description React 生命周期内注册右键菜单 provider。
 */
export function useContextMenuProvider<TPayload>(
    provider: ContextMenuProvider<TPayload>,
): void {
    useEffect(() => registerContextMenuProvider(provider), [provider]);
}

/**
 * @function showRegisteredContextMenu
 * @description 通过右键菜单中心打开菜单；未注册 provider 时仅消费事件，不弹出菜单。
 */
export async function showRegisteredContextMenu<TPayload>(
    providerId: string,
    trigger: ContextMenuTrigger,
    payload: TPayload,
): Promise<string | null> {
    trigger.preventDefault?.();
    trigger.stopPropagation?.();

    const provider = providerRegistry.get(providerId) as ContextMenuProvider<TPayload> | undefined;
    if (!provider) {
        console.warn("[context-menu-center] skipped: provider not registered", { providerId });
        return null;
    }

    const menuItems = await provider.buildMenu(payload, trigger);
    if (menuItems.length === 0) {
        console.info("[context-menu-center] skipped: empty menu", { providerId });
        return null;
    }

    const selectedActionId = await showNativeContextMenu(menuItems);
    if (!selectedActionId) {
        return null;
    }

    await provider.handleAction?.(selectedActionId, payload, trigger);
    return selectedActionId;
}

/**
 * @function useGlobalContextMenuBlocker
 * @description 默认阻止应用内浏览器右键菜单，确保只有注册中心可弹出菜单。
 */
export function useGlobalContextMenuBlocker(): void {
    useEffect(() => {
        if (typeof document === "undefined") {
            return;
        }

        const handleContextMenu = (event: MouseEvent): void => {
            event.preventDefault();
        };

        document.addEventListener("contextmenu", handleContextMenu, { capture: true });
        return () => {
            document.removeEventListener("contextmenu", handleContextMenu, { capture: true });
        };
    }, []);
}
