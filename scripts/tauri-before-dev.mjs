import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * @module scripts/tauri-before-dev
 * @description 受控启动 Tauri 开发前置链路：先构建 sidecar，再启动前端 dev server，并在父级 Tauri dev 进程退出后自动清理 Vite，避免残留端口占用。
 */

const WATCH_PARENT_INTERVAL_MS = 1000;
const DEV_SERVER_PORT = 1420;
const STALE_PROCESS_SHUTDOWN_WAIT_MS = 1200;

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const nodeExecutable = process.execPath;
const buildLayoutV2ScriptPath = path.join(repoRoot, "scripts", "build-local-layout-v2.mjs");
const buildScriptPath = path.join(repoRoot, "scripts", "build-sidecar.mjs");
const viteEntryPath = path.join(repoRoot, "node_modules", "vite", "bin", "vite.js");

const BUILD_LAYOUT_V2_COMMAND = nodeExecutable;
const BUILD_LAYOUT_V2_ARGS = [buildLayoutV2ScriptPath];
const BUILD_COMMAND = nodeExecutable;
const BUILD_ARGS = [buildScriptPath];
const DEV_SERVER_COMMAND = nodeExecutable;
const DEV_SERVER_ARGS = [
    viteEntryPath,
    "--host",
    "127.0.0.1",
    "--port",
    String(DEV_SERVER_PORT),
    "--strictPort",
];

/**
 * @function sleep
 * @description 等待指定毫秒数，供异步清理流程复用。
 * @param {number} ms 等待时长（毫秒）。
 * @returns {Promise<void>} 等待完成后 resolve。
 */
function sleep(ms) {
    return new Promise((resolve) => {
        setTimeout(resolve, ms);
    });
}

const originalParentPid = process.ppid;

/**
 * @function isProcessAlive
 * @description 判断指定 pid 对应的进程是否仍然存在。
 * @param {number} pid 进程 ID。
 * @returns {boolean} 进程存在时返回 true。
 */
function isProcessAlive(pid) {
    if (!Number.isInteger(pid) || pid <= 0) {
        return false;
    }

    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        return false;
    }
}

/**
 * @function buildLayoutV2
 * @description 构建本地 layout-v2 依赖，确保前端 dev server 消费最新共享布局产物。
 */
function buildLayoutV2() {
    const result = spawnSync(BUILD_LAYOUT_V2_COMMAND, BUILD_LAYOUT_V2_ARGS, {
        stdio: "inherit",
        env: process.env,
        cwd: repoRoot,
    });

    if (typeof result.status === "number" && result.status !== 0) {
        process.exit(result.status);
    }

    if (result.error) {
        throw result.error;
    }
}

/**
 * @function buildSidecar
 * @description 同步执行 sidecar 构建，确保前端 dev server 启动前依赖已就绪。
 */
function buildSidecar() {
    const result = spawnSync(BUILD_COMMAND, BUILD_ARGS, {
        stdio: "inherit",
        env: process.env,
        cwd: repoRoot,
    });

    if (typeof result.status === "number" && result.status !== 0) {
        process.exit(result.status);
    }

    if (result.error) {
        throw result.error;
    }
}

/**
 * @function terminateChild
 * @description 尝试优雅终止 dev server 子进程。
 * @param {import("node:child_process").ChildProcess | null} child 子进程句柄。
 * @param {NodeJS.Signals} signal 使用的终止信号。
 */
function terminateChild(child, signal = "SIGTERM") {
    if (!child || child.killed || child.exitCode !== null) {
        return;
    }

    try {
        child.kill(signal);
    } catch (error) {
        console.warn("[tauri-before-dev] failed to terminate child", {
            signal,
            error: error instanceof Error ? error.message : String(error),
        });
    }
}

/**
 * @function listListeningPidsOnDevPort
 * @description 列出当前监听前端 dev 端口的全部进程 ID。
 * @returns {number[]} 监听指定端口的 pid 列表。
 */
function listListeningPidsOnDevPort() {
    const result = spawnSync("lsof", [
        "-nP",
        `-iTCP:${String(DEV_SERVER_PORT)}`,
        "-sTCP:LISTEN",
        "-t",
    ], {
        stdio: ["ignore", "pipe", "ignore"],
        encoding: "utf8",
    });

    if (typeof result.status === "number" && result.status !== 0) {
        return [];
    }

    return String(result.stdout)
        .split(/\s+/)
        .map((value) => Number.parseInt(value, 10))
        .filter((value) => Number.isInteger(value) && value > 0);
}

/**
 * @function getProcessCommandLine
 * @description 读取指定 pid 的完整命令行，便于识别是否属于当前仓库的 Vite dev server。
 * @param {number} pid 进程 ID。
 * @returns {string} 命令行文本，读取失败时返回空字符串。
 */
function getProcessCommandLine(pid) {
    const result = spawnSync("ps", ["-o", "command=", "-p", String(pid)], {
        stdio: ["ignore", "pipe", "ignore"],
        encoding: "utf8",
    });

    if (typeof result.status === "number" && result.status !== 0) {
        return "";
    }

    return String(result.stdout).trim();
}

/**
 * @function isRepoLocalViteProcess
 * @description 判断指定命令行是否是当前仓库遗留的 1420 Vite dev server。
 * @param {string} commandLine 进程命令行。
 * @returns {boolean} 属于当前仓库的 Vite 时返回 true。
 */
function isRepoLocalViteProcess(commandLine) {
    return commandLine.includes(viteEntryPath)
        || (
            commandLine.includes(`${path.sep}node_modules${path.sep}.bin${path.sep}vite`)
            && commandLine.includes(repoRoot)
            && commandLine.includes(`--port ${String(DEV_SERVER_PORT)}`)
        );
}

/**
 * @function cleanupStaleRepoLocalDevServer
 * @description 在启动前清理当前仓库遗留的 1420 端口 Vite 进程，避免前一次异常退出后阻塞新会话。
 * @returns {Promise<void>} 清理完成后 resolve。
 */
async function cleanupStaleRepoLocalDevServer() {
    const candidatePids = listListeningPidsOnDevPort();
    if (candidatePids.length === 0) {
        return;
    }

    const stalePids = candidatePids.filter((pid) => {
        return isRepoLocalViteProcess(getProcessCommandLine(pid));
    });

    if (stalePids.length === 0) {
        return;
    }

    console.info("[tauri-before-dev] cleaning stale repo-local dev server", {
        port: DEV_SERVER_PORT,
        pids: stalePids,
    });

    for (const pid of stalePids) {
        try {
            process.kill(pid, "SIGTERM");
        } catch (error) {
            console.warn("[tauri-before-dev] failed to terminate stale process", {
                pid,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }

    await sleep(STALE_PROCESS_SHUTDOWN_WAIT_MS);

    for (const pid of stalePids) {
        if (!isProcessAlive(pid)) {
            continue;
        }

        console.warn("[tauri-before-dev] forcing stale repo-local dev server shutdown", {
            pid,
        });
        try {
            process.kill(pid, "SIGKILL");
        } catch (error) {
            console.warn("[tauri-before-dev] failed to kill stale process", {
                pid,
                error: error instanceof Error ? error.message : String(error),
            });
        }
    }
}

await cleanupStaleRepoLocalDevServer();
buildLayoutV2();
buildSidecar();

const devServer = spawn(DEV_SERVER_COMMAND, DEV_SERVER_ARGS, {
    stdio: "inherit",
    env: process.env,
    cwd: repoRoot,
});

let shuttingDown = false;

/**
 * @function shutdown
 * @description 清理 watcher 与 dev server，并按需退出当前监督进程。
 * @param {number} exitCode 退出码。
 * @param {NodeJS.Signals | null} signal 触发清理的信号。
 */
function shutdown(exitCode = 0, signal = null) {
    if (shuttingDown) {
        return;
    }

    shuttingDown = true;
    clearInterval(parentWatchTimer);
    terminateChild(devServer, signal ?? "SIGTERM");

    if (signal) {
        process.exitCode = exitCode;
        return;
    }

    process.exit(exitCode);
}

const parentWatchTimer = setInterval(() => {
    const parentGone = !isProcessAlive(originalParentPid);
    const orphanedOnPosix = process.platform !== "win32" && process.ppid === 1;
    if (!parentGone && !orphanedOnPosix) {
        return;
    }

    console.info("[tauri-before-dev] parent process exited; shutting down dev server");
    shutdown(0, "SIGTERM");
}, WATCH_PARENT_INTERVAL_MS);

devServer.on("exit", (code, signal) => {
    clearInterval(parentWatchTimer);
    if (signal) {
        process.exit(0);
    }
    process.exit(code ?? 0);
});

devServer.on("error", (error) => {
    clearInterval(parentWatchTimer);
    console.error("[tauri-before-dev] failed to start dev server", error);
    process.exit(1);
});

process.on("SIGINT", () => {
    shutdown(0, "SIGINT");
});

process.on("SIGTERM", () => {
    shutdown(0, "SIGTERM");
});

process.on("exit", () => {
    clearInterval(parentWatchTimer);
    terminateChild(devServer, "SIGTERM");
});
