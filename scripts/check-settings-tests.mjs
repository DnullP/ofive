/**
 * @file scripts/check-settings-tests.mjs
 * @description settings 中心化测试守卫：基于 settings 注册逻辑与中心消费入口自动发现
 *   settings 定义方和消费方，并要求它们至少被一个真实测试文件直接导入。
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const SRC_ROOT = path.join(ROOT, "src");
const TEST_FILE_RE = /\.(test|e2e|perf)\.(ts|tsx)$/;
const STATIC_IMPORT_RE = /import\s+(?:type\s+)?([\s\S]*?)\s+from\s+["']([^"']+)["']/g;
const DYNAMIC_IMPORT_RE = /import\(\s*["']([^"']+)["']\s*\)/g;
const SETTINGS_REGISTRATION_CALL_RE = /\b(registerSettingsSection|registerSettingsItem|registerSettingsItems)\s*\(/g;
const SETTINGS_REGISTRY_CONSUMER_EXPORTS = new Set([
    "useSettingsSections",
    "getSettingsSectionsSnapshot",
    "subscribeSettingsSections",
]);
const SETTINGS_LAYOUT_CONSUMER_EXPORTS = new Set([
    "SettingsTab",
]);

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
    const imports = [];

    STATIC_IMPORT_RE.lastIndex = 0;
    let match;
    while ((match = STATIC_IMPORT_RE.exec(content)) !== null) {
        if (/^import\s+type\b/.test(match[0] ?? "")) {
            continue;
        }

        const resolvedImport = resolveImport(fromFile, match[2] ?? "");
        if (!resolvedImport) {
            continue;
        }

        const localBindings = new Set();
        const importClause = match[1] ?? "";
        const namedImportsMatch = importClause.match(/\{([\s\S]*)\}/);
        if (namedImportsMatch) {
            namedImportsMatch[1]
                .split(",")
                .map((specifier) => specifier.trim())
                .filter(Boolean)
                .forEach((specifier) => {
                    const aliasMatch = specifier.match(/^([A-Za-z_$][A-Za-z0-9_$]*)(?:\s+as\s+([A-Za-z_$][A-Za-z0-9_$]*))?$/);
                    if (!aliasMatch) {
                        return;
                    }

                    localBindings.add(aliasMatch[2] ?? aliasMatch[1]);
                });
        }

        imports.push({
            resolvedImport,
            localBindings,
        });
    }

    return imports;
}

function parseAllRelativeImports(fromFile, content) {
    const resolvedImports = new Set();

    const pushImport = (importPath) => {
        const resolvedImport = resolveImport(fromFile, importPath);
        if (resolvedImport) {
            resolvedImports.add(resolvedImport);
        }
    };

    STATIC_IMPORT_RE.lastIndex = 0;
    let staticMatch;
    while ((staticMatch = STATIC_IMPORT_RE.exec(content)) !== null) {
        pushImport(staticMatch[2] ?? "");
    }

    DYNAMIC_IMPORT_RE.lastIndex = 0;
    let dynamicMatch;
    while ((dynamicMatch = DYNAMIC_IMPORT_RE.exec(content)) !== null) {
        pushImport(dynamicMatch[1] ?? "");
    }

    return resolvedImports;
}

function discoverSettingsDefinitionModules(sourceFiles) {
    const discoveredModules = new Set();

    for (const sourceFile of sourceFiles) {
        const content = readFileSync(sourceFile, "utf8");
        const imports = parseImportedBindings(sourceFile, content);

        const importedRegistrationBindings = new Set();
        imports.forEach(({ resolvedImport, localBindings }) => {
            if (toRelative(resolvedImport) !== "src/host/settings/settingsRegistry.ts") {
                return;
            }

            localBindings.forEach((binding) => {
                if (
                    binding === "registerSettingsSection"
                    || binding === "registerSettingsItem"
                    || binding === "registerSettingsItems"
                ) {
                    importedRegistrationBindings.add(binding);
                }
            });
        });

        if (importedRegistrationBindings.size === 0) {
            continue;
        }

        SETTINGS_REGISTRATION_CALL_RE.lastIndex = 0;
        let registrationMatch;
        while ((registrationMatch = SETTINGS_REGISTRATION_CALL_RE.exec(content)) !== null) {
            const registrationIdentifier = registrationMatch[1] ?? "";
            if (importedRegistrationBindings.has(registrationIdentifier)) {
                discoveredModules.add(toRelative(sourceFile));
                break;
            }
        }
    }

    return discoveredModules;
}

function discoverSettingsConsumerModules(sourceFiles) {
    const consumerModules = new Set();

    for (const sourceFile of sourceFiles) {
        const content = readFileSync(sourceFile, "utf8");
        const imports = parseImportedBindings(sourceFile, content);
        let consumesSettings = false;

        imports.forEach(({ resolvedImport, localBindings }) => {
            const relativeImport = toRelative(resolvedImport);

            if (relativeImport === "src/host/settings/settingsRegistry.ts") {
                localBindings.forEach((binding) => {
                    if (SETTINGS_REGISTRY_CONSUMER_EXPORTS.has(binding)) {
                        consumesSettings = true;
                    }
                });
            }

            if (relativeImport === "src/host/settings/SettingsRegisteredSection.tsx") {
                consumesSettings = true;
            }

            if (
                relativeImport === "src/host/layout/SettingsTab.tsx"
                || relativeImport === "src/host/layout/index.ts"
            ) {
                localBindings.forEach((binding) => {
                    if (SETTINGS_LAYOUT_CONSUMER_EXPORTS.has(binding)) {
                        consumesSettings = true;
                    }
                });
            }

            if (relativeImport === "src/host/settings/registerBuiltinSettings.ts") {
                localBindings.forEach((binding) => {
                    if (binding === "ensureBuiltinSettingsRegistered") {
                        consumesSettings = true;
                    }
                });
            }
        });

        if (consumesSettings) {
            consumerModules.add(toRelative(sourceFile));
        }
    }

    const expandedConsumers = new Set(consumerModules);
    const queue = [...consumerModules];

    while (queue.length > 0) {
        const currentModule = queue.shift();
        const absoluteCurrentFile = path.join(ROOT, currentModule);
        const content = readFileSync(absoluteCurrentFile, "utf8");
        const imports = parseAllRelativeImports(absoluteCurrentFile, content);

        imports.forEach((resolvedImport) => {
            const relativeImport = toRelative(resolvedImport);
            if (!relativeImport.startsWith("src/host/settings/")) {
                return;
            }
            if (TEST_FILE_RE.test(relativeImport)) {
                return;
            }
            if (expandedConsumers.has(relativeImport)) {
                return;
            }

            expandedConsumers.add(relativeImport);
            queue.push(relativeImport);
        });
    }

    return expandedConsumers;
}

function buildTestImportMap(testFiles) {
    const importedByTests = new Map();

    for (const testFile of testFiles) {
        const content = readFileSync(testFile, "utf8");
        const importedModules = parseAllRelativeImports(testFile, content);

        importedModules.forEach((importedModule) => {
            const relativeModule = toRelative(importedModule);
            const current = importedByTests.get(relativeModule) ?? [];
            current.push(toRelative(testFile));
            importedByTests.set(relativeModule, current);
        });
    }

    return importedByTests;
}

const allSourceFiles = walkFiles(SRC_ROOT).filter((filePath) => /\.(ts|tsx)$/.test(filePath));
const sourceFiles = allSourceFiles.filter((filePath) => !TEST_FILE_RE.test(filePath));
const testFiles = allSourceFiles.filter((filePath) => TEST_FILE_RE.test(filePath));

const definitionModules = discoverSettingsDefinitionModules(sourceFiles);
const consumerModules = discoverSettingsConsumerModules(sourceFiles);
const importedByTests = buildTestImportMap(testFiles);

const failures = [];

for (const modulePath of [...definitionModules].sort()) {
    const tests = importedByTests.get(modulePath) ?? [];
    if (tests.length === 0) {
        failures.push(`settings definition module lacks a direct test import: ${modulePath}`);
    }
}

for (const modulePath of [...consumerModules].sort()) {
    const tests = importedByTests.get(modulePath) ?? [];
    if (tests.length === 0) {
        failures.push(`settings consumer module lacks a direct test import: ${modulePath}`);
    }
}

if (failures.length > 0) {
    console.error("[settings-test-guard] failed:");
    failures.forEach((failure) => {
        console.error(` - ${failure}`);
    });
    process.exit(1);
}

console.info(
    `[settings-test-guard] passed (${definitionModules.size} definition modules, ${consumerModules.size} consumer modules)`,
);