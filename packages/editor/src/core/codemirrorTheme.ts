import { markdownLanguage } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { EditorView } from "@codemirror/view";

const markdownSymbolHighlightStyle = HighlightStyle.define([
  {
    tag: [
      tags.meta,
      tags.processingInstruction,
      tags.punctuation,
      tags.contentSeparator,
      tags.quote,
      tags.list,
    ],
    color: "var(--oe-editor-symbol-color)",
  },
], {
  scope: markdownLanguage,
});

export function createEditorThemeExtension() {
  return [
    EditorView.theme({
      "&": {
        height: "100%",
        color: "var(--oe-editor-text)",
        backgroundColor: "var(--oe-editor-bg)",
      },
      "&.cm-focused": {
        outline: "none",
      },
      ".cm-scroller": {
        fontFamily: "var(--oe-editor-font-family)",
        backgroundColor: "var(--oe-editor-bg)",
      },
      ".cm-content": {
        caretColor: "var(--oe-editor-caret)",
        padding: "24px 32px 96px",
        minHeight: "100%",
      },
      ".cm-line": {
        lineHeight: "1.68",
      },
      ".cm-activeLine": {
        backgroundColor: "var(--oe-editor-active-line)",
      },
      ".cm-cursor, .cm-dropCursor": {
        borderLeftColor: "var(--oe-editor-caret)",
      },
      "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground": {
        backgroundColor: "var(--oe-editor-selection)",
      },
      ".cm-gutters": {
        color: "var(--oe-editor-muted)",
        backgroundColor: "var(--oe-editor-bg)",
        borderRight: "1px solid var(--oe-border)",
      },
      ".cm-activeLineGutter": {
        backgroundColor: "var(--oe-editor-active-line)",
      },
    }),
    syntaxHighlighting(markdownSymbolHighlightStyle),
  ];
}
