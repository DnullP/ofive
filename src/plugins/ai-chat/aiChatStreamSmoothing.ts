/**
 * @module plugins/ai-chat/aiChatStreamSmoothing
 * @description AI 聊天流式平滑工具：负责将后端按批到达的累计文本转换为前端连续 reveal 的展示文本，
 *   避免流式阶段频繁触发完整 Markdown 重渲染时仍出现明显块状跳变。
 * @dependencies
 *   - none
 *
 * @example
 *   const synced = syncAiChatSmoothedMessageTargets(current, {
 *     messageId: "assistant-1",
 *     targetText: "hello world",
 *     active: true,
 *   });
 *   const next = advanceAiChatSmoothedMessageState(synced, 16);
 *
 * @exports
 *   - AiChatSmoothedMessageState
 *   - isAiChatSmoothedMessageSettled
 *   - syncAiChatSmoothedMessageTargets
 *   - advanceAiChatSmoothedMessageState
 */

/**
 * @interface AiChatSmoothedMessageState
 * @description 单条助手消息的流式平滑状态。
 * @field messageId 消息 ID。
 * @field targetText 后端当前已到达的最终文本目标。
 * @field displayText 当前展示给用户的文本。
 * @field targetReasoningText 后端当前已到达的 reasoning 文本目标。
 * @field displayReasoningText 当前展示给用户的 reasoning 文本。
 * @field active 该消息是否仍处于后端流式接收阶段。
 */
export interface AiChatSmoothedMessageState {
    messageId: string;
    targetText: string;
    displayText: string;
    targetReasoningText: string;
    displayReasoningText: string;
    active: boolean;
}

/**
 * @interface SyncAiChatSmoothedMessageTargetsInput
 * @description 同步后端最新目标文本时使用的参数。
 * @field messageId 消息 ID。
 * @field targetText 最新累计答案文本；未提供时保持原值。
 * @field targetReasoningText 最新累计 reasoning 文本；未提供时保持原值。
 * @field active 是否仍处于流式接收阶段；未提供时保持原值。
 */
export interface SyncAiChatSmoothedMessageTargetsInput {
    messageId: string;
    targetText?: string | null;
    targetReasoningText?: string | null;
    active?: boolean;
}

/**
 * @function isAiChatSmoothedMessageSettled
 * @description 判断一条消息是否已经追平到当前目标文本。
 * @param state 平滑状态。
 * @returns 若显示文本与目标文本完全一致则返回 true。
 */
export function isAiChatSmoothedMessageSettled(
    state: AiChatSmoothedMessageState,
): boolean {
    return state.displayText === state.targetText
        && state.displayReasoningText === state.targetReasoningText;
}

/**
 * @function syncAiChatSmoothedMessageTargets
 * @description 将后端最新累计文本同步到本地平滑状态，同时保留当前已显示的进度。
 * @param state 当前平滑状态。
 * @param input 同步输入。
 * @returns 更新后的平滑状态。
 */
export function syncAiChatSmoothedMessageTargets(
    state: AiChatSmoothedMessageState | null | undefined,
    input: SyncAiChatSmoothedMessageTargetsInput,
): AiChatSmoothedMessageState {
    return {
        messageId: input.messageId,
        targetText: input.targetText ?? state?.targetText ?? "",
        displayText: state?.displayText ?? "",
        targetReasoningText: input.targetReasoningText ?? state?.targetReasoningText ?? "",
        displayReasoningText: state?.displayReasoningText ?? "",
        active: input.active ?? state?.active ?? true,
    };
}

/**
 * @function advanceAiChatSmoothedMessageState
 * @description 根据本帧时间推进展示文本，优先追平 reasoning，再追平最终回答。
 * @param state 当前平滑状态。
 * @param elapsedMs 距离上一帧过去的毫秒数。
 * @returns 推进后的状态；若无需推进则返回原对象。
 */
export function advanceAiChatSmoothedMessageState(
    state: AiChatSmoothedMessageState,
    elapsedMs: number,
): AiChatSmoothedMessageState {
    if (isAiChatSmoothedMessageSettled(state)) {
        return state;
    }

    const backlog = Math.max(0,
        state.targetReasoningText.length - state.displayReasoningText.length,
    ) + Math.max(0,
        state.targetText.length - state.displayText.length,
    );
    const budget = calculateAiChatRevealCharacterBudget(elapsedMs, backlog);
    if (budget <= 0) {
        return state;
    }

    const reasoningAdvance = advanceTextTowardsTarget(
        state.displayReasoningText,
        state.targetReasoningText,
        budget,
    );
    const answerAdvance = advanceTextTowardsTarget(
        state.displayText,
        state.targetText,
        budget - reasoningAdvance.consumed,
    );

    if (
        reasoningAdvance.nextText === state.displayReasoningText
        && answerAdvance.nextText === state.displayText
    ) {
        return state;
    }

    return {
        ...state,
        displayReasoningText: reasoningAdvance.nextText,
        displayText: answerAdvance.nextText,
    };
}

/**
 * @function calculateAiChatRevealCharacterBudget
 * @description 根据帧间隔与待追平积压量计算本帧应吐出的字符数。
 * @param elapsedMs 距离上一帧的毫秒数。
 * @param backlog 待显示的字符积压量。
 * @returns 本帧可推进的字符预算。
 */
function calculateAiChatRevealCharacterBudget(
    elapsedMs: number,
    backlog: number,
): number {
    const clampedElapsedMs = Math.max(8, Math.min(elapsedMs, 80));
    let charactersPerSecond = 120;
    if (backlog > 24) {
        charactersPerSecond = 180;
    }
    if (backlog > 96) {
        charactersPerSecond = 260;
    }
    if (backlog > 220) {
        charactersPerSecond = 420;
    }

    return Math.max(1, Math.round((clampedElapsedMs * charactersPerSecond) / 1000));
}

/**
 * @function advanceTextTowardsTarget
 * @description 将当前文本向目标文本前进一步，假定目标文本是累计追加得到的前缀扩展。
 * @param currentText 当前展示文本。
 * @param targetText 目标文本。
 * @param budget 可消耗字符预算。
 * @returns 新文本和本次消耗字符数。
 */
function advanceTextTowardsTarget(
    currentText: string,
    targetText: string,
    budget: number,
): { nextText: string; consumed: number } {
    if (budget <= 0 || currentText === targetText) {
        return {
            nextText: currentText,
            consumed: 0,
        };
    }

    if (!targetText.startsWith(currentText)) {
        return {
            nextText: targetText,
            consumed: Math.max(1, targetText.length - currentText.length),
        };
    }

    const nextText = targetText.slice(0, currentText.length + budget);
    return {
        nextText,
        consumed: nextText.length - currentText.length,
    };
}