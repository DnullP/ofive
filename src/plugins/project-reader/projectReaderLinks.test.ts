import { describe, expect, test } from "bun:test";
import {
    buildProjectReaderTabDefinitionFromLocation,
    buildProjectReaderSymbolResolveContext,
    buildProjectReaderTabId,
    buildProjectReaderWikiLinkMarkup,
    buildProjectReaderWikiLinkTarget,
    parseProjectReaderWikiLinkTarget,
    resolveProjectReaderWikiLinkPreview,
} from "./projectReaderLinks";

describe("projectReaderLinks", () => {
    test("parses project wikilink target with line number", () => {
        expect(parseProjectReaderWikiLinkTarget("ofive:/src/main.ts:12")).toEqual({
            projectName: "ofive",
            relativePath: "src/main.ts",
            lineNumber: 12,
            columnNumber: null,
            endLineNumber: null,
            endColumnNumber: null,
        });
    });

    test("parses project wikilink target with range", () => {
        expect(parseProjectReaderWikiLinkTarget("ofive:/src/main.ts:12:4-14:8")).toEqual({
            projectName: "ofive",
            relativePath: "src/main.ts",
            lineNumber: 12,
            columnNumber: 4,
            endLineNumber: 14,
            endColumnNumber: 8,
        });
    });

    test("parses project wikilink target without line number", () => {
        expect(parseProjectReaderWikiLinkTarget("ofive:/src/main.ts")).toEqual({
            projectName: "ofive",
            relativePath: "src/main.ts",
            lineNumber: null,
            columnNumber: null,
            endLineNumber: null,
            endColumnNumber: null,
        });
    });

    test("rejects normal vault wikilink target", () => {
        expect(parseProjectReaderWikiLinkTarget("daily/note")).toBeNull();
        expect(parseProjectReaderWikiLinkTarget("ofive:src/main.ts")).toBeNull();
    });

    test("builds stable project file tab id", () => {
        expect(buildProjectReaderTabId("project-1", "/src/main.ts")).toBe(
            "project-reader:project-1:src%2Fmain.ts",
        );
    });

    test("formats project wikilink target and markup with range", () => {
        expect(buildProjectReaderWikiLinkTarget("ofive", "/src/main.ts", {
            lineNumber: 12,
            columnNumber: 4,
            endLineNumber: 14,
            endColumnNumber: 8,
        })).toBe("ofive:/src/main.ts:12:4-14:8");
        expect(buildProjectReaderWikiLinkMarkup("ofive", "/src/main.ts", "selected text", {
            lineNumber: 12,
            columnNumber: 4,
            endLineNumber: 14,
            endColumnNumber: 8,
        })).toBe("[[ofive:/src/main.ts:12:4-14:8|selected text]]");
    });

    test("formats target-only project wikilink markup", () => {
        expect(buildProjectReaderWikiLinkMarkup("ofive", "/src/main.ts", "", {
            lineNumber: 12,
            columnNumber: 4,
            endLineNumber: 12,
            endColumnNumber: 18,
        })).toBe("[[ofive:/src/main.ts:12:4-12:18]]");
    });

    test("builds symbol location tab params with exact column range", () => {
        const tab = buildProjectReaderTabDefinitionFromLocation(
            {
                id: "project-1",
                name: "ofive",
                rootPath: "/tmp/ofive",
                createdAtUnixMs: 1,
                updatedAtUnixMs: 1,
            },
            {
                projectId: "project-1",
                relativePath: "src/main.ts",
                lineNumber: 7,
                columnNumber: 17,
                symbolName: "createMainRuntime",
                kind: "definition",
                preview: "export function createMainRuntime() {}",
        },
        );

        expect(tab.params).toMatchObject({
            lineNumber: 7,
            columnNumber: 17,
            endLineNumber: 7,
            endColumnNumber: 34,
        });
    });

    test("builds symbol resolve context from current code location", () => {
        expect(buildProjectReaderSymbolResolveContext(
            "src/main.ts",
            7,
            12,
            "memory.Service",
            "export interface Service {}",
        )).toEqual({
            currentFilePath: "src/main.ts",
            currentLineNumber: 7,
            currentColumnNumber: 12,
            currentLineText: "memory.Service",
            currentFileContent: "export interface Service {}",
        });
    });

    test("resolves project wikilink preview from referenced source range", async () => {
        const preview = await resolveProjectReaderWikiLinkPreview(
            "mock-ofive:/src/main.ts:7:1-9:1",
        );

        expect(preview).not.toBeNull();
        expect(preview?.resolvedPath).toBe("mock-ofive:/src/main.ts:7:1-9:1");
        expect(preview?.language).toBe("typescript");
        expect(preview?.snippetLines.map((line) => line.lineNumber)).toEqual([7, 8, 9]);
        expect(preview?.content).toContain("export function createMainRuntime(): AppRuntime");
        expect(preview?.content).toContain("return createApp();");
    });
});
