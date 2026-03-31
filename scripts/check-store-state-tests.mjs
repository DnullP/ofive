/**
 * @file scripts/check-store-state-tests.mjs
 * @description store 状态全流程测试守卫：优先基于 store 注册逻辑发现受治理 store，
 *   并要求所有 store 逻辑与关键 store 使用逻辑都映射到真实测试锚点。
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import {
    explicitlyGovernedStoreLogicModules,
    storeConsumerCoverage,
    storeLogicCoverage,
    storeSchemaCoverage,
} from "./store-state-flow-coverage.config.mjs";

const ROOT = process.cwd();
const SRC_ROOT = path.join(ROOT, "src");
const TEST_FILE_RE = /\.(test|e2e|perf)\.(ts|tsx)$/;
const IMPORT_RE = /import\s+(?:type\s+)?([\s\S]*?)\s+from\s+["']([^"']+)["']/g;
const STORE_REGISTRATION_CALL_RE = /\b(registerManagedStore|registerPluginOwnedStore)\s*\(/g;
const SNAPSHOT_IDENTIFIER_RE = /getSnapshot\s*:\s*(?:\(\)\s*=>\s*)?([A-Za-z_$][A-Za-z0-9_$]*)/g;
const SUBSCRIBE_IDENTIFIER_RE = /subscribe\s*:\s*(?:\([^)]*\)\s*=>\s*)?([A-Za-z_$][A-Za-z0-9_$]*)/g;

function walkFiles(directory) {
    const entries = readdirSync(directory, { withFileTypes: true });
    const results = [];

    for (const entry of entries) {
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            results.push(...walkFiles(fullPath));
            continue;
        }

        results.push(fullPath);
    }

    return results;
}

function toRelative(filePath) {
    return path.relative(ROOT, filePath).split(path.sep).join("/");
}

function resolveImport(fromFile, importPath) {
    if (!importPath.startsWith(".")) {
        return null;
    }

    const base = path.resolve(path.dirname(fromFile), importPath);
    const candidates = [
        base,
        `${base}.ts`,
        `${base}.tsx`,
        `${base}.js`,
        `${base}.jsx`,
        path.join(base, "index.ts"),
        path.join(base, "index.tsx"),
    ];

    return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function parseImportedBindings(fromFile, content) {
    const bindings = new Map();

    IMPORT_RE.lastIndex = 0;
    let match;
    while ((match = IMPORT_RE.exec(content)) !== null) {
        if (/^import\s+type\b/.test(match[0] ?? "")) {
            continue;
        }

        const importPath = match[2] ?? "";
        const resolvedImport = resolveImport(fromFile, importPath);
        if (!resolvedImport) {
            continue;
        }

        const importClause = match[1] ?? "";
        const namedImportsMatch = importClause.match(/\{([\s\S]*)\}/);
        if (!namedImportsMatch) {
            continue;
        }

        namedImportsMatch[1]
            .split(",")
            .map((specifier) => specifier.trim())
            .filter(Boolean)
            .forEach((specifier) => {
                const aliasMatch = specifier.match(/^([A-Za-z_$][A-Za-z0-9_$]*)(?:\s+as\s+([A-Za-z_$][A-Za-z0-9_$]*))?$/);
                if (!aliasMatch) {
                    return;
                }

                const localName = aliasMatch[2] ?? aliasMatch[1];
                bindings.set(localName, resolvedImport);
            });
    }

    return bindings;
}

function extractIdentifiers(content, pattern) {
    const identifiers = new Set();
    pattern.lastIndex = 0;

    let match;
    while ((match = pattern.exec(content)) !== null) {
        const identifier = match[1] ?? "";
        if (identifier.length > 0) {
            identifiers.add(identifier);
        }
    }

    return identifiers;
}

function discoverRegisteredStoreModules(sourceFiles) {
    const discoveredModules = new Set();
    const schemaCoverageByModule = new Map();
    const failures = [];

    for (const sourceFile of sourceFiles) {
        const content = readFileSync(sourceFile, "utf8");
        const importedBindings = parseImportedBindings(sourceFile, content);
        const matchedRegistrationCalls = new Set();

        STORE_REGISTRATION_CALL_RE.lastIndex = 0;
        let registrationMatch;
        while ((registrationMatch = STORE_REGISTRATION_CALL_RE.exec(content)) !== null) {
            const registrationIdentifier = registrationMatch[1] ?? "";
            if (importedBindings.has(registrationIdentifier)) {
                matchedRegistrationCalls.add(registrationIdentifier);
            }
        }

        if (matchedRegistrationCalls.size === 0) {
            continue;
        }

        const identifiers = new Set([
            ...extractIdentifiers(content, SNAPSHOT_IDENTIFIER_RE),
            ...extractIdentifiers(content, SUBSCRIBE_IDENTIFIER_RE),
        ]);

        const parsedSchemaCoverage = parseSchemaCoverageRequirements(content);
        if (!parsedSchemaCoverage) {
            failures.push(`unable to parse store schema coverage requirements from registration file: ${toRelative(sourceFile)}`);
            continue;
        }

        const resolvedModules = new Set();
        identifiers.forEach((identifier) => {
            const resolvedImport = importedBindings.get(identifier);
            if (resolvedImport) {
                resolvedModules.add(toRelative(resolvedImport));
            }
        });

        if (resolvedModules.size === 0) {
            failures.push(`unable to resolve registered store module from registration file: ${toRelative(sourceFile)}`);
            continue;
        }

        resolvedModules.forEach((modulePath) => {
            discoveredModules.add(modulePath);
            schemaCoverageByModule.set(modulePath, parsedSchemaCoverage);
        });
    }

    return {
        discoveredModules,
        schemaCoverageByModule,
        failures,
    };
}

function extractBalancedBlock(content, startIndex, openChar, closeChar) {
    let depth = 0;

    for (let index = startIndex; index < content.length; index += 1) {
        const currentChar = content[index];
        if (currentChar === openChar) {
            depth += 1;
        } else if (currentChar === closeChar) {
            depth -= 1;
            if (depth === 0) {
                return content.slice(startIndex, index + 1);
            }
        }
    }

    return null;
}

function extractPropertyBlock(content, propertyName, openChar, closeChar) {
    const propertyPattern = new RegExp(`${propertyName}\\s*:\\s*\\${openChar}`);
    const match = propertyPattern.exec(content);
    if (!match || typeof match.index !== "number") {
        return null;
    }

    const blockStart = content.indexOf(openChar, match.index);
    if (blockStart === -1) {
        return null;
    }

    return extractBalancedBlock(content, blockStart, openChar, closeChar);
}

function extractStringValues(content, valuePattern) {
    const values = [];
    valuePattern.lastIndex = 0;

    let match;
    while ((match = valuePattern.exec(content)) !== null) {
        const value = match[1] ?? "";
        if (value.length > 0) {
            values.push(value);
        }
    }

    return values;
}

function parseSchemaCoverageRequirements(content) {
    const schemaBlock = extractPropertyBlock(content, "schema", "{", "}");
    if (!schemaBlock) {
        return null;
    }

    const actionsBlock = extractPropertyBlock(schemaBlock, "actions", "[", "]");
    const flowBlock = extractPropertyBlock(schemaBlock, "flow", "{", "}");
    if (!actionsBlock || !flowBlock) {
        return null;
    }

    const actionIds = extractStringValues(actionsBlock, /id\s*:\s*"([^"]+)"/g);
    const flowKindMatch = /kind\s*:\s*"([^"]+)"/.exec(flowBlock);
    const flowKind = flowKindMatch?.[1] ?? null;
    if (!flowKind) {
        return null;
    }

    let flowEntries = [];
    if (flowKind === "state-machine") {
        const transitionsBlock = extractPropertyBlock(flowBlock, "transitions", "[", "]");
        if (!transitionsBlock) {
            return null;
        }
        flowEntries = extractStringValues(transitionsBlock, /event\s*:\s*"([^"]+)"/g);
    } else if (flowKind === "value-space") {
        const triggersBlock = extractPropertyBlock(flowBlock, "updateTriggers", "[", "]");
        if (!triggersBlock) {
            return null;
        }
        flowEntries = extractStringValues(triggersBlock, /"([^"]+)"/g);
    } else {
        return null;
    }

    const failureModesBlock = extractPropertyBlock(flowBlock, "failureModes", "[", "]");
    if (!failureModesBlock) {
        return null;
    }

    return {
        actionIds,
        flowKind,
        flowEntries,
        failureModes: extractStringValues(failureModesBlock, /"([^"]+)"/g),
    };
}

function ensureNestedCoverageEntriesExist(coverageMap, label) {
    const failures = [];

    Object.entries(coverageMap).forEach(([modulePath, groups]) => {
        Object.entries(groups).forEach(([groupName, entries]) => {
            Object.entries(entries).forEach(([entryKey, tests]) => {
                if (!Array.isArray(tests) || tests.length === 0) {
                    failures.push(`${label} entry has no tests: ${modulePath} -> ${groupName}.${entryKey}`);
                    return;
                }

                tests.forEach((testPath) => {
                    if (!TEST_FILE_RE.test(testPath)) {
                        failures.push(`${label} test path is not a test file: ${modulePath} -> ${groupName}.${entryKey} -> ${testPath}`);
                        return;
                    }
                    if (!existsSync(path.join(ROOT, testPath))) {
                        failures.push(`${label} test file missing: ${modulePath} -> ${groupName}.${entryKey} -> ${testPath}`);
                    }
                });
            });
        });
    });

    return failures;
}

function ensureCoverageEntriesExist(coverageMap, label) {
    const failures = [];

    Object.entries(coverageMap).forEach(([modulePath, tests]) => {
        if (!existsSync(path.join(ROOT, modulePath))) {
            failures.push(`${label} module missing: ${modulePath}`);
        }

        if (!Array.isArray(tests) || tests.length === 0) {
            failures.push(`${label} module has no tests: ${modulePath}`);
            return;
        }

        tests.forEach((testPath) => {
            if (!TEST_FILE_RE.test(testPath)) {
                failures.push(`${label} test path is not a test file: ${modulePath} -> ${testPath}`);
                return;
            }
            if (!existsSync(path.join(ROOT, testPath))) {
                failures.push(`${label} test file missing: ${modulePath} -> ${testPath}`);
            }
        });
    });

    return failures;
}

const sourceFiles = walkFiles(SRC_ROOT)
    .filter((filePath) => /\.(ts|tsx)$/.test(filePath))
    .filter((filePath) => !TEST_FILE_RE.test(filePath));

const {
    discoveredModules: discoveredRegisteredStoreModules,
    schemaCoverageByModule,
    failures: registrationDiscoveryFailures,
} = discoverRegisteredStoreModules(sourceFiles);

const discoveredStoreLogicModules = new Set(discoveredRegisteredStoreModules);
explicitlyGovernedStoreLogicModules.forEach((modulePath) => discoveredStoreLogicModules.add(modulePath));

const storeLogicFailures = [];
for (const modulePath of discoveredStoreLogicModules) {
    if (!storeLogicCoverage[modulePath]) {
        storeLogicFailures.push(`missing store logic coverage entry: ${modulePath}`);
    }
}

Object.keys(storeLogicCoverage).forEach((modulePath) => {
    if (!discoveredStoreLogicModules.has(modulePath)) {
        storeLogicFailures.push(`stale store logic coverage entry: ${modulePath}`);
    }
});

const discoveredConsumerModules = new Set();
for (const sourceFile of sourceFiles) {
    const relativeSourceFile = toRelative(sourceFile);
    if (discoveredStoreLogicModules.has(relativeSourceFile)) {
        continue;
    }

    const content = readFileSync(sourceFile, "utf8");
    IMPORT_RE.lastIndex = 0;
    let match;
    while ((match = IMPORT_RE.exec(content)) !== null) {
        if (/^import\s+type\b/.test(match[0] ?? "")) {
            continue;
        }

        const importPath = match[2] ?? "";
        const resolvedImport = resolveImport(sourceFile, importPath);
        if (!resolvedImport) {
            continue;
        }

        const relativeImport = toRelative(resolvedImport);
        if (!discoveredStoreLogicModules.has(relativeImport)) {
            continue;
        }

        discoveredConsumerModules.add(relativeSourceFile);
        break;
    }
}

const storeConsumerFailures = [];
for (const modulePath of discoveredConsumerModules) {
    if (!storeConsumerCoverage[modulePath]) {
        storeConsumerFailures.push(`missing store consumer coverage entry: ${modulePath}`);
    }
}

Object.keys(storeConsumerCoverage).forEach((modulePath) => {
    if (!discoveredConsumerModules.has(modulePath)) {
        storeConsumerFailures.push(`stale store consumer coverage entry: ${modulePath}`);
    }
});

const coverageFailures = [
    ...ensureCoverageEntriesExist(storeLogicCoverage, "store logic"),
    ...ensureCoverageEntriesExist(storeConsumerCoverage, "store consumer"),
    ...ensureNestedCoverageEntriesExist(storeSchemaCoverage, "store schema"),
];

const storeSchemaFailures = [];
for (const modulePath of discoveredRegisteredStoreModules) {
    const expectedSchemaCoverage = schemaCoverageByModule.get(modulePath);
    const configuredSchemaCoverage = storeSchemaCoverage[modulePath];

    if (!expectedSchemaCoverage) {
        storeSchemaFailures.push(`missing parsed store schema requirements: ${modulePath}`);
        continue;
    }

    if (!configuredSchemaCoverage) {
        storeSchemaFailures.push(`missing store schema coverage entry: ${modulePath}`);
        continue;
    }

    expectedSchemaCoverage.actionIds.forEach((actionId) => {
        if (!configuredSchemaCoverage.actions?.[actionId]) {
            storeSchemaFailures.push(`missing store action coverage entry: ${modulePath} -> ${actionId}`);
        }
    });

    Object.keys(configuredSchemaCoverage.actions ?? {}).forEach((actionId) => {
        if (!expectedSchemaCoverage.actionIds.includes(actionId)) {
            storeSchemaFailures.push(`stale store action coverage entry: ${modulePath} -> ${actionId}`);
        }
    });

    expectedSchemaCoverage.flowEntries.forEach((flowEntry) => {
        if (!configuredSchemaCoverage.flow?.[flowEntry]) {
            storeSchemaFailures.push(`missing store flow coverage entry: ${modulePath} -> ${flowEntry}`);
        }
    });

    Object.keys(configuredSchemaCoverage.flow ?? {}).forEach((flowEntry) => {
        if (!expectedSchemaCoverage.flowEntries.includes(flowEntry)) {
            storeSchemaFailures.push(`stale store flow coverage entry: ${modulePath} -> ${flowEntry}`);
        }
    });

    expectedSchemaCoverage.failureModes.forEach((failureMode) => {
        if (!configuredSchemaCoverage.failureModes?.[failureMode]) {
            storeSchemaFailures.push(`missing store failure-mode coverage entry: ${modulePath} -> ${failureMode}`);
        }
    });

    Object.keys(configuredSchemaCoverage.failureModes ?? {}).forEach((failureMode) => {
        if (!expectedSchemaCoverage.failureModes.includes(failureMode)) {
            storeSchemaFailures.push(`stale store failure-mode coverage entry: ${modulePath} -> ${failureMode}`);
        }
    });
}

Object.keys(storeSchemaCoverage).forEach((modulePath) => {
    if (!discoveredRegisteredStoreModules.has(modulePath)) {
        storeSchemaFailures.push(`stale store schema coverage entry: ${modulePath}`);
    }
});

const failures = [
    ...registrationDiscoveryFailures,
    ...storeLogicFailures,
    ...storeSchemaFailures,
    ...storeConsumerFailures,
    ...coverageFailures,
];

if (failures.length > 0) {
    console.error("[store-state-test-guard] failed:");
    failures.forEach((failure) => {
        console.error(`- ${failure}`);
    });
    process.exit(1);
}

console.info(
    `[store-state-test-guard] passed (${discoveredRegisteredStoreModules.size} registered store modules, ${explicitlyGovernedStoreLogicModules.length} explicit governed state modules, ${discoveredConsumerModules.size} consumer modules)`,
);