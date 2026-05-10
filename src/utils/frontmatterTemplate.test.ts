/**
 * @module utils/frontmatterTemplate.test
 * @description 新建 Markdown frontmatter 模板生成测试。
 */

import { describe, expect, test } from "bun:test";
import {
    buildCreatedMarkdownInitialContent,
    expandFrontmatterTemplate,
} from "./frontmatterTemplate";

describe("expandFrontmatterTemplate", () => {
    test("should expand filename date and directory placeholders", () => {
        const result = expandFrontmatterTemplate(
            "title: {{filename}}\ndate: {{date}}\ndir: {{directory}}",
            "notes/daily/today.md",
            new Date(2026, 4, 8),
        );

        expect(result).toBe("title: today\ndate: 2026-05-08\ndir: notes/daily");
    });
});

describe("buildCreatedMarkdownInitialContent", () => {
    test("should keep heading-only content when auto frontmatter is disabled", () => {
        expect(buildCreatedMarkdownInitialContent(
            "notes/topic.md",
            {
                frontmatterAutoInsertOnCreate: false,
                frontmatterTemplate: "---\ntitle: {{filename}}\n---",
            },
            new Date(2026, 4, 8),
        )).toBe("# topic\n");
    });

    test("should insert expanded frontmatter before heading when enabled", () => {
        expect(buildCreatedMarkdownInitialContent(
            "notes/topic.md",
            {
                frontmatterAutoInsertOnCreate: true,
                frontmatterTemplate: "---\ntitle: {{filename}}\ndate: {{date}}\n---",
            },
            new Date(2026, 4, 8),
        )).toBe("---\ntitle: topic\ndate: 2026-05-08\n---\n\n# topic\n");
    });
});
