/**
 * @module plugins/markdown-codemirror/editor/editorPreviewMirrorDom
 * @description 为 split preview 创建轻量、安全的编辑器 DOM 镜像。
 */

const HEAVY_MIRROR_SUBTREE_SELECTOR = ".cm-markdown-table-widget";

function copyFormControlValue(source: Element, clone: Element): void {
    if (source instanceof HTMLInputElement && clone instanceof HTMLInputElement) {
        clone.value = source.value;
        clone.checked = source.checked;
        return;
    }

    if (source instanceof HTMLTextAreaElement && clone instanceof HTMLTextAreaElement) {
        clone.value = source.value;
        return;
    }

    if (source instanceof HTMLSelectElement && clone instanceof HTMLSelectElement) {
        clone.value = source.value;
    }
}

function resolveElementRenderedHeight(element: HTMLElement): number {
    const rectHeight = element.getBoundingClientRect().height;
    const styleHeight = Number.parseFloat(element.style.height);
    const styleMinHeight = Number.parseFloat(element.style.minHeight);
    return Math.max(
        0,
        Number.isFinite(rectHeight) ? rectHeight : 0,
        Number.isFinite(styleHeight) ? styleHeight : 0,
        Number.isFinite(styleMinHeight) ? styleMinHeight : 0,
    );
}

function createMarkdownTableMirrorPlaceholder(source: HTMLElement): HTMLElement {
    const clone = source.cloneNode(false) as HTMLElement;
    const renderedHeight = resolveElementRenderedHeight(source);
    clone.setAttribute("data-editor-preview-table-skeleton", "true");
    clone.setAttribute("aria-hidden", "true");
    clone.style.height = renderedHeight > 0 ? `${Math.ceil(renderedHeight)}px` : source.style.height;
    clone.style.minHeight = renderedHeight > 0 ? `${Math.ceil(renderedHeight)}px` : source.style.minHeight;

    const skeleton = source.ownerDocument.createElement("div");
    skeleton.className = "cm-editor-preview-mirror__table-skeleton";
    skeleton.setAttribute("aria-hidden", "true");
    clone.appendChild(skeleton);
    return clone;
}

function createMarkdownTableViewportMirrorPlaceholder(ownerDocument: Document): HTMLElement {
    const clone = ownerDocument.createElement("section");
    clone.className = "cm-markdown-table-widget";
    clone.setAttribute("data-editor-preview-table-skeleton", "true");
    clone.setAttribute("aria-hidden", "true");
    clone.style.height = "100%";
    clone.style.minHeight = "100%";

    const skeleton = ownerDocument.createElement("div");
    skeleton.className = "cm-editor-preview-mirror__table-skeleton";
    skeleton.setAttribute("aria-hidden", "true");
    clone.appendChild(skeleton);
    return clone;
}

function cloneElementShell(
    source: HTMLElement | null,
    fallbackClassName: string,
    ownerDocument: Document,
): HTMLElement {
    if (source) {
        return source.cloneNode(false) as HTMLElement;
    }

    const element = ownerDocument.createElement("div");
    element.className = fallbackClassName;
    return element;
}

function createLightweightTableEditorMirrorClone(source: HTMLElement): HTMLElement | null {
    if (!source.querySelector(HEAVY_MIRROR_SUBTREE_SELECTOR)) {
        return null;
    }

    const ownerDocument = source.ownerDocument;
    const clone = source.cloneNode(false) as HTMLElement;
    const editorHost = cloneElementShell(source.querySelector(".cm-tab-editor"), "cm-tab-editor", ownerDocument);
    const editor = cloneElementShell(source.querySelector(".cm-editor"), "cm-editor", ownerDocument);
    const scroller = cloneElementShell(source.querySelector(".cm-scroller"), "cm-scroller", ownerDocument);
    const content = ownerDocument.createElement("div");

    content.className = "cm-content";
    content.setAttribute("data-editor-preview-lightweight-content", "true");
    content.style.minHeight = "100%";
    content.appendChild(createMarkdownTableViewportMirrorPlaceholder(ownerDocument));
    scroller.appendChild(content);
    editor.appendChild(scroller);
    editorHost.appendChild(editor);
    clone.appendChild(editorHost);

    const sourceScroller = source.querySelector<HTMLElement>(".cm-scroller");
    if (sourceScroller) {
        scroller.scrollTop = sourceScroller.scrollTop;
        scroller.scrollLeft = sourceScroller.scrollLeft;
    }

    return clone;
}

function cloneNodeForPreviewMirror(source: Node): Node {
    if (source.nodeType !== Node.ELEMENT_NODE) {
        return source.cloneNode(true);
    }

    const element = source as Element;
    if (element instanceof HTMLElement && element.matches(HEAVY_MIRROR_SUBTREE_SELECTOR)) {
        return createMarkdownTableMirrorPlaceholder(element);
    }

    const clone = element.cloneNode(false) as Element;
    copyFormControlValue(element, clone);
    source.childNodes.forEach((child) => {
        clone.appendChild(cloneNodeForPreviewMirror(child));
    });
    return clone;
}

function removeUnsafeMirrorAttributes(clone: HTMLElement): void {
    clone.querySelectorAll<HTMLElement>("[id]").forEach((element) => {
        element.removeAttribute("id");
    });

    clone.querySelectorAll<HTMLElement>("[contenteditable]").forEach((element) => {
        element.setAttribute("contenteditable", "false");
        element.setAttribute("tabindex", "-1");
    });

    clone.querySelectorAll<HTMLElement>("button, input, textarea, select, [tabindex]").forEach((element) => {
        element.setAttribute("tabindex", "-1");
    });
}

function markMirrorEditorNodes(clone: HTMLElement): void {
    clone.setAttribute("data-editor-preview-mirror-clone", "true");
    clone.querySelectorAll<HTMLElement>(".cm-editor").forEach((element) => {
        element.setAttribute("data-editor-preview-mirror-node", "true");
    });
}

/**
 * @function copyScrollableOffsets
 * @description 将源 editor 的滚动位置复制到克隆 editor，保证 preview 与当前可见视口一致。
 * @param source 源 editor 根 DOM。
 * @param clone 克隆 editor 根 DOM。
 * @returns void。
 */
export function copyScrollableOffsets(source: HTMLElement, clone: HTMLElement): void {
    const sourceScrollers = Array.from(source.querySelectorAll<HTMLElement>(".cm-scroller"));
    const cloneScrollers = Array.from(clone.querySelectorAll<HTMLElement>(".cm-scroller"));

    sourceScrollers.forEach((sourceScroller, index) => {
        const cloneScroller = cloneScrollers[index];
        if (!cloneScroller) {
            return;
        }

        cloneScroller.scrollTop = sourceScroller.scrollTop;
        cloneScroller.scrollLeft = sourceScroller.scrollLeft;
    });
}

/**
 * @function createEditorPreviewMirrorClone
 * @description 基于真实 editor DOM 创建安全的 preview 镜像克隆。
 * @param source 源 editor 根 DOM。
 * @returns 清理并标记后的 DOM 克隆。
 */
export function createEditorPreviewMirrorClone(source: HTMLElement): HTMLElement {
    const clone = createLightweightTableEditorMirrorClone(source)
        ?? cloneNodeForPreviewMirror(source) as HTMLElement;
    removeUnsafeMirrorAttributes(clone);
    markMirrorEditorNodes(clone);
    copyScrollableOffsets(source, clone);
    return clone;
}
