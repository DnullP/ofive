/**
 * @module utils/frontmatterTemplate
 * @description Frontmatter 模板展开与新建 Markdown 初始内容生成。
 */

import type { FeatureSettings } from "../host/config/configStore";

export interface FrontmatterTemplateVariables {
    filename: string;
    directory: string;
    date: string;
}

/**
 * @function buildFrontmatterTemplateVariables
 * @description 根据 vault 相对路径构造 frontmatter 模板变量。
 */
export function buildFrontmatterTemplateVariables(
    relativePath: string,
    now: Date = new Date(),
): FrontmatterTemplateVariables {
    const normalizedPath = relativePath.replace(/\\/g, "/");
    const segments = normalizedPath.split("/");
    const fullName = segments.pop() ?? normalizedPath;
    const directory = segments.join("/");
    const filename = fullName.replace(/\.(md|markdown)$/i, "");
    const date = [
        String(now.getFullYear()).padStart(4, "0"),
        String(now.getMonth() + 1).padStart(2, "0"),
        String(now.getDate()).padStart(2, "0"),
    ].join("-");

    return {
        filename,
        directory,
        date,
    };
}

/**
 * @function expandFrontmatterTemplate
 * @description 展开模板占位符：{{filename}} / {{date}} / {{directory}}。
 */
export function expandFrontmatterTemplate(
    template: string,
    relativePath: string,
    now: Date = new Date(),
): string {
    const variables = buildFrontmatterTemplateVariables(relativePath, now);
    return template
        .replace(/\{\{filename\}\}/g, variables.filename)
        .replace(/\{\{date\}\}/g, variables.date)
        .replace(/\{\{directory\}\}/g, variables.directory);
}

/**
 * @function normalizeFrontmatterBlock
 * @description 将用户模板规范成完整 frontmatter 块；模板已含 --- 时原样尊重。
 */
export function normalizeFrontmatterBlock(expandedTemplate: string): string {
    const trimmed = expandedTemplate.trim();
    if (!trimmed) {
        return "---\n---";
    }

    if (trimmed.startsWith("---")) {
        return trimmed;
    }

    return `---\n${trimmed}\n---`;
}

/**
 * @function buildCreatedMarkdownInitialContent
 * @description 根据配置生成新建 Markdown 初始内容。
 */
export function buildCreatedMarkdownInitialContent(
    relativePath: string,
    featureSettings: Pick<FeatureSettings, "frontmatterAutoInsertOnCreate" | "frontmatterTemplate">,
    now: Date = new Date(),
): string {
    const { filename } = buildFrontmatterTemplateVariables(relativePath, now);
    const body = `# ${filename}\n`;

    if (!featureSettings.frontmatterAutoInsertOnCreate) {
        return body;
    }

    const expandedTemplate = expandFrontmatterTemplate(featureSettings.frontmatterTemplate, relativePath, now);
    const frontmatterBlock = normalizeFrontmatterBlock(expandedTemplate);
    return `${frontmatterBlock}\n\n${body}`;
}
