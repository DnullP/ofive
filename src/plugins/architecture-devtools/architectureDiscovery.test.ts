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
    it("应自动发现插件、事件、前端接口与后端命令", async () => {
        const slice = createAutoDiscoveredArchitectureSlice({
            frontendModules: await collectRawModules("src/**/*.{ts,tsx}"),
            backendModules: await collectRawModules("src-tauri/src/**/*.rs"),
        });
        const nodeTitles = new Set(slice.nodes.map((node) => node.title));

        expect(slice.nodes.some((node) => node.kind === "plugin")).toBe(true);
        expect(slice.nodes.some((node) => node.kind === "event")).toBe(true);
        expect(slice.nodes.some((node) => node.kind === "frontend-api")).toBe(true);
        expect(slice.nodes.some((node) => node.kind === "backend-api")).toBe(true);

        expect(nodeTitles.has("outlinePlugin")).toBe(true);
        expect(nodeTitles.has("vault.fs")).toBe(true);
        expect(nodeTitles.has("getCurrentVaultTree")).toBe(true);
        expect(nodeTitles.has("get_current_vault_tree")).toBe(true);
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
});