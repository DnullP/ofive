/**
 * @module plugins/architecture-devtools/architectureReverseDependency.test
 * @description 反向模块依赖单元测试：验证红色边识别规则与复制文本格式。
 * @dependencies
 *   - bun:test
 *   - ./architectureReverseDependency
 *   - ./architectureRegistry
 */

import { describe, expect, it } from "bun:test";
import {
    collectReverseModuleDependencyDetails,
    formatReverseModuleDependencyDetailsForClipboard,
} from "./architectureReverseDependency";
import type { ArchitectureEdge, ArchitectureNode } from "./architectureRegistry";

const SAMPLE_NODES: ArchitectureNode[] = [
    {
        id: "ui-module:infra",
        title: "commandSystem",
        kind: "ui-module",
        moduleLayer: "infrastructure",
        summary: "基础设施命令系统",
        location: "src/host/commandSystem.ts",
    },
    {
        id: "ui-module:plugin",
        title: "FileTree",
        kind: "ui-module",
        moduleLayer: "plugin-logic",
        summary: "文件树插件界面模块",
        location: "src/plugins/file-tree/FileTree.tsx",
    },
    {
        id: "backend-module:vault",
        title: "vault",
        kind: "backend-module",
        summary: "后端仓库访问模块",
        location: "src-tauri/src/app/vault/mod.rs",
    },
    {
        id: "frontend-api:save",
        title: "saveDocument",
        kind: "frontend-api",
        summary: "保存接口",
        location: "src/api/documentApi.ts",
    },
];

const SAMPLE_NODE_MAP = new Map(SAMPLE_NODES.map((node) => [node.id, node]));

describe("architectureReverseDependency", () => {
    it("应识别右侧模块依赖左侧模块的反向边", () => {
        const edges: ArchitectureEdge[] = [
            {
                from: "ui-module:plugin",
                to: "ui-module:infra",
                kind: "reads-state",
                label: "imports command helpers",
                details: ["src/plugins/file-tree/FileTree.tsx -> src/host/commandSystem.ts"],
            },
            {
                from: "ui-module:infra",
                to: "ui-module:plugin",
                kind: "writes-state",
                label: "normal forward edge",
            },
            {
                from: "backend-module:vault",
                to: "frontend-api:save",
                kind: "implemented-by-backend-module",
            },
        ];

        const details = collectReverseModuleDependencyDetails(
            edges,
            SAMPLE_NODE_MAP,
            new Map([
                ["ui-module:infra", { x: 100 }],
                ["ui-module:plugin", { x: 360 }],
                ["backend-module:vault", { x: 700 }],
                ["frontend-api:save", { x: 540 }],
            ]),
        );

        expect(details).toHaveLength(1);
        expect(details[0]?.fromNode.title).toBe("FileTree");
        expect(details[0]?.toNode.title).toBe("commandSystem");
        expect(details[0]?.edge.label).toBe("imports command helpers");
    });

    it("应忽略非模块节点和从左到右的正常边", () => {
        const edges: ArchitectureEdge[] = [
            {
                from: "ui-module:infra",
                to: "ui-module:plugin",
                kind: "reads-state",
            },
            {
                from: "frontend-api:save",
                to: "ui-module:infra",
                kind: "calls-api",
            },
        ];

        const details = collectReverseModuleDependencyDetails(
            edges,
            SAMPLE_NODE_MAP,
            new Map([
                ["ui-module:infra", { x: 120 }],
                ["ui-module:plugin", { x: 360 }],
                ["frontend-api:save", { x: 240 }],
            ]),
        );

        expect(details).toHaveLength(0);
    });

    it("应将反向依赖格式化为可复制文本", () => {
        const text = formatReverseModuleDependencyDetailsForClipboard([
            {
                edge: {
                    from: "ui-module:plugin",
                    to: "ui-module:infra",
                    kind: "reads-state",
                    label: "imports command helpers",
                    details: ["src/plugins/file-tree/FileTree.tsx -> src/host/commandSystem.ts"],
                },
                fromNode: SAMPLE_NODE_MAP.get("ui-module:plugin")!,
                toNode: SAMPLE_NODE_MAP.get("ui-module:infra")!,
            },
        ]);

        expect(text).toContain("#1 FileTree -> commandSystem");
        expect(text).toContain("from=FileTree (ui-module / plugin-logic)");
        expect(text).toContain("to=commandSystem (ui-module / infrastructure)");
        expect(text).toContain("edgeKind=reads-state");
        expect(text).toContain("imports command helpers");
        expect(text).toContain("src/plugins/file-tree/FileTree.tsx -> src/host/commandSystem.ts");
    });
});