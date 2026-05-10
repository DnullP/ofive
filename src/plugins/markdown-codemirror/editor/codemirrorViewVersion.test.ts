/**
 * @module plugins/markdown-codemirror/editor/codemirrorViewVersion.test
 * @description CodeMirror view 版本护栏：避免回退到已知会破坏 IME composition 与 decoration 同步的版本。
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const CODEMIRROR_VIEW_MIN_VERSION = "6.39.16";

function parseVersion(version: string): [number, number, number] {
    const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
    if (!match) {
        throw new Error(`Invalid semver version: ${version}`);
    }

    return [
        Number(match[1]),
        Number(match[2]),
        Number(match[3]),
    ];
}

function compareVersions(left: string, right: string): number {
    const leftParts = parseVersion(left);
    const rightParts = parseVersion(right);

    for (let index = 0; index < leftParts.length; index += 1) {
        const diff = leftParts[index]! - rightParts[index]!;
        if (diff !== 0) {
            return diff;
        }
    }

    return 0;
}

describe("@codemirror/view version guard", () => {
    test("should include the IME composition and decoration corruption fixes from 6.39.16", () => {
        const packageJsonPath = require.resolve("@codemirror/view/package.json");
        const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { version?: unknown };
        const version = typeof packageJson.version === "string" ? packageJson.version : "";

        expect(compareVersions(version, CODEMIRROR_VIEW_MIN_VERSION)).toBeGreaterThanOrEqual(0);
    });

    test("should force transitive CodeMirror view users onto the IME-safe version", () => {
        const rootPackageJsonPath = path.resolve(import.meta.dir, "../../../../package.json");
        const packageJson = JSON.parse(readFileSync(rootPackageJsonPath, "utf8")) as {
            dependencies?: Record<string, string>;
            overrides?: Record<string, string>;
        };

        expect(packageJson.dependencies?.["@codemirror/view"]).toBe(CODEMIRROR_VIEW_MIN_VERSION);
        expect(packageJson.overrides?.["@codemirror/view"]).toBe(CODEMIRROR_VIEW_MIN_VERSION);
    });
});
