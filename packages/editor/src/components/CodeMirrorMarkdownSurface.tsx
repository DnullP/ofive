import { useEffect, useMemo, useRef } from "react";
import { markdown } from "@codemirror/lang-markdown";
import { indentWithTab } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { editorBaseSetup } from "../core/editorBaseSetup";
import { createEditorThemeExtension } from "../core/codemirrorTheme";
import type { EditorService } from "../core/types";
import { useEditorSnapshot } from "../react/useEditorSnapshot";

export interface CodeMirrorMarkdownSurfaceProps {
  service: EditorService;
  lineNumbers?: boolean;
  readOnly?: boolean;
}

export function CodeMirrorMarkdownSurface({
  service,
  lineNumbers: showLineNumbers = true,
  readOnly = false,
}: CodeMirrorMarkdownSurfaceProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const applyingExternalChangeRef = useRef(false);
  const snapshot = useEditorSnapshot(service);
  const pluginExtensions = useMemo(() => service.getCodeMirrorExtensions(), [service]);

  useEffect(() => {
    if (!hostRef.current) {
      return undefined;
    }

    const updateListener = EditorView.updateListener.of((update) => {
      if (!update.docChanged || applyingExternalChangeRef.current) {
        return;
      }
      service.updateContent(update.state.doc.toString(), "codemirror");
    });

    const state = EditorState.create({
      doc: service.getSnapshot().document.content,
      extensions: [
        editorBaseSetup,
        markdown(),
        createEditorThemeExtension(),
        EditorView.lineWrapping,
        keymap.of([indentWithTab]),
        showLineNumbers ? lineNumbers() : [],
        readOnly ? EditorState.readOnly.of(true) : [],
        updateListener,
        ...pluginExtensions,
      ],
    });

    const view = new EditorView({
      state,
      parent: hostRef.current,
    });
    viewRef.current = view;
    service.attachView(view);

    return () => {
      service.attachView(null);
      view.destroy();
      viewRef.current = null;
    };
  }, [pluginExtensions, readOnly, service, showLineNumbers]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) {
      return;
    }

    const currentContent = view.state.doc.toString();
    if (currentContent === snapshot.document.content) {
      return;
    }

    applyingExternalChangeRef.current = true;
    view.dispatch({
      changes: {
        from: 0,
        to: currentContent.length,
        insert: snapshot.document.content,
      },
    });
    applyingExternalChangeRef.current = false;
  }, [snapshot.document.content]);

  return <div className="oe-code-editor" ref={hostRef} />;
}
