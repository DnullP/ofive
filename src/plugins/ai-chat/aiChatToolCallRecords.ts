/**
 * @module plugins/ai-chat/aiChatToolCallRecords
 * @description 从 AI debug stream 中派生用户可见的工具调用记录。
 * @dependencies
 *   - ./aiChatStreamState
 */

import type { ChatDebugEntry } from "./aiChatStreamState";

export type AiChatToolCallStatus = "calling" | "completed" | "failed";

export interface AiChatToolCallRecord {
    id: string;
    assistantMessageId: string;
    capabilityId: string;
    status: AiChatToolCallStatus;
    inputText: string | null;
    outputText: string | null;
    errorText: string | null;
    startedAtUnixMs: number;
    completedAtUnixMs: number | null;
}

interface ParsedCapabilityDebugEntry {
    capabilityId: string;
    status: AiChatToolCallStatus;
    payloadKind: "input" | "output" | "error";
    payloadText: string;
}

export interface ReduceAiChatToolCallDebugEntryInput {
    assistantMessageId: string;
    records: AiChatToolCallRecord[];
    entry: ChatDebugEntry;
    recordId: string;
    nowUnixMs: number;
}

export interface ReduceAiChatToolCallDebugEntryResult {
    changed: boolean;
    records: AiChatToolCallRecord[];
}

const TOOL_CALL_STARTED_TITLE = "Capability call started";
const TOOL_CALL_COMPLETED_TITLE = "Capability call completed";
const TOOL_CALL_FAILED_TITLES = new Set([
    "Capability call failed",
    "Capability call transport failed",
    "Capability result encode failed",
]);

export function reduceAiChatToolCallDebugEntry(
    input: ReduceAiChatToolCallDebugEntryInput,
): ReduceAiChatToolCallDebugEntryResult {
    const parsed = parseCapabilityDebugEntry(input.entry);
    if (!parsed) {
        return {
            changed: false,
            records: input.records,
        };
    }

    if (parsed.status === "calling") {
        return {
            changed: true,
            records: [
                ...input.records,
                {
                    id: input.recordId,
                    assistantMessageId: input.assistantMessageId,
                    capabilityId: parsed.capabilityId,
                    status: "calling",
                    inputText: parsed.payloadKind === "input" ? parsed.payloadText : null,
                    outputText: null,
                    errorText: null,
                    startedAtUnixMs: input.nowUnixMs,
                    completedAtUnixMs: null,
                },
            ],
        };
    }

    const matchingIndex = findLastCallingToolRecordIndex(
        input.records,
        parsed.capabilityId,
    );
    if (matchingIndex < 0) {
        return {
            changed: true,
            records: [
                ...input.records,
                createCompletedToolRecordFromDebugEntry(input, parsed),
            ],
        };
    }

    const nextRecords = [...input.records];
    const currentRecord = nextRecords[matchingIndex]!;
    nextRecords[matchingIndex] = {
        ...currentRecord,
        status: parsed.status,
        outputText: parsed.payloadKind === "output"
            ? parsed.payloadText
            : currentRecord.outputText,
        errorText: parsed.payloadKind === "error"
            ? parsed.payloadText
            : currentRecord.errorText,
        completedAtUnixMs: input.nowUnixMs,
    };

    return {
        changed: true,
        records: nextRecords,
    };
}

function parseCapabilityDebugEntry(
    entry: ChatDebugEntry,
): ParsedCapabilityDebugEntry | null {
    const title = entry.title.trim();
    let status: AiChatToolCallStatus | null = null;
    if (title === TOOL_CALL_STARTED_TITLE) {
        status = "calling";
    } else if (title === TOOL_CALL_COMPLETED_TITLE) {
        status = "completed";
    } else if (TOOL_CALL_FAILED_TITLES.has(title)) {
        status = "failed";
    }

    if (!status) {
        return null;
    }

    const match = entry.text.match(/^capability=([^\s]+)\s+(input|output|error)=(.*)$/s);
    if (!match) {
        return null;
    }

    return {
        capabilityId: match[1]!,
        status,
        payloadKind: match[2] as ParsedCapabilityDebugEntry["payloadKind"],
        payloadText: match[3] ?? "",
    };
}

function findLastCallingToolRecordIndex(
    records: AiChatToolCallRecord[],
    capabilityId: string,
): number {
    for (let index = records.length - 1; index >= 0; index -= 1) {
        const record = records[index];
        if (record?.capabilityId === capabilityId && record.status === "calling") {
            return index;
        }
    }

    return -1;
}

function createCompletedToolRecordFromDebugEntry(
    input: ReduceAiChatToolCallDebugEntryInput,
    parsed: ParsedCapabilityDebugEntry,
): AiChatToolCallRecord {
    return {
        id: input.recordId,
        assistantMessageId: input.assistantMessageId,
        capabilityId: parsed.capabilityId,
        status: parsed.status,
        inputText: null,
        outputText: parsed.payloadKind === "output" ? parsed.payloadText : null,
        errorText: parsed.payloadKind === "error" ? parsed.payloadText : null,
        startedAtUnixMs: input.nowUnixMs,
        completedAtUnixMs: input.nowUnixMs,
    };
}
