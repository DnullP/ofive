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

const baseConfig = readJsonFile(baseConfigPath);
const macosConfig = fs.existsSync(macosConfigPath) ? readJsonFile(macosConfigPath) : {};
const mergedTauriConfig = mergeJsonConfig(baseConfig, macosConfig);
const protocPath = await ensurePinnedProtoc();

const result = spawnSync("cargo", ["test", "--manifest-path", "src-tauri/Cargo.toml"], {
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