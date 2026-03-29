/**
 * @module plugins/canvas/canvasDocument.test
 * @description Canvas 文档适配层单元测试。
 */

import { describe, expect, test } from "bun:test";
import {
    createFileNode,
    createGroupNode,
    createTextNode,
    parseCanvasDocument,
    serializeCanvasDocument,
} from "./canvasDocument";

describe("canvasDocument", () => {
    test("should parse obsidian canvas json into runtime document", () => {
        const document = parseCanvasDocument(`{
  "nodes": [
    {
      "id": "text-1",
      "type": "text",
      "x": 12,
      "y": 24,
      "width": 300,
      "height": 180,
      "text": "hello"
    },
    {
      "id": "file-1",
      "type": "file",
      "x": 40,
      "y": 64,
      "width": 260,
      "height": 120,
      "file": "notes/guide.md"
    }
  ],
  "edges": [
    {
      "id": "edge-1",
      "fromNode": "text-1",
      "fromSide": "right",
      "toNode": "file-1",
      "toSide": "left",
      "label": "relates"
    }
  ]
}`);

        expect(document.nodes).toHaveLength(2);
        expect(document.nodes[0]?.data.kind).toBe("text");
        expect(document.nodes[1]?.data.filePath).toBe("notes/guide.md");
        expect(document.edges[0]?.sourceHandle).toBe("right");
        expect(document.edges[0]?.targetHandle).toBe("left");
    });

    test("should serialize runtime document into obsidian canvas json", () => {
        const serialized = serializeCanvasDocument({
            nodes: [
                createTextNode("text-1", 10, 20),
                createFileNode("file-1", 30, 40, "notes/guide.md"),
                createGroupNode("group-1", 50, 60),
            ],
            edges: [
                {
                    id: "edge-1",
                    source: "text-1",
                    target: "file-1",
                    sourceHandle: "bottom",
                    targetHandle: "top",
                    data: {
                        label: "linked",
                        color: "#475569",
                    },
                },
            ],
            metadata: {
                title: "Roadmap",
            },
        });

        const parsed = JSON.parse(serialized) as {
            metadata?: { title?: string };
            nodes?: Array<Record<string, unknown>>;
            edges?: Array<Record<string, unknown>>;
        };

        expect(parsed.metadata?.title).toBe("Roadmap");
        expect(parsed.nodes?.[0]?.type).toBe("text");
        expect(parsed.nodes?.[1]?.type).toBe("file");
        expect(parsed.nodes?.[2]?.type).toBe("group");
        expect(parsed.edges?.[0]?.fromSide).toBe("bottom");
        expect(parsed.edges?.[0]?.toSide).toBe("top");
        expect(parsed.edges?.[0]?.label).toBe("linked");
    });
});