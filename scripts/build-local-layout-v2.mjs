import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

/**
 * @module scripts/build-local-layout-v2
 * @description 当 layout-v2 以本地 file/link 依赖接入时，构建共享布局包，确保 ofive 消费最新 dist。
 */

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const packageJsonPath = path.join(repoRoot, "package.json");
const defaultLayoutV2Root = path.resolve(repoRoot, "..", "layout-v2");
const LAYOUT_V2_REPOSITORY_URL = "https://github.com/DnullP/layout-v2.git";

function readPackageJson(filePath) {
    return JSON.parse(readFileSync(filePath, "utf8"));
}

function readLayoutV2DependencySpec(packageJson) {
    return packageJson.dependencies?.["layout-v2"]
        ?? packageJson.devDependencies?.["layout-v2"]
        ?? packageJson.peerDependencies?.["layout-v2"]
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

function hasLayoutV2Dependencies(layoutRoot) {
    return existsSync(path.join(layoutRoot, "node_modules", "typescript"))
        && existsSync(path.join(layoutRoot, "node_modules", "vite"));
}

function installLayoutV2Dependencies(layoutRoot) {
    console.info("[layout-v2-build] installing dependencies", {
        layoutRoot,
    });

    const result = spawnSync("bun", ["install"], {
        cwd: layoutRoot,
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

function cloneDefaultLayoutV2Source(layoutRoot) {
    console.info("[layout-v2-build] cloning missing local dependency", {
        layoutRoot,
        repository: LAYOUT_V2_REPOSITORY_URL,
    });

    mkdirSync(path.dirname(layoutRoot), { recursive: true });
    const result = spawnSync("git", ["clone", "--depth=1", LAYOUT_V2_REPOSITORY_URL, layoutRoot], {
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

function ensureLayoutV2Source(layoutRoot, allowClone) {
    const layoutPackageJsonPath = path.join(layoutRoot, "package.json");
    if (existsSync(layoutPackageJsonPath)) {
        return;
    }

    if (!existsSync(layoutRoot) && allowClone) {
        cloneDefaultLayoutV2Source(layoutRoot);
        return;
    }

    throw new Error(`layout-v2 本地依赖缺少 package.json: ${layoutPackageJsonPath}`);
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

function removeExistingLayoutV2Module(modulePath) {
    if (!existsSync(modulePath)) {
        return;
    }

    const existingStats = lstatSync(modulePath);
    if (!existingStats.isDirectory() && !existingStats.isSymbolicLink()) {
        throw new Error(`node_modules/layout-v2 已存在但不是目录或链接: ${modulePath}`);
    }

    rmSync(modulePath, { recursive: true, force: true });
}

function ensureLayoutV2NodeModuleLink(layoutRoot) {
    const nodeModulesRoot = path.join(repoRoot, "node_modules");
    const modulePath = path.join(nodeModulesRoot, "layout-v2");
    if (pathsReferToSameLocation(modulePath, layoutRoot)) {
        return;
    }

    removeExistingLayoutV2Module(modulePath);
    mkdirSync(nodeModulesRoot, { recursive: true });

    const linkType = process.platform === "win32" ? "junction" : "dir";
    symlinkSync(layoutRoot, modulePath, linkType);
    console.info("[layout-v2-build] linked local dependency", {
        modulePath,
        layoutRoot,
    });
}

function buildLayoutV2(layoutRoot) {
    ensureLayoutV2NodeModuleLink(layoutRoot);

    if (!hasLayoutV2Dependencies(layoutRoot)) {
        installLayoutV2Dependencies(layoutRoot);
    }

    console.info("[layout-v2-build] start", {
        layoutRoot,
    });

    const result = spawnSync("bun", ["run", "build"], {
        cwd: layoutRoot,
        stdio: "inherit",
        env: process.env,
    });

    if (typeof result.status === "number" && result.status !== 0) {
        process.exit(result.status);
    }

    if (result.error) {
        throw result.error;
    }

    console.info("[layout-v2-build] success", {
        layoutRoot,
    });
}

const packageJson = readPackageJson(packageJsonPath);
const dependencySpec = readLayoutV2DependencySpec(packageJson);
const configuredLayoutRoot = resolveLocalDependencyPath(dependencySpec);
const layoutRoot = configuredLayoutRoot ?? defaultLayoutV2Root;

ensureLayoutV2Source(layoutRoot, configuredLayoutRoot === null);
buildLayoutV2(layoutRoot);
