/**
 * @module plugins/architecture-devtools/architectureDiscovery
 * @description 基于源码文本自动发现架构节点与依赖关系，生成供 DevTools 使用的架构切片。
 *
 *   该模块不维护手工架构清单，而是通过以下方式构建图谱：
 *   - 扫描 `src/` 下的 TS/TSX 源码，识别插件、模块、Store、事件与前端 API。
 *   - 扫描 `src-tauri/src/` 下的 Rust 源文件中的 Tauri 命令与模块 manifest，识别后端接口与模块边界。
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

interface ParsedBackendSurface {
    namespace: string;
    allowedPaths: string[];
    rationale: string;
    location: string;
}

interface ParsedBackendBoundary {
    namespace: string;
    allowedPaths: string[];
    rationale: string;
    location: string;
}

interface ParsedBackendEventDescriptor {
    id: string;
    kind: string;
    location: string;
}

interface ParsedBackendModule {
    moduleId: string;
    summary: string;
    location: string;
    commandSourcePaths: string[];
    eventDescriptors: ParsedBackendEventDescriptor[];
    publicSurfaces: ParsedBackendSurface[];
    privateBoundaries: ParsedBackendBoundary[];
    details: string[];
}

const HARD_INFRASTRUCTURE_MODULE_PREFIXES = [
    "src/host/events/",
    "src/host/registry/",
    "src/host/commands/",
    "src/host/settings/",
    "src/host/store/",
    "src/host/layout/sidebar/",
] as const;

const INFRASTRUCTURE_MODULE_PREFIXES = [
    "src/host/events/",
    "src/host/registry/",
    "src/host/commands/",
    "src/host/settings/",
    "src/host/store/",
    "src/host/layout/sidebar/",
] as const;

const INFRASTRUCTURE_MODULE_PATHS = new Set([
    "src/host/layout/DockviewLayout.tsx",
    "src/host/layout/MoveFileDirectoryModal.tsx",
    "src/host/layout/nativeContextMenu.ts",
    "src/host/layout/panelOrderUtils.ts",
    "src/host/layout/openFileService.ts",
    "src/host/layout/index.ts",
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
    const backendSourceFiles = collectBackendSourceFiles(backendModules);
    const backendSourceFileMap = new Map(backendSourceFiles.map((file) => [file.path, file]));
    const sourceFileMap = new Map(sourceFiles.map((file) => [file.path, file]));
    const importersByPath = buildImportersMap(sourceFiles);
    const moduleLayerCache = new Map<string, ArchitectureModuleLayer>();
    const backendCommands = Object.entries(backendModules).flatMap(([rawPath, content]) => {
        return parseBackendCommands(content, normalizeSourcePath(rawPath));
    });
    const backendModulesGraph = parseBackendModules(backendSourceFiles, backendSourceFileMap);

    const pluginFiles = sourceFiles.filter((file) => isPluginFile(file.path));
    const storeFiles = sourceFiles.filter((file) => isStoreFile(file.path));
    const busFile = sourceFileMap.get("src/host/events/appEventBus.ts") ?? sourceFileMap.get("src/events/appEventBus.ts") ?? null;
    const apiFiles = sourceFiles.filter((file) => isFrontendApiSourceFile(file));
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
    const backendModuleNodeIdMap = new Map<string, string>();
    const backendEventNodeIdMap = new Map<string, string>();

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
            location: "src/host/events/appEventBus.ts",
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

    backendModulesGraph.forEach((backendModule) => {
        const moduleNodeId = `backend-module:${backendModule.moduleId}`;
        nodes.push({
            id: moduleNodeId,
            title: backendModule.moduleId,
            kind: "backend-module",
            summary: backendModule.summary,
            location: backendModule.location,
            details: backendModule.details,
        });
        backendModuleNodeIdMap.set(backendModule.moduleId, moduleNodeId);

        backendModule.eventDescriptors.forEach((eventDescriptor) => {
            const eventNodeId = `backend-event:${eventDescriptor.id}`;
            if (!backendEventNodeIdMap.has(eventDescriptor.id)) {
                nodes.push({
                    id: eventNodeId,
                    title: eventDescriptor.id,
                    kind: "backend-event",
                    summary: `后端事件：${eventDescriptor.kind}`,
                    location: eventDescriptor.location,
                    details: [`kind: ${eventDescriptor.kind}`],
                });
                backendEventNodeIdMap.set(eventDescriptor.id, eventNodeId);
            }

            edges.push({
                from: eventNodeId,
                to: moduleNodeId,
                kind: "owned-by-backend-module",
                label: eventDescriptor.kind,
            });
        });
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

    backendModulesGraph.forEach((backendModule) => {
        const moduleNodeId = backendModuleNodeIdMap.get(backendModule.moduleId);
        if (!moduleNodeId) {
            return;
        }

        backendModule.commandSourcePaths.forEach((commandSourcePath) => {
            backendCommands
                .filter((command) => command.location === commandSourcePath)
                .forEach((command) => {
                    const commandNodeId = backendNodeIdMap.get(command.name);
                    if (!commandNodeId) {
                        return;
                    }

                    edges.push({
                        from: commandNodeId,
                        to: moduleNodeId,
                        kind: "implemented-by-backend-module",
                        label: "command",
                    });
                });
        });
    });

    edges.push(
        ...buildBackendModuleDependencyEdges(
            backendSourceFiles,
            backendModulesGraph,
            backendModuleNodeIdMap,
        ),
    );

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
 * @function collectBackendSourceFiles
 * @description 收集后端 Rust 源文件，供后端架构扫描使用。
 * @param backendModules 后端原始模块映射。
 * @returns 后端源码记录列表。
 */
function collectBackendSourceFiles(
    backendModules: RawModuleMap,
): Array<{ path: string; content: string }> {
    return Object.entries(backendModules)
        .map(([rawPath, content]) => ({
            path: normalizeSourcePath(rawPath),
            content,
        }))
        .filter((entry) => entry.path.startsWith("src-tauri/src/"));
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
            const localNameParts = clean.split(" as ");
            const localName = localNameParts[localNameParts.length - 1]?.trim();
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

    if (path.startsWith("src/plugins/architecture-devtools/") || /KnowledgeGraph|knowledgeGraph/.test(path)) {
        cache.set(path, "plugin-logic");
        visiting.delete(path);
        return "plugin-logic";
    }

    if (path.startsWith("src/plugins/")) {
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
    const regex = /#\[tauri::command\]\s+pub\s+(?:async\s+)?fn\s+([a-zA-Z0-9_]+)\s*\(/g;

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
 * @function buildBackendModuleDependencyEdges
 * @description 基于 Rust `use crate::...` 导入生成后端模块之间的依赖边。
 * @param backendFiles 后端源码文件记录。
 * @param backendModules 后端模块描述列表。
 * @param backendModuleNodeIdMap 后端模块节点映射。
 * @returns 模块依赖边列表。
 */
function buildBackendModuleDependencyEdges(
    backendFiles: Array<{ path: string; content: string }>,
    backendModules: ParsedBackendModule[],
    backendModuleNodeIdMap: Map<string, string>,
): ArchitectureEdge[] {
    const ownerships = buildBackendModuleOwnerships(backendModules);
    const dependencyMap = new Map<string, ArchitectureEdge>();

    backendFiles.forEach((file) => {
        const importerModuleId = resolveBackendModuleOwnerForPath(file.path, ownerships);
        if (!importerModuleId) {
            return;
        }

        const runtimeContent = file.content.split(/\n#\[cfg\(test\)\]/)[0] ?? file.content;
        const useStatements = extractRustUseStatements(runtimeContent);

        useStatements.forEach((useStatement) => {
            const targetRule = resolveBackendImportRule(useStatement, importerModuleId, ownerships);
            if (!targetRule) {
                return;
            }

            const fromNodeId = backendModuleNodeIdMap.get(importerModuleId);
            const toNodeId = backendModuleNodeIdMap.get(targetRule.moduleId);
            if (!fromNodeId || !toNodeId || fromNodeId === toNodeId) {
                return;
            }

            const edgeId = `${fromNodeId}->${toNodeId}:depends-on-backend-module:module dependency`;
            const detailPrefix = targetRule.visibility === "public" ? "public" : "private";
            const detail = `${detailPrefix} · ${shortenRustNamespace(targetRule.namespace)} ← ${file.path}`;
            const existing = dependencyMap.get(edgeId);

            if (!existing) {
                dependencyMap.set(edgeId, {
                    from: fromNodeId,
                    to: toNodeId,
                    kind: "depends-on-backend-module",
                    label: "module dependency",
                    details: [detail],
                });
                return;
            }

            dependencyMap.set(edgeId, {
                ...existing,
                details: Array.from(new Set([...(existing.details ?? []), detail])),
            });
        });
    });

    return Array.from(dependencyMap.values());
}

interface BackendModuleOwnership {
    moduleId: string;
    pathPatterns: string[];
    namespaceRules: Array<{
        namespace: string;
        visibility: "public" | "private";
    }>;
}

/**
 * @function buildBackendModuleOwnerships
 * @description 为每个后端模块构建源码归属模式与命名空间规则。
 * @param backendModules 后端模块描述列表。
 * @returns 模块归属规则列表。
 */
function buildBackendModuleOwnerships(
    backendModules: ParsedBackendModule[],
): BackendModuleOwnership[] {
    return backendModules.map((backendModule) => ({
        moduleId: backendModule.moduleId,
        pathPatterns: Array.from(new Set([
            backendModule.location,
            ...backendModule.commandSourcePaths,
            ...backendModule.eventDescriptors.map((descriptor) => descriptor.location),
            ...backendModule.publicSurfaces.flatMap((surface) => namespaceToPathPatterns(surface.namespace)),
            ...backendModule.privateBoundaries.flatMap((boundary) => namespaceToPathPatterns(boundary.namespace)),
        ])),
        namespaceRules: [
            ...backendModule.publicSurfaces.map((surface) => ({
                namespace: surface.namespace,
                visibility: "public" as const,
            })),
            ...backendModule.privateBoundaries.map((boundary) => ({
                namespace: boundary.namespace,
                visibility: "private" as const,
            })),
        ],
    }));
}

/**
 * @function namespaceToPathPatterns
 * @description 将 Rust namespace 前缀转换为源码路径模式。
 * @param namespace Rust 命名空间。
 * @returns 路径模式列表。
 */
function namespaceToPathPatterns(namespace: string): string[] {
    const normalized = namespace.replace(/^crate::/, "").replace(/::$/, "");
    if (!normalized) {
        return [];
    }

    const pathBase = `src-tauri/src/${normalized.replace(/::/g, "/")}`;
    return [`${pathBase}.rs`, `${pathBase}/`];
}

/**
 * @function resolveBackendModuleOwnerForPath
 * @description 根据源码路径解析所属后端模块，优先取最长匹配规则。
 * @param filePath 源码路径。
 * @param ownerships 模块归属规则列表。
 * @returns 所属模块 ID。
 */
function resolveBackendModuleOwnerForPath(
    filePath: string,
    ownerships: BackendModuleOwnership[],
): string {
    let bestModuleId = "";
    let bestScore = -1;

    ownerships.forEach((ownership) => {
        ownership.pathPatterns.forEach((pattern) => {
            const matches = pattern.endsWith("/")
                ? filePath.startsWith(pattern)
                : filePath === pattern;
            if (!matches) {
                return;
            }

            if (pattern.length > bestScore) {
                bestModuleId = ownership.moduleId;
                bestScore = pattern.length;
            }
        });
    });

    return bestModuleId;
}

/**
 * @function extractRustUseStatements
 * @description 提取 Rust 运行时代码中的 `use crate::...` 导入语句。
 * @param content Rust 源码。
 * @returns use 语句列表。
 */
function extractRustUseStatements(content: string): string[] {
    return content
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => (line.startsWith("use ") || line.startsWith("pub use ")) && line.includes("crate::"));
}

/**
 * @function resolveBackendImportRule
 * @description 将导入语句映射到被依赖的后端模块命名空间规则。
 * @param useStatement Rust 导入语句。
 * @param importerModuleId 导入方模块 ID。
 * @param ownerships 模块归属规则列表。
 * @returns 命中的模块规则。
 */
function resolveBackendImportRule(
    useStatement: string,
    importerModuleId: string,
    ownerships: BackendModuleOwnership[],
): { moduleId: string; namespace: string; visibility: "public" | "private" } | null {
    const normalizedStatement = useStatement.replace(/\s+/g, " ");
    let bestMatch: { moduleId: string; namespace: string; visibility: "public" | "private" } | null = null;
    let bestScore = -1;

    ownerships.forEach((ownership) => {
        if (ownership.moduleId === importerModuleId) {
            return;
        }

        ownership.namespaceRules.forEach((rule) => {
            const namespaceNeedle = rule.namespace.replace(/::$/, "");
            if (!normalizedStatement.includes(namespaceNeedle)) {
                return;
            }

            if (namespaceNeedle.length > bestScore) {
                bestMatch = {
                    moduleId: ownership.moduleId,
                    namespace: rule.namespace,
                    visibility: rule.visibility,
                };
                bestScore = namespaceNeedle.length;
            }
        });
    });

    return bestMatch;
}

/**
 * @function parseBackendModules
 * @description 基于后端模块 contribution 源码解析后端模块图。
 * @param backendFiles 后端源码文件记录。
 * @param backendSourceFileMap 后端源码映射。
 * @returns 后端模块描述列表。
 */
function parseBackendModules(
    backendFiles: Array<{ path: string; content: string }>,
    backendSourceFileMap: Map<string, { path: string; content: string }>,
): ParsedBackendModule[] {
    return backendFiles
        .filter((file) => file.path.endsWith("module_contribution.rs"))
        .map((file) => parseBackendModule(file.path, file.content, backendSourceFileMap))
        .filter((module): module is ParsedBackendModule => module !== null);
}

/**
 * @function parseBackendModule
 * @description 解析单个后端模块 contribution 文件。
 * @param location 源码位置。
 * @param content 源码内容。
 * @param backendSourceFileMap 后端源码映射。
 * @returns 模块描述；无法识别时返回 null。
 */
function parseBackendModule(
    location: string,
    content: string,
    backendSourceFileMap: Map<string, { path: string; content: string }>,
): ParsedBackendModule | null {
    const imports = parseRustImports(content);
    const contributionFunctionName = findBackendContributionFunctionName(content);
    if (!contributionFunctionName) {
        return null;
    }

    const contributionBody = extractNamedFunctionBody(content, contributionFunctionName);
    if (!contributionBody) {
        return null;
    }

    const moduleId = extractRustFieldStringLiteral(contributionBody, "module_id");
    if (!moduleId) {
        return null;
    }

    const commandSourcePaths = resolveRustReferenceSourcePaths(
        extractRustFieldExpression(contributionBody, "command_ids"),
        content,
        imports,
        backendSourceFileMap,
    );
    const eventDescriptors = parseReferencedBackendEvents(
        extractRustFieldExpression(contributionBody, "events"),
        content,
        imports,
        backendSourceFileMap,
    );
    const persistenceOwners = resolveRustStringValues(
        extractRustFieldExpression(contributionBody, "persistence_owners"),
        content,
        imports,
        backendSourceFileMap,
    );
    const publicSurfaces = parseBackendPublicSurfaces(location, content);
    const privateBoundaries = parseBackendPrivateBoundaries(location, content);

    return {
        moduleId,
        summary: extractPrimaryDescription(content) || `后端模块：${moduleId}`,
        location,
        commandSourcePaths,
        eventDescriptors,
        publicSurfaces,
        privateBoundaries,
        details: [
            `commands: ${commandSourcePaths.length}`,
            `events: ${eventDescriptors.length}`,
            `persistence owners: ${persistenceOwners.length}`,
            ...publicSurfaces.map((surface) => `public surface: ${shortenRustNamespace(surface.namespace)}`),
            ...privateBoundaries.map((boundary) => `private boundary: ${shortenRustNamespace(boundary.namespace)}`),
        ],
    };
}

/**
 * @function findBackendContributionFunctionName
 * @description 查找后端模块 contribution 函数名。
 * @param content 源码内容。
 * @returns 函数名。
 */
function findBackendContributionFunctionName(content: string): string {
    return content.match(/fn\s+([a-z0-9_]+_backend_module_contribution)\s*\(/)?.[1] ?? "";
}

/**
 * @function extractNamedFunctionBody
 * @description 提取具名函数体文本。
 * @param content 源码内容。
 * @param functionName 函数名。
 * @returns 函数体文本。
 */
function extractNamedFunctionBody(content: string, functionName: string): string {
    const startIndex = content.search(new RegExp(`fn\\s+${functionName}\\s*\\(`));
    if (startIndex < 0) {
        return "";
    }

    return extractFunctionBody(content, startIndex);
}

/**
 * @function extractRustFieldExpression
 * @description 提取 Rust 结构体字面量字段表达式。
 * @param body 文本。
 * @param fieldName 字段名。
 * @returns 字段表达式。
 */
function extractRustFieldExpression(body: string, fieldName: string): string {
    const match = body.match(new RegExp(`${fieldName}:\\s*([^,\\n]+)`, "m"));
    return match?.[1]?.trim() ?? "";
}

/**
 * @function extractRustFieldStringLiteral
 * @description 提取 Rust 结构体字段中的字符串字面量。
 * @param body 文本。
 * @param fieldName 字段名。
 * @returns 字符串值。
 */
function extractRustFieldStringLiteral(body: string, fieldName: string): string {
    return extractRustFieldExpression(body, fieldName).match(/^"([^"]+)"$/)?.[1] ?? "";
}

/**
 * @function parseBackendPublicSurfaces
 * @description 解析模块文件中的公共依赖面声明。
 * @param location 源码位置。
 * @param content 源码内容。
 * @returns 公共依赖面列表。
 */
function parseBackendPublicSurfaces(location: string, content: string): ParsedBackendSurface[] {
    return Array.from(content.matchAll(/BackendModulePublicSurface\s*\{([\s\S]*?)\n\s*\}/g)).map((match) => {
        const body = match[1] ?? "";
        return {
            namespace: extractRustStringField(body, "namespace"),
            allowedPaths: extractRustStringArrayField(body, "allowed_paths"),
            rationale: extractRustStringField(body, "rationale"),
            location,
        };
    }).filter((surface) => Boolean(surface.namespace));
}

/**
 * @function parseBackendPrivateBoundaries
 * @description 解析模块文件中的私有边界模板。
 * @param location 源码位置。
 * @param content 源码内容。
 * @returns 私有边界列表。
 */
function parseBackendPrivateBoundaries(location: string, content: string): ParsedBackendBoundary[] {
    return Array.from(content.matchAll(/ModulePrivateNamespaceTemplate\s*\{([\s\S]*?)\n\s*\}/g)).map((match) => {
        const body = match[1] ?? "";
        return {
            namespace: extractRustStringField(body, "namespace"),
            allowedPaths: extractRustStringArrayField(body, "allowed_paths"),
            rationale: extractRustStringField(body, "rationale"),
            location,
        };
    }).filter((boundary) => Boolean(boundary.namespace));
}

/**
 * @function parseReferencedBackendEvents
 * @description 解析模块引用的后端事件描述。
 * @param expression 事件字段表达式。
 * @param currentPath 当前文件路径。
 * @param currentContent 当前文件内容。
 * @param imports Rust 导入映射。
 * @param backendSourceFileMap 后端源码映射。
 * @returns 事件描述列表。
 */
function parseReferencedBackendEvents(
    expression: string,
    currentContent: string,
    imports: Map<string, string>,
    backendSourceFileMap: Map<string, { path: string; content: string }>,
): ParsedBackendEventDescriptor[] {
    const sourcePaths = resolveRustReferenceSourcePaths(
        expression,
        currentContent,
        imports,
        backendSourceFileMap,
    );

    return sourcePaths.flatMap((sourcePath) => {
        const targetFile = backendSourceFileMap.get(sourcePath);
        if (!targetFile) {
            return [];
        }

        const stringConstants = parseRustStringConstants(targetFile.content);
        return Array.from(targetFile.content.matchAll(/BackendEventDescriptor::new\(\s*([A-Z0-9_]+|"[^"]+")\s*,\s*BackendEventKind::([A-Za-z]+)\s*,?\s*\)/g)).map((match) => {
            const rawId = match[1] ?? "";
            return {
                id: rawId.startsWith("\"")
                    ? rawId.replace(/^"|"$/g, "")
                    : (stringConstants.get(rawId) ?? rawId),
                kind: match[2] ?? "Unknown",
                location: sourcePath,
            };
        });
    });
}

/**
 * @function resolveRustReferenceSourcePaths
 * @description 将 Rust 字段表达式解析为其引用的源码文件路径。
 * @param expression 字段表达式。
 * @param currentPath 当前文件路径。
 * @param currentContent 当前文件内容。
 * @param imports Rust 导入映射。
 * @param backendSourceFileMap 后端源码映射。
 * @returns 源码文件路径列表。
 */
function resolveRustReferenceSourcePaths(
    expression: string,
    currentContent: string,
    imports: Map<string, string>,
    backendSourceFileMap: Map<string, { path: string; content: string }>,
): string[] {
    if (!expression || expression === "&[]") {
        return [];
    }

    const rootIdentifier = expression.match(/^([A-Z0-9_]+)/)?.[1] ?? "";
    if (!rootIdentifier) {
        return [];
    }

    const importedPath = imports.get(rootIdentifier);
    if (importedPath) {
        return backendSourceFileMap.has(importedPath) ? [importedPath] : [];
    }

    const localConstBody = extractRustConstArrayBody(currentContent, rootIdentifier);
    if (!localConstBody) {
        return [];
    }

    return Array.from(localConstBody.matchAll(/([A-Z0-9_]+)(?:\[[0-9]+\])?/g))
        .map((match) => imports.get(match[1] ?? "") ?? "")
        .filter((path) => backendSourceFileMap.has(path));
}

/**
 * @function resolveRustStringValues
 * @description 解析 Rust 字符串数组表达式中的字符串值。
 * @param expression 字段表达式。
 * @param currentPath 当前文件路径。
 * @param currentContent 当前文件内容。
 * @param imports Rust 导入映射。
 * @param backendSourceFileMap 后端源码映射。
 * @returns 字符串值列表。
 */
function resolveRustStringValues(
    expression: string,
    currentContent: string,
    imports: Map<string, string>,
    backendSourceFileMap: Map<string, { path: string; content: string }>,
): string[] {
    if (!expression || expression === "&[]") {
        return [];
    }

    const inlineValues = Array.from(expression.matchAll(/"([^"]+)"/g)).map((match) => match[1] ?? "");
    if (inlineValues.length > 0) {
        return inlineValues;
    }

    const rootIdentifier = expression.match(/^([A-Z0-9_]+)/)?.[1] ?? "";
    if (!rootIdentifier) {
        return [];
    }

    const importedPath = imports.get(rootIdentifier);
    if (importedPath) {
        const importedFile = backendSourceFileMap.get(importedPath);
        const arrayBody = extractRustConstArrayBody(importedFile?.content ?? "", rootIdentifier);
        return Array.from(arrayBody.matchAll(/"([^"]+)"/g)).map((match) => match[1] ?? "");
    }

    const localConstBody = extractRustConstArrayBody(currentContent, rootIdentifier);
    return Array.from(localConstBody.matchAll(/"([^"]+)"/g)).map((match) => match[1] ?? "");
}

/**
 * @function parseRustImports
 * @description 解析 Rust use 语句，建立符号到源码文件的映射。
 * @param content Rust 源码。
 * @returns 导入映射。
 */
function parseRustImports(content: string): Map<string, string> {
    const imports = new Map<string, string>();

    for (const match of content.matchAll(/use\s+crate::([a-zA-Z0-9_:]+)::\{([\s\S]*?)\};/g)) {
        const modulePath = match[1] ?? "";
        const names = (match[2] ?? "")
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean);
        names.forEach((name) => {
            imports.set(name, rustModulePathToSourcePath(`${modulePath}::${name}`));
        });
    }

    for (const match of content.matchAll(/use\s+crate::([a-zA-Z0-9_:]+)::([A-Z0-9_]+);/g)) {
        const modulePath = match[1] ?? "";
        const name = match[2] ?? "";
        imports.set(name, rustModulePathToSourcePath(`${modulePath}::${name}`));
    }

    return imports;
}

/**
 * @function rustModulePathToSourcePath
 * @description 将 Rust crate 模块路径映射为源码文件路径。
 * @param rustPath Rust 模块路径。
 * @returns 源码路径。
 */
function rustModulePathToSourcePath(rustPath: string): string {
    const segments = rustPath.replace(/^crate::/, "").split("::");
    return `src-tauri/src/${segments.slice(0, -1).join("/")}.rs`;
}

/**
 * @function extractRustConstArrayBody
 * @description 提取 Rust const 数组主体。
 * @param content 源码内容。
 * @param constName 常量名。
 * @returns 数组主体文本。
 */
function extractRustConstArrayBody(content: string, constName: string): string {
    return content.match(new RegExp(`const\\s+${constName}:[^=]+=\\s*&\\[([\\s\\S]*?)\\];`))?.[1] ?? "";
}

/**
 * @function extractRustStringField
 * @description 提取 Rust 结构体体内的字符串字段。
 * @param body 结构体体文本。
 * @param fieldName 字段名。
 * @returns 字符串值。
 */
function extractRustStringField(body: string, fieldName: string): string {
    return body.match(new RegExp(`${fieldName}:\\s*"([^"]+)"`))?.[1] ?? "";
}

/**
 * @function extractRustStringArrayField
 * @description 提取 Rust 结构体体内的字符串数组字段。
 * @param body 结构体体文本。
 * @param fieldName 字段名。
 * @returns 字符串数组。
 */
function extractRustStringArrayField(body: string, fieldName: string): string[] {
    const arrayBody = body.match(new RegExp(`${fieldName}:\\s*&\\[([\\s\\S]*?)\\]`))?.[1] ?? "";
    return Array.from(arrayBody.matchAll(/"([^"]+)"/g)).map((match) => match[1] ?? "");
}

/**
 * @function parseRustStringConstants
 * @description 解析 Rust 字符串常量。
 * @param content 源码内容。
 * @returns 常量映射。
 */
function parseRustStringConstants(content: string): Map<string, string> {
    const constants = new Map<string, string>();
    for (const match of content.matchAll(/(?:pub(?:\([^)]*\))?\s+)?const\s+([A-Z0-9_]+):\s*&str\s*=\s*"([^"]+)";/g)) {
        constants.set(match[1] ?? "", match[2] ?? "");
    }
    return constants;
}

/**
 * @function shortenRustNamespace
 * @description 缩短 Rust 命名空间以便图中展示。
 * @param namespace 原始命名空间。
 * @returns 缩短后的名称。
 */
function shortenRustNamespace(namespace: string): string {
    return namespace.replace(/^crate::/, "");
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
    const pathSegments = path.split("/");
    const fileName = pathSegments[pathSegments.length - 1] ?? path;
    const baseName = fileName.replace(/\.(ts|tsx)$/, "");
    if (baseName === "index") {
        return pathSegments[pathSegments.length - 2] ?? baseName;
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
        const edgeId = `${edge.from}->${edge.to}:${edge.kind}:${edge.label ?? ""}`;
        const existing = map.get(edgeId);
        if (!existing) {
            map.set(edgeId, edge);
            return;
        }

        map.set(edgeId, {
            ...existing,
            details: Array.from(new Set([...(existing.details ?? []), ...(edge.details ?? [])])),
        });
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
    return /^src\/plugins\/(?:.+\/)?[A-Za-z0-9_$-]+Plugin\.tsx?$/.test(path);
}

/** @function isStoreFile */
function isStoreFile(path: string): boolean {
    return (
        path.startsWith("src/host/store/") &&
        !path.endsWith(".test.ts")
    );
}

/** @function isEventFile */
function isEventFile(path: string): boolean {
    return (
        (path.startsWith("src/host/events/") || path.startsWith("src/events/")) &&
        !path.endsWith(".test.ts")
    );
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
        path.startsWith("src/host/layout/") ||
        path.startsWith("src/plugins/") ||
        path.startsWith("src/host/commands/") ||
        path.startsWith("src/host/registry/") ||
        path.startsWith("src/host/settings/")
    );
}

/** @function isExcludedModulePath */
function isExcludedModulePath(path: string): boolean {
    return (
        path.endsWith(".test.ts") ||
        path.endsWith(".test.tsx") ||
        path.startsWith("src/plugins/architecture-devtools/architectureDiscovery")
    );
}