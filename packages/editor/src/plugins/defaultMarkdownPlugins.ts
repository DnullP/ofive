import type { EditorPlugin } from "../core/types";
import { createLinkOpenPlugin } from "./linkOpenPlugin";
import { createMarkdownFormattingPlugin } from "./markdownFormattingPlugin";

export function createDefaultMarkdownPlugins(): EditorPlugin[] {
  return [
    createMarkdownFormattingPlugin(),
    createLinkOpenPlugin(),
  ];
}
