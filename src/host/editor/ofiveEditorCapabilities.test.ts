/**
 * @module host/editor/ofiveEditorCapabilities.test
 * @description ofive 注入 obeditor 的宿主能力测试。
 */

import { describe, expect, it, mock } from "bun:test";
import { createMockVaultApi } from "../../test-support/mockVaultApi";

const createdBinaryFiles: Array<{ relativePath: string; base64Content: string }> = [];

mock.module("../../api/vaultApi", () => createMockVaultApi({
    createVaultBinaryFile: async (relativePath: string, base64Content: string) => {
        createdBinaryFiles.push({ relativePath, base64Content });
        return { relativePath, created: true };
    },
}));

mock.module("../layout/nativeContextMenu", () => ({
    showNativeContextMenu: async () => null,
}));

const { createOfiveEditorCapabilities } = await import("./ofiveEditorCapabilities");

describe("createOfiveEditorCapabilities", () => {
    it("creates pasted media assets through the vault API", async () => {
        createdBinaryFiles.length = 0;
        const capabilities = createOfiveEditorCapabilities();
        const file = new File([new Uint8Array([1, 2, 3])], "demo.png", {
            type: "image/png",
        });

        const result = await capabilities.mediaEmbeds?.createAsset?.(file, {
            currentFilePath: "Notes/current.md",
            suggestedFileName: "pasted-image-demo.png",
            suggestedRelativePath: "Images/pasted-image-demo.png",
            base64Content: "AQID",
            markdown: "![[Images/pasted-image-demo.png]]",
        });

        expect(createdBinaryFiles).toEqual([
            {
                relativePath: "Images/pasted-image-demo.png",
                base64Content: "AQID",
            },
        ]);
        expect(result).toEqual({
            relativePath: "Images/pasted-image-demo.png",
            markdown: "![[Images/pasted-image-demo.png]]",
        });
    });

    it("requires obeditor-provided base64 content for pasted assets", async () => {
        const capabilities = createOfiveEditorCapabilities();
        const file = new File([new Uint8Array([1])], "demo.png", {
            type: "image/png",
        });

        await expect(capabilities.mediaEmbeds?.createAsset?.(file, {
            suggestedRelativePath: "Images/demo.png",
        })).rejects.toThrow("base64");
    });
});
