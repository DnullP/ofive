import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";

const LAYOUT_V2_REPOSITORY_URL = "https://github.com/DnullP/layout-v2.git";
const LOCKFILE_PATH = "bun.lock";
const LOCKFILE_REF_PATTERN = /"layout-v2": \["layout-v2@github:DnullP\/layout-v2#([0-9a-f]+)"/;

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");

function readCurrentLayoutV2Ref() {
    const lockfileText = readFileSync(path.join(repoRoot, LOCKFILE_PATH), "utf8");
    const match = lockfileText.match(LOCKFILE_REF_PATTERN);
    if (!match?.[1]) {
        throw new Error("无法从 bun.lock 解析当前 layout-v2 锁定提交。");
    }

    return match[1];
}

function readRemoteLayoutV2Ref() {
    const result = spawnSync("git", ["ls-remote", LAYOUT_V2_REPOSITORY_URL, "HEAD"], {
        cwd: repoRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
    });

    if (result.status !== 0) {
        const errorText = result.stderr?.trim() || result.stdout?.trim() || "未知 git ls-remote 错误";
        throw new Error(`读取远端 layout-v2 提交失败: ${errorText}`);
    }

    const remoteRef = result.stdout.trim().split(/\s+/)[0];
    if (!remoteRef) {
        throw new Error("远端 layout-v2 HEAD 返回为空。");
    }

    return remoteRef;
}

function isInteractiveSession() {
    return !!process.stdin.isTTY && !!process.stdout.isTTY && process.env.CI !== "true";
}

function isSameGitRef(currentRef, remoteRef) {
    return currentRef === remoteRef
        || remoteRef.startsWith(currentRef)
        || currentRef.startsWith(remoteRef);
}

async function promptForUpdate(currentRef, remoteRef) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    try {
        while (true) {
            const answer = (await rl.question(
                `[layout-v2-update] 检测到新版本 ${remoteRef.slice(0, 7)}，当前为 ${currentRef.slice(0, 7)}。是否现在更新 layout-v2？(y/n) `,
            )).trim().toLowerCase();

            if (answer === "y" || answer === "yes") {
                return true;
            }

            if (answer === "n" || answer === "no") {
                return false;
            }

            console.info("[layout-v2-update] 请输入 y 或 n。");
        }
    } finally {
        rl.close();
    }
}

function updateLayoutV2Dependency() {
    const result = spawnSync("bun", ["update", "layout-v2"], {
        cwd: repoRoot,
        stdio: "inherit",
        env: process.env,
    });

    if (result.status !== 0) {
        process.exit(result.status ?? 1);
    }
}

async function main() {
    let currentRef;
    try {
        currentRef = readCurrentLayoutV2Ref();
    } catch (error) {
        console.warn("[layout-v2-update] 跳过检查：", error instanceof Error ? error.message : String(error));
        return;
    }

    let remoteRef;
    try {
        remoteRef = readRemoteLayoutV2Ref();
    } catch (error) {
        console.warn("[layout-v2-update] 跳过检查：", error instanceof Error ? error.message : String(error));
        return;
    }

    if (isSameGitRef(currentRef, remoteRef)) {
        console.info(`[layout-v2-update] layout-v2 已是最新版本 (${currentRef.slice(0, 7)})`);
        return;
    }

    console.info(`[layout-v2-update] 发现新版本: ${currentRef.slice(0, 7)} -> ${remoteRef.slice(0, 7)}`);

    if (!isInteractiveSession()) {
        console.warn("[layout-v2-update] 当前环境不可交互，继续使用已锁定版本构建。");
        return;
    }

    const shouldUpdate = await promptForUpdate(currentRef, remoteRef);
    if (!shouldUpdate) {
        console.info("[layout-v2-update] 用户选择保持当前 layout-v2 版本。");
        return;
    }

    updateLayoutV2Dependency();

    const nextCurrentRef = readCurrentLayoutV2Ref();
    console.info(`[layout-v2-update] layout-v2 已更新到 ${nextCurrentRef.slice(0, 7)}`);
}

await main();