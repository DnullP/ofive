/**
 * @module devtools/architecture/architectureDiscovery
 * @description 基于源码文本自动发现架构节点与依赖关系，生成供 DevTools 使用的架构切片。
 *
 *   该模块不维护手工架构清单，而是通过以下方式构建图谱：
 *   - 扫描 `src/` 下的 TS/TSX 源码，识别插件、模块、Store、事件与前端 API。
 *   - 扫描 `src-tauri/src/vault_commands.rs` 中的 Tauri 命令，识别后端接口。
 *   - 通过 import 关系、事件函数命名、`invoke()` 调用等文本特征推断依赖边。
 *
 * @dependencies
 *   - ./architectureRegistry
 *
 * @example
 *   import { createAutoDiscoveredArchitectureSlice } from "./architectureDiscovery";
 *
 *   const slice = createAutoDiscoveredArchitectureSlice();
 *
 * @exports
 *   - createAutoDiscoveredArchitectureSlice
 */

import type {
    ArchitectureEdge,
    ArchitectureEdgeKind,
    ArchitectureModuleLayer,
    ArchitectureNode,
    ArchitectureSlice,
} from "./architectureRegistry";

type RawModuleMap = Record<string, string>;

interface DiscoveryInput {
    frontendModules?: RawModuleMap;
    backendModules?: RawModuleMap;
}

const FRONTEND_SOURCE_MODULES: RawModuleMap = typeof Bun !== "undefined"
    ? {}
    : import.meta.glob("/src/**/*.{ts,tsx}", {
        query: "?raw",
        import: "default",
        eager: true,
    }) as RawModuleMap;

const BACKEND_SOURCE_MODULES: RawModuleMap = typeof Bun !== "undefined"
    ? {}
    : import.meta.glob("/src-tauri/src/**/*.rs", {
        query: "?raw",
        import: "default",
        eager: true,
    }) as RawModuleMap;

type FileNodeKind = "plugin" | "ui-module" | "store";

interface SourceFileRecord {
    path: string;
    content: string;
    imports: ResolvedImport[];
}

interface ResolvedImport {
    specifier: string;
    resolvedPath: string;
    importedNames: string[];
}

interface ParsedApiFunction {
    name: string;
    summary: string;
    location: string;
    details: string[];
    backendCommands: string[];
}

interface ParsedBusEvent {
    name: string;
    payloadType: string;
}

interface ParsedBackendCommand {
    name: string;
    summary: string;
    location: string;
}

const HARD_INFRASTRUCTURE_MODULE_PREFIXES = [
    "src/registry/",
    "src/commands/",
    "src/layout/sidebar/",
    "src/layout/editor/",
] as const;

const INFRASTRUCTURE_MODULE_PREFIXES = [
    "src/registry/",
    "src/commands/",
    "src/settings/",
    "src/layout/sidebar/",
    "src/layout/editor/",
] as const;

const INFRASTRUCTURE_MODULE_PATHS = new Set([
    "src/layout/DockviewLayout.tsx",
    "src/layout/CommandPaletteModal.tsx",
    "src/layout/QuickSwitcherModal.tsx",
    "src/layout/MoveFileDirectoryModal.tsx",
    "src/layout/nativeContextMenu.ts",
    "src/layout/panelOrderUtils.ts",
    "src/layout/fileTabRegistry.ts",
    "src/layout/index.ts",
]);

/**
 * @function createAutoDiscoveredArchitectureSlice
 * @description 扫描当前仓库源码并生成自动发现的架构切片。
 * @returns 自动发现的架构切片。
 */
export function createAutoDiscoveredArchitectureSlice(input?: DiscoveryInput): ArchitectureSlice {
    const frontendModules = input?.frontendModules ?? FRONTEND_SOURCE_MODULES;
    const backendModules = input?.backendModules ?? BACKEND_SOURCE_MODULES;
    const sourceFiles = collectFrontendSourceFiles(frontendModules);
    const sourceFileMap = new Map(sourceFiles.map((file) => [file.path, file]));
    const importersByPath = buildImportersMap(sourceFiles);
    const moduleLayerCache = new Map<string, ArchitectureModuleLayer>();
    const backendSourceFile = Object.entries(backendModules).find(([rawPath]) => {
        return normalizeSourcePath(rawPath) === "src-tauri/src/vault_commands.rs";
    });

    const pluginFiles = sourceFiles.filter((file) => isPluginFile(file.path));
    const storeFiles = sourceFiles.filter((file) => isStoreFile(file.path));
    const busFile = sourceFileMap.get("src/events/appEventBus.ts") ?? null;
    const apiFiles = sourceFiles.filter((file) => isFrontendApiSourceFile(file));
    const backendCommands = parseBackendCommands(
        backendSourceFile?.[1] ?? "",
        "src-tauri/src/vault_commands.rs",
    );
    const apiFunctions = apiFiles.flatMap((file) => parseFrontendApiFunctions(file));
    const busEvents = busFile ? parseBusEvents(busFile.content) : [];

    const moduleFiles = sourceFiles.filter((file) => {
        if (isPluginFile(file.path) || isStoreFile(file.path) || isEventFile(file.path) || isApiFile(file.path)) {
            return false;
        }

        if (isExcludedModulePath(file.path)) {
            return false;
        }

        const importsInterestingFile = file.imports.some((entry) => {
            return (
                isPluginFile(entry.resolvedPath) ||
                isStoreFile(entry.resolvedPath) ||
                isEventFile(entry.resolvedPath) ||
                isApiFile(entry.resolvedPath) ||
                isRegistryOrCommandOrLayoutFile(entry.resolvedPath)
            );
        });

        const importedByPlugin = (importersByPath.get(file.path) ?? []).some((importerPath) => {
            return isPluginFile(importerPath) || isRegistryOrCommandOrLayoutFile(importerPath);
        });

        return importsInterestingFile || importedByPlugin || isRegistryOrCommandOrLayoutFile(file.path);
    });

    const nodes: ArchitectureNode[] = [];
    const edges: ArchitectureEdge[] = [];
    const fileNodeIdMap = new Map<string, string>();
    const eventNodeIdMap = new Map<string, string>();
    const apiNodeIdMap = new Map<string, string>();
    const backendNodeIdMap = new Map<string, string>();

    pluginFiles.forEach((file) => {
        const node = createFileNode(file, "plugin");
        nodes.push(node);
        fileNodeIdMap.set(file.path, node.id);
    });

    moduleFiles.forEach((file) => {
        const node = createFileNode(
            file,
            "ui-module",
            classifyUiModuleLayer(file.path, importersByPath, moduleLayerCache),
        );
        nodes.push(node);
        fileNodeIdMap.set(file.path, node.id);
    });

    storeFiles.forEach((file) => {
        const node = createStoreNode(file);
        nodes.push(node);
        fileNodeIdMap.set(file.path, node.id);
    });

    busEvents.forEach((event) => {
        const node: ArchitectureNode = {
            id: `event:${event.name}`,
            title: event.name,
            kind: "event",
            summary: `应用事件总线事件：${event.name}`,
            location: "src/events/appEventBus.ts",
            details: event.payloadType ? [`payload: ${event.payloadType}`] : [],
        };
        nodes.push(node);
        eventNodeIdMap.set(event.name, node.id);
    });

    apiFunctions.forEach((apiFunction) => {
        const node: ArchitectureNode = {
            id: `frontend-api:${apiFunction.name}`,
            title: apiFunction.name,
            kind: "frontend-api",
            summary: apiFunction.summary,
            location: apiFunction.location,
            details: apiFunction.details,
        };
        nodes.push(node);
        apiNodeIdMap.set(apiFunction.name, node.id);
    });

    backendCommands.forEach((command) => {
        const node: ArchitectureNode = {
            id: `backend-api:${command.name}`,
            title: command.name,
            kind: "backend-api",
            summary: command.summary,
            location: command.location,
            details: [],
        };
        nodes.push(node);
        backendNodeIdMap.set(command.name, node.id);
    });

    sourceFiles.forEach((file) => {
        const fromNodeId = fileNodeIdMap.get(file.path);
        if (!fromNodeId) {
            return;
        }

        file.imports.forEach((entry) => {
            const targetFileNodeId = fileNodeIdMap.get(entry.resolvedPath);
            if (targetFileNodeId) {
                const edge = createFileImportEdge(file.path, fromNodeId, entry.resolvedPath, targetFileNodeId, entry.importedNames);
                if (edge) {
                    edges.push(edge);
                }
            }

            if (isEventFile(entry.resolvedPath)) {
                matchImportedEvents(entry.importedNames, busEvents).forEach((eventName) => {
                    const targetId = eventNodeIdMap.get(eventName);
                    if (!targetId) {
                        return;
                    }
                    edges.push({
                        from: fromNodeId,
                        to: targetId,
                        kind: deriveEventEdgeKind(entry.importedNames, eventName),
                        label: eventName,
                    });
                });
            }

            if (isApiFile(entry.resolvedPath)) {
                entry.importedNames.forEach((importedName) => {
                    const targetId = apiNodeIdMap.get(importedName);
                    if (!targetId) {
                        return;
                    }
                    edges.push({
                        from: fromNodeId,
                        to: targetId,
                        kind: "calls-api",
                        label: importedName,
                    });
                });
            }
        });
    });

    apiFunctions.forEach((apiFunction) => {
        const fromNodeId = apiNodeIdMap.get(apiFunction.name);
        if (!fromNodeId) {
            return;
        }

        apiFunction.backendCommands.forEach((commandName) => {
            const targetId = backendNodeIdMap.get(commandName);
            if (!targetId) {
                return;
            }

            edges.push({
                from: fromNodeId,
                to: targetId,
                kind: "calls-api",
                label: commandName,
            });
        });
    });

    return {
        id: "auto-discovered-architecture",
        title: "Auto Discovered Architecture",
        nodes: dedupeNodes(nodes),
        edges: dedupeEdges(edges),
    };
}

/**
 * @function collectFrontendSourceFiles
 * @description 收集并解析前端源码文件。
 * @returns 前端源码记录列表。
 */
function collectFrontendSourceFiles(frontendModules: RawModuleMap): SourceFileRecord[] {
    const normalizedModuleEntries = Object.entries(frontendModules)
        .map(([rawPath, content]) => ({
            path: normalizeSourcePath(rawPath),
            content,
        }))
        .filter((entry) => shouldIncludeSourceFile(entry.path));

    const existingPaths = new Set(normalizedModuleEntries.map((entry) => entry.path));

    return normalizedModuleEntries.map((entry) => ({
        path: entry.path,
        content: entry.content,
        imports: parseResolvedImports(entry.path, entry.content, existingPaths),
    }));
}

/**
 * @function normalizeSourcePath
 * @description 将 glob 返回的相对路径标准化为仓库内路径。
 * @param rawPath glob 返回的路径。
 * @returns 标准化后的路径。
 */
function normalizeSourcePath(rawPath: string): string {
    const normalized = rawPath
        .replace(/^\//, "")
        .replace(/^(\.\.\/)+/, "")
        .replace(/^\.\//, "")
        .replace(/\\/g, "/");

    if (normalized.startsWith("src/") || normalized.startsWith("src-tauri/")) {
        return normalized;
    }

    return `src/${normalized}`;
}

/**
 * @function shouldIncludeSourceFile
 * @description 判断源码文件是否应参与自动发现。
 * @param path 源码路径。
 * @returns 是否参与扫描。
 */
function shouldIncludeSourceFile(path: string): boolean {
    if (!path.startsWith("src/")) {
        return false;
    }

    return !(
        path.endsWith(".test.ts") ||
        path.endsWith(".test.tsx") ||
        path.endsWith("vite-env.d.ts") ||
        path.includes("/i18n/") ||
        path.includes("/assets/")
    );
}

/**
 * @function parseResolvedImports
 * @description 解析源码中的本地 import，并解析为仓库内实际路径。
 * @param filePath 当前文件路径。
 * @param content 文件内容。
 * @param existingPaths 当前存在的源码路径集合。
 * @returns 解析后的 import 列表。
 */
function parseResolvedImports(
    filePath: string,
    content: string,
    existingPaths: Set<string>,
): ResolvedImport[] {
    const imports: ResolvedImport[] = [];
    const importRegex = /import\s+(?:type\s+)?([\s\S]*?)\s+from\s+["']([^"']+)["'];?|import\s+["']([^"']+)["'];?/g;

    for (const match of content.matchAll(importRegex)) {
        const fullStatement = match[0] ?? "";
        const bindings = match[1] ?? "";
        const specifier = (match[2] ?? match[3] ?? "").trim();
        if (/^import\s+type\b/.test(fullStatement)) {
            continue;
        }

        if (!specifier.startsWith(".")) {
            continue;
        }

        const resolvedPath = resolveImportPath(filePath, specifier, existingPaths);
        if (!resolvedPath) {
            continue;
        }

        imports.push({
            specifier,
            resolvedPath,
            importedNames: parseImportedNames(bindings),
        });
    }

    return imports;
}

/**
 * @function parseImportedNames
 * @description 解析 import 语句中的具名标识符列表。
 * @param bindings import 绑定字符串。
 * @returns 具名导入列表。
 */
function parseImportedNames(bindings: string): string[] {
    const names = new Set<string>();
    const normalized = bindings.replace(/\s+/g, " ").trim();

    const namedBlockMatch = normalized.match(/\{([^}]+)\}/);
    if (namedBlockMatch?.[1]) {
        namedBlockMatch[1].split(",").forEach((entry) => {
            const clean = entry.trim();
            if (!clean) {
                return;
            }
            const localName = clean.split(" as ").at(-1)?.trim();
            if (localName) {
                names.add(localName);
            }
        });
    }

    const defaultPart = normalized.split("{")[0]?.replace(/,$/, "").trim();
    if (defaultPart && defaultPart !== "*") {
        defaultPart.split(",").forEach((entry) => {
            const clean = entry.trim();
            if (clean && clean !== "type") {
                names.add(clean);
            }
        });
    }

    const namespaceMatch = normalized.match(/\*\s+as\s+([A-Za-z0-9_$]+)/);
    if (namespaceMatch?.[1]) {
        names.add(namespaceMatch[1]);
    }

    return Array.from(names);
}

/**
 * @function resolveImportPath
 * @description 解析相对 import 为仓库源码路径。
 * @param currentPath 当前文件路径。
 * @param specifier import 相对路径。
 * @param existingPaths 当前存在的源码路径集合。
 * @returns 解析后的路径。
 */
function resolveImportPath(
    currentPath: string,
    specifier: string,
    existingPaths: Set<string>,
): string | null {
    const currentSegments = currentPath.split("/");
    currentSegments.pop();
    const candidateSegments = [...currentSegments, ...specifier.split("/")];
    const normalizedSegments: string[] = [];

    candidateSegments.forEach((segment) => {
        if (!segment || segment === ".") {
            return;
        }
        if (segment === "..") {
            normalizedSegments.pop();
            return;
        }
        normalizedSegments.push(segment);
    });

    const candidateBase = normalizedSegments.join("/");
    const candidates = [
        candidateBase,
        `${candidateBase}.ts`,
        `${candidateBase}.tsx`,
        `${candidateBase}/index.ts`,
        `${candidateBase}/index.tsx`,
    ];

    return candidates.find((candidate) => existingPaths.has(candidate)) ?? null;
}

/**
 * @function buildImportersMap
 * @description 建立“文件被哪些文件导入”的反向映射。
 * @param files 源码文件列表。
 * @returns 反向导入映射。
 */
function buildImportersMap(files: SourceFileRecord[]): Map<string, string[]> {
    const map = new Map<string, string[]>();

    files.forEach((file) => {
        file.imports.forEach((entry) => {
            const importers = map.get(entry.resolvedPath) ?? [];
            importers.push(file.path);
            map.set(entry.resolvedPath, importers);
        });
    });

    return map;
}

/**
 * @function createFileNode
 * @description 基于源码文件创建插件或模块节点。
 * @param file 源码文件记录。
 * @param kind 节点类型。
 * @returns 架构节点。
 */
function createFileNode(
    file: SourceFileRecord,
    kind: FileNodeKind,
    moduleLayer?: ArchitectureModuleLayer,
): ArchitectureNode {
    const title = inferFileDisplayName(file.path);
    const details = kind === "plugin" ? extractPluginRegistrationDetails(file.content) : extractModuleDetails(file.content);

    return {
        id: `${kind}:${title}`,
        title,
        kind,
        summary: extractPrimaryDescription(file.content) || buildFallbackSummary(title, kind),
        moduleLayer,
        location: file.path,
        details,
    };
}

/**
 * @function classifyUiModuleLayer
 * @description 根据路径与导入关系推断模块属于基础设施还是插件逻辑。
 * @param path 模块路径。
 * @param importersByPath 反向导入映射。
 * @returns 模块层级。
 */
function classifyUiModuleLayer(
    path: string,
    importersByPath: Map<string, string[]>,
    cache: Map<string, ArchitectureModuleLayer>,
    visiting = new Set<string>(),
): ArchitectureModuleLayer {
    const cachedLayer = cache.get(path);
    if (cachedLayer) {
        return cachedLayer;
    }

    if (visiting.has(path)) {
        return "infrastructure";
    }

    visiting.add(path);

    if (path.startsWith("src/devtools/") || /KnowledgeGraph|knowledgeGraph/.test(path)) {
        cache.set(path, "plugin-logic");
        visiting.delete(path);
        return "plugin-logic";
    }

    if (isHardInfrastructureModulePath(path)) {
        cache.set(path, "infrastructure");
        visiting.delete(path);
        return "infrastructure";
    }

    const importers = importersByPath.get(path) ?? [];
    if (importers.some((importerPath) => isPluginFile(importerPath))) {
        cache.set(path, "plugin-logic");
        visiting.delete(path);
        return "plugin-logic";
    }

    const pluginOnlySupportModule = importers.length > 0 && importers.every((importerPath) => {
        if (isPluginFile(importerPath)) {
            return true;
        }

        return classifyUiModuleLayer(importerPath, importersByPath, cache, visiting) === "plugin-logic";
    });

    if (pluginOnlySupportModule) {
        cache.set(path, "plugin-logic");
        visiting.delete(path);
        return "plugin-logic";
    }

    const moduleLayer = isInfrastructureModulePath(path) ? "infrastructure" : "infrastructure";
    cache.set(path, moduleLayer);
    visiting.delete(path);
    return moduleLayer;
}

/** @function isHardInfrastructureModulePath */
function isHardInfrastructureModulePath(path: string): boolean {
    if (INFRASTRUCTURE_MODULE_PATHS.has(path)) {
        return true;
    }

    return HARD_INFRASTRUCTURE_MODULE_PREFIXES.some((prefix) => path.startsWith(prefix));
}

/** @function isInfrastructureModulePath */
function isInfrastructureModulePath(path: string): boolean {
    if (isHardInfrastructureModulePath(path)) {
        return true;
    }

    return INFRASTRUCTURE_MODULE_PREFIXES.some((prefix) => path.startsWith(prefix));
}

/**
 * @function createStoreNode
 * @description 基于 store 文件创建状态节点。
 * @param file store 文件记录。
 * @returns 状态节点。
 */
function createStoreNode(file: SourceFileRecord): ArchitectureNode {
    const title = inferFileDisplayName(file.path);
    const stateDetails = extractTaggedList(file.content, "state");
    return {
        id: `store:${title}`,
        title,
        kind: "store",
        summary: extractPrimaryDescription(file.content) || `状态模块：${title}`,
        location: file.path,
        details: stateDetails,
    };
}

/**
 * @function parseFrontendApiFunctions
 * @description 解析前端 API 源文件中的导出函数。
 * @param file API 源文件。
 * @returns API 函数列表。
 */
function parseFrontendApiFunctions(file: SourceFileRecord): ParsedApiFunction[] {
    const regex = /export\s+(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/g;
    const functions: ParsedApiFunction[] = [];

    for (const match of file.content.matchAll(regex)) {
        const name = match[1] ?? "";
        const startIndex = match.index ?? 0;
        const body = extractFunctionBody(file.content, startIndex);
        const summary = extractNearestDocDescription(file.content, startIndex) || `前端接口：${name}`;
        const backendCommands = Array.from(body.matchAll(/invoke(?:<[^>]+>)?\(\s*["']([^"']+)["']/g)).map((item) => item[1] ?? "");
        const listenedEvents = Array.from(body.matchAll(/listen(?:<[^>]+>)?\(\s*([A-Z0-9_]+)/g)).map((item) => item[1] ?? "");
        const details = [
            ...backendCommands.map((command) => `invoke ${command}`),
            ...listenedEvents.map((eventConstant) => `listen ${eventConstant}`),
        ];

        functions.push({
            name,
            summary,
            location: file.path,
            details,
            backendCommands,
        });
    }

    return functions;
}

/**
 * @function parseBusEvents
 * @description 解析事件总线中的事件名与负载类型。
 * @param content appEventBus 源码。
 * @returns 事件列表。
 */
function parseBusEvents(content: string): ParsedBusEvent[] {
    const mapMatch = content.match(/type\s+AppBusEventMap\s*=\s*\{([\s\S]*?)\n\};/);
    if (!mapMatch?.[1]) {
        return [];
    }

    return Array.from(mapMatch[1].matchAll(/["']([^"']+)["']\s*:\s*([^;\n]+);/g)).map((match) => ({
        name: match[1] ?? "",
        payloadType: (match[2] ?? "").trim(),
    }));
}

/**
 * @function parseBackendCommands
 * @description 解析 Rust Tauri 命令定义。
 * @param content Rust 源码。
 * @param location 源码路径。
 * @returns 后端命令列表。
 */
function parseBackendCommands(content: string, location: string): ParsedBackendCommand[] {
    const commands: ParsedBackendCommand[] = [];
    const regex = /#\[tauri::command\]\s+pub\s+fn\s+([a-zA-Z0-9_]+)\s*\(/g;

    for (const match of content.matchAll(regex)) {
        const name = match[1] ?? "";
        const startIndex = match.index ?? 0;
        const summary = extractNearestDocDescription(content, startIndex) || `Tauri 命令：${name}`;
        commands.push({
            name,
            summary,
            location,
        });
    }

    return commands;
}

/**
 * @function createFileImportEdge
 * @description 根据文件到文件的 import 生成依赖边。
 * @param fromPath 来源文件路径。
 * @param fromNodeId 来源节点 ID。
 * @param toPath 目标文件路径。
 * @param toNodeId 目标节点 ID。
 * @param importedNames 导入的标识符。
 * @returns 依赖边，无法识别时返回 null。
 */
function createFileImportEdge(
    fromPath: string,
    fromNodeId: string,
    toPath: string,
    toNodeId: string,
    importedNames: string[],
): ArchitectureEdge | null {
    if (isStoreFile(toPath)) {
        return {
            from: fromNodeId,
            to: toNodeId,
            kind: deriveStoreEdgeKind(importedNames),
            label: importedNames[0] ?? inferFileDisplayName(toPath),
        };
    }

    if (isPluginFile(toPath) || isRegistryOrCommandOrLayoutFile(toPath)) {
        return {
            from: fromNodeId,
            to: toNodeId,
            kind: deriveModuleEdgeKind(fromPath, toPath, importedNames),
            label: importedNames[0] ?? inferFileDisplayName(toPath),
        };
    }

    return null;
}

/**
 * @function deriveStoreEdgeKind
 * @description 从导入标识符推断是读状态还是写状态。
 * @param importedNames 导入标识符。
 * @returns 状态依赖边类型。
 */
function deriveStoreEdgeKind(importedNames: string[]): ArchitectureEdgeKind {
    const joined = importedNames.join(" ").toLowerCase();
    if (/(update|set|mark|write|save|load|reset|create|delete|rename|move)/.test(joined)) {
        return "writes-state";
    }
    return "reads-state";
}

/**
 * @function deriveModuleEdgeKind
 * @description 从导入关系推断模块边语义。
 * @param fromPath 来源文件路径。
 * @param toPath 目标文件路径。
 * @param importedNames 导入标识符。
 * @returns 模块边类型。
 */
function deriveModuleEdgeKind(
    fromPath: string,
    toPath: string,
    importedNames: string[],
): ArchitectureEdgeKind {
    const joined = importedNames.join(" ");
    if (/registerActivity|registerPanel|registerTabComponent/i.test(joined)) {
        return "registers-ui";
    }
    if (isEventFile(toPath) || isEventFile(fromPath)) {
        return "bridges-event";
    }
    return "registers-ui";
}

/**
 * @function matchImportedEvents
 * @description 根据导入函数名匹配事件总线事件名。
 * @param importedNames 导入的标识符。
 * @param events 事件列表。
 * @returns 匹配到的事件名列表。
 */
function matchImportedEvents(importedNames: string[], events: ParsedBusEvent[]): string[] {
    const matched = new Set<string>();

    importedNames.forEach((importedName) => {
        const normalizedImport = normalizeSymbolName(importedName);
        events.forEach((event) => {
            const normalizedEvent = normalizeSymbolName(event.name);
            if (normalizedImport.includes(normalizedEvent)) {
                matched.add(event.name);
            }
        });
    });

    return Array.from(matched);
}

/**
 * @function deriveEventEdgeKind
 * @description 根据导入名推断事件关系是订阅、发出还是桥接。
 * @param importedNames 导入名列表。
 * @param eventName 事件名。
 * @returns 事件边类型。
 */
function deriveEventEdgeKind(importedNames: string[], eventName: string): ArchitectureEdgeKind {
    const matchedImport = importedNames.find((name) => {
        return normalizeSymbolName(name).includes(normalizeSymbolName(eventName));
    }) ?? "";
    const normalized = matchedImport.toLowerCase();

    if (normalized.startsWith("emit")) {
        return "emits-event";
    }
    if (normalized.startsWith("subscribe") || normalized.startsWith("use")) {
        return "subscribes-event";
    }
    return "bridges-event";
}

/**
 * @function extractPrimaryDescription
 * @description 提取模块级文档中的主要描述。
 * @param content 源码内容。
 * @returns 描述文本。
 */
function extractPrimaryDescription(content: string): string {
    return extractTaggedBlock(content, "description")
        .split("\n")
        .map((line) => line.trim().replace(/^\*\s?/, ""))
        .find((line) => Boolean(line)) ?? "";
}

/**
 * @function extractTaggedList
 * @description 提取文档注释中的列表项。
 * @param content 源码内容。
 * @param tag 标签名。
 * @returns 列表项集合。
 */
function extractTaggedList(content: string, tag: string): string[] {
    const block = extractTaggedBlock(content, tag);
    return block
        .split("\n")
        .map((line) => line.trim().replace(/^\*\s?/, ""))
        .filter((line) => line.startsWith("- "))
        .map((line) => line.slice(2).trim());
}

/**
 * @function extractTaggedBlock
 * @description 提取指定注释标签对应的文本块。
 * @param content 源码内容。
 * @param tag 标签名。
 * @returns 标签文本块。
 */
function extractTaggedBlock(content: string, tag: string): string {
    const regex = new RegExp(`@${tag}([\\s\\S]*?)(?:\\n\\s*\\*\\s*@|\\n\\s*\\*/|$)`);
    return content.match(regex)?.[1]?.trim() ?? "";
}

/**
 * @function extractNearestDocDescription
 * @description 提取指定代码位置前最近一段文档注释中的描述。
 * @param content 源码内容。
 * @param startIndex 代码起始偏移。
 * @returns 文档描述。
 */
function extractNearestDocDescription(content: string, startIndex: number): string {
    const before = content.slice(0, startIndex);
    const commentStart = before.lastIndexOf("/**");
    const commentEnd = before.lastIndexOf("*/");
    if (commentStart < 0 || commentEnd < commentStart) {
        return "";
    }

    const gap = before.slice(commentEnd + 2).trim();
    if (gap.length > 0) {
        return "";
    }

    const comment = before.slice(commentStart, commentEnd + 2);
    return extractPrimaryDescription(comment);
}

/**
 * @function extractFunctionBody
 * @description 提取函数体文本。
 * @param content 源码内容。
 * @param startIndex 函数定义起始偏移。
 * @returns 函数体文本。
 */
function extractFunctionBody(content: string, startIndex: number): string {
    const openBraceIndex = content.indexOf("{", startIndex);
    if (openBraceIndex < 0) {
        return "";
    }

    let depth = 0;
    for (let index = openBraceIndex; index < content.length; index += 1) {
        const char = content[index] ?? "";
        if (char === "{") {
            depth += 1;
        } else if (char === "}") {
            depth -= 1;
            if (depth === 0) {
                return content.slice(openBraceIndex, index + 1);
            }
        }
    }

    return content.slice(openBraceIndex);
}

/**
 * @function extractPluginRegistrationDetails
 * @description 提取插件文件中的自注册信息。
 * @param content 插件源码。
 * @returns 细项列表。
 */
function extractPluginRegistrationDetails(content: string): string[] {
    const details: string[] = [];
    const registrationPatterns: Array<{ regex: RegExp; label: string }> = [
        { regex: /registerActivity\(\{[\s\S]*?id:\s*["']([^"']+)["']/g, label: "register activity" },
        { regex: /registerPanel\(\{[\s\S]*?id:\s*["']([^"']+)["']/g, label: "register panel" },
        { regex: /registerTabComponent\(\{[\s\S]*?id:\s*["']([^"']+)["']/g, label: "register tab" },
    ];

    registrationPatterns.forEach(({ regex, label }) => {
        for (const match of content.matchAll(regex)) {
            const id = match[1] ?? "";
            if (id) {
                details.push(`${label}: ${id}`);
            }
        }
    });

    return details;
}

/**
 * @function extractModuleDetails
 * @description 提取模块注释中的示例、导出或依赖信息。
 * @param content 模块源码。
 * @returns 细项列表。
 */
function extractModuleDetails(content: string): string[] {
    const exportNames = Array.from(content.matchAll(/export\s+(?:async\s+)?(?:function|const|class|type)\s+([A-Za-z0-9_$]+)/g))
        .map((match) => match[1] ?? "")
        .filter(Boolean)
        .slice(0, 4);

    return exportNames.map((name) => `export: ${name}`);
}

/**
 * @function inferFileDisplayName
 * @description 从文件路径推断更适合展示的名称。
 * @param path 文件路径。
 * @returns 展示名称。
 */
function inferFileDisplayName(path: string): string {
    const fileName = path.split("/").at(-1) ?? path;
    const baseName = fileName.replace(/\.(ts|tsx)$/, "");
    if (baseName === "index") {
        return path.split("/").at(-2) ?? baseName;
    }
    return baseName;
}

/**
 * @function buildFallbackSummary
 * @description 为缺失文档描述的节点生成兜底摘要。
 * @param title 节点标题。
 * @param kind 节点类型。
 * @returns 摘要文本。
 */
function buildFallbackSummary(title: string, kind: FileNodeKind): string {
    switch (kind) {
        case "plugin":
            return `插件模块：${title}`;
        case "store":
            return `状态模块：${title}`;
        default:
            return `界面模块：${title}`;
    }
}

/**
 * @function dedupeNodes
 * @description 按节点 ID 去重并稳定排序。
 * @param nodes 节点列表。
 * @returns 去重后的节点列表。
 */
function dedupeNodes(nodes: ArchitectureNode[]): ArchitectureNode[] {
    const map = new Map<string, ArchitectureNode>();
    nodes.forEach((node) => {
        map.set(node.id, node);
    });

    return Array.from(map.values()).sort((left, right) => left.title.localeCompare(right.title));
}

/**
 * @function dedupeEdges
 * @description 按 from/to/kind/label 去重依赖边。
 * @param edges 边列表。
 * @returns 去重后的边列表。
 */
function dedupeEdges(edges: ArchitectureEdge[]): ArchitectureEdge[] {
    const map = new Map<string, ArchitectureEdge>();
    edges.forEach((edge) => {
        map.set(`${edge.from}->${edge.to}:${edge.kind}:${edge.label ?? ""}`, edge);
    });

    return Array.from(map.values()).sort((left, right) => {
        const fromDelta = left.from.localeCompare(right.from);
        if (fromDelta !== 0) {
            return fromDelta;
        }
        return left.to.localeCompare(right.to);
    });
}

/**
 * @function normalizeSymbolName
 * @description 归一化符号名，便于模糊匹配。
 * @param value 原始名称。
 * @returns 归一化名称。
 */
function normalizeSymbolName(value: string): string {
    return value.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
}

/** @function isPluginFile */
function isPluginFile(path: string): boolean {
    return /^src\/plugins\/[A-Za-z0-9_$-]+Plugin\.tsx?$/.test(path);
}

/** @function isStoreFile */
function isStoreFile(path: string): boolean {
    return path.startsWith("src/store/") && !path.endsWith(".test.ts");
}

/** @function isEventFile */
function isEventFile(path: string): boolean {
    return path.startsWith("src/events/") && !path.endsWith(".test.ts");
}

/** @function isApiFile */
function isApiFile(path: string): boolean {
    return path.startsWith("src/api/") && !path.endsWith(".test.ts");
}

/** @function isFrontendApiSourceFile */
function isFrontendApiSourceFile(file: SourceFileRecord): boolean {
    return (
        isApiFile(file.path) &&
        (/invoke(?:<|\s*\()/.test(file.content) ||
            /listen(?:<|\s*\()/.test(file.content) ||
            /export\s+(?:async\s+)?function\s+[A-Za-z0-9_$]+\s*\(/.test(file.content))
    );
}

/** @function isRegistryOrCommandOrLayoutFile */
function isRegistryOrCommandOrLayoutFile(path: string): boolean {
    return (
        path === "src/App.tsx" ||
        path.startsWith("src/layout/") ||
        path.startsWith("src/commands/") ||
        path.startsWith("src/registry/") ||
        path.startsWith("src/devtools/")
    );
}

/** @function isExcludedModulePath */
function isExcludedModulePath(path: string): boolean {
    return (
        path.endsWith(".test.ts") ||
        path.endsWith(".test.tsx") ||
        path.startsWith("src/devtools/architecture/architectureDiscovery")
    );
}