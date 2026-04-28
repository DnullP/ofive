import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const packageJsonPath = path.join(repoRoot, "package.json");

function run(command, args, options = {}) {
    const result = spawnSync(command, args, {
        cwd: options.cwd ?? repoRoot,
        encoding: "utf8",
        stdio: options.stdio ?? "pipe",
        env: process.env,
    });

    if (result.error) {
        throw result.error;
    }

    if (typeof result.status === "number" && result.status !== 0) {
        const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
        throw new Error(output || `${command} ${args.join(" ")} failed with code ${result.status}`);
    }

    return (result.stdout ?? "").trim();
}

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

function ensureCleanWorktree(root, label) {
    const status = run("git", ["status", "--porcelain"], { cwd: root });
    if (status) {
        throw new Error(`[push] ${label} has uncommitted changes. Commit or stash them first.\n${status}`);
    }
}

function readCurrentBranch(root) {
    const branch = run("git", ["branch", "--show-current"], { cwd: root });
    if (!branch) {
        throw new Error(`[push] ${root} is detached. Checkout a branch before pushing.`);
    }

    return branch;
}

function hasUpstream(root, branch) {
    const result = spawnSync("git", ["rev-parse", "--abbrev-ref", `${branch}@{upstream}`], {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
        env: process.env,
    });

    return result.status === 0;
}

function pushBranch(root, label) {
    const branch = readCurrentBranch(root);
    const args = hasUpstream(root, branch)
        ? ["push"]
        : ["push", "--set-upstream", "origin", branch];

    console.info(`[push] pushing ${label}:${branch}`);
    run("git", args, { cwd: root, stdio: "inherit" });
}

function main() {
    const packageJson = readPackageJson(packageJsonPath);
    const layoutSpec = readLayoutV2DependencySpec(packageJson);
    const layoutRoot = resolveLocalDependencyPath(layoutSpec);

    if (layoutRoot) {
        const layoutPackageJsonPath = path.join(layoutRoot, "package.json");
        if (!existsSync(layoutPackageJsonPath)) {
            throw new Error(`[push] local layout-v2 dependency is missing: ${layoutPackageJsonPath}`);
        }

        ensureCleanWorktree(layoutRoot, "layout-v2");
        pushBranch(layoutRoot, "layout-v2");
    }

    ensureCleanWorktree(repoRoot, "ofive");

    console.info("[push] verifying frozen install before pushing ofive");
    run("bun", ["install", "--frozen-lockfile"], { cwd: repoRoot, stdio: "inherit" });

    pushBranch(repoRoot, "ofive");
}

try {
    main();
} catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
}
