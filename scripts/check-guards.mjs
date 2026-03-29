/**
 * @file scripts/check-guards.mjs
 * @description 守卫统一入口：顺序执行所有前端/后端静态 guard，作为构建与 CI 的单一入口。
 */

import { spawnSync } from "node:child_process";

const guardCommands = [
    { label: "backend-log-guard", args: ["scripts/check-backend-logs.mjs"] },
    { label: "theme-guard", args: ["scripts/check-theme-colors.mjs"] },
    { label: "i18n-guard", args: ["scripts/check-i18n-copy.mjs"] },
    { label: "editor-read-parity-guard", args: ["scripts/check-editor-read-parity.mjs"] },
];

for (const guardCommand of guardCommands) {
    console.info(`[guard-runner] running ${guardCommand.label}...`);
    const result = spawnSync("node", guardCommand.args, {
        stdio: "inherit",
        cwd: process.cwd(),
        env: process.env,
    });

    if (result.status !== 0) {
        console.error(`[guard-runner] failed at ${guardCommand.label}.`);
        process.exit(result.status ?? 1);
    }
}

console.info(`[guard-runner] passed (${guardCommands.length} guards)`);