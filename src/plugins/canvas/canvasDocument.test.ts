/**
 * @module plugins/canvas/canvasDocument.test
 * @description Canvas 文档适配层单元测试。
 */

import { describe, expect, test } from "bun:test";
import {
    createGroupFromSelection,
    createFileNode,
    createGroupNode,
    createTextNode,
    parseCanvasDocument,
    serializeCanvasDocument,
    ungroupCanvasDocument,
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
        expect(document.nodes.find((node) => node.id === "text-1")?.data.kind).toBe("text");
        expect(document.nodes.find((node) => node.id === "file-1")?.data.filePath).toBe("notes/guide.md");
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
  expect(parsed.nodes?.find((node) => node.id === "text-1")?.type).toBe("text");
  expect(parsed.nodes?.find((node) => node.id === "file-1")?.type).toBe("file");
  expect(parsed.nodes?.find((node) => node.id === "group-1")?.type).toBe("group");
        expect(parsed.edges?.[0]?.fromSide).toBe("bottom");
        expect(parsed.edges?.[0]?.toSide).toBe("top");
        expect(parsed.edges?.[0]?.label).toBe("linked");
    });

    test("should map parentId children to relative runtime positions and preserve absolute positions on save", () => {
        const document = parseCanvasDocument(`{
  "nodes": [
    {
      "id": "group-1",
      "type": "group",
      "x": 100,
      "y": 200,
      "width": 320,
      "height": 220,
      "label": "Cluster"
    },
    {
      "id": "text-1",
      "type": "text",
      "x": 140,
      "y": 260,
      "width": 180,
      "height": 80,
      "text": "kubelet",
      "parentId": "group-1",
      "unknownField": true
    }
  ],
  "edges": []
}`);

        expect(document.nodes[0]?.id).toBe("group-1");
        expect(document.nodes[1]?.parentId).toBe("group-1");
        expect(document.nodes[1]?.extent).toBe("parent");
        expect(document.nodes[1]?.position.x).toBe(40);
        expect(document.nodes[1]?.position.y).toBe(60);
        expect(document.nodes[1]?.data.extraFields?.unknownField).toBe(true);

        const serialized = JSON.parse(serializeCanvasDocument(document)) as {
            nodes: Array<Record<string, unknown>>;
        };
        expect(serialized.nodes[1]?.parentId).toBe("group-1");
        expect(serialized.nodes[1]?.x).toBe(140);
        expect(serialized.nodes[1]?.y).toBe(260);
        expect(serialized.nodes[1]?.unknownField).toBe(true);
    });

    test("should create and remove xyflow sub-flow groups from the current selection", () => {
        const grouped = createGroupFromSelection({
            nodes: [
                createTextNode("text-1", 80, 100),
                createTextNode("text-2", 240, 160),
            ],
            edges: [],
        }, ["text-1", "text-2"], "group-1");

        expect(grouped).not.toBeNull();
        expect(grouped?.nodes[0]?.id).toBe("group-1");
        expect(grouped?.nodes[1]?.parentId).toBe("group-1");
        expect(grouped?.nodes[2]?.parentId).toBe("group-1");

        const ungrouped = ungroupCanvasDocument(grouped!, "group-1");
        expect(ungrouped.nodes).toHaveLength(2);
        expect(ungrouped.nodes[0]?.parentId).toBeUndefined();
        expect(ungrouped.nodes[1]?.parentId).toBeUndefined();
        expect(ungrouped.nodes[0]?.position.x).toBe(80);
        expect(ungrouped.nodes[0]?.position.y).toBe(100);
        expect(ungrouped.nodes[1]?.position.x).toBe(240);
        expect(ungrouped.nodes[1]?.position.y).toBe(160);
    });
});