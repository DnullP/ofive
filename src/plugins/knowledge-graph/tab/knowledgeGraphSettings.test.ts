/**
 * @module plugins/knowledge-graph/tab/knowledgeGraphSettings.test
 * @description 知识图谱设置单元测试：确保图谱颜色不进入 setting，并由主题统一驱动。
 * @dependencies
 *  - bun:test
 *  - ./knowledgeGraphSettings
 *
 * @example
 *   bun test src/plugins/knowledge-graph/tab/knowledgeGraphSettings.test.ts
 */

import { afterEach, describe, expect, it } from "bun:test";
import {
    DEFAULT_KNOWLEDGE_GRAPH_SETTINGS,
    buildKnowledgeGraphConfig,
    mergeKnowledgeGraphSettings,
} from "./knowledgeGraphSettings";

const originalWindow = globalThis.window;
const originalDocument = globalThis.document;

afterEach(() => {
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
});

describe("knowledgeGraphSettings", () => {
    it("默认设置不应暴露图谱颜色字段", () => {
        expect("backgroundColor" in DEFAULT_KNOWLEDGE_GRAPH_SETTINGS).toBe(false);
        expect("pointDefaultColor" in DEFAULT_KNOWLEDGE_GRAPH_SETTINGS).toBe(false);
        expect("pointGreyoutColor" in DEFAULT_KNOWLEDGE_GRAPH_SETTINGS).toBe(false);
        expect("hoveredPointRingColor" in DEFAULT_KNOWLEDGE_GRAPH_SETTINGS).toBe(false);
        expect("focusedPointRingColor" in DEFAULT_KNOWLEDGE_GRAPH_SETTINGS).toBe(false);
        expect("linkDefaultColor" in DEFAULT_KNOWLEDGE_GRAPH_SETTINGS).toBe(false);
        expect("hoveredLinkColor" in DEFAULT_KNOWLEDGE_GRAPH_SETTINGS).toBe(false);
    });

    it("合并设置时应丢弃旧版持久化颜色字段", () => {
        const merged = mergeKnowledgeGraphSettings({
            pointDefaultSize: 4,
            backgroundColor: "legacy-background-color",
            pointDefaultColor: "legacy-point-color",
        } as never);

        expect(Number(merged.pointDefaultSize)).toBe(4);
        expect("backgroundColor" in merged).toBe(false);
        expect("pointDefaultColor" in merged).toBe(false);
    });

    it("构建图谱配置时应直接读取当前主题颜色", () => {
        const appendedNodes: Array<{ style: Record<string, string> }> = [];
        globalThis.document = {
            documentElement: {},
            body: {
                appendChild: (node: { style: Record<string, string> }) => {
                    appendedNodes.push(node);
                    return node;
                },
            },
            createElement: () => ({
                style: {},
                remove: () => { },
            }),
        } as unknown as Document;
        globalThis.window = {
            getComputedStyle: (target?: Element) => {
                if (target && appendedNodes.includes(target as never)) {
                    const colorValue = (target as { style?: { color?: string } }).style?.color;
                    switch (colorValue) {
                        case "var(--graph-bg-primary)":
                            return { color: "rgba(0, 0, 0, 0)" };
                        case "var(--graph-point-color)":
                            return { color: "rgb(11, 109, 255)" };
                        case "var(--graph-point-greyout-color)":
                            return { color: "rgb(107, 114, 128)" };
                        case "var(--graph-point-ring-hover-color)":
                            return { color: "rgb(11, 109, 255)" };
                        case "var(--graph-point-ring-focus-color)":
                            return { color: "rgb(31, 41, 55)" };
                        case "var(--graph-link-color)":
                            return { color: "rgb(107, 114, 128)" };
                        case "var(--graph-link-hover-color)":
                            return { color: "rgb(11, 109, 255)" };
                        default:
                            return { color: "" };
                    }
                }

                return {
                    getPropertyValue: (propertyName: string) => {
                        switch (propertyName) {
                            case "--graph-bg-primary":
                                return "transparent";
                            case "--graph-point-color":
                                return "#0b6dff";
                            case "--graph-point-greyout-color":
                                return "#6b7280";
                            case "--graph-point-ring-hover-color":
                                return "#0b6dff";
                            case "--graph-point-ring-focus-color":
                                return "#1f2937";
                            case "--graph-link-color":
                                return "#6b7280";
                            case "--graph-link-hover-color":
                                return "#0b6dff";
                            default:
                                return "";
                        }
                    },
                };
            },
        } as unknown as Window & typeof globalThis;

        const config = buildKnowledgeGraphConfig({
            ...DEFAULT_KNOWLEDGE_GRAPH_SETTINGS,
        });

        expect(config.backgroundColor).toBe("rgba(0, 0, 0, 0)");
        expect(config.pointDefaultColor).toBe("rgb(11, 109, 255)");
        expect(config.pointGreyoutColor).toBe("rgb(107, 114, 128)");
        expect(config.hoveredPointRingColor).toBe("rgb(11, 109, 255)");
        expect(config.focusedPointRingColor).toBe("rgb(31, 41, 55)");
        expect(config.linkDefaultColor).toBe("rgb(107, 114, 128)");
        expect(config.hoveredLinkColor).toBe("rgb(11, 109, 255)");
    });
});