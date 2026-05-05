import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const tauriConfigPath = path.join(repoRoot, "src-tauri", "tauri.conf.json");
const tauriConfig = JSON.parse(readFileSync(tauriConfigPath, "utf8"));

/**
 * @function readCliOption
 * @description Reads a string option from the current process arguments.
 * @param {string} optionName Option name such as --target.
 * @returns {string | null} Option value when present.
 */
function readCliOption(optionName) {
    const optionIndex = process.argv.indexOf(optionName);
    if (optionIndex === -1 || optionIndex + 1 >= process.argv.length) {
        return null;
    }

    return process.argv[optionIndex + 1] ?? null;
}

/**
 * @function resolveWindowsArchLabel
 * @description Converts a Rust Windows target triple to the release asset arch label.
 * @param {string} targetTriple Rust target triple.
 * @returns {string} Short arch label.
 */
function resolveWindowsArchLabel(targetTriple) {
    if (targetTriple.startsWith("aarch64-")) {
        return "arm64";
    }

    return "x64";
}

/**
 * @function ensureFile
 * @description Fails fast when a required portable payload file is missing.
 * @param {string} filePath Absolute file path.
 * @param {string} label Human-readable file label.
 */
function ensureFile(filePath, label) {
    if (!existsSync(filePath) || !statSync(filePath).isFile()) {
        throw new Error(`${label} not found: ${filePath}`);
    }
}

/**
 * @function copyRequiredFile
 * @description Copies one required payload file into the portable app directory.
 * @param {string} sourcePath Absolute source path.
 * @param {string} destinationRoot Portable app directory.
 * @param {string} label Human-readable file label.
 */
function copyRequiredFile(sourcePath, destinationRoot, label) {
    ensureFile(sourcePath, label);
    copyFileSync(sourcePath, path.join(destinationRoot, path.basename(sourcePath)));
}

/**
 * @function escapePowerShellLiteral
 * @description Escapes a value for single-quoted PowerShell literals.
 * @param {string} value Text to escape.
 * @returns {string} Escaped text.
 */
function escapePowerShellLiteral(value) {
    return value.replaceAll("'", "''");
}

/**
 * @function createZipArchive
 * @description Creates a zip archive containing the portable app root directory.
 * @param {string} portableParent Parent directory that contains the portable app root.
 * @param {string} portableDirName Portable app directory name.
 * @param {string} zipPath Destination zip path.
 */
function createZipArchive(portableParent, portableDirName, zipPath) {
    rmSync(zipPath, { force: true });

    const tarResult = spawnSync("tar.exe", [
        "-a",
        "-cf",
        zipPath,
        "-C",
        portableParent,
        portableDirName,
    ], {
        stdio: "inherit",
    });

    if (tarResult.status === 0) {
        return;
    }

    const archiveSource = path.join(portableParent, portableDirName);
    const command = [
        "$ErrorActionPreference = 'Stop'",
        `Compress-Archive -LiteralPath '${escapePowerShellLiteral(archiveSource)}' -DestinationPath '${escapePowerShellLiteral(zipPath)}' -Force`,
    ].join("; ");
    const powershellResult = spawnSync("powershell.exe", [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        command,
    ], {
        stdio: "inherit",
    });

    if (typeof powershellResult.status === "number" && powershellResult.status !== 0) {
        process.exit(powershellResult.status);
    }

    if (powershellResult.error) {
        throw powershellResult.error;
    }
}

const targetTriple = readCliOption("--target") ?? "x86_64-pc-windows-msvc";
if (!targetTriple.endsWith("-pc-windows-msvc")) {
    throw new Error(`Windows portable packaging requires a Windows MSVC target. Got: ${targetTriple}`);
}

const productName = tauriConfig.productName ?? "ofive";
const version = tauriConfig.version ?? "0.0.0";
const archLabel = resolveWindowsArchLabel(targetTriple);
const releaseRoot = path.join(repoRoot, "src-tauri", "target", targetTriple, "release");
const bundleRoot = path.join(releaseRoot, "bundle");
const portableRoot = path.join(bundleRoot, "portable");
const portableDirName = `${productName}_${version}_${archLabel}-portable`;
const portableDir = path.join(portableRoot, portableDirName);
const zipPath = path.join(portableRoot, `${portableDirName}.zip`);

rmSync(portableDir, { recursive: true, force: true });
mkdirSync(portableDir, { recursive: true });

copyRequiredFile(path.join(releaseRoot, `${productName}.exe`), portableDir, "Tauri app executable");

for (const externalBin of tauriConfig.bundle?.externalBin ?? []) {
    const sidecarName = path.basename(externalBin);
    copyRequiredFile(path.join(releaseRoot, `${sidecarName}.exe`), portableDir, `${sidecarName} sidecar`);
}

const resourcesRoot = path.join(releaseRoot, "resources");
if (existsSync(resourcesRoot)) {
    cpSync(resourcesRoot, path.join(portableDir, "resources"), { recursive: true });
}

writeFileSync(path.join(portableDir, "README.txt"), [
    `${productName} portable build`,
    "",
    `Run ${productName}.exe directly from this directory.`,
    "Keep the sidecar executables next to the app executable.",
    "The Microsoft Edge WebView2 Runtime must be available on the machine.",
    "",
].join("\r\n"));

createZipArchive(portableRoot, portableDirName, zipPath);

console.info("[windows-portable] success", {
    portableDir,
    zipPath,
});