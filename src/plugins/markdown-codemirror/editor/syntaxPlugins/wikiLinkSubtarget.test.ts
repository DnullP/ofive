import { describe, expect, test } from "bun:test";
import {
    parseWikiLinkTarget,
    resolveWikiLinkSubtarget,
} from "./wikiLinkSubtarget";

describe("wikiLinkSubtarget", () => {
    test("parses line, title, and paragraph fragments", () => {
        expect(parseWikiLinkTarget("Guide#L42")).toEqual({
            noteTarget: "Guide",
            subtarget: { kind: "line", line: 42, raw: "L42" },
        });
        expect(parseWikiLinkTarget("Guide#line:12")).toEqual({
            noteTarget: "Guide",
            subtarget: { kind: "line", line: 12, raw: "line:12" },
        });
        expect(parseWikiLinkTarget("Guide#Install Docker")).toEqual({
            noteTarget: "Guide",
            subtarget: { kind: "title", title: "Install Docker", raw: "Install Docker" },
        });
        expect(parseWikiLinkTarget("Guide#title:L42")).toEqual({
            noteTarget: "Guide",
            subtarget: { kind: "title", title: "L42", raw: "title:L42" },
        });
        expect(parseWikiLinkTarget("Guide#P3")).toEqual({
            noteTarget: "Guide",
            subtarget: { kind: "paragraph", index: 3, raw: "P3" },
        });
        expect(parseWikiLinkTarget("Guide#paragraph:2")).toEqual({
            noteTarget: "Guide",
            subtarget: { kind: "paragraph", index: 2, raw: "paragraph:2" },
        });
    });

    test("resolves subtargets to original markdown lines and offsets", () => {
        const markdown = [
            "---",
            "title: Demo",
            "---",
            "# Overview",
            "",
            "First paragraph.",
            "still first paragraph.",
            "",
            "## Install **Docker**",
            "",
            "Second paragraph.",
            "",
            "```ts",
            "# Ignored",
            "```",
            "",
            "Third paragraph.",
        ].join("\n");

        expect(resolveWikiLinkSubtarget(markdown, { kind: "line", line: 11, raw: "L11" })).toEqual({
            line: 11,
            offset: markdown.indexOf("Second paragraph."),
        });
        expect(resolveWikiLinkSubtarget(markdown, { kind: "title", title: "Install Docker", raw: "Install Docker" })).toEqual({
            line: 9,
            offset: markdown.indexOf("## Install"),
        });
        expect(resolveWikiLinkSubtarget(markdown, { kind: "paragraph", index: 3, raw: "P3" })).toEqual({
            line: 17,
            offset: markdown.indexOf("Third paragraph."),
        });
    });
});
