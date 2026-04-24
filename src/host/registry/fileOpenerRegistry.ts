/**
 * @module host/registry/fileOpenerRegistry
 * @description 文件 opener 注册中心：统一管理“一个文件应该由哪个 opener 打开”。
 *   opener 负责两件事：
 *   - 声明自己支持哪些文件
 *   - 将文件打开请求解析为具体的 Tab 定义
 *
 *   该注册中心是多编辑器/多查看器能力的基础设施：
 *   - 同一类文件可注册多个 opener
 *   - 宿主可按 kind 或显式 opener id 选择默认实现
 *   - 未来设置页可直接消费本模块的快照，向用户展示可选 opener 列表
 *
 * @dependencies
 *   - react (useSyncExternalStore)
 *   - ../layout/workbenchContracts
 *
 * @example
 *   const dispose = registerFileOpener({
 *     id: "markdown.codemirror",
 *     label: "CodeMirror",
 *     kind: "markdown",
 *     priority: 100,
 *     matches: ({ relativePath }) => relativePath.endsWith(".md"),
 *     resolveTab: async ({ relativePath }) => ({ ... }),
 *   });
 */

import { useSyncExternalStore } from "react";
import type { TabInstanceDefinition } from "../layout/workbenchContracts";

/**
 * @interface FileOpenerContext
 * @description 文件 opener 解析上下文。
 */
export interface FileOpenerContext {
    /** 归一化后的相对路径。 */
    relativePath: string;
    /** 当前仓库绝对路径；部分 opener（如图片）可选使用。 */
    currentVaultPath?: string;
    /** 调用方提供的内容覆盖值；用于重命名/新建/移动后避免重复读取。 */
    contentOverride?: string;
}

/**
 * @interface FileOpenerDescriptor
 * @description 文件 opener 注册描述。
 */
export interface FileOpenerDescriptor {
    /** opener 唯一标识。 */
    id: string;
    /** opener 展示名称。 */
    label: string | (() => string);
    /** opener 归属 kind，例如 markdown/image。 */
    kind: string;
    /** 优先级，值越大越优先。 */
    priority: number;
    /** 判断当前 opener 是否支持该文件。 */
    matches: (context: FileOpenerContext) => boolean;
    /** 将文件打开请求解析为具体 Tab 定义。 */
    resolveTab: (context: FileOpenerContext) => Promise<TabInstanceDefinition>;
}

const fileOpenerMap = new Map<string, FileOpenerDescriptor>();
const listeners = new Set<() => void>();
let cachedSnapshot: FileOpenerDescriptor[] = [];

function emit(): void {
    cachedSnapshot = Array.from(fileOpenerMap.values()).sort((left, right) => {
        if (left.kind !== right.kind) {
            return left.kind.localeCompare(right.kind);
        }
        if (left.priority !== right.priority) {
            return right.priority - left.priority;
        }
        return left.id.localeCompare(right.id);
    });
    listeners.forEach((listener) => listener());
}

/**
 * @function registerFileOpener
 * @description 注册文件 opener。相同 id 会覆盖旧值。
 * @param descriptor opener 描述。
 * @returns 注销函数。
 */
export function registerFileOpener(descriptor: FileOpenerDescriptor): () => void {
    fileOpenerMap.set(descriptor.id, descriptor);
    console.info("[fileOpenerRegistry] registered opener", {
        id: descriptor.id,
        kind: descriptor.kind,
        priority: descriptor.priority,
    });
    emit();

    return () => {
        unregisterFileOpener(descriptor.id);
    };
}

/**
 * @function unregisterFileOpener
 * @description 按 id 注销文件 opener。
 * @param id opener id。
 */
export function unregisterFileOpener(id: string): void {
    if (!fileOpenerMap.has(id)) {
        return;
    }

    fileOpenerMap.delete(id);
    console.info("[fileOpenerRegistry] unregistered opener", { id });
    emit();
}

/**
 * @function getFileOpenersSnapshot
 * @description 获取当前注册的 opener 快照。
 * @returns opener 列表。
 */
export function getFileOpenersSnapshot(): FileOpenerDescriptor[] {
    return cachedSnapshot;
}

/**
 * @function subscribeFileOpeners
 * @description 订阅 opener 注册表变化。
 * @param listener 监听器。
 * @returns 取消订阅函数。
 */
export function subscribeFileOpeners(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/**
 * @function useFileOpeners
 * @description React Hook：订阅并返回 opener 快照。
 * @returns opener 列表。
 */
export function useFileOpeners(): FileOpenerDescriptor[] {
    return useSyncExternalStore(
        (listener) => subscribeFileOpeners(listener),
        () => getFileOpenersSnapshot(),
        () => getFileOpenersSnapshot(),
    );
}

/**
 * @function getFileOpenerById
 * @description 按 id 获取文件 opener。
 * @param id opener id。
 * @returns opener 描述；未命中返回 undefined。
 */
export function getFileOpenerById(id: string): FileOpenerDescriptor | undefined {
    return fileOpenerMap.get(id);
}

/**
 * @function resolveFileOpenerLabel
 * @description 解析 opener 展示名称。
 * @param label 字符串或动态函数。
 * @returns 展示名称。
 */
export function resolveFileOpenerLabel(label: string | (() => string)): string {
    return typeof label === "function" ? label() : label;
}

/**
 * @function getMatchingFileOpeners
 * @description 获取可打开指定文件的 opener 候选列表。
 * @param context 文件 opener 上下文。
 * @returns 匹配的 opener 列表，按优先级降序。
 */
export function getMatchingFileOpeners(context: FileOpenerContext): FileOpenerDescriptor[] {
    return cachedSnapshot.filter((descriptor) => descriptor.matches(context));
}

/**
 * @function resolveFileOpener
 * @description 为指定文件解析最终 opener。
 * @param context 文件 opener 上下文。
 * @param preferredOpenerId 可选的显式 opener id；若匹配则优先使用。
 * @returns 最终 opener；未命中返回 null。
 */
export function resolveFileOpener(
    context: FileOpenerContext,
    preferredOpenerId?: string,
): FileOpenerDescriptor | null {
    const candidates = getMatchingFileOpeners(context);
    if (candidates.length === 0) {
        return null;
    }

    if (preferredOpenerId) {
        const preferred = candidates.find((descriptor) => descriptor.id === preferredOpenerId);
        if (preferred) {
            return preferred;
        }
    }

    return candidates[0] ?? null;
}