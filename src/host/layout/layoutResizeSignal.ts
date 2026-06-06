/**
 * @module host/layout/layoutResizeSignal
 * @description Shared reader for layout-v2's document-level resize flag.
 */

import { useSyncExternalStore } from "react";

export const DOCUMENT_LAYOUT_RESIZING_ATTR = "data-layout-resizing";
export const DOCUMENT_LAYOUT_LIGHTWEIGHT_ATTR = "data-layout-lightweight";

type LayoutResizeListener = (isResizing: boolean) => void;

function getDocumentElement(): HTMLElement | null {
    return typeof document === "undefined" ? null : document.documentElement;
}

export function isDocumentLayoutResizing(): boolean {
    return readDocumentBooleanAttribute(DOCUMENT_LAYOUT_RESIZING_ATTR);
}

export function isDocumentLayoutLightweight(): boolean {
    return readDocumentBooleanAttribute(DOCUMENT_LAYOUT_LIGHTWEIGHT_ATTR);
}

function readDocumentBooleanAttribute(attributeName: string): boolean {
    return getDocumentElement()?.getAttribute(attributeName) === "true";
}

function subscribeDocumentBooleanAttribute(
    attributeName: string,
    readValue: () => boolean,
    listener: LayoutResizeListener,
): () => void {
    const root = getDocumentElement();
    if (!root || typeof MutationObserver === "undefined") {
        return () => {};
    }

    let previousValue = readValue();
    const notifyIfChanged = (): void => {
        const nextValue = readValue();
        if (nextValue === previousValue) {
            return;
        }

        previousValue = nextValue;
        listener(nextValue);
    };

    const observer = new MutationObserver(notifyIfChanged);
    observer.observe(root, {
        attributes: true,
        attributeFilter: [attributeName],
    });

    return () => observer.disconnect();
}

export function subscribeDocumentLayoutResizing(listener: LayoutResizeListener): () => void {
    return subscribeDocumentBooleanAttribute(
        DOCUMENT_LAYOUT_RESIZING_ATTR,
        isDocumentLayoutResizing,
        listener,
    );
}

export function subscribeDocumentLayoutLightweight(listener: LayoutResizeListener): () => void {
    return subscribeDocumentBooleanAttribute(
        DOCUMENT_LAYOUT_LIGHTWEIGHT_ATTR,
        isDocumentLayoutLightweight,
        listener,
    );
}

export function useDocumentLayoutResizing(): boolean {
    return useSyncExternalStore(
        (onStoreChange) => subscribeDocumentLayoutResizing(() => onStoreChange()),
        isDocumentLayoutResizing,
        () => false,
    );
}

export function useDocumentLayoutLightweight(): boolean {
    return useSyncExternalStore(
        (onStoreChange) => subscribeDocumentLayoutLightweight(() => onStoreChange()),
        isDocumentLayoutLightweight,
        () => false,
    );
}
