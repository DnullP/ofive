import { describe, expect, it, mock } from "bun:test";
import { createEditorService } from "./editorService";
import type { EditorPlugin } from "./types";

describe("createEditorService", () => {
  it("tracks dirty state after content changes and clears it after save", async () => {
    const saved: string[] = [];
    const service = createEditorService({
      document: {
        id: "demo",
        content: "# Demo",
      },
      adapter: {
        saveDocument: async (document) => {
          saved.push(document.content);
        },
        now: () => 100,
      },
    });

    service.updateContent("# Demo\n\nUpdated");

    expect(service.getSnapshot().dirty).toBe(true);
    await service.save();
    expect(saved).toEqual(["# Demo\n\nUpdated"]);
    expect(service.getSnapshot().dirty).toBe(false);
  });

  it("loads documents through the host adapter", async () => {
    const service = createEditorService({
      adapter: {
        loadDocument: async (ref) => ({
          id: ref.id,
          path: ref.path,
          title: "Loaded",
          content: "loaded content",
        }),
      },
    });

    await service.loadDocument({ id: "a", path: "notes/a.md" });

    expect(service.getSnapshot().document.content).toBe("loaded content");
    expect(service.getSnapshot().document.path).toBe("notes/a.md");
    expect(service.getSnapshot().dirty).toBe(false);
  });

  it("publishes authoritative document replacements without making the editor dirty", () => {
    const changed = mock(() => undefined);
    const service = createEditorService({
      document: { id: "demo", path: "notes/demo.md", content: "# Old" },
      adapter: {
        onDocumentChanged: changed,
      },
    });

    service.setDocument({
      id: "demo",
      path: "notes/demo.md",
      content: "# New",
    });

    expect(service.getSnapshot().document.content).toBe("# New");
    expect(service.getSnapshot().dirty).toBe(false);
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it("can attach a view without reporting focus during host-controlled mounting", () => {
    const focused = mock(() => undefined);
    const service = createEditorService({
      document: { id: "demo", content: "# Demo" },
      adapter: {
        onDocumentFocused: focused,
      },
    });
    const view = {} as never;

    service.attachView(view, { notifyFocus: false });
    expect(focused).not.toHaveBeenCalled();

    service.attachView(view);
    expect(focused).toHaveBeenCalledTimes(1);
  });

  it("installs plugin commands through the generic plugin contract", async () => {
    const plugin: EditorPlugin = {
      id: "test-plugin",
      setup() {
        return {
          commands: [
            {
              id: "test.append",
              label: "Append",
              run: ({ document, updateContent }) => updateContent(`${document.content}!`, "test"),
            },
          ],
        };
      },
    };
    const service = createEditorService({
      document: { id: "demo", content: "hello" },
      plugins: [plugin],
    });

    await service.executeCommand("test.append");

    expect(service.getSnapshot().document.content).toBe("hello!");
    expect(service.getSnapshot().pluginIds).toEqual(["test-plugin"]);
  });
});
