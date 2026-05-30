import { describe, expect, it } from "bun:test";
import { createEditorService } from "obeditor";
import {
    resolveEditorServiceDocumentTitle,
    syncEditorServiceDocument,
} from "./editorServiceDocumentBridge";

describe("editorServiceDocumentBridge", () => {
    it("resolves a fallback title from the document path", () => {
        expect(resolveEditorServiceDocumentTitle("notes/project/brief.md")).toBe("brief.md");
    });

    it("publishes authoritative ofive document state without keeping local edits dirty", () => {
        const service = createEditorService({
            document: {
                id: "old",
                path: "notes/old.md",
                content: "# Old",
            },
        });
        service.updateContent("# Unsaved local edit");
        expect(service.getSnapshot().dirty).toBe(true);

        syncEditorServiceDocument({
            editorService: service,
            articleId: "article-a",
            path: "notes/a.md",
            content: "# A",
        });

        const snapshot = service.getSnapshot();
        expect(snapshot.document.id).toBe("article-a");
        expect(snapshot.document.path).toBe("notes/a.md");
        expect(snapshot.document.title).toBe("a.md");
        expect(snapshot.document.content).toBe("# A");
        expect(snapshot.dirty).toBe(false);
    });
});
