/**
 * @file scripts/check-production-preview-smoke.mjs
 * @description Runs the built frontend through Vite preview and verifies it mounts without runtime errors.
 *   This protects against the packaged-app white-screen class where `tauri dev`
 *   works, `vite build` succeeds, but the installed app never mounts React.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const distIndexPath = path.join(repoRoot, "dist", "index.html");
const viteEntryPath = path.join(repoRoot, "node_modules", "vite", "bin", "vite.js");
const previewPort = Number.parseInt(process.env.OFIVE_PREVIEW_SMOKE_PORT ?? "4174", 10);
const previewUrl = `http://127.0.0.1:${String(previewPort)}/`;
const previewReadyTimeoutMs = 20_000;

function assertBuildReady() {
    if (!existsSync(distIndexPath)) {
        throw new Error("dist/index.html does not exist. Run `bun run build` before production preview smoke.");
    }
}

function sleep(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

async function isPreviewReady() {
    try {
        const response = await fetch(previewUrl, { signal: AbortSignal.timeout(1_000) });
        return response.ok;
    } catch {
        return false;
    }
}

async function waitForPreviewReady(previewProcess) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < previewReadyTimeoutMs) {
        if (await isPreviewReady()) {
            return;
        }

        if (previewProcess.exitCode !== null) {
            throw new Error(`vite preview exited before becoming ready with code ${String(previewProcess.exitCode)}`);
        }

        await sleep(250);
    }

    throw new Error(`vite preview did not become ready at ${previewUrl}`);
}

function startPreviewServer() {
    const child = spawn(process.execPath, [
        viteEntryPath,
        "preview",
        "--host",
        "127.0.0.1",
        "--port",
        String(previewPort),
        "--strictPort",
    ], {
        cwd: repoRoot,
        env: {
            ...process.env,
            NO_COLOR: "1",
        },
        stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout.on("data", (chunk) => {
        process.stdout.write(`[preview] ${String(chunk)}`);
    });
    child.stderr.on("data", (chunk) => {
        process.stderr.write(`[preview] ${String(chunk)}`);
    });

    return child;
}

function stopPreviewServer(previewProcess) {
    if (!previewProcess || previewProcess.exitCode !== null) {
        return;
    }

    previewProcess.kill("SIGTERM");
}

async function runSmoke() {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    // Capture production-only initialization failures, including the former
    // CodeMirror/editor manualChunks TDZ regression (`Cannot access ... before
    // initialization`) that blanked the installed Tauri app.
    const runtimeErrors = [];

    page.on("pageerror", (error) => {
        runtimeErrors.push(error.stack || error.message);
    });
    page.on("console", (message) => {
        if (message.type() === "error") {
            runtimeErrors.push(message.text());
        }
    });

    try {
        const response = await page.goto(previewUrl, { waitUntil: "networkidle", timeout: 20_000 });
        await page.waitForSelector(".app-shell", { timeout: 10_000 });

        const state = await page.evaluate(() => ({
            status: document.readyState,
            title: document.title,
            rootChildren: document.getElementById("root")?.children.length ?? 0,
            appShell: Boolean(document.querySelector(".app-shell")),
            appContent: Boolean(document.querySelector(".app-content")),
            bodyTextLength: document.body.innerText.trim().length,
        }));

        if (!response?.ok()) {
            throw new Error(`preview responded with status ${String(response?.status())}`);
        }
        if (!state.appShell || !state.appContent || state.rootChildren < 1) {
            throw new Error(`frontend did not mount expected shell: ${JSON.stringify(state)}`);
        }
        if (runtimeErrors.length > 0) {
            throw new Error(`frontend runtime errors:\n${runtimeErrors.join("\n")}`);
        }

        console.info("[production-preview-smoke] passed", state);
    } finally {
        await browser.close();
    }
}

assertBuildReady();

let previewProcess = null;
const reusedExistingPreview = await isPreviewReady();

try {
    if (!reusedExistingPreview) {
        previewProcess = startPreviewServer();
        await waitForPreviewReady(previewProcess);
    }

    await runSmoke();
} finally {
    stopPreviewServer(previewProcess);
}
