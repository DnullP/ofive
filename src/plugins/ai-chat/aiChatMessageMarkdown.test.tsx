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

import { mock } from "bun:test";

import { AiChatMessageMarkdown } from "./aiChatMessageMarkdown";

mock.module("react-i18next", () => ({
    useTranslation: () => ({
        t: (key: string) => {
            if (key === "aiChatPlugin.reasoningSummary") {
                return "思考过程";
            }

            return key;
        },
    }),
}));

const STREAMING_PENDING_MARKDOWN = "**pending** answer";

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

    it("应在最终回答前渲染独立 reasoning 文本块", () => {
        const html = renderToStaticMarkup(
            <AiChatMessageMarkdown
                role="assistant"
                content="最终回答"
                reasoningContent="先分析上下文\n再给出结论"
            />,
        );

        expect(html).toContain("ai-chat-message-reasoning-panel");
        expect(html).toContain("ai-chat-message-reasoning-summary");
        expect(html).toContain("ai-chat-message-reasoning");
        expect(html).toContain("先分析上下文");
        expect(html).toContain("最终回答");
    });

    it("应在仅有 reasoning 时默认展开推理面板", () => {
        const html = renderToStaticMarkup(
            <AiChatMessageMarkdown
                role="assistant"
                content="   "
                reasoningContent="先收集约束\n再生成答案"
            />,
        );

        expect(html).toContain("<details class=\"ai-chat-message-reasoning-panel\" open=\"\"");
        expect(html).toContain("思考过程");
        expect(html).toContain("先收集约束");
    });

    it("应在流式阶段使用轻量纯文本渲染而不是 Markdown", () => {
        const html = renderToStaticMarkup(
            <AiChatMessageMarkdown
                role="assistant"
                content={STREAMING_PENDING_MARKDOWN}
                streaming
            />,
        );

        expect(html).toContain("ai-chat-message-markdown-streaming");
        expect(html).toContain("ai-chat-message-streaming-text");
        expect(html).toContain(STREAMING_PENDING_MARKDOWN);
        // i18n-guard-ignore-next-line: 这里断言的是渲染后的 HTML 片段，不是 UI 文案。
        expect(html).not.toContain("<strong>pending</strong>");
    });
});