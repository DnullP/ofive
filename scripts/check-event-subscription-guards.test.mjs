/**
 * @file scripts/check-event-subscription-guards.test.mjs
 * @description 后端事件订阅生命周期 guard 的最小回归测试。
 */

import { describe, expect, test } from "bun:test";

import { buildEventSubscriptionViolations } from "./check-event-subscription-guards.mjs";

describe("event subscription guards", () => {
    test("allows backend stream subscriptions only in the plugin-level hub", () => {
        const violations = buildEventSubscriptionViolations([
            {
                relativePath: "src/plugins/ai-chat/aiChatStreamEventHub.ts",
                content: "import { subscribeAiChatStreamEvents } from '../../api/aiApi';\nsubscribeAiChatStreamEvents(() => {});",
            },
            {
                relativePath: "src/plugins/ai-chat/aiChatPlugin.tsx",
                content: "import { subscribeAiChatStreamEvents } from '../../api/aiApi';\nsubscribeAiChatStreamEvents(() => {});",
            },
        ]);

        expect(violations).toEqual([
            {
                relativePath: "src/plugins/ai-chat/aiChatPlugin.tsx",
                symbol: "subscribeAiChatStreamEvents",
                replacement: "subscribeAiChatStreamEventHub",
            },
        ]);
    });

    test("rejects direct vault fs backend subscriptions outside the App Event Bus bridge", () => {
        const violations = buildEventSubscriptionViolations([
            {
                relativePath: "src/host/events/appEventBus.ts",
                content: "import { subscribeVaultFsEvents } from '../../api/vaultApi';\nsubscribeVaultFsEvents(() => {});",
            },
            {
                relativePath: "src/plugins/example/examplePlugin.tsx",
                content: "import { subscribeVaultFsEvents } from '../../api/vaultApi';\nsubscribeVaultFsEvents(() => {});",
            },
        ]);

        expect(violations).toEqual([
            {
                relativePath: "src/plugins/example/examplePlugin.tsx",
                symbol: "subscribeVaultFsEvents",
                replacement: "subscribeVaultFsBusEvent",
            },
        ]);
    });
});
