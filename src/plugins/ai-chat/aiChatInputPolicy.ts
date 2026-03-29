/**
 * @module plugins/ai-chat/aiChatInputPolicy
 * @description AI 聊天输入策略模块：负责判断输入框键盘事件是否应触发发送，避免输入法组合态下误发消息。
 * @dependencies
 *   - none
 *
 * @example
 *   const shouldSubmit = shouldSubmitAiChatComposer({
 *       key: "Enter",
 *       shiftKey: false,
 *       nativeEvent: { isComposing: false, keyCode: 13 },
 *   });
 */

interface NativeKeyboardEventLike {
    isComposing?: boolean;
    keyCode?: number;
}

export interface AiChatComposerKeydownInput {
    key: string;
    shiftKey: boolean;
    nativeEvent: NativeKeyboardEventLike;
}

/**
 * @function shouldSubmitAiChatComposer
 * @description 判断 AI 聊天输入框当前键盘事件是否应触发发送。
 * @param input 键盘判定所需的最小输入信息。
 * @returns `true` 表示应发送；`false` 表示应忽略或交给其他输入行为处理。
 */
export function shouldSubmitAiChatComposer(input: AiChatComposerKeydownInput): boolean {
    if (input.key !== "Enter" || input.shiftKey) {
        return false;
    }

    const isComposing = input.nativeEvent.isComposing || input.nativeEvent.keyCode === 229;
    return !isComposing;
}