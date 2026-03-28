/**
 * @module api/vaultBrowserMockFixtures
 * @description 浏览器 mock Markdown fixture 的惰性加载器，用于隔离 Vite 专属的 `?raw` 与 `import.meta.glob` 逻辑，避免共享 API 模块在 Bun/Node 环境导入时触发资源解析。
 * @dependencies
 *  - Vite `import.meta.glob`
 *  - test-resources/notes 下的 Markdown fixture
 *
 * @example
 *   const markdownContents = await loadBrowserMockMarkdownContents();
 *   console.info(Object.keys(markdownContents));
 *
 * @exports
 *  - loadBrowserMockMarkdownContents: 加载并缓存浏览器 mock Markdown 内容映射。
 */

const BROWSER_MOCK_NOTES_MARKER = "/test-resources/notes/";
const BROWSER_MOCK_NOTES_GLOB_PATTERN = "../../test-resources/notes/**/*.{md,markdown}";

type RawModuleMap = Record<string, string>;

type BrowserMockFixturesImportMeta = ImportMeta & {
    glob?: (
        pattern: string,
        options: {
            query: string;
            import: string;
            eager: boolean;
        },
    ) => RawModuleMap;
};

let cachedBrowserMockMarkdownContentsPromise: Promise<Record<string, string>> | null = null;

/**
 * @function toBrowserMockMarkdownContents
 * @description 将原始模块路径映射转换为 vault 相对路径到 Markdown 文本的映射。
 * @param rawModules 原始模块路径与内容映射。
 * @returns 规范化后的 Markdown 内容映射。
 */
function toBrowserMockMarkdownContents(rawModules: RawModuleMap): Record<string, string> {
    return Object.entries(rawModules).reduce<Record<string, string>>((accumulator, [sourcePath, content]) => {
        const normalizedSourcePath = sourcePath.replace(/\\/g, "/");
        const markerIndex = normalizedSourcePath.lastIndexOf(BROWSER_MOCK_NOTES_MARKER);
        if (markerIndex < 0) {
            return accumulator;
        }

        const noteRelativePath = normalizedSourcePath.slice(markerIndex + 1);
        accumulator[noteRelativePath] = content;
        return accumulator;
    }, {});
}

/**
 * @function loadStaticBrowserMockRawModules
 * @description 在不支持 `import.meta.glob` 时，通过显式动态导入加载基础 Markdown fixture。
 * @returns 原始模块路径与内容映射。
 * @throws 动态导入失败时抛出异常。
 */
async function loadStaticBrowserMockRawModules(): Promise<RawModuleMap> {
    const [
        codeBlockTest,
        guide,
        networkSegment,
        note1,
        note2,
        taskBoardE2E,
    ] = await Promise.all([
        import("../../test-resources/notes/code-block-test.md?raw"),
        import("../../test-resources/notes/guide.md?raw"),
        import("../../test-resources/notes/network-segment.md?raw"),
        import("../../test-resources/notes/note1.md?raw"),
        import("../../test-resources/notes/note2.md?raw"),
        import("../../test-resources/notes/task-board-e2e.md?raw"),
    ]);

    return {
        "/test-resources/notes/code-block-test.md": codeBlockTest.default,
        "/test-resources/notes/guide.md": guide.default,
        "/test-resources/notes/network-segment.md": networkSegment.default,
        "/test-resources/notes/note1.md": note1.default,
        "/test-resources/notes/note2.md": note2.default,
        "/test-resources/notes/task-board-e2e.md": taskBoardE2E.default,
    };
}

/**
 * @function loadBrowserMockMarkdownContents
 * @description 加载浏览器 mock Markdown 内容，并在首次解析后复用同一份可变缓存。
 * @returns Markdown 内容映射；在非浏览器运行时返回空映射。
 */
export async function loadBrowserMockMarkdownContents(): Promise<Record<string, string>> {
    if (cachedBrowserMockMarkdownContentsPromise) {
        return cachedBrowserMockMarkdownContentsPromise;
    }

    cachedBrowserMockMarkdownContentsPromise = (async () => {
        if (typeof window === "undefined") {
            return {};
        }

        const viteImportMeta = import.meta as BrowserMockFixturesImportMeta;
        if (typeof viteImportMeta.glob === "function") {
            const globbedModules = viteImportMeta.glob(BROWSER_MOCK_NOTES_GLOB_PATTERN, {
                query: "?raw",
                import: "default",
                eager: true,
            }) as RawModuleMap;

            if (Object.keys(globbedModules).length > 0) {
                return toBrowserMockMarkdownContents(globbedModules);
            }
        }

        try {
            const staticFallbackModules = await loadStaticBrowserMockRawModules();
            return toBrowserMockMarkdownContents(staticFallbackModules);
        } catch (error) {
            console.warn("[vault-api] failed to load browser mock markdown fixtures", {
                error,
            });
            return {};
        }
    })();

    return cachedBrowserMockMarkdownContentsPromise;
}