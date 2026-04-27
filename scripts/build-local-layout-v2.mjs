import { existsSync, readFileSync } from "node:fs";
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

function buildLayoutV2(layoutRoot) {
    const layoutPackageJsonPath = path.join(layoutRoot, "package.json");
    if (!existsSync(layoutPackageJsonPath)) {
        throw new Error(`layout-v2 本地依赖缺少 package.json: ${layoutPackageJsonPath}`);
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
const layoutRoot = resolveLocalDependencyPath(dependencySpec);

if (!layoutRoot) {
    console.info("[layout-v2-build] skipped: layout-v2 is not a local file/link dependency", {
        dependencySpec,
    });
} else {
    buildLayoutV2(layoutRoot);
}
