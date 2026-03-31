/**
 * @module plugins/ai-chat/aiChatMessageMarkdown.test
 * @description AI 聊天 Markdown 渲染单元测试：验证气泡消息能够稳定输出常见 Markdown 结构。
 * @dependencies
 *   - bun:test
 *   - react-dom/server
 *   - ./aiChatMessageMarkdown
 */

import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { AiChatMessageMarkdown } from "./aiChatMessageMarkdown";

describe("AiChatMessageMarkdown", () => {
    it("应渲染常见 Markdown 结构", () => {
        const html = renderToStaticMarkup(
            <AiChatMessageMarkdown
                role="assistant"
                content={[
                    "# Summary",
                    "",
                    "A **bold** line with `code` and [link](https://example.com)",
                    "",
                    "- alpha",
                    "- beta",
                    "",
                    "```ts",
                    "const total = 1;",
                    "```",
                ].join("\n")}
            />,
        );

        expect(html).toContain("ai-chat-message-markdown");
        // i18n-guard-ignore-next-line
        expect(html).toContain("<h1 class=\"ai-chat-message-heading ai-chat-message-heading-h1\">Summary</h1>");
        // i18n-guard-ignore-next-line
        expect(html).toContain("<strong>bold</strong>");
        expect(html).toContain("ai-chat-message-inline-code");
        expect(html).toContain("href=\"https://example.com\"");
        expect(html).toContain("target=\"_blank\"");
        // i18n-guard-ignore-next-line
        expect(html).toContain("<li class=\"ai-chat-message-list-item\">alpha</li>");
        expect(html).toContain("ai-chat-message-code-block language-ts");
        expect(html).toContain("const total = 1;");
    });

    it("应在空内容时渲染占位文本", () => {
        const html = renderToStaticMarkup(
            <AiChatMessageMarkdown role="user" content="   " />,
        );

        expect(html).toContain("ai-chat-message-placeholder");
        expect(html).toContain("...");
    });
});