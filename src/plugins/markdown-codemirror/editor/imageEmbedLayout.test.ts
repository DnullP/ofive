/**
 * @module plugins/markdown-codemirror/editor/imageEmbedLayout.test
 * @description Image embed layout helper tests.
 * @dependencies
 *  - bun:test
 *  - ./imageEmbedLayout
 */

import { describe, expect, test } from "bun:test";
import {
    parseImageEmbedTarget,
    serializeImageEmbedSyntax,
    serializeImageEmbedTarget,
} from "./imageEmbedLayout";

describe("imageEmbedLayout", () => {
    test("parses plain image targets without layout", () => {
        expect(parseImageEmbedTarget("Images/demo.png")).toEqual({
            target: "Images/demo.png",
            layout: null,
        });
    });

    test("parses width and height suffix", () => {
        expect(parseImageEmbedTarget("Images/demo.png|640x360")).toEqual({
            target: "Images/demo.png",
            layout: {
                width: 640,
                height: 360,
            },
        });
    });

    test("parses width-only suffix", () => {
        expect(parseImageEmbedTarget("Images/demo.png|420")).toEqual({
            target: "Images/demo.png",
            layout: {
                width: 420,
            },
        });
    });

    test("serializes target and full embed syntax", () => {
        expect(serializeImageEmbedTarget("Images/demo.png", { width: 512, height: 288 })).toBe("Images/demo.png|512x288");
        expect(serializeImageEmbedSyntax("Images/demo.png", { width: 512, height: 288 })).toBe("![[Images/demo.png|512x288]]");
    });
});
