/**
 * @file scripts/check-tauri-frontend-assets.mjs
 * @description 校验 Vite 生产产物使用 Tauri 安装包可加载的相对资源路径。
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const distRoot = path.join(repoRoot, "dist");
const indexHtmlPath = path.join(distRoot, "index.html");

const checkedExtensions = new Set([".html", ".css"]);
// Root-relative asset references can be masked by the Vite dev server but are
// unsafe in an installed Tauri bundle, where frontend assets are loaded from
// the packaged app protocol rather than from an HTTP server root.
const rootRelativeResourcePattern = /\b(?:src|href)=["']\/(?:assets|icon\.(?:svg|png|ico)|vite\.svg|tauri\.svg)\b|url\(\s*["']?\/(?:assets|icon\.(?:svg|png|ico)|vite\.svg|tauri\.svg)\b/g;

function walkFiles(directory) {
    const entries = readdirSync(directory, { withFileTypes: true });
    const files = [];

    for (const entry of entries) {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            files.push(...walkFiles(entryPath));
            continue;
        }

        if (entry.isFile()) {
            files.push(entryPath);
        }
    }

    return files;
}

function relativePath(filePath) {
    return path.relative(repoRoot, filePath).replace(/\\/g, "/");
}

function assertDistReady() {
    if (!existsSync(indexHtmlPath)) {
        throw new Error("dist/index.html does not exist. Run `bun run build` before checking Tauri frontend assets.");
    }

    const stat = statSync(indexHtmlPath);
    if (!stat.isFile()) {
        throw new Error("dist/index.html is not a file.");
    }
}

function collectViolations() {
    return walkFiles(distRoot).flatMap((filePath) => {
        if (!checkedExtensions.has(path.extname(filePath))) {
            return [];
        }

        const content = readFileSync(filePath, "utf8");
        const matches = Array.from(content.matchAll(rootRelativeResourcePattern));

        return matches.map((match) => ({
            filePath,
            reference: match[0],
        }));
    });
}

assertDistReady();

const violations = collectViolations();
if (violations.length > 0) {
    console.error("[tauri-frontend-assets] root-relative production asset references are not Tauri-safe.");
    for (const violation of violations) {
        console.error(`  ${relativePath(violation.filePath)}: ${violation.reference}`);
    }
    console.error("[tauri-frontend-assets] Use Vite base \"./\" so installed apps load bundled assets via relative URLs.");
    process.exit(1);
}

console.info("[tauri-frontend-assets] passed");
