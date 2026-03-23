import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
    ensurePinnedProtoc,
    PINNED_PROTOC_VERSION,
    readPinnedProtocVersion,
} from "./protoc-toolchain.mjs";

/**
 * @module scripts/build-sidecar
 * @description 构建当前主机平台的 Go sidecar，并输出到 Tauri `externalBin` 需要的命名位置。
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const outputDir = path.join(projectRoot, "src-tauri", "binaries");
const protoDir = path.join(projectRoot, "proto");
const PROTOC_GEN_GO_VERSION = "v1.36.11";
const PROTOC_GEN_GO_GRPC_VERSION = "v1.5.1";

/**
 * @function resolveLocalExecutable
 * @description 返回本地工具在当前平台上的可执行文件路径。
 * @param {string} toolDir 工具目录。
 * @param {string} fileName 工具基础文件名。
 * @returns {string} 当前平台可执行文件完整路径。
 */
function resolveLocalExecutable(toolDir, fileName) {
    const executableName = process.platform === "win32"
        ? `${fileName}.exe`
        : fileName;
    return path.join(toolDir, executableName);
}

/**
 * @constant SIDECAR_TARGETS
 * @description 当前项目需要构建的 sidecar 清单。
 */
const SIDECAR_TARGETS = [
    {
        id: "ofive-ai-sidecar",
        sourceDir: path.join(projectRoot, "sidecars", "go", "ofive-ai-agent"),
        buildArgs: ["build", "-o"],
        entry: "./cmd/ofive-ai-sidecar",
        protoFiles: [path.join(protoDir, "ai_sidecar.proto")],
        generatedDir: path.join(projectRoot, "sidecars", "go", "ofive-ai-agent", "gen", "ofive", "aiv1"),
    },
];

/**
 * @function getHostTuple
 * @description 读取当前 Rust 主机 target triple，用于生成符合 Tauri 约定的 sidecar 文件名。
 * @returns {string} 当前主机 triple。
 */
function getHostTuple() {
    return execFileSync("rustc", ["--print", "host-tuple"], {
        cwd: projectRoot,
        encoding: "utf8",
    }).trim();
}

/**
 * @function ensureGoCodegenTools
 * @description 为指定 Go sidecar 构建本地 protobuf 代码生成器。
 * @param {{ sourceDir: string }} target sidecar 构建目标。
 */
function ensureGoCodegenTools(target) {
    const toolDir = path.join(target.sourceDir, ".bin");
    if (!existsSync(toolDir)) {
        mkdirSync(toolDir, { recursive: true });
    }

    const protocGenGoPath = resolveLocalExecutable(toolDir, "protoc-gen-go");
    const protocGenGoGrpcPath = resolveLocalExecutable(toolDir, "protoc-gen-go-grpc");

    if (!existsSync(protocGenGoPath)) {
        execFileSync(
            "go",
            ["install", `google.golang.org/protobuf/cmd/protoc-gen-go@${PROTOC_GEN_GO_VERSION}`],
            {
                cwd: target.sourceDir,
                stdio: "inherit",
                env: {
                    ...process.env,
                    GOBIN: toolDir,
                    GOWORK: "off",
                },
            },
        );
    }

    if (!existsSync(protocGenGoGrpcPath)) {
        execFileSync(
            "go",
            ["install", `google.golang.org/grpc/cmd/protoc-gen-go-grpc@${PROTOC_GEN_GO_GRPC_VERSION}`],
            {
                cwd: target.sourceDir,
                stdio: "inherit",
                env: {
                    ...process.env,
                    GOBIN: toolDir,
                    GOWORK: "off",
                },
            },
        );
    }
}

/**
 * @function generateGoStubs
 * @description 根据共享 proto 为指定 sidecar 生成 Go gRPC 代码。
 * @param {{ sourceDir: string, protoFiles: string[], generatedDir: string }} target sidecar 构建目标。
 * @param {string} protocPath 固定版本 protoc 路径。
 */
function generateGoStubs(target, protocPath) {
    if (!existsSync(target.generatedDir)) {
        mkdirSync(target.generatedDir, { recursive: true });
    }

    const toolDir = path.join(target.sourceDir, ".bin");
    const protocGenGoPath = resolveLocalExecutable(toolDir, "protoc-gen-go");
    const protocGenGoGrpcPath = resolveLocalExecutable(toolDir, "protoc-gen-go-grpc");
    execFileSync(
        protocPath,
        [
            `-I${protoDir}`,
            `--plugin=protoc-gen-go=${protocGenGoPath}`,
            `--plugin=protoc-gen-go-grpc=${protocGenGoGrpcPath}`,
            `--go_out=${target.generatedDir}`,
            "--go_opt=paths=source_relative",
            `--go-grpc_out=${target.generatedDir}`,
            "--go-grpc_opt=paths=source_relative",
            ...target.protoFiles,
        ],
        {
            cwd: target.sourceDir,
            stdio: "inherit",
        },
    );
}

/**
 * @function buildSidecars
 * @description 编译当前平台 sidecar 二进制集合。
 */
async function buildSidecars() {
    const generateOnly = process.argv.includes("--generate-only");
    const hostTuple = getHostTuple();
    const extension = process.platform === "win32" ? ".exe" : "";
    const protocPath = await ensurePinnedProtoc();
    const protocVersion = readPinnedProtocVersion(protocPath);

    if (!existsSync(outputDir)) {
        mkdirSync(outputDir, { recursive: true });
    }

    console.info("[sidecar-build] using protoc", {
        version: protocVersion,
        pinnedVersion: PINNED_PROTOC_VERSION,
        protocPath,
    });

    for (const target of SIDECAR_TARGETS) {
        const binaryName = `${target.id}-${hostTuple}${extension}`;
        const outputPath = path.join(outputDir, binaryName);

        console.info("[sidecar-build] start", {
            id: target.id,
            hostTuple,
            outputPath,
        });

        ensureGoCodegenTools(target);
        generateGoStubs(target, protocPath);

        if (generateOnly) {
            console.info("[sidecar-build] codegen-only success", {
                id: target.id,
            });
            continue;
        }

        execFileSync(
            "go",
            [...target.buildArgs, outputPath, target.entry],
            {
                cwd: target.sourceDir,
                stdio: "inherit",
                env: {
                    ...process.env,
                    CGO_ENABLED: process.env.CGO_ENABLED ?? "0",
                    GOWORK: "off",
                },
            },
        );

        console.info("[sidecar-build] success", {
            id: target.id,
            binaryName,
        });
    }
}

await buildSidecars();