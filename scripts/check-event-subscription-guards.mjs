/**
 * @file scripts/check-event-subscription-guards.mjs
 * @description 后端事件订阅生命周期守卫：防止 UI 组件绕过 App Event Bus、store 或 plugin hub 直接订阅后端事件。
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = process.cwd();
const sourceRoot = path.join(repoRoot, "src");
const sourceExtensions = new Set([".ts", ".tsx"]);

const backendSubscriptionAllowedFilesBySymbol = {
    subscribeAiChatStreamEvents: new Set([
        "src/api/aiApi.ts",
        "src/plugins/ai-chat/aiChatStreamEventHub.ts",
    ]),
    subscribeBackendLogNotificationEvents: new Set([
        "src/api/logNotificationApi.ts",
        "src/plugins/log-notification/logNotificationPlugin.tsx",
    ]),
    subscribeVaultConfigEvents: new Set([
        "src/api/vaultApi.ts",
        "src/host/events/appEventBus.ts",
    ]),
    subscribeVaultFsEvents: new Set([
        "src/api/vaultApi.ts",
        "src/host/events/appEventBus.ts",
    ]),
};

const backendSubscriptionReplacementBySymbol = {
    subscribeAiChatStreamEvents: "subscribeAiChatStreamEventHub",
    subscribeBackendLogNotificationEvents: "the log notification plugin lifecycle bridge",
    subscribeVaultConfigEvents: "subscribeVaultConfigBusEvent",
    subscribeVaultFsEvents: "subscribeVaultFsBusEvent",
};

function toPosixPath(inputPath) {
    return inputPath.split(path.sep).join("/");
}

function listSourceFiles(directory) {
    const files = [];
    for (const entryName of readdirSync(directory)) {
        const entryPath = path.join(directory, entryName);
        const stats = statSync(entryPath);
        if (stats.isDirectory()) {
            files.push(...listSourceFiles(entryPath));
            continue;
        }

        if (sourceExtensions.has(path.extname(entryPath))) {
            files.push(entryPath);
        }
    }

    return files;
}

function shouldIgnoreFile(relativePath) {
    return relativePath.includes(".test.") ||
        relativePath.startsWith("src/test-support/");
}

function stripCodeComments(content) {
    return content
        .replaceAll(/\/\*[\s\S]*?\*\//g, "")
        .replaceAll(/^\s*\/\/.*$/gm, "");
}

function containsSymbol(content, symbol) {
    const pattern = new RegExp(`\\b${symbol}\\b`);
    return pattern.test(content);
}

export function buildEventSubscriptionViolations(files) {
    const violations = [];

    files.forEach(({ relativePath, content }) => {
        if (shouldIgnoreFile(relativePath)) {
            return;
        }

        const code = stripCodeComments(content);
        for (const [symbol, allowedFiles] of Object.entries(backendSubscriptionAllowedFilesBySymbol)) {
            if (!containsSymbol(code, symbol) || allowedFiles.has(relativePath)) {
                continue;
            }

            violations.push({
                relativePath,
                symbol,
                replacement: backendSubscriptionReplacementBySymbol[symbol],
            });
        }
    });

    return violations;
}

function isMainModule() {
    return import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isMainModule()) {
    const files = listSourceFiles(sourceRoot).map((filePath) => ({
        relativePath: toPosixPath(path.relative(repoRoot, filePath)),
        content: readFileSync(filePath, "utf8"),
    }));

    const violations = buildEventSubscriptionViolations(files);
    if (violations.length > 0) {
        console.error("[event-subscription-guard] direct backend event subscriptions are not allowed outside lifecycle owners:");
        violations.forEach((violation) => {
            console.error(`  - ${violation.relativePath}: ${violation.symbol} (use ${violation.replacement})`);
        });
        console.error("");
        console.error("Keep backend event listeners in API wrappers, App Event Bus bridges, plugin-level hubs, or plugin activation owners. UI components should consume stores, hubs, or semantic bus events.");
        process.exit(1);
    }

    console.info("[event-subscription-guard] passed");
}
