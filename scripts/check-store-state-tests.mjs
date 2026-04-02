/**
 * @file scripts/check-store-state-tests.mjs
 * @description store 状态全流程测试守卫：优先基于 store 注册逻辑发现受治理 store，
 *   并要求所有 store 逻辑与关键 store 使用逻辑都映射到真实测试锚点。
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import {
    explicitlyGovernedStoreLogicModules,
    explicitStoreLogicCoverage,
    registeredStoreLogicCoverage,
    registeredStoreSchemaCoverage,
    storeConsumerCoverage,
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

function resolveStaticStringExpression(content, expression) {
    const normalizedExpression = expression.trim();
    const literalMatch = normalizedExpression.match(/^['"]([^'"]+)['"]$/);
    if (literalMatch) {
        return literalMatch[1];
    }

    const identifierMatch = normalizedExpression.match(/^([A-Za-z_$][A-Za-z0-9_$]*)$/);
    if (!identifierMatch) {
        return null;
    }

    const identifier = identifierMatch[1];
    const declarationPattern = new RegExp(
        `(?:export\\s+)?(?:const|let|var)\\s+${identifier}\\s*=\\s*['\"]([^'\"]+)['\"]`,
    );
    return declarationPattern.exec(content)?.[1] ?? null;
}

function inferRegisteredStoreCoverageKey(relativeSourceFile, content) {
    const pluginRegistrationMatch = content.match(/\bregisterPluginOwnedStore\s*\(\s*([^,\n]+)\s*,/);
    if (pluginRegistrationMatch) {
        const pluginId = resolveStaticStringExpression(content, pluginRegistrationMatch[1] ?? "");
        const storeId = content.match(/\bstoreId\s*:\s*"([^"]+)"/)?.[1] ?? null;
        if (!storeId) {
            return relativeSourceFile;
        }

        return pluginId ? `${pluginId}:${storeId}` : `${relativeSourceFile}::${storeId}`;
    }

    const managedStoreId = content.match(/\bid\s*:\s*"([^"]+)"/)?.[1] ?? null;
    return managedStoreId ?? relativeSourceFile;
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
    const discoveredStores = new Map();
    const storeCoverageKeyByModule = new Map();
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

        const coverageKey = inferRegisteredStoreCoverageKey(
            toRelative(sourceFile),
            content,
        );

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
            const existingStore = discoveredStores.get(coverageKey);
            if (existingStore && existingStore.modulePath !== modulePath) {
                failures.push(
                    `registered store coverage key collision: ${coverageKey} maps to both ${existingStore.modulePath} and ${modulePath}`,
                );
                return;
            }

            discoveredStores.set(coverageKey, {
                modulePath,
                schemaCoverage: parsedSchemaCoverage,
            });
            storeCoverageKeyByModule.set(modulePath, coverageKey);
        });
    }

    return {
        discoveredStores,
        storeCoverageKeyByModule,
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

function ensureNamedCoverageEntriesExist(coverageMap, label) {
    const failures = [];

    Object.entries(coverageMap).forEach(([coverageKey, tests]) => {
        if (!Array.isArray(tests) || tests.length === 0) {
            failures.push(`${label} entry has no tests: ${coverageKey}`);
            return;
        }

        tests.forEach((testPath) => {
            if (!TEST_FILE_RE.test(testPath)) {
                failures.push(`${label} test path is not a test file: ${coverageKey} -> ${testPath}`);
                return;
            }
            if (!existsSync(path.join(ROOT, testPath))) {
                failures.push(`${label} test file missing: ${coverageKey} -> ${testPath}`);
            }
        });
    });

    return failures;
}

const sourceFiles = walkFiles(SRC_ROOT)
    .filter((filePath) => /\.(ts|tsx)$/.test(filePath))
    .filter((filePath) => !TEST_FILE_RE.test(filePath));

const {
    discoveredStores: discoveredRegisteredStores,
    storeCoverageKeyByModule,
    failures: registrationDiscoveryFailures,
} = discoverRegisteredStoreModules(sourceFiles);

const discoveredRegisteredStoreCoverageKeys = new Set(discoveredRegisteredStores.keys());
const discoveredRegisteredStoreModules = new Set(
    Array.from(discoveredRegisteredStores.values()).map((store) => store.modulePath),
);

const discoveredStoreLogicModules = new Set(discoveredRegisteredStoreModules);
explicitlyGovernedStoreLogicModules.forEach((modulePath) => discoveredStoreLogicModules.add(modulePath));

const storeLogicFailures = [];
for (const coverageKey of discoveredRegisteredStoreCoverageKeys) {
    if (!registeredStoreLogicCoverage[coverageKey]) {
        const modulePath = discoveredRegisteredStores.get(coverageKey)?.modulePath ?? "unknown";
        storeLogicFailures.push(`missing registered store logic coverage entry: ${coverageKey} -> ${modulePath}`);
    }
}

Object.keys(registeredStoreLogicCoverage).forEach((coverageKey) => {
    if (!discoveredRegisteredStoreCoverageKeys.has(coverageKey)) {
        storeLogicFailures.push(`stale registered store logic coverage entry: ${coverageKey}`);
    }
});

for (const modulePath of explicitlyGovernedStoreLogicModules) {
    if (!explicitStoreLogicCoverage[modulePath]) {
        storeLogicFailures.push(`missing store logic coverage entry: ${modulePath}`);
    }
}

Object.keys(explicitStoreLogicCoverage).forEach((modulePath) => {
    if (!explicitlyGovernedStoreLogicModules.includes(modulePath)) {
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
    ...ensureNamedCoverageEntriesExist(registeredStoreLogicCoverage, "registered store logic"),
    ...ensureCoverageEntriesExist(explicitStoreLogicCoverage, "store logic"),
    ...ensureCoverageEntriesExist(storeConsumerCoverage, "store consumer"),
    ...ensureNestedCoverageEntriesExist(registeredStoreSchemaCoverage, "store schema"),
];

const storeSchemaFailures = [];
for (const [coverageKey, storeDescriptor] of discoveredRegisteredStores.entries()) {
    const expectedSchemaCoverage = storeDescriptor.schemaCoverage;
    const configuredSchemaCoverage = registeredStoreSchemaCoverage[coverageKey];
    const modulePath = storeDescriptor.modulePath;

    if (!expectedSchemaCoverage) {
        storeSchemaFailures.push(`missing parsed store schema requirements: ${coverageKey} -> ${modulePath}`);
        continue;
    }

    if (!configuredSchemaCoverage) {
        storeSchemaFailures.push(`missing store schema coverage entry: ${coverageKey} -> ${modulePath}`);
        continue;
    }

    expectedSchemaCoverage.actionIds.forEach((actionId) => {
        if (!configuredSchemaCoverage.actions?.[actionId]) {
            storeSchemaFailures.push(`missing store action coverage entry: ${coverageKey} -> ${actionId}`);
        }
    });

    Object.keys(configuredSchemaCoverage.actions ?? {}).forEach((actionId) => {
        if (!expectedSchemaCoverage.actionIds.includes(actionId)) {
            storeSchemaFailures.push(`stale store action coverage entry: ${coverageKey} -> ${actionId}`);
        }
    });

    expectedSchemaCoverage.flowEntries.forEach((flowEntry) => {
        if (!configuredSchemaCoverage.flow?.[flowEntry]) {
            storeSchemaFailures.push(`missing store flow coverage entry: ${coverageKey} -> ${flowEntry}`);
        }
    });

    Object.keys(configuredSchemaCoverage.flow ?? {}).forEach((flowEntry) => {
        if (!expectedSchemaCoverage.flowEntries.includes(flowEntry)) {
            storeSchemaFailures.push(`stale store flow coverage entry: ${coverageKey} -> ${flowEntry}`);
        }
    });

    expectedSchemaCoverage.failureModes.forEach((failureMode) => {
        if (!configuredSchemaCoverage.failureModes?.[failureMode]) {
            storeSchemaFailures.push(`missing store failure-mode coverage entry: ${coverageKey} -> ${failureMode}`);
        }
    });

    Object.keys(configuredSchemaCoverage.failureModes ?? {}).forEach((failureMode) => {
        if (!expectedSchemaCoverage.failureModes.includes(failureMode)) {
            storeSchemaFailures.push(`stale store failure-mode coverage entry: ${coverageKey} -> ${failureMode}`);
        }
    });
}

Object.keys(registeredStoreSchemaCoverage).forEach((coverageKey) => {
    if (!discoveredRegisteredStoreCoverageKeys.has(coverageKey)) {
        storeSchemaFailures.push(`stale store schema coverage entry: ${coverageKey}`);
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
    `[store-state-test-guard] passed (${discoveredRegisteredStoreCoverageKeys.size} registered stores, ${explicitlyGovernedStoreLogicModules.length} explicit governed state modules, ${discoveredConsumerModules.size} consumer modules)`,
);