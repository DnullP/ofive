/**
 * @module test-support/mockVaultApi
 * @description Shared complete vaultApi mock for Bun tests. Bun keeps module mocks process-wide,
 * so partial mocks can leak into later tests and make unrelated imports fail with missing exports.
 */

type MockVaultApiOverrides = Record<string, unknown>;

const DEFAULT_MARKDOWN_CONTENT = "# latest";

/**
 * @function createMockVaultApi
 * @description Builds a complete value-export mock for ../../api/vaultApi with optional overrides.
 * @param overrides Test-specific behavior to replace default mock functions.
 * @returns Runtime exports compatible with vaultApi consumers.
 */
export function createMockVaultApi(overrides: MockVaultApiOverrides = {}): MockVaultApiOverrides {
    return {
        VAULT_FS_EVENT_NAME: "vault://fs-event",
        VAULT_CONFIG_EVENT_NAME: "vault://config-event",
        setCurrentVault: async (vaultPath: string) => ({ vaultPath }),
        getCurrentVaultTree: async () => ({ vaultPath: "", entries: [] }),
        readVaultMarkdownFile: async (relativePath: string) => ({
            relativePath,
            content: DEFAULT_MARKDOWN_CONTENT,
        }),
        readVaultCanvasFile: async (relativePath: string) => ({
            relativePath,
            content: "{\n  \"nodes\": [],\n  \"edges\": []\n}\n",
        }),
        readVaultBinaryFile: async (relativePath: string) => ({
            relativePath,
            mimeType: "application/octet-stream",
            base64Content: "",
        }),
        resolveWikiLinkTarget: async () => null,
        resolveMediaEmbedTarget: async () => null,
        getCurrentVaultMarkdownGraph: async () => ({ nodes: [], edges: [] }),
        searchVaultMarkdownFiles: async () => [],
        searchVaultMarkdown: async () => [],
        suggestWikiLinkTargets: async () => [],
        getBacklinksForFile: async () => [],
        getVaultMarkdownOutline: async () => ({ relativePath: "", headings: [] }),
        queryVaultMarkdownFrontmatter: async (fieldName: string, fieldValue?: string) => ({
            fieldName,
            fieldValue: fieldValue ?? null,
            matches: [],
        }),
        queryVaultTasks: async () => [],
        createVaultMarkdownFile: async (relativePath: string) => ({ relativePath, created: true }),
        createVaultCanvasFile: async (relativePath: string) => ({ relativePath, created: true }),
        createVaultDirectory: async () => undefined,
        createVaultBinaryFile: async (relativePath: string) => ({ relativePath, created: true }),
        saveVaultMarkdownFile: async (relativePath: string) => ({ relativePath, created: false }),
        saveVaultCanvasFile: async (relativePath: string) => ({ relativePath, created: false }),
        renameVaultMarkdownFile: async (_fromRelativePath: string, toRelativePath: string) => ({
            relativePath: toRelativePath,
            created: false,
        }),
        renameVaultCanvasFile: async (_fromRelativePath: string, toRelativePath: string) => ({
            relativePath: toRelativePath,
            created: false,
        }),
        moveVaultMarkdownFileToDirectory: async (fromRelativePath: string) => ({
            relativePath: fromRelativePath,
            created: false,
        }),
        moveVaultCanvasFileToDirectory: async (fromRelativePath: string) => ({
            relativePath: fromRelativePath,
            created: false,
        }),
        renameVaultDirectory: async (_fromRelativePath: string, toRelativePath: string) => ({
            relativePath: toRelativePath,
            created: false,
        }),
        moveVaultDirectoryToDirectory: async (fromRelativePath: string) => ({
            relativePath: fromRelativePath,
            created: false,
        }),
        deleteVaultDirectory: async () => undefined,
        deleteVaultMarkdownFile: async () => undefined,
        deleteVaultCanvasFile: async () => undefined,
        deleteVaultBinaryFile: async () => undefined,
        copyVaultEntry: async (sourceRelativePath: string) => ({
            relativePath: sourceRelativePath,
            sourceRelativePath,
        }),
        segmentChineseText: async (text: string) => Array.from(text).map((word, index) => ({
            word,
            start: index,
            end: index + word.length,
        })),
        subscribeVaultFsEvents: async () => () => undefined,
        getCurrentVaultConfig: async () => ({
            schemaVersion: 1,
            entries: {},
        }),
        saveCurrentVaultConfig: async (config: unknown) => config,
        subscribeVaultConfigEvents: async () => () => undefined,
        isSelfTriggeredVaultFsEvent: () => false,
        isSelfTriggeredVaultConfigEvent: () => false,
        ...overrides,
    };
}
