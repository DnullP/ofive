/**
 * @module plugins/ai-chat/aiChatStreamEventHub
 * @description Plugin-level AI stream event hub. Keeps the backend stream listener alive while chat UI surfaces remount.
 */

import {
    subscribeAiChatStreamEvents,
    type AiChatStreamEventPayload,
} from "../../api/aiApi";

type AiChatStreamEventListener = (payload: AiChatStreamEventPayload) => void;

const MAX_BUFFERED_EVENTS = 200;

let backendUnlisten: (() => void) | null = null;
let startPromise: Promise<void> | null = null;
let subscribeAiChatStreamEventsImpl = subscribeAiChatStreamEvents;
const listeners = new Set<AiChatStreamEventListener>();
let bufferedEvents: AiChatStreamEventPayload[] = [];

function dispatchStreamEvent(payload: AiChatStreamEventPayload): void {
    if (listeners.size === 0) {
        bufferedEvents = [...bufferedEvents, payload].slice(-MAX_BUFFERED_EVENTS);
        return;
    }

    listeners.forEach((listener) => {
        listener(payload);
    });
}

export function startAiChatStreamEventHub(): void {
    if (backendUnlisten || startPromise) {
        return;
    }

    startPromise = subscribeAiChatStreamEventsImpl(dispatchStreamEvent)
        .then((unlisten) => {
            backendUnlisten = unlisten;
            startPromise = null;
        })
        .catch((error) => {
            startPromise = null;
            console.warn("[aiChatStreamEventHub] failed to subscribe ai stream events", {
                error: error instanceof Error ? error.message : String(error),
            });
        });
}

export function stopAiChatStreamEventHub(): void {
    backendUnlisten?.();
    backendUnlisten = null;
    startPromise = null;
    bufferedEvents = [];
    listeners.clear();
}

export function subscribeAiChatStreamEventHub(
    listener: AiChatStreamEventListener,
): () => void {
    startAiChatStreamEventHub();
    listeners.add(listener);

    if (bufferedEvents.length > 0) {
        const eventsToReplay = bufferedEvents;
        bufferedEvents = [];
        queueMicrotask(() => {
            if (!listeners.has(listener)) {
                return;
            }

            eventsToReplay.forEach((payload) => {
                listener(payload);
            });
        });
    }

    return () => {
        listeners.delete(listener);
    };
}

export function __resetAiChatStreamEventHubForTests(): void {
    stopAiChatStreamEventHub();
    subscribeAiChatStreamEventsImpl = subscribeAiChatStreamEvents;
}

export function __setAiChatStreamEventHubSubscribeForTests(
    subscribe: typeof subscribeAiChatStreamEvents,
): void {
    stopAiChatStreamEventHub();
    subscribeAiChatStreamEventsImpl = subscribe;
}
