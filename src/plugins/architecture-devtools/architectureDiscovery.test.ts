/**
 * @module plugins/architecture-devtools/architectureDiscovery.test
 * @description 自动架构发现单元测试：验证核心节点与前后端接口关联可被源码扫描识别。
 * @dependencies
 *   - bun:test
 *   - ./architectureDiscovery
 */

import { describe, expect, it } from "bun:test";
import { createAutoDiscoveredArchitectureSlice } from "./architectureDiscovery";

/**
 * @function collectRawModules
 * @description 使用 Bun.Glob 从仓库读取匹配文件内容，构造自动发现输入。
 * @param pattern glob 模式。
 * @returns 原始模块映射。
 */
async function collectRawModules(pattern: string): Promise<Record<string, string>> {
    const modules: Record<string, string> = {};
    const glob = new Bun.Glob(pattern);

    for await (const relativePath of glob.scan({ cwd: process.cwd(), onlyFiles: true })) {
        modules[`./${relativePath}`] = await Bun.file(relativePath).text();
    }

    return modules;
}

describe("architectureDiscovery", () => {
    it("应自动发现插件、事件、前端接口、后端命令与后端模块边界", async () => {
        const slice = createAutoDiscoveredArchitectureSlice({
            frontendModules: await collectRawModules("src/**/*.{ts,tsx}"),
            backendModules: await collectRawModules("src-tauri/src/**/*.rs"),
        });
        const nodeTitles = new Set(slice.nodes.map((node) => node.title));

        expect(slice.nodes.some((node) => node.kind === "plugin")).toBe(true);
        expect(slice.nodes.some((node) => node.kind === "event")).toBe(true);
        expect(slice.nodes.some((node) => node.kind === "frontend-api")).toBe(true);
        expect(slice.nodes.some((node) => node.kind === "backend-api")).toBe(true);
        expect(slice.nodes.some((node) => node.kind === "backend-module")).toBe(true);
        expect(slice.nodes.some((node) => node.kind === "backend-event")).toBe(true);

        expect(nodeTitles.has("outlinePlugin")).toBe(true);
        expect(nodeTitles.has("vault.fs")).toBe(true);
        expect(nodeTitles.has("getCurrentVaultTree")).toBe(true);
        expect(nodeTitles.has("get_current_vault_tree")).toBe(true);
        expect(nodeTitles.has("vault")).toBe(true);
        expect(nodeTitles.has("ai://chat-stream")).toBe(true);
    });

    it("应建立前端 API 到后端命令的调用边", async () => {
        const slice = createAutoDiscoveredArchitectureSlice({
            frontendModules: await collectRawModules("src/**/*.{ts,tsx}"),
            backendModules: await collectRawModules("src-tauri/src/**/*.rs"),
        });

        expect(slice.edges.some((edge) => {
            return (
                edge.from === "frontend-api:getCurrentVaultTree" &&
                edge.to === "backend-api:get_current_vault_tree" &&
                edge.kind === "calls-api"
            );
        })).toBe(true);
    });

    it("应区分基础设施模块与插件逻辑模块", async () => {
        const slice = createAutoDiscoveredArchitectureSlice({
            frontendModules: await collectRawModules("src/**/*.{ts,tsx}"),
            backendModules: await collectRawModules("src-tauri/src/**/*.rs"),
        });

        expect(slice.nodes.some((node) => {
            return (
                node.kind === "ui-module" &&
                node.title === "DockviewLayout" &&
                node.moduleLayer === "infrastructure"
            );
        })).toBe(true);

        expect(slice.nodes.some((node) => {
            return (
                node.kind === "ui-module" &&
                node.title === "commandSystem" &&
                node.moduleLayer === "infrastructure"
            );
        })).toBe(true);

        expect(slice.nodes.some((node) => {
            return (
                node.kind === "ui-module" &&
                node.title === "KnowledgeGraphTab" &&
                node.moduleLayer === "plugin-logic"
            );
        })).toBe(true);

        expect(slice.nodes.some((node) => {
            return (
                node.kind === "ui-module" &&
                node.title === "graphSettingsRegistrar" &&
                node.moduleLayer === "plugin-logic"
            );
        })).toBe(true);

        expect(slice.nodes.some((node) => {
            return (
                node.kind === "ui-module" &&
                node.title === "codeMirrorSettingsRegistrar" &&
                node.moduleLayer === "plugin-logic"
            );
        })).toBe(true);

        expect(slice.nodes.some((node) => {
            return (
                node.kind === "ui-module" &&
                node.title === "autoSaveSettingsRegistrar" &&
                node.moduleLayer === "infrastructure"
            );
        })).toBe(true);

        expect(slice.nodes.some((node) => {
            return (
                node.kind === "ui-module" &&
                node.title === "FileTree" &&
                node.moduleLayer === "plugin-logic"
            );
        })).toBe(true);

        expect(slice.nodes.some((node) => {
            return (
                node.kind === "ui-module" &&
                node.title === "fileTreeClipboard" &&
                node.moduleLayer === "plugin-logic"
            );
        })).toBe(true);
    });

    it("应将内置插件注册入口识别为 plugin，而不是 ui-module", async () => {
        const slice = createAutoDiscoveredArchitectureSlice({
            frontendModules: await collectRawModules("src/**/*.{ts,tsx}"),
            backendModules: await collectRawModules("src-tauri/src/**/*.rs"),
        });

        expect(slice.nodes.some((node) => {
            return (
                node.kind === "plugin" &&
                node.title === "registerBuiltinEditPlugins" &&
                node.location === "src/plugins/markdown-codemirror/editor/registerBuiltinEditPlugins.ts"
            );
        })).toBe(true);

        expect(slice.nodes.some((node) => {
            return (
                node.kind === "plugin" &&
                node.title === "registerBuiltinSyntaxRenderers" &&
                node.location === "src/plugins/markdown-codemirror/editor/registerBuiltinSyntaxRenderers.ts"
            );
        })).toBe(true);

        expect(slice.nodes.some((node) => {
            return node.kind === "ui-module" && node.title === "registerBuiltinEditPlugins";
        })).toBe(false);
    });

    it("应将后端模块与命令连接起来，并把边界规则保留在模块详情中", async () => {
        const slice = createAutoDiscoveredArchitectureSlice({
            frontendModules: await collectRawModules("src/**/*.{ts,tsx}"),
            backendModules: await collectRawModules("src-tauri/src/**/*.rs"),
        });

        const vaultModule = slice.nodes.find((node) => node.id === "backend-module:vault");

        expect(slice.edges.some((edge) => {
            return (
                edge.from === "backend-api:get_current_vault_tree" &&
                edge.to === "backend-module:vault" &&
                edge.kind === "implemented-by-backend-module"
            );
        })).toBe(true);

        expect(vaultModule?.details?.includes("public surface: shared::vault_contracts")).toBe(true);
        expect(vaultModule?.details?.includes("private boundary family: app::vault::")).toBe(true);

        expect(slice.edges.some((edge) => {
            return (
                edge.from === "backend-event:ai://chat-stream" &&
                edge.to === "backend-module:ai-chat" &&
                edge.kind === "owned-by-backend-module"
            );
        })).toBe(true);
    });

    it("应发现后端模块之间的依赖关系，并记录依赖产生原因", async () => {
        const slice = createAutoDiscoveredArchitectureSlice({
            frontendModules: await collectRawModules("src/**/*.{ts,tsx}"),
            backendModules: await collectRawModules("src-tauri/src/**/*.rs"),
        });

        const aiToHostDependency = slice.edges.find((edge) => {
            return (
                edge.from === "backend-module:ai-chat" &&
                edge.to === "backend-module:host-platform" &&
                edge.kind === "depends-on-backend-module"
            );
        });

        expect(aiToHostDependency).toBeDefined();
        expect(aiToHostDependency?.details?.some((detail) => {
            return detail.includes("public · app::capability::") || detail.includes("public · app::persistence::persistence_app_service");
        })).toBe(true);
    });
});