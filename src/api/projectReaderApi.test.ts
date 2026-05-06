import { describe, expect, test } from "bun:test";
import { resolveProjectReaderSymbol } from "./projectReaderApi";

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
});
