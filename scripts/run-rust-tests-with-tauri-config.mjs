import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { ensurePinnedProtoc } from "./protoc-toolchain.mjs";

/**
 * @module scripts/run-rust-tests-with-tauri-config
 * @description 为 `cargo test` 显式注入合并后的 Tauri 配置，避免直接走 Cargo 时因平台配置推断差异触发 feature/config 不一致校验。
 */

const workspaceRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const srcTauriRoot = path.join(workspaceRoot, "src-tauri");
const baseConfigPath = path.join(srcTauriRoot, "tauri.conf.json");
const macosConfigPath = path.join(srcTauriRoot, "tauri.macos.conf.json");
const integrationTestsRoot = path.join(srcTauriRoot, "tests");
const sidecarTestTargets = new Set(["ai_sidecar_grpc_integration"]);

/**
 * @function isPlainObject
 * @description 判断给定值是否为普通对象，用于深合并配置。
 * @param {unknown} value 待判断值。
 * @returns {boolean} 是否为普通对象。
 */
function isPlainObject(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * @function mergeJsonConfig
 * @description 深合并两个 JSON 对象，数组采用覆盖语义。
 * @param {Record<string, unknown>} base 基础配置。
 * @param {Record<string, unknown>} override 覆盖配置。
 * @returns {Record<string, unknown>} 合并后的配置。
 */
function mergeJsonConfig(base, override) {
    const merged = { ...base };

    for (const [key, overrideValue] of Object.entries(override)) {
        const baseValue = merged[key];
        if (isPlainObject(baseValue) && isPlainObject(overrideValue)) {
            merged[key] = mergeJsonConfig(baseValue, overrideValue);
            continue;
        }

        merged[key] = overrideValue;
    }

    return merged;
}

/**
 * @function readJsonFile
 * @description 读取 JSON 文件。
 * @param {string} filePath 文件路径。
 * @returns {Record<string, unknown>} 解析后的 JSON 对象。
 */
function readJsonFile(filePath) {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

/**
 * @function parseCliOptions
 * @description 解析脚本参数，支持按测试画像拆分 Rust 测试执行。
 * @param {string[]} argv 命令行参数列表。
 * @returns {{ profile: "all" | "core" | "sidecar", cargoArgs: string[] }}
 * 解析后的画像与透传给 cargo 的附加参数。
 * @throws {Error} 当画像值非法或缺少参数值时抛出异常。
 */
function parseCliOptions(argv) {
    let profile = "all";
    const cargoArgs = [];

    for (let index = 0; index < argv.length; index += 1) {
        const argument = argv[index];

        if (argument === "--profile") {
            const nextValue = argv[index + 1];
            if (!nextValue) {
                throw new Error("--profile 需要提供 profile 值");
            }
            if (!["all", "core", "sidecar"].includes(nextValue)) {
                throw new Error(`不支持的 Rust 测试画像: ${nextValue}`);
            }
            profile = nextValue;
            index += 1;
            continue;
        }

        if (argument === "--") {
            cargoArgs.push(...argv.slice(index + 1));
            break;
        }

        cargoArgs.push(argument);
    }

    return {
        profile,
        cargoArgs,
    };
}

/**
 * @function listIntegrationTestTargets
 * @description 枚举当前 crate 的 integration test target 名称。
 * @returns {string[]} 所有 integration test target，按名称排序。
 */
function listIntegrationTestTargets() {
    return fs.readdirSync(integrationTestsRoot, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(".rs"))
        .map((entry) => entry.name.replace(/\.rs$/u, ""))
        .sort((left, right) => left.localeCompare(right));
}

/**
 * @function resolveHostTuple
 * @description 读取当前 Rust 主机 target triple。
 * @returns {string} 当前主机 triple。
 */
function resolveHostTuple() {
    const hostTuple = spawnSync("rustc", ["--print", "host-tuple"], {
        cwd: workspaceRoot,
        encoding: "utf8",
    });

    if (hostTuple.status !== 0) {
        throw new Error(hostTuple.error?.message ?? "读取 Rust host tuple 失败");
    }

    return hostTuple.stdout.trim();
}

/**
 * @function resolveSidecarBinaryPath
 * @description 解析当前主机平台对应的 sidecar 二进制路径。
 * @param {string} id sidecar 基础 ID。
 * @returns {string} sidecar 二进制绝对路径。
 */
function resolveSidecarBinaryPath(id) {
    const hostTuple = resolveHostTuple();
    const extension = process.platform === "win32" ? ".exe" : "";
    return path.join(
        srcTauriRoot,
        "binaries",
        `${id}-${hostTuple}${extension}`,
    );
}

/**
 * @function ensurePlaceholderBinary
 * @description 准备一个让 Tauri build script 通过资源路径校验的占位 sidecar。
 * @param {string} binaryPath 目标二进制路径。
 * @param {string} label 占位说明。
 * @returns {void}
 */
function ensurePlaceholderBinary(binaryPath, label) {
    if (fs.existsSync(binaryPath)) {
        return;
    }

    fs.mkdirSync(path.dirname(binaryPath), { recursive: true });
    fs.writeFileSync(
        binaryPath,
        `placeholder sidecar for ${label}\n`,
        "utf8",
    );
}

/**
 * @function ensureSidecarBinaryForProfile
 * @description 根据测试画像准备 sidecar 二进制占位或校验真实产物。
 * @param {"all" | "core" | "sidecar"} profile 当前测试画像。
 * @returns {void}
 * @throws {Error} 当 sidecar 画像缺少真实二进制时抛出异常。
 */
function ensureSidecarBinaryForProfile(profile) {
    const toolboxBinaryPath = resolveSidecarBinaryPath("ofive-toolbox");
    ensurePlaceholderBinary(toolboxBinaryPath, "ofive-toolbox Rust tests");

    const binaryPath = resolveSidecarBinaryPath("ofive-ai-sidecar");
    if (fs.existsSync(binaryPath)) {
        return;
    }

    if (profile === "core") {
        ensurePlaceholderBinary(binaryPath, "non-sidecar Rust tests");
        return;
    }

    throw new Error(
        `缺少 AI sidecar 二进制: ${binaryPath}。请先执行 bun run build:sidecar。`,
    );
}

/**
 * @function buildCargoTestArgs
 * @description 按画像构造 cargo test 参数，隔离 sidecar 依赖测试目标。
 * @param {"all" | "core" | "sidecar"} profile 当前测试画像。
 * @param {string[]} extraArgs 透传给 cargo 的附加参数。
 * @returns {string[]} 完整 cargo 参数列表。
 */
function buildCargoTestArgs(profile, extraArgs) {
    const cargoArgs = ["test", "--manifest-path", "src-tauri/Cargo.toml"];

    if (profile === "all") {
        cargoArgs.push(...extraArgs);
        return cargoArgs;
    }

    const integrationTargets = listIntegrationTestTargets();
    const selectedTargets = integrationTargets.filter((target) => {
        const isSidecarTarget = sidecarTestTargets.has(target);
        return profile === "sidecar" ? isSidecarTarget : !isSidecarTarget;
    });

    if (profile === "core") {
        cargoArgs.push("--lib");
    }

    for (const target of selectedTargets) {
        cargoArgs.push("--test", target);
    }

    cargoArgs.push(...extraArgs);
    return cargoArgs;
}

const baseConfig = readJsonFile(baseConfigPath);
const macosConfig = fs.existsSync(macosConfigPath) ? readJsonFile(macosConfigPath) : {};
const mergedTauriConfig = mergeJsonConfig(baseConfig, macosConfig);
const protocPath = await ensurePinnedProtoc();
const { profile, cargoArgs } = parseCliOptions(process.argv.slice(2));

ensureSidecarBinaryForProfile(profile);

const result = spawnSync("cargo", buildCargoTestArgs(profile, cargoArgs), {
    stdio: "inherit",
    cwd: workspaceRoot,
    env: {
        ...process.env,
        PROTOC: protocPath,
        TAURI_CONFIG: JSON.stringify(mergedTauriConfig),
    },
});

if (typeof result.status === "number") {
    process.exit(result.status);
}

if (result.error) {
    throw result.error;
}

process.exit(1);
