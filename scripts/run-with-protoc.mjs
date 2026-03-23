import { spawnSync } from "node:child_process";
import { ensurePinnedProtoc } from "./protoc-toolchain.mjs";

/**
 * @module scripts/run-with-protoc
 * @description 使用仓库内固定版本 protoc 执行任意命令，为 Rust / Tauri 构建流提供一致工具链。
 */

const commandArgs = process.argv.slice(2);
if (commandArgs.length === 0) {
    console.error("[run-with-protoc] missing command");
    process.exit(1);
}

const [command, ...args] = commandArgs;
const protocPath = await ensurePinnedProtoc();

const result = spawnSync(command, args, {
    stdio: "inherit",
    env: {
        ...process.env,
        PROTOC: protocPath,
    },
});

if (typeof result.status === "number") {
    process.exit(result.status);
}

if (result.error) {
    throw result.error;
}

process.exit(1);