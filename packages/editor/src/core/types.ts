import type { Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";

export type EditorMode = "edit" | "read" | "split";
export type EditorStatus = "idle" | "loading" | "saving" | "error";

export interface EditorDocument {
  id: string;
  content: string;
  path?: string;
  title?: string;
  language: "markdown" | string;
  version: number;
  savedVersion: number;
  updatedAt: number;
  metadata?: Record<string, unknown>;
}

export interface EditorDocumentRef {
  id?: string;
  path?: string;
  title?: string;
  content?: string;
  metadata?: Record<string, unknown>;
}

export interface EditorCommandDescriptor {
  id: string;
  label: string;
  group?: string;
  icon?: string;
  enabled: boolean;
}

export interface EditorSnapshot {
  document: EditorDocument;
  mode: EditorMode;
  status: EditorStatus;
  dirty: boolean;
  error: string | null;
  pluginIds: string[];
  commands: EditorCommandDescriptor[];
}

export interface EditorViewAttachOptions {
  notifyFocus?: boolean;
}

export interface EditorHostAdapter {
  loadDocument?: (ref: EditorDocumentRef) => Promise<Partial<EditorDocument> & { content: string }>;
  saveDocument?: (document: EditorDocument, snapshot: EditorSnapshot) => Promise<Partial<EditorDocument> | void>;
  onDocumentChanged?: (document: EditorDocument, snapshot: EditorSnapshot) => void;
  onDocumentFocused?: (document: EditorDocument, snapshot: EditorSnapshot) => void;
  onModeChanged?: (mode: EditorMode, snapshot: EditorSnapshot) => void;
  resolveLink?: (target: string, sourceDocument: EditorDocument) => Promise<void> | void;
  log?: (level: "debug" | "info" | "warn" | "error", message: string, context?: Record<string, unknown>) => void;
  now?: () => number;
}

export interface EditorCommandContext {
  service: EditorService;
  document: EditorDocument;
  snapshot: EditorSnapshot;
  host: EditorHostAdapter;
  view: EditorView | null;
  updateContent: (content: string, reason?: string) => void;
}

export interface EditorCommand {
  id: string;
  label: string;
  group?: string;
  icon?: string;
  run: (context: EditorCommandContext) => void | Promise<void>;
  isEnabled?: (context: Omit<EditorCommandContext, "updateContent">) => boolean;
}

export interface EditorPluginContext {
  host: EditorHostAdapter;
  getSnapshot: () => EditorSnapshot;
  updateContent: (content: string, reason?: string) => void;
  setMode: (mode: EditorMode) => void;
  registerCommand: (command: EditorCommand) => () => void;
  registerCodeMirrorExtension: (extension: Extension) => () => void;
}

export interface EditorPluginContribution {
  commands?: EditorCommand[];
  codeMirrorExtensions?: Extension[];
  dispose?: () => void;
}

export interface EditorPlugin {
  id: string;
  setup: (context: EditorPluginContext) => EditorPluginContribution | (() => void) | void;
}

export interface EditorServiceOptions {
  document?: Partial<EditorDocument> & Pick<EditorDocument, "content">;
  mode?: EditorMode;
  adapter?: EditorHostAdapter;
  plugins?: EditorPlugin[];
}

export interface EditorService {
  getSnapshot: () => EditorSnapshot;
  subscribe: (listener: () => void) => () => void;
  loadDocument: (ref: EditorDocumentRef) => Promise<void>;
  setDocument: (document: Partial<EditorDocument> & Pick<EditorDocument, "content">) => void;
  updateContent: (content: string, reason?: string) => void;
  save: () => Promise<void>;
  setMode: (mode: EditorMode) => void;
  executeCommand: (commandId: string) => Promise<void>;
  getCodeMirrorExtensions: () => Extension[];
  attachView: (view: EditorView | null, options?: EditorViewAttachOptions) => void;
  dispose: () => void;
}
