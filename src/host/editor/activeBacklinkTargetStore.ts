/**
 * @module host/editor/activeBacklinkTargetStore
 * @description 当前反向链接面板关注目标。目标可以是 Markdown 编辑器，也可以是项目源码阅读 tab。
 */

import { useSyncExternalStore } from "react";

export interface ActiveMarkdownBacklinkTarget {
    kind: "markdown";
    articleId: string;
    path: string;
    title: string;
    updatedAt: number;
}

export interface ActiveProjectSourceBacklinkTarget {
    kind: "project-source";
    tabId: string;
    projectId: string;
    projectName: string;
    rootPath: string;
    relativePath: string;
    title: string;
    updatedAt: number;
}

export type ActiveBacklinkTarget = ActiveMarkdownBacklinkTarget | ActiveProjectSourceBacklinkTarget;

class ActiveBacklinkTargetStore {
    private target: ActiveBacklinkTarget | null = null;

    private listeners = new Set<() => void>();

    subscribe(listener: () => void): () => void {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    getSnapshot(): ActiveBacklinkTarget | null {
        return this.target;
    }

    reportMarkdownTarget(payload: {
        articleId: string;
        path: string;
    }): void {
        const title = payload.path.split("/").pop() ?? payload.path;
        const nextTarget: ActiveMarkdownBacklinkTarget = {
            kind: "markdown",
            articleId: payload.articleId,
            path: payload.path,
            title,
            updatedAt: Date.now(),
        };

        if (
            this.target?.kind === "markdown"
            && this.target.articleId === nextTarget.articleId
            && this.target.path === nextTarget.path
        ) {
            return;
        }

        this.target = nextTarget;
        this.emit();
    }

    reportProjectSourceTarget(payload: {
        tabId: string;
        projectId: string;
        projectName: string;
        rootPath: string;
        relativePath: string;
    }): void {
        const nextTarget: ActiveProjectSourceBacklinkTarget = {
            kind: "project-source",
            tabId: payload.tabId,
            projectId: payload.projectId,
            projectName: payload.projectName,
            rootPath: payload.rootPath,
            relativePath: payload.relativePath,
            title: `${payload.projectName} / ${payload.relativePath}`,
            updatedAt: Date.now(),
        };

        if (
            this.target?.kind === "project-source"
            && this.target.tabId === nextTarget.tabId
            && this.target.projectId === nextTarget.projectId
            && this.target.relativePath === nextTarget.relativePath
        ) {
            return;
        }

        this.target = nextTarget;
        this.emit();
    }

    clearTarget(): void {
        if (!this.target) {
            return;
        }

        this.target = null;
        this.emit();
    }

    clearProjectSourceTarget(tabId: string): void {
        if (this.target?.kind !== "project-source" || this.target.tabId !== tabId) {
            return;
        }

        this.target = null;
        this.emit();
    }

    private emit(): void {
        this.listeners.forEach((listener) => listener());
    }
}

const activeBacklinkTargetStore = new ActiveBacklinkTargetStore();

export function reportMarkdownBacklinkTarget(payload: {
    articleId: string;
    path: string;
}): void {
    activeBacklinkTargetStore.reportMarkdownTarget(payload);
}

export function reportProjectSourceBacklinkTarget(payload: {
    tabId: string;
    projectId: string;
    projectName: string;
    rootPath: string;
    relativePath: string;
}): void {
    activeBacklinkTargetStore.reportProjectSourceTarget(payload);
}

export function clearActiveBacklinkTarget(): void {
    activeBacklinkTargetStore.clearTarget();
}

export function clearProjectSourceBacklinkTarget(tabId: string): void {
    activeBacklinkTargetStore.clearProjectSourceTarget(tabId);
}

export function useActiveBacklinkTarget(): ActiveBacklinkTarget | null {
    return useSyncExternalStore(
        (listener) => activeBacklinkTargetStore.subscribe(listener),
        () => activeBacklinkTargetStore.getSnapshot(),
        () => activeBacklinkTargetStore.getSnapshot(),
    );
}

export function getActiveBacklinkTargetSnapshot(): ActiveBacklinkTarget | null {
    return activeBacklinkTargetStore.getSnapshot();
}
