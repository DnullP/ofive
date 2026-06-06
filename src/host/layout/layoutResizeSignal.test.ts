/**
 * @module host/layout/layoutResizeSignal.test
 * @description Regression tests for the document-level resize signal consumed by resize hot paths.
 */

import { afterEach, describe, expect, test } from "bun:test";
import {
    DOCUMENT_LAYOUT_LIGHTWEIGHT_ATTR,
    DOCUMENT_LAYOUT_RESIZING_ATTR,
    isDocumentLayoutLightweight,
    isDocumentLayoutResizing,
    subscribeDocumentLayoutLightweight,
    subscribeDocumentLayoutResizing,
} from "./layoutResizeSignal";

const originalDocument = globalThis.document;
const originalMutationObserver = globalThis.MutationObserver;

class DocumentElementStub {
    private readonly attrs = new Map<string, string>();

    getAttribute(name: string): string | null {
        return this.attrs.get(name) ?? null;
    }

    setAttribute(name: string, value: string): void {
        this.attrs.set(name, value);
    }

    removeAttribute(name: string): void {
        this.attrs.delete(name);
    }
}

class MutationObserverStub {
    static instances: MutationObserverStub[] = [];

    readonly callback: MutationCallback;
    disconnected = false;
    observedAttributeFilter: string[] | undefined;

    constructor(callback: MutationCallback) {
        this.callback = callback;
        MutationObserverStub.instances.push(this);
    }

    observe(_target: Node, options: MutationObserverInit): void {
        this.observedAttributeFilter = options.attributeFilter ? [...options.attributeFilter] : undefined;
    }

    disconnect(): void {
        this.disconnected = true;
    }

    emit(): void {
        this.callback([], this as unknown as MutationObserver);
    }
}

function installDocumentStub(element: DocumentElementStub): void {
    globalThis.document = {
        documentElement: element,
    } as unknown as Document;
    globalThis.MutationObserver = MutationObserverStub as unknown as typeof MutationObserver;
    MutationObserverStub.instances = [];
}

afterEach(() => {
    globalThis.document = originalDocument;
    globalThis.MutationObserver = originalMutationObserver;
    MutationObserverStub.instances = [];
});

describe("layoutResizeSignal", () => {
    test("reads layout-v2 document resize flag", () => {
        const root = new DocumentElementStub();
        installDocumentStub(root);

        expect(isDocumentLayoutResizing()).toBe(false);

        root.setAttribute(DOCUMENT_LAYOUT_RESIZING_ATTR, "true");

        expect(isDocumentLayoutResizing()).toBe(true);
    });

    test("reads layout-v2 document lightweight flag", () => {
        const root = new DocumentElementStub();
        installDocumentStub(root);

        expect(isDocumentLayoutLightweight()).toBe(false);

        root.setAttribute(DOCUMENT_LAYOUT_LIGHTWEIGHT_ATTR, "true");

        expect(isDocumentLayoutLightweight()).toBe(true);
    });

    test("notifies subscribers only when the resize flag changes", () => {
        const root = new DocumentElementStub();
        installDocumentStub(root);
        const values: boolean[] = [];

        const unsubscribe = subscribeDocumentLayoutResizing((isResizing) => {
            values.push(isResizing);
        });
        const observer = MutationObserverStub.instances[0];

        expect(observer?.observedAttributeFilter).toEqual([DOCUMENT_LAYOUT_RESIZING_ATTR]);

        observer?.emit();
        root.setAttribute(DOCUMENT_LAYOUT_RESIZING_ATTR, "true");
        observer?.emit();
        observer?.emit();
        root.removeAttribute(DOCUMENT_LAYOUT_RESIZING_ATTR);
        observer?.emit();

        unsubscribe();

        expect(values).toEqual([true, false]);
        expect(observer?.disconnected).toBe(true);
    });

    test("notifies subscribers only when the lightweight flag changes", () => {
        const root = new DocumentElementStub();
        installDocumentStub(root);
        const values: boolean[] = [];

        const unsubscribe = subscribeDocumentLayoutLightweight((isLightweight) => {
            values.push(isLightweight);
        });
        const observer = MutationObserverStub.instances[0];

        expect(observer?.observedAttributeFilter).toEqual([DOCUMENT_LAYOUT_LIGHTWEIGHT_ATTR]);

        observer?.emit();
        root.setAttribute(DOCUMENT_LAYOUT_LIGHTWEIGHT_ATTR, "true");
        observer?.emit();
        observer?.emit();
        root.removeAttribute(DOCUMENT_LAYOUT_LIGHTWEIGHT_ATTR);
        observer?.emit();

        unsubscribe();

        expect(values).toEqual([true, false]);
        expect(observer?.disconnected).toBe(true);
    });
});
