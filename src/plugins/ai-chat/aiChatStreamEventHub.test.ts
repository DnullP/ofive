/**
 * @module plugins/ai-chat/aiChatStreamEventHub.test
 * @description AI stream event hub tests: backend subscription outlives UI listener remounts.
 */

import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import type { AiChatStreamEventPayload } from "../../api/aiApi";

let subscribedHandler: ((payload: AiChatStreamEventPayload) => void) | null = null;
let backendUnlistenCount = 0;

const subscribeAiChatStreamEventsMock = mock(async (handler: (payload: AiChatStreamEventPayload) => void) => {
    subscribedHandler = handler;
    return () => {
        subscribedHandler = null;
        backendUnlistenCount += 1;
    };
});

const {
    __resetAiChatStreamEventHubForTests,
    __setAiChatStreamEventHubSubscribeForTests,
    startAiChatStreamEventHub,
    subscribeAiChatStreamEventHub,
} = await import("./aiChatStreamEventHub");

function createPayload(eventType: AiChatStreamEventPayload["eventType"]): AiChatStreamEventPayload {
    return {
        streamId: "stream-1",
        eventType,
        sessionId: "session-1",
        agentName: "test-agent",
        deltaText: eventType === "delta" ? "hello" : null,
        accumulatedText: eventType === "delta" ? "hello" : null,
        reasoningDeltaText: null,
        reasoningAccumulatedText: null,
        historyContentBlocksJson: null,
        debugTitle: null,
        debugLevel: null,
        debugText: null,
        confirmationId: null,
        confirmationHint: null,
        confirmationToolName: null,
        confirmationToolArgsJson: null,
        error: null,
        done: eventType === "done",
    };
}

async function flushStreamHubTasks(): Promise<void> {
    await Promise.resolve();
    await new Promise<void>((resolve) => queueMicrotask(resolve));
}

describe("aiChatStreamEventHub", () => {
    beforeEach(() => {
        __resetAiChatStreamEventHubForTests();
        subscribeAiChatStreamEventsMock.mockClear();
        subscribedHandler = null;
        backendUnlistenCount = 0;
        __setAiChatStreamEventHubSubscribeForTests(subscribeAiChatStreamEventsMock);
    });

    afterEach(() => {
        __resetAiChatStreamEventHubForTests();
    });

    it("buffers stream events while no UI listener is mounted and replays on resubscribe", async () => {
        startAiChatStreamEventHub();
        await flushStreamHubTasks();

        subscribedHandler?.(createPayload("delta"));
        const received: AiChatStreamEventPayload[] = [];
        const unlisten = subscribeAiChatStreamEventHub((payload) => {
            received.push(payload);
        });
        await flushStreamHubTasks();

        expect(subscribeAiChatStreamEventsMock).toHaveBeenCalledTimes(1);
        expect(received.map((payload) => payload.eventType)).toEqual(["delta"]);

        unlisten();
    });

    it("keeps the backend subscription alive when the UI listener unmounts", async () => {
        const received: AiChatStreamEventPayload[] = [];
        const unlisten = subscribeAiChatStreamEventHub((payload) => {
            received.push(payload);
        });
        await flushStreamHubTasks();

        subscribedHandler?.(createPayload("delta"));
        unlisten();
        subscribedHandler?.(createPayload("done"));

        const secondUnlisten = subscribeAiChatStreamEventHub((payload) => {
            received.push(payload);
        });
        await flushStreamHubTasks();

        expect(subscribeAiChatStreamEventsMock).toHaveBeenCalledTimes(1);
        expect(backendUnlistenCount).toBe(0);
        expect(received.map((payload) => payload.eventType)).toEqual(["delta", "done"]);

        secondUnlisten();
    });
});
