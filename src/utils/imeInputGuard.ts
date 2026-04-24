/**
 * @module utils/imeInputGuard
 * @description 统一处理文本输入场景中的输入法组合态保护，避免中文拼音候选确认时误触发 Enter 提交或 blur 自动提交。
 * @dependencies
 *   - none
 *
 * @example
 *   if (shouldSubmitPlainEnter({
 *       key: event.key,
 *       nativeEvent: event.nativeEvent,
 *   })) {
 *       submit();
 *   }
 *
 * @exports
 *   - isImeComposing
 *   - shouldSubmitPlainEnter
 *   - shouldDeferBlurCommitAfterComposition
 *   - shouldAllowBlurActionAfterComposition
 *   - createImeCompositionGuard
 */

interface NativeKeyboardEventLike {
    isComposing?: boolean;
    keyCode?: number;
}

interface PlainEnterInput {
    key: string;
    shiftKey?: boolean;
    altKey?: boolean;
    ctrlKey?: boolean;
    metaKey?: boolean;
    nativeEvent: NativeKeyboardEventLike;
}

interface BlurCommitGuardInput {
    isComposing: boolean;
    lastCompositionEndAt: number;
    now: number;
}

export interface ImeCompositionStateSnapshot {
    isComposing: boolean;
    lastCompositionEndAt: number;
}

interface ImeCompositionGuardOptions {
    getNow?: () => number;
}

export interface ImeCompositionGuard {
    state: ImeCompositionStateSnapshot;
    handleCompositionStart(): void;
    handleCompositionEnd(): void;
    shouldDeferBlurCommit(input?: { isComposing?: boolean }): boolean;
    shouldAllowBlurAction(input?: { isComposing?: boolean }): boolean;
}

const BLUR_COMMIT_GRACE_PERIOD_MS = 40;

function getDefaultNow(): number {
    return typeof performance !== "undefined"
        ? performance.now()
        : Date.now();
}

/**
 * @function isImeComposing
 * @description 判断当前原生键盘事件是否处于输入法组合态。
 * @param nativeEvent 原生键盘事件的最小兼容视图。
 * @returns `true` 表示处于组合态，应忽略 Enter 提交。
 */
export function isImeComposing(nativeEvent: NativeKeyboardEventLike): boolean {
    return Boolean(nativeEvent.isComposing) || nativeEvent.keyCode === 229;
}

/**
 * @function shouldSubmitPlainEnter
 * @description 判断当前按键是否应按“纯 Enter 提交”处理。
 * @param input 键盘事件判定所需的最小输入信息。
 * @returns `true` 表示可以将该次 Enter 视为提交；`false` 表示应忽略或交给其他输入行为处理。
 */
export function shouldSubmitPlainEnter(input: PlainEnterInput): boolean {
    if (input.key !== "Enter") {
        return false;
    }

    if (input.shiftKey || input.altKey || input.ctrlKey || input.metaKey) {
        return false;
    }

    return !isImeComposing(input.nativeEvent);
}

/**
 * @function shouldDeferBlurCommitAfterComposition
 * @description 判断 blur 自动提交是否应在输入法组合完成附近的短窗口内延后，避免候选确认导致误提交。
 * @param input blur 判定所需的组合态与时间戳信息。
 * @returns `true` 表示当前 blur 不应提交；`false` 表示可以正常提交。
 */
export function shouldDeferBlurCommitAfterComposition(
    input: BlurCommitGuardInput,
): boolean {
    if (input.isComposing) {
        return true;
    }

    return input.now - input.lastCompositionEndAt < BLUR_COMMIT_GRACE_PERIOD_MS;
}

/**
 * @function shouldAllowBlurActionAfterComposition
 * @description 判断 blur 触发的后续动作是否可以执行。
 * @param input blur 判定所需的组合态与时间戳信息。
 * @returns `true` 表示可以继续执行 blur 相关动作；`false` 表示应延后。
 */
export function shouldAllowBlurActionAfterComposition(
    input: BlurCommitGuardInput,
): boolean {
    return !shouldDeferBlurCommitAfterComposition(input);
}

/**
 * @function createImeCompositionGuard
 * @description 创建一份可复用的输入法组合态守卫，用于聚合 `isComposing` 与 `lastCompositionEndAt` 状态。
 * @param options 可选配置。
 * @returns 组合态守卫实例。
 */
export function createImeCompositionGuard(
    options: ImeCompositionGuardOptions = {},
): ImeCompositionGuard {
    const getNow = options.getNow ?? getDefaultNow;
    const state: ImeCompositionStateSnapshot = {
        isComposing: false,
        lastCompositionEndAt: 0,
    };

    const shouldDeferBlurCommit = (input: { isComposing?: boolean } = {}): boolean => {
        return shouldDeferBlurCommitAfterComposition({
            isComposing: input.isComposing ?? state.isComposing,
            lastCompositionEndAt: state.lastCompositionEndAt,
            now: getNow(),
        });
    };

    return {
        state,
        handleCompositionStart(): void {
            state.isComposing = true;
        },
        handleCompositionEnd(): void {
            state.isComposing = false;
            state.lastCompositionEndAt = getNow();
        },
        shouldDeferBlurCommit,
        shouldAllowBlurAction(input: { isComposing?: boolean } = {}): boolean {
            return !shouldDeferBlurCommit(input);
        },
    };
}