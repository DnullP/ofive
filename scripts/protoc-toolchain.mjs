import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * @module scripts/protoc-toolchain
 * @description 管理仓库内固定版本的 protoc 工具链，避免不同机器上的系统 protoc 产生漂移。
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

export const PINNED_PROTOC_VERSION = "33.4";

/**
 * @function resolvePinnedProtocPath
 * @description 返回当前平台下仓库缓存的 protoc 可执行文件路径。
 * @returns {string} protoc 可执行文件路径。
 */
export function resolvePinnedProtocPath() {
    const executableName = process.platform === "win32"
        ? "protoc.exe"
        : "protoc";

    return path.join(
        projectRoot,
        ".tools",
        "protoc",
        PINNED_PROTOC_VERSION,
        `${process.platform}-${process.arch}`,
        "bin",
        executableName,
    );
}

/**
 * @function resolveDownloadArchiveName
 * @description 根据当前平台与架构解析 protobuf 官方发布资产名。
 * @returns {string} zip 资产文件名。
 */
function resolveDownloadArchiveName() {
    if (process.platform === "darwin") {
        if (process.arch === "arm64") {
            return `protoc-${PINNED_PROTOC_VERSION}-osx-aarch_64.zip`;
        }

        if (process.arch === "x64") {
            return `protoc-${PINNED_PROTOC_VERSION}-osx-x86_64.zip`;
        }
    }

    if (process.platform === "linux") {
        if (process.arch === "arm64") {
            return `protoc-${PINNED_PROTOC_VERSION}-linux-aarch_64.zip`;
        }

        if (process.arch === "x64") {
            return `protoc-${PINNED_PROTOC_VERSION}-linux-x86_64.zip`;
        }
    }

    if (process.platform === "win32") {
        if (process.arch === "x64") {
            return `protoc-${PINNED_PROTOC_VERSION}-win64.zip`;
        }

        if (process.arch === "ia32") {
            return `protoc-${PINNED_PROTOC_VERSION}-win32.zip`;
        }
    }

    throw new Error(
        `Unsupported protoc host platform: ${process.platform}/${process.arch}`,
    );
}

/**
 * @function extractArchive
 * @description 使用当前平台可用的系统工具解压 protoc 归档。
 * @param {string} archivePath zip 归档路径。
 * @param {string} destinationDir 解压目录。
 */
function extractArchive(archivePath, destinationDir) {
    if (process.platform === "win32") {
        execFileSync(
            "powershell",
            [
                "-NoProfile",
                "-Command",
                `Expand-Archive -LiteralPath '${archivePath.replace(/'/g, "''")}' -DestinationPath '${destinationDir.replace(/'/g, "''")}' -Force`,
            ],
            {
                stdio: "inherit",
            },
        );
        return;
    }

    if (process.platform === "darwin") {
        execFileSync("ditto", ["-x", "-k", archivePath, destinationDir], {
            stdio: "inherit",
        });
        return;
    }

    execFileSync("unzip", ["-oq", archivePath, "-d", destinationDir], {
        stdio: "inherit",
    });
}

/**
 * @function resolveConfiguredProtocPath
 * @description 优先返回显式配置的 protoc 路径，便于离线或企业镜像环境覆盖。
 * @returns {string | null} 配置路径或 null。
 */
function resolveConfiguredProtocPath() {
    const configuredPath = process.env.OFIVE_PROTOC_PATH?.trim();
    if (!configuredPath) {
        return null;
    }

    return configuredPath;
}

/**
 * @function ensurePinnedProtoc
 * @description 确保仓库内存在固定版本的 protoc；若不存在则自动下载并缓存。
 * @returns {Promise<string>} protoc 可执行文件路径。
 */
export async function ensurePinnedProtoc() {
    const configuredProtocPath = resolveConfiguredProtocPath();
    if (configuredProtocPath) {
        return configuredProtocPath;
    }

    const protocPath = resolvePinnedProtocPath();
    if (existsSync(protocPath)) {
        return protocPath;
    }

    const archiveName = resolveDownloadArchiveName();
    const downloadUrl = `https://github.com/protocolbuffers/protobuf/releases/download/v${PINNED_PROTOC_VERSION}/${archiveName}`;
    const cacheRoot = path.dirname(path.dirname(protocPath));
    const tempRoot = path.join(os.tmpdir(), `ofive-protoc-${Date.now()}`);
    const archivePath = path.join(tempRoot, archiveName);

    mkdirSync(tempRoot, { recursive: true });
    mkdirSync(cacheRoot, { recursive: true });

    try {
        console.info("[protoc-toolchain] download start", {
            version: PINNED_PROTOC_VERSION,
            url: downloadUrl,
        });

        const response = await fetch(downloadUrl);
        if (!response.ok) {
            throw new Error(`Failed to download protoc: ${response.status} ${response.statusText}`);
        }

        const archiveBuffer = Buffer.from(await response.arrayBuffer());
        writeFileSync(archivePath, archiveBuffer);
        extractArchive(archivePath, cacheRoot);

        if (!existsSync(protocPath)) {
            throw new Error(`Pinned protoc was not extracted to expected path: ${protocPath}`);
        }

        if (process.platform !== "win32") {
            chmodSync(protocPath, 0o755);
        }

        console.info("[protoc-toolchain] download success", {
            version: PINNED_PROTOC_VERSION,
            protocPath,
        });

        return protocPath;
    } finally {
        rmSync(tempRoot, { recursive: true, force: true });
    }
}

/**
 * @function readPinnedProtocVersion
 * @description 读取指定 protoc 的实际版本字符串，用于日志和诊断。
 * @param {string} protocPath protoc 路径。
 * @returns {string} `protoc --version` 输出。
 */
export function readPinnedProtocVersion(protocPath) {
    return execFileSync(protocPath, ["--version"], {
        encoding: "utf8",
    }).trim();
}