import { keymap } from "@codemirror/view";
import type { EditorPlugin } from "../core/types";

function extractWikiLinkAt(content: string, position: number): string | null {
  const pattern = /\[\[([^\]]+)\]\]/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content))) {
    const from = match.index;
    const to = from + match[0].length;
    if (position >= from && position <= to) {
      return match[1]?.trim() || null;
    }
  }
  return null;
}

export function createLinkOpenPlugin(): EditorPlugin {
  return {
    id: "link-open",
    setup(context) {
      return {
        commands: [
          {
            id: "editor.openLinkAtCursor",
            label: "Open link",
            group: "navigate",
            icon: "external-link",
            isEnabled: ({ host }) => Boolean(host.resolveLink),
            run: async ({ view, document, host }) => {
              if (!view || !host.resolveLink) {
                return;
              }
              const target = extractWikiLinkAt(document.content, view.state.selection.main.from);
              if (target) {
                await host.resolveLink(target, document);
              }
            },
          },
        ],
        codeMirrorExtensions: [
          keymap.of([
            {
              key: "Mod-Enter",
              run(view) {
                void context.getSnapshot();
                const service = context.getSnapshot();
                const target = extractWikiLinkAt(service.document.content, view.state.selection.main.from);
                if (!target || !context.host.resolveLink) {
                  return false;
                }
                void context.host.resolveLink(target, service.document);
                return true;
              },
            },
          ]),
        ],
      };
    },
  };
}
