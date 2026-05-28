import { describe, expect, test } from "bun:test";
import { readOfiveWindowBootstrap } from "./windowApi";

function encodeUrlSafeJson(value: unknown): string {
    const json = JSON.stringify(value);
    const bytes = new TextEncoder().encode(json);
    let binary = "";
    for (const byte of bytes) {
        binary += String.fromCharCode(byte);
    }
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

describe("windowApi bootstrap parsing", () => {
    test("defaults to the main window when no detached params exist", () => {
        expect(readOfiveWindowBootstrap("http://localhost/")).toEqual({
            kind: "main",
            initialTab: null,
        });
    });

    test("reads a detached initial tab from URL-safe base64 JSON", () => {
        const encodedTab = encodeUrlSafeJson({
            id: "note-1",
            title: "Note 1",
            component: "codemirror",
            params: { path: "Notes/Note 1.md" },
        });

        expect(readOfiveWindowBootstrap(`http://localhost/?ofiveWindow=detached&ofiveInitialTab=${encodedTab}`)).toEqual({
            kind: "detached",
            initialTab: {
                id: "note-1",
                title: "Note 1",
                component: "codemirror",
                params: { path: "Notes/Note 1.md" },
            },
        });
    });

    test("keeps detached mode but drops malformed initial tab payloads", () => {
        expect(readOfiveWindowBootstrap("http://localhost/?ofiveWindow=detached&ofiveInitialTab=not-json")).toEqual({
            kind: "detached",
            initialTab: null,
        });
    });
});
