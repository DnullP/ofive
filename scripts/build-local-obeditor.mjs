import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/**
 * @module scripts/build-local-obeditor
 * @description 当 obeditor 以本地 file/link 依赖接入时，构建共享编辑器包，确保 ofive 消费最新 dist。
 */

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const packageJsonPath = path.join(repoRoot, "package.json");
const defaultObeditorRoot = path.resolve(repoRoot, "..", "obeditor");
const OBEDITOR_REPOSITORY_URL = "https://github.com/DnullP/obeditor.git";

function readPackageJson(filePath) {
    return JSON.parse(readFileSync(filePath, "utf8"));
}

function readObeditorDependencySpec(packageJson) {
    return packageJson.dependencies?.obeditor
        ?? packageJson.devDependencies?.obeditor
        ?? packageJson.peerDependencies?.obeditor
        ?? null;
}

function resolveLocalDependencyPath(spec) {
    if (typeof spec !== "string") {
        return null;
    }

    if (spec.startsWith("file:")) {
        return path.resolve(repoRoot, spec.slice("file:".length));
    }

    if (spec.startsWith("link:")) {
        return path.resolve(repoRoot, spec.slice("link:".length));
    }

    return null;
}

function hasObeditorDependencies(editorRoot) {
    return existsSync(path.join(editorRoot, "node_modules", "typescript"))
        && existsSync(path.join(editorRoot, "node_modules", "vite"));
}

function installObeditorDependencies(editorRoot) {
    console.info("[obeditor-build] installing dependencies", {
        editorRoot,
    });

    const result = spawnSync("bun", ["install", "--ignore-scripts"], {
        cwd: editorRoot,
        stdio: "inherit",
        env: process.env,
    });

    if (typeof result.status === "number" && result.status !== 0) {
        process.exit(result.status);
    }

    if (result.error) {
        throw result.error;
    }
}

function cloneDefaultObeditorSource(editorRoot) {
    console.info("[obeditor-build] cloning missing local dependency", {
        editorRoot,
        repository: OBEDITOR_REPOSITORY_URL,
    });

    mkdirSync(path.dirname(editorRoot), { recursive: true });
    const result = spawnSync("git", ["clone", "--depth=1", OBEDITOR_REPOSITORY_URL, editorRoot], {
        cwd: repoRoot,
        stdio: "inherit",
        env: process.env,
    });

    if (typeof result.status === "number" && result.status !== 0) {
        process.exit(result.status);
    }

    if (result.error) {
        throw result.error;
    }
}

function ensureObeditorSource(editorRoot, allowClone) {
    const editorPackageJsonPath = path.join(editorRoot, "package.json");
    if (existsSync(editorPackageJsonPath)) {
        return;
    }

    if (!existsSync(editorRoot) && allowClone) {
        cloneDefaultObeditorSource(editorRoot);
        return;
    }

    throw new Error(`obeditor 本地依赖缺少 package.json: ${editorPackageJsonPath}`);
}

function pathsReferToSameLocation(firstPath, secondPath) {
    try {
        const firstRealPath = realpathSync.native(firstPath);
        const secondRealPath = realpathSync.native(secondPath);
        if (process.platform === "win32") {
            return firstRealPath.toLowerCase() === secondRealPath.toLowerCase();
        }

        return firstRealPath === secondRealPath;
    } catch {
        return false;
    }
}

function removeExistingObeditorModule(modulePath) {
    if (!existsSync(modulePath)) {
        return;
    }

    const existingStats = lstatSync(modulePath);
    if (!existingStats.isDirectory() && !existingStats.isSymbolicLink()) {
        throw new Error(`node_modules/obeditor 已存在但不是目录或链接: ${modulePath}`);
    }

    rmSync(modulePath, { recursive: true, force: true });
}

function ensureObeditorNodeModuleLink(editorRoot) {
    const nodeModulesRoot = path.join(repoRoot, "node_modules");
    const modulePath = path.join(nodeModulesRoot, "obeditor");
    if (pathsReferToSameLocation(modulePath, editorRoot)) {
        return;
    }

    removeExistingObeditorModule(modulePath);
    mkdirSync(nodeModulesRoot, { recursive: true });

    const linkType = process.platform === "win32" ? "junction" : "dir";
    symlinkSync(editorRoot, modulePath, linkType);
    console.info("[obeditor-build] linked local dependency", {
        modulePath,
        editorRoot,
    });
}

function buildObeditor(editorRoot) {
    ensureObeditorNodeModuleLink(editorRoot);

    if (!hasObeditorDependencies(editorRoot)) {
        installObeditorDependencies(editorRoot);
    }

    console.info("[obeditor-build] start", {
        editorRoot,
    });

    const result = spawnSync("bun", ["run", "build"], {
        cwd: editorRoot,
        stdio: "inherit",
        env: process.env,
    });

    if (typeof result.status === "number" && result.status !== 0) {
        process.exit(result.status);
    }

    if (result.error) {
        throw result.error;
    }

    console.info("[obeditor-build] success", {
        editorRoot,
    });
}

const packageJson = readPackageJson(packageJsonPath);
const dependencySpec = readObeditorDependencySpec(packageJson);
const configuredEditorRoot = resolveLocalDependencyPath(dependencySpec);
const editorRoot = configuredEditorRoot ?? defaultObeditorRoot;

ensureObeditorSource(editorRoot, configuredEditorRoot === null);
buildObeditor(editorRoot);
