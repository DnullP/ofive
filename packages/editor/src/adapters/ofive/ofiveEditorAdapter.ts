import { createEditorService } from "../../core/editorService";
import type {
  EditorDocument,
  EditorHostAdapter,
  EditorMode,
  EditorPlugin,
  EditorService,
} from "../../core/types";

export interface OfiveEditorHostBridge {
  readMarkdown: (relativePath: string) => Promise<string>;
  saveMarkdown: (relativePath: string, content: string) => Promise<void>;
  reportArticleFocus?: (payload: { articleId: string; path: string; content: string }) => void;
  reportArticleContent?: (payload: { articleId: string; path: string; content: string }) => void;
  reportActiveEditor?: (payload: { articleId: string; path: string }) => void;
  updateDisplayMode?: (mode: Extract<EditorMode, "edit" | "read">) => void;
  log?: EditorHostAdapter["log"];
}

export interface OfiveEditorServiceOptions {
  articleId: string;
  path: string;
  title?: string;
  content?: string;
  mode?: EditorMode;
  bridge: OfiveEditorHostBridge;
  plugins?: EditorPlugin[];
}

export function createOfiveEditorHostAdapter(
  bridge: OfiveEditorHostBridge,
): EditorHostAdapter {
  return {
    async loadDocument(ref) {
      const relativePath = ref.path ?? ref.id;
      if (!relativePath) {
        throw new Error("Cannot load an ofive editor document without a path or id.");
      }

      return {
        id: ref.id ?? relativePath,
        path: relativePath,
        title: ref.title ?? relativePath.split("/").pop() ?? relativePath,
        content: await bridge.readMarkdown(relativePath),
      };
    },
    async saveDocument(document) {
      if (!document.path) {
        throw new Error("Cannot save an ofive editor document without a path.");
      }

      await bridge.saveMarkdown(document.path, document.content);
      return {
        savedVersion: document.version,
      };
    },
    onDocumentChanged(document) {
      if (!document.path) {
        return;
      }

      bridge.reportArticleContent?.({
        articleId: document.id,
        path: document.path,
        content: document.content,
      });
    },
    onDocumentFocused(document) {
      if (!document.path) {
        return;
      }

      const payload = {
        articleId: document.id,
        path: document.path,
        content: document.content,
      };
      bridge.reportArticleFocus?.(payload);
      bridge.reportActiveEditor?.({
        articleId: document.id,
        path: document.path,
      });
    },
    onModeChanged(mode) {
      if (mode === "split") {
        bridge.updateDisplayMode?.("edit");
        return;
      }

      bridge.updateDisplayMode?.(mode);
    },
    log: bridge.log,
  };
}

export function createOfiveEditorDocument(
  options: Pick<OfiveEditorServiceOptions, "articleId" | "path" | "title" | "content">,
): EditorDocument {
  return {
    id: options.articleId,
    path: options.path,
    title: options.title ?? options.path.split("/").pop() ?? options.path,
    content: options.content ?? "",
    language: "markdown",
    version: 1,
    savedVersion: 1,
    updatedAt: Date.now(),
  };
}

export function createOfiveMarkdownEditorService(
  options: OfiveEditorServiceOptions,
): EditorService {
  return createEditorService({
    document: createOfiveEditorDocument(options),
    mode: options.mode,
    adapter: createOfiveEditorHostAdapter(options.bridge),
    plugins: options.plugins,
  });
}
