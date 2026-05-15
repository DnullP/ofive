/**
 * @module plugins/markdown-codemirror/editor/syntaxPlugins/mermaidRenderer
 * @description Shared Mermaid rendering helper for editor widgets and read mode.
 */

import mermaid from "mermaid";

interface MermaidRenderResult {
    /** Mermaid generated SVG markup. */
    svg: string;
    /** Optional Mermaid bind callback for interactive diagrams. */
    bindFunctions?: (element: Element) => void;
}

let hasInitializedMermaid = false;
let mermaidRenderSequence = 0;

function ensureMermaidInitialized(): void {
    if (hasInitializedMermaid) {
        return;
    }

    mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: "base",
        fontFamily: "var(--cm-editor-font-family, sans-serif)",
    });
    hasInitializedMermaid = true;
}

/**
 * @function renderMermaidToElement
 * @description Render Mermaid source into an existing DOM element.
 * @param target DOM element that will receive the rendered SVG or error state.
 * @param source Mermaid diagram source.
 * @returns void
 */
export function renderMermaidToElement(target: HTMLElement, source: string): void {
    ensureMermaidInitialized();

    const renderId = `ofive-mermaid-${Date.now()}-${mermaidRenderSequence++}`;
    target.classList.remove("cm-mermaid-widget-error");
    target.replaceChildren();

    void mermaid.render(renderId, source)
        .then((result: MermaidRenderResult) => {
            if (!target.isConnected) {
                return;
            }

            target.innerHTML = result.svg;
            result.bindFunctions?.(target);
        })
        .catch((error: unknown) => {
            if (!target.isConnected) {
                return;
            }

            const message = error instanceof Error ? error.message : String(error);
            target.classList.add("cm-mermaid-widget-error");
            target.textContent = message;
        });
}

/**
 * @function isMermaidLanguage
 * @description Determine whether a fenced code info string should be rendered as Mermaid.
 * @param language Fence language token.
 * @returns true when the fence language is mermaid.
 */
export function isMermaidLanguage(language: string): boolean {
    return language.trim().toLowerCase() === "mermaid";
}
