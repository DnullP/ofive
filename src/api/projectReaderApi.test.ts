import { describe, expect, test } from "bun:test";
import { resolveProjectReaderSymbol, searchProjectReader } from "./projectReaderApi";

describe("projectReaderApi browser fallback", () => {
    test("resolves qualified service symbol to matching package path", async () => {
        const response = await resolveProjectReaderSymbol("mock-ofive-project", "Service", {
            currentFilePath: "src/runner.ts",
            currentLineNumber: 4,
            currentColumnNumber: 25,
            currentLineText: "  memoryService: memory.Service;",
        });

        expect(response.locations.map((location) => location.relativePath)).toEqual([
            "src/memory/service.ts",
        ]);
        expect(response.locations).toHaveLength(1);
    });

    test("searches mock project text content", async () => {
        const response = await searchProjectReader("mock-ofive-project", "createMainRuntime", "text", 10);

        expect(response.mode).toBe("text");
        expect(response.matches.some((match) =>
            match.relativePath === "src/main.ts" && match.preview.includes("createMainRuntime"),
        )).toBe(true);
    });

    test("searches mock project symbols", async () => {
        const response = await searchProjectReader("mock-ofive-project", "Runtime", "symbol", 10);

        expect(response.mode).toBe("symbol");
        expect(response.matches.map((match) => match.relativePath)).toContain("src/main.ts");
        expect(response.matches.map((match) => match.relativePath)).toContain("src/runtime.ts");
    });

    test("searches mock project ast-grep patterns", async () => {
        const response = await searchProjectReader(
            "mock-ofive-project",
            "function $NAME() { $$$BODY }",
            "astGrep",
            10,
        );

        expect(response.mode).toBe("astGrep");
        expect(response.matches.some((match) =>
            match.kind === "ast-grep:mock" && match.preview.includes("function"),
        )).toBe(true);
    });
});
