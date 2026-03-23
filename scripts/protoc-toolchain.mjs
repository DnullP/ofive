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
const PINNED_PROTOC_MAJOR = Number.parseInt(
    PINNED_PROTOC_VERSION.split(".")[0] ?? "0",
    10,
);

/**
 * @function parseProtocVersion
 * @description 解析 `protoc --version` 输出，提取可比较的语义化版本信息。
 * @param {string} versionOutput `protoc --version` 原始输出。
 * @returns {{ raw: string, major: number, minor: number, patch: number }} 版本对象。
 */
function parseProtocVersion(versionOutput) {
    const normalizedOutput = versionOutput.trim();
    const match = /libprotoc\s+(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(normalizedOutput);

    if (!match) {
        throw new Error(`Unable to parse protoc version output: ${normalizedOutput}`);
    }

    return {
        raw: normalizedOutput,
        major: Number.parseInt(match[1] ?? "0", 10),
        minor: Number.parseInt(match[2] ?? "0", 10),
        patch: Number.parseInt(match[3] ?? "0", 10),
    };
}

/**
 * @function isCompatibleProtocVersion
 * @description 判断给定 protoc 版本是否满足当前仓库允许的兼容策略。
 * @param {string} versionOutput `protoc --version` 输出。
 * @returns {boolean} 是否兼容当前仓库。
 */
function isCompatibleProtocVersion(versionOutput) {
    const version = parseProtocVersion(versionOutput);
    return version.major === PINNED_PROTOC_MAJOR;
}

/**
 * @function resolveSystemProtocPath
 * @description 解析当前主机 PATH 中的系统 protoc，便于离线开发场景复用本地工具链。
 * @returns {string | null} 系统 protoc 可执行文件路径。
 */
function resolveSystemProtocPath() {
    const locator = process.platform === "win32"
        ? "where"
        : "which";

    try {
        const locatorOutput = execFileSync(locator, ["protoc"], {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
        });

        return locatorOutput
            .split(/\r?\n/u)
            .map((entry) => entry.trim())
            .find((entry) => entry.length > 0) ?? null;
    } catch {
        return null;
    }
}

/**
 * @function resolveCompatibleSystemProtoc
 * @description 查找本机已安装且与仓库版本策略兼容的 protoc。
 * @returns {{ path: string, version: string } | null} 兼容的系统 protoc 信息。
 */
function resolveCompatibleSystemProtoc() {
    const systemProtocPath = resolveSystemProtocPath();
    if (!systemProtocPath) {
        return null;
    }

    const systemProtocVersion = readPinnedProtocVersion(systemProtocPath);
    if (!isCompatibleProtocVersion(systemProtocVersion)) {
        console.warn("[protoc-toolchain] system protoc rejected", {
            systemProtocPath,
            systemProtocVersion,
            compatibleMajor: PINNED_PROTOC_MAJOR,
        });
        return null;
    }

    return {
        path: systemProtocPath,
        version: systemProtocVersion,
    };
}

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
        const configuredVersion = readPinnedProtocVersion(configuredProtocPath);
        if (!isCompatibleProtocVersion(configuredVersion)) {
            throw new Error(
                `Configured protoc is incompatible: ${configuredVersion}. Expected major ${PINNED_PROTOC_MAJOR}.x`,
            );
        }

        console.info("[protoc-toolchain] using configured protoc", {
            configuredProtocPath,
            configuredVersion,
        });
        return configuredProtocPath;
    }

    const protocPath = resolvePinnedProtocPath();
    if (existsSync(protocPath)) {
        return protocPath;
    }

    const compatibleSystemProtoc = resolveCompatibleSystemProtoc();
    if (compatibleSystemProtoc) {
        console.info("[protoc-toolchain] using compatible system protoc", {
            protocPath: compatibleSystemProtoc.path,
            version: compatibleSystemProtoc.version,
            preferredVersion: PINNED_PROTOC_VERSION,
        });
        return compatibleSystemProtoc.path;
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
    } catch (error) {
        throw new Error(
            `[protoc-toolchain] unable to resolve compatible protoc. `
            + `Preferred version: ${PINNED_PROTOC_VERSION}; accepted major: ${PINNED_PROTOC_MAJOR}.x; `
            + `download failed: ${error instanceof Error ? error.message : String(error)}`,
        );
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