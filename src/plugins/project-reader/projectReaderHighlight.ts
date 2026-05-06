/**
 * @module plugins/project-reader/projectReaderHighlight
 * @description highlight.js setup for external project read-only code tabs.
 */

import hljs from "highlight.js/lib/core";
import bashLanguage from "highlight.js/lib/languages/bash";
import cssLanguage from "highlight.js/lib/languages/css";
import goLanguage from "highlight.js/lib/languages/go";
import javascriptLanguage from "highlight.js/lib/languages/javascript";
import jsonLanguage from "highlight.js/lib/languages/json";
import markdownLanguage from "highlight.js/lib/languages/markdown";
import plaintextLanguage from "highlight.js/lib/languages/plaintext";
import pythonLanguage from "highlight.js/lib/languages/python";
import rustLanguage from "highlight.js/lib/languages/rust";
import typescriptLanguage from "highlight.js/lib/languages/typescript";
import xmlLanguage from "highlight.js/lib/languages/xml";
import yamlLanguage from "highlight.js/lib/languages/yaml";

let registered = false;

function ensureHighlightLanguagesRegistered(): void {
    if (registered) {
        return;
    }

    hljs.registerLanguage("bash", bashLanguage);
    hljs.registerLanguage("css", cssLanguage);
    hljs.registerLanguage("go", goLanguage);
    hljs.registerLanguage("javascript", javascriptLanguage);
    hljs.registerLanguage("js", javascriptLanguage);
    hljs.registerLanguage("json", jsonLanguage);
    hljs.registerLanguage("markdown", markdownLanguage);
    hljs.registerLanguage("md", markdownLanguage);
    hljs.registerLanguage("plaintext", plaintextLanguage);
    hljs.registerLanguage("python", pythonLanguage);
    hljs.registerLanguage("rust", rustLanguage);
    hljs.registerLanguage("rs", rustLanguage);
    hljs.registerLanguage("typescript", typescriptLanguage);
    hljs.registerLanguage("ts", typescriptLanguage);
    hljs.registerLanguage("tsx", typescriptLanguage);
    hljs.registerLanguage("xml", xmlLanguage);
    hljs.registerLanguage("yaml", yamlLanguage);
    hljs.registerLanguage("yml", yamlLanguage);
    registered = true;
}

function normalizeHighlightLanguage(language: string | null | undefined): string {
    if (!language) {
        return "plaintext";
    }

    if (language === "tsx") {
        return "typescript";
    }

    return language;
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

export function highlightProjectCodeLine(
    line: string,
    language: string | null | undefined,
): string {
    ensureHighlightLanguagesRegistered();
    const normalizedLanguage = normalizeHighlightLanguage(language);

    if (hljs.getLanguage(normalizedLanguage)) {
        try {
            return hljs.highlight(line || " ", {
                language: normalizedLanguage,
                ignoreIllegals: true,
            }).value;
        } catch (error) {
            console.warn("[project-reader] highlight failed", {
                language: normalizedLanguage,
                message: error instanceof Error ? error.message : String(error),
            });
        }
    }

    return escapeHtml(line || " ");
}
