/**
 * @module host/editor/ofiveEditorService.test
 * @description 验证 ofive 默认 editor service adapter 会把通用编辑器事件接回注入的 host 依赖。
 */

import { beforeEach, describe, expect, it, mock } from "bun:test";
import { createDefaultOfiveEditorService } from "./ofiveEditorService";

const readMarkdownMock = mock(async (relativePath: string) => `# Loaded ${relativePath}`);
const saveMarkdownMock = mock(async () => undefined);
const reportArticleFocusMock = mock(() => undefined);
const reportArticleContentMock = mock(() => undefined);
const reportActiveEditorMock = mock(() => undefined);
const updateDisplayModeMock = mock(() => undefined);
const logMock = mock(() => undefined);

describe("createDefaultOfiveEditorService", () => {
    beforeEach(() => {
        readMarkdownMock.mockClear();
        saveMarkdownMock.mockClear();
        reportArticleFocusMock.mockClear();
        reportArticleContentMock.mockClear();
        reportActiveEditorMock.mockClear();
        updateDisplayModeMock.mockClear();
        logMock.mockClear();
    });

    it("loads, reports, saves, and maps mode changes through injected ofive bridge dependencies", async () => {
        const service = createDefaultOfiveEditorService({
            articleId: "tab:notes/a.md",
            path: "notes/a.md",
            content: "# Initial",
            dependencies: {
                readMarkdown: readMarkdownMock,
                saveMarkdown: saveMarkdownMock,
                reportArticleFocus: reportArticleFocusMock,
                reportArticleContent: reportArticleContentMock,
                reportActiveEditor: reportActiveEditorMock,
                updateDisplayMode: updateDisplayModeMock,
                log: logMock,
            },
        });

        await service.loadDocument({ id: "tab:notes/a.md", path: "notes/a.md" });
        expect(readMarkdownMock).toHaveBeenCalledWith("notes/a.md");
        expect(service.getSnapshot().document.content).toBe("# Loaded notes/a.md");

        service.updateContent("# Updated", "test");
        expect(reportArticleContentMock).toHaveBeenCalledWith({
            articleId: "tab:notes/a.md",
            path: "notes/a.md",
            content: "# Updated",
        });

        await service.save();
        expect(saveMarkdownMock).toHaveBeenCalledWith("notes/a.md", "# Updated", undefined);

        service.setMode("read");
        expect(updateDisplayModeMock).toHaveBeenCalledWith("read");
    });
});
