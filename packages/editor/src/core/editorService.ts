import type { Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type {
  EditorCommand,
  EditorCommandDescriptor,
  EditorDocument,
  EditorDocumentRef,
  EditorHostAdapter,
  EditorMode,
  EditorPlugin,
  EditorPluginContext,
  EditorService,
  EditorServiceOptions,
  EditorSnapshot,
  EditorStatus,
  EditorViewAttachOptions,
} from "./types";

const DEFAULT_DOCUMENT_ID = "document:untitled";

function fallbackNow(): number {
  return Date.now();
}

function createInitialDocument(
  input: EditorServiceOptions["document"],
  now: number,
): EditorDocument {
  const content = input?.content ?? "";
  const id = input?.id ?? input?.path ?? DEFAULT_DOCUMENT_ID;
  const version = input?.version ?? 1;

  return {
    id,
    content,
    path: input?.path,
    title: input?.title ?? input?.path?.split("/").pop() ?? "Untitled",
    language: input?.language ?? "markdown",
    version,
    savedVersion: input?.savedVersion ?? version,
    updatedAt: input?.updatedAt ?? now,
    metadata: input?.metadata,
  };
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

class EditorServiceImpl implements EditorService {
  private document: EditorDocument;
  private mode: EditorMode;
  private status: EditorStatus = "idle";
  private error: string | null = null;
  private readonly host: EditorHostAdapter;
  private readonly listeners = new Set<() => void>();
  private readonly commands = new Map<string, EditorCommand>();
  private readonly codeMirrorExtensions: Extension[] = [];
  private readonly pluginIds: string[] = [];
  private readonly disposers: Array<() => void> = [];
  private view: EditorView | null = null;

  constructor(options: EditorServiceOptions = {}) {
    this.host = options.adapter ?? {};
    this.document = createInitialDocument(options.document, this.now());
    this.mode = options.mode ?? "edit";
    this.installPlugins(options.plugins ?? []);
  }

  getSnapshot(): EditorSnapshot {
    const snapshotBase = {
      document: this.document,
      mode: this.mode,
      status: this.status,
      dirty: this.document.version !== this.document.savedVersion,
      error: this.error,
      pluginIds: [...this.pluginIds],
    };

    return {
      ...snapshotBase,
      commands: this.getCommandDescriptors(snapshotBase as Omit<EditorSnapshot, "commands">),
    };
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async loadDocument(ref: EditorDocumentRef): Promise<void> {
    if (!this.host.loadDocument) {
      this.setDocument({
        id: ref.id,
        path: ref.path,
        title: ref.title,
        content: ref.content ?? "",
        metadata: ref.metadata,
      });
      return;
    }

    this.status = "loading";
    this.error = null;
    this.emit();

    try {
      const loaded = await this.host.loadDocument(ref);
      this.document = this.normalizeLoadedDocument(loaded, ref);
      this.status = "idle";
      this.host.onDocumentChanged?.(this.document, this.getSnapshot());
      this.emit();
    } catch (error) {
      this.status = "error";
      this.error = toErrorMessage(error);
      this.log("error", "Failed to load editor document", { error: this.error });
      this.emit();
    }
  }

  setDocument(document: Partial<EditorDocument> & Pick<EditorDocument, "content">): void {
    this.document = this.normalizeLoadedDocument(document, document);
    this.status = "idle";
    this.error = null;
    this.host.onDocumentChanged?.(this.document, this.getSnapshot());
    this.emit();
  }

  updateContent(content: string, reason = "edit"): void {
    if (content === this.document.content) {
      return;
    }

    this.document = {
      ...this.document,
      content,
      version: this.document.version + 1,
      updatedAt: this.now(),
    };
    this.error = null;
    this.host.onDocumentChanged?.(this.document, this.getSnapshot());
    this.log("debug", "Editor content updated", {
      documentId: this.document.id,
      reason,
      version: this.document.version,
    });
    this.emit();
  }

  async save(): Promise<void> {
    this.status = "saving";
    this.error = null;
    this.emit();

    try {
      const result = await this.host.saveDocument?.(this.document, this.getSnapshot());
      this.document = {
        ...this.document,
        ...result,
        content: result?.content ?? this.document.content,
        version: result?.version ?? this.document.version,
        savedVersion: result?.version ?? this.document.version,
        updatedAt: this.now(),
      };
      this.status = "idle";
      this.emit();
    } catch (error) {
      this.status = "error";
      this.error = toErrorMessage(error);
      this.log("error", "Failed to save editor document", { error: this.error });
      this.emit();
    }
  }

  setMode(mode: EditorMode): void {
    if (this.mode === mode) {
      return;
    }

    this.mode = mode;
    const snapshot = this.getSnapshot();
    this.host.onModeChanged?.(mode, snapshot);
    this.emit();
  }

  async executeCommand(commandId: string): Promise<void> {
    const command = this.commands.get(commandId);
    if (!command) {
      this.log("warn", "Editor command not found", { commandId });
      return;
    }

    const snapshot = this.getSnapshot();
    const context = {
      service: this,
      document: snapshot.document,
      snapshot,
      host: this.host,
      view: this.view,
    };
    if (command.isEnabled && !command.isEnabled(context)) {
      return;
    }

    await command.run({
      ...context,
      updateContent: (content, reason) => this.updateContent(content, reason),
    });
  }

  getCodeMirrorExtensions(): Extension[] {
    return [...this.codeMirrorExtensions];
  }

  attachView(view: EditorView | null, options: EditorViewAttachOptions = {}): void {
    this.view = view;
    if (view && options.notifyFocus !== false) {
      this.host.onDocumentFocused?.(this.document, this.getSnapshot());
    }
  }

  dispose(): void {
    this.disposers.splice(0).reverse().forEach((dispose) => dispose());
    this.listeners.clear();
    this.commands.clear();
    this.codeMirrorExtensions.splice(0);
    this.view = null;
  }

  private installPlugins(plugins: EditorPlugin[]): void {
    plugins.forEach((plugin) => {
      this.pluginIds.push(plugin.id);
      const context: EditorPluginContext = {
        host: this.host,
        getSnapshot: () => this.getSnapshot(),
        updateContent: (content, reason) => this.updateContent(content, reason),
        setMode: (mode) => this.setMode(mode),
        registerCommand: (command) => this.registerCommand(command),
        registerCodeMirrorExtension: (extension) => this.registerCodeMirrorExtension(extension),
      };
      const contribution = plugin.setup(context);
      this.installContribution(contribution);
    });
  }

  private installContribution(contribution: ReturnType<EditorPlugin["setup"]>): void {
    if (!contribution) {
      return;
    }

    if (typeof contribution === "function") {
      this.disposers.push(contribution);
      return;
    }

    contribution.commands?.forEach((command) => {
      this.disposers.push(this.registerCommand(command));
    });
    contribution.codeMirrorExtensions?.forEach((extension) => {
      this.disposers.push(this.registerCodeMirrorExtension(extension));
    });
    if (contribution.dispose) {
      this.disposers.push(contribution.dispose);
    }
  }

  private registerCommand(command: EditorCommand): () => void {
    this.commands.set(command.id, command);
    this.emit();
    return () => {
      this.commands.delete(command.id);
      this.emit();
    };
  }

  private registerCodeMirrorExtension(extension: Extension): () => void {
    this.codeMirrorExtensions.push(extension);
    this.emit();
    return () => {
      const index = this.codeMirrorExtensions.indexOf(extension);
      if (index >= 0) {
        this.codeMirrorExtensions.splice(index, 1);
        this.emit();
      }
    };
  }

  private normalizeLoadedDocument(
    loaded: Partial<EditorDocument> & Pick<EditorDocument, "content">,
    fallback: EditorDocumentRef,
  ): EditorDocument {
    const version = loaded.version ?? this.document?.version + 1 ?? 1;
    return {
      id: loaded.id ?? fallback.id ?? loaded.path ?? fallback.path ?? DEFAULT_DOCUMENT_ID,
      content: loaded.content,
      path: loaded.path ?? fallback.path,
      title: loaded.title ?? fallback.title ?? loaded.path?.split("/").pop() ?? fallback.path?.split("/").pop() ?? "Untitled",
      language: loaded.language ?? "markdown",
      version,
      savedVersion: loaded.savedVersion ?? version,
      updatedAt: loaded.updatedAt ?? this.now(),
      metadata: loaded.metadata ?? fallback.metadata,
    };
  }

  private getCommandDescriptors(snapshot: Omit<EditorSnapshot, "commands">): EditorCommandDescriptor[] {
    return Array.from(this.commands.values()).map((command) => ({
      id: command.id,
      label: command.label,
      group: command.group,
      icon: command.icon,
      enabled: command.isEnabled
        ? command.isEnabled({
          service: this,
          document: snapshot.document,
          snapshot: snapshot as EditorSnapshot,
          host: this.host,
          view: this.view,
        })
        : true,
    }));
  }

  private emit(): void {
    this.listeners.forEach((listener) => listener());
  }

  private now(): number {
    return this.host.now?.() ?? fallbackNow();
  }

  private log(level: "debug" | "info" | "warn" | "error", message: string, context?: Record<string, unknown>): void {
    this.host.log?.(level, message, context);
  }
}

export function createEditorService(options: EditorServiceOptions = {}): EditorService {
  return new EditorServiceImpl(options);
}
