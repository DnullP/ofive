import { useMemo, useState } from "react";
import {
  createDefaultMarkdownPlugins,
  createEditorService,
  UniversalMarkdownEditor,
  type EditorHostAdapter,
} from "./index";
import "./styles/editor.css";
import "./app.css";

const initialContent = `# Universal editor core

This project extracts the editor state owner, host adapter and plugin contracts from ofive.

## Goals

- Keep Markdown content in a single editor service.
- Let hosts provide load/save/link behavior through adapters.
- Let plugins contribute commands and CodeMirror extensions.

Try **bold**, *italic*, \`inline code\`, tasks, and split mode.

- [ ] Build host adapter
- [ ] Keep editor UI independent
- [ ] Let ofive consume the service contract
`;

export function App() {
  const [savedContent, setSavedContent] = useState(initialContent);
  const adapter = useMemo<EditorHostAdapter>(() => ({
    saveDocument: async (document) => {
      setSavedContent(document.content);
    },
    log: (level, message, context) => {
      console[level === "debug" ? "info" : level]("[editor-demo]", message, context ?? {});
    },
  }), []);
  const service = useMemo(() => createEditorService({
    document: {
      id: "demo",
      path: "demo.md",
      title: "demo.md",
      content: initialContent,
    },
    adapter,
    plugins: createDefaultMarkdownPlugins(),
  }), [adapter]);

  return (
    <main className="demo-shell">
      <section className="demo-sidebar">
        <h1>ofive/editor</h1>
        <p>Generic Markdown editor service, plugin interface, and React surface.</p>
        <div className="demo-saved">
          <strong>Last saved</strong>
          <span>{savedContent.length} chars</span>
        </div>
      </section>
      <section className="demo-editor-frame">
        <UniversalMarkdownEditor service={service} />
      </section>
    </main>
  );
}
