/**
 * @module plugins/markdown-codemirror/editor/wikiLinkPreviewHierarchy
 * @description WikiLink 预览层级注册表：维护多层 preview 之间的父子关系，
 *   供编辑态 preview 与阅读态 preview 共享，用于判断父 preview 是否仍被子 preview 链路占用。
 * @dependencies
 *  - react
 *
 * @example
 *   const id = createWikiLinkPreviewId();
 *   registerWikiLinkPreview(id, parentId);
 *   const hasChild = hasWikiLinkPreviewDescendant(id);
 *
 * @exports
 *  - WikiLinkPreviewParentContext 预览父节点上下文
 *  - createWikiLinkPreviewId 生成稳定 preview id
 *  - registerWikiLinkPreview 注册 preview 节点
 *  - unregisterWikiLinkPreview 注销 preview 节点
 *  - hasWikiLinkPreviewDescendant 判断是否存在后代 preview
 *  - subscribeWikiLinkPreviewHierarchy 订阅层级变化
 */

import { createContext } from "react";

type WikiLinkPreviewHierarchyListener = () => void;

const previewParentById = new Map<string, string | null>();
const previewChildrenById = new Map<string, Set<string>>();
const hierarchyListeners = new Set<WikiLinkPreviewHierarchyListener>();
let nextWikiLinkPreviewSequence = 1;
let hierarchyNotifyScheduled = false;

/** 预览父节点上下文：供嵌套 MarkdownReadView 继续挂接后代 preview。 */
export const WikiLinkPreviewParentContext = createContext<string | null>(null);

/**
 * @function createWikiLinkPreviewId
 * @description 生成全局唯一的 WikiLink preview id。
 * @returns preview id。
 */
export function createWikiLinkPreviewId(): string {
    const id = `wikilink-preview:${nextWikiLinkPreviewSequence}`;
    nextWikiLinkPreviewSequence += 1;
    return id;
}

/**
 * @function registerWikiLinkPreview
 * @description 将 preview 节点注册到层级表中。
 * @param previewId 当前 preview id。
 * @param parentPreviewId 父 preview id；顶层 preview 传 null。
 * @returns void。
 */
export function registerWikiLinkPreview(
    previewId: string,
    parentPreviewId: string | null,
): void {
    unregisterWikiLinkPreview(previewId, false);
    previewParentById.set(previewId, parentPreviewId);

    if (parentPreviewId !== null) {
        const siblingSet = previewChildrenById.get(parentPreviewId) ?? new Set<string>();
        siblingSet.add(previewId);
        previewChildrenById.set(parentPreviewId, siblingSet);
    }

    notifyHierarchyListeners();
}

/**
 * @function unregisterWikiLinkPreview
 * @description 从层级表中移除指定 preview。
 * @param previewId preview id。
 * @param shouldNotify 是否广播层级变化，默认 true。
 * @returns void。
 */
export function unregisterWikiLinkPreview(
    previewId: string,
    shouldNotify = true,
): void {
    const parentPreviewId = previewParentById.get(previewId);
    if (parentPreviewId === undefined) {
        return;
    }

    previewParentById.delete(previewId);
    if (parentPreviewId !== null) {
        const siblingSet = previewChildrenById.get(parentPreviewId);
        if (siblingSet) {
            siblingSet.delete(previewId);
            if (siblingSet.size === 0) {
                previewChildrenById.delete(parentPreviewId);
            }
        }
    }

    if (shouldNotify) {
        notifyHierarchyListeners();
    }
}

/**
 * @function hasWikiLinkPreviewDescendant
 * @description 判断指定 preview 是否拥有任意深度的后代 preview。
 * @param previewId preview id。
 * @returns 存在后代则返回 true。
 */
export function hasWikiLinkPreviewDescendant(previewId: string): boolean {
    const directChildren = previewChildrenById.get(previewId);
    if (!directChildren || directChildren.size === 0) {
        return false;
    }

    return true;
}

/**
 * @function subscribeWikiLinkPreviewHierarchy
 * @description 订阅 preview 层级变化。
 * @param listener 变化回调。
 * @returns 取消订阅函数。
 */
export function subscribeWikiLinkPreviewHierarchy(
    listener: WikiLinkPreviewHierarchyListener,
): () => void {
    hierarchyListeners.add(listener);
    return () => {
        hierarchyListeners.delete(listener);
    };
}

/**
 * @function notifyHierarchyListeners
 * @description 广播 preview 层级变化。
 * @returns void。
 */
function notifyHierarchyListeners(): void {
    if (hierarchyNotifyScheduled) {
        return;
    }

    hierarchyNotifyScheduled = true;
    queueMicrotask(() => {
        hierarchyNotifyScheduled = false;
        hierarchyListeners.forEach((listener) => {
            listener();
        });
    });
}