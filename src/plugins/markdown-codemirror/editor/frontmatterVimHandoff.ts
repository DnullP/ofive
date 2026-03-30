/**
 * @module plugins/markdown-codemirror/editor/frontmatterVimHandoff
 * @description frontmatter 与正文编辑器之间的 Vim handoff 纯逻辑。
 * @dependencies 无
 *
 * @example
 *   if (shouldEnterFrontmatterFromBody({
 *       key: event.key,
 *       hasFrontmatter: bodyAnchor > 0,
 *       currentLineNumber,
 *       firstBodyLineNumber,
 *       isVimEnabled: true,
 *       isVimNormalMode: true,
 *   })) {
 *       // 将焦点切入 frontmatter 导航层
 *   }
 */

/**
 * @interface PlainFrontmatterVimKeyEvent
 * @description frontmatter Vim handoff 所需的最小按键信息。
 */
export interface PlainFrontmatterVimKeyEvent {
    /** 键值。 */
    key: string;
    /** Meta 修饰键。 */
    metaKey: boolean;
    /** Ctrl 修饰键。 */
    ctrlKey: boolean;
    /** Alt 修饰键。 */
    altKey: boolean;
    /** Shift 修饰键。 */
    shiftKey: boolean;
}

/**
 * @interface EnterFrontmatterFromBodyOptions
 * @description 判断是否应从正文切入 frontmatter 导航层的输入参数。
 */
export interface EnterFrontmatterFromBodyOptions {
    /** 当前按键。 */
    key: string;
    /** 是否存在 frontmatter。 */
    hasFrontmatter: boolean;
    /** 当前光标所在行号。 */
    currentLineNumber: number;
    /** 正文首行行号。 */
    firstBodyLineNumber: number;
    /** 是否开启 Vim。 */
    isVimEnabled: boolean;
    /** 是否处于 Vim normal 模式。 */
    isVimNormalMode: boolean;
}

/**
 * @type FrontmatterEnterAction
 * @description frontmatter 导航层按下 `Enter` 后应执行的动作。
 */
export type FrontmatterEnterAction = "focus-value" | "toggle-boolean";

/**
 * @type FrontmatterNavigationMoveResult
 * @description frontmatter 导航层的移动结果。
 */
export type FrontmatterNavigationMoveResult =
    | { kind: "move"; index: number }
    | { kind: "stay" }
    | { kind: "exit-body" };

/**
 * @function isPlainFrontmatterVimKey
 * @description 判断是否为不带修饰键的 frontmatter Vim handoff 按键。
 * @param event 键盘事件最小信息。
 * @param expectedKey 期望按键。
 * @returns 是否匹配。
 */
export function isPlainFrontmatterVimKey(
    event: PlainFrontmatterVimKeyEvent,
    expectedKey: string,
): boolean {
    return event.key === expectedKey &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.shiftKey;
}

/**
 * @function shouldEnterFrontmatterFromBody
 * @description 判断当前是否应从正文切入 frontmatter Vim 导航层。
 *   仅在 Vim normal 模式下，且光标位于正文首行时，按 `k` 才会切入 metadata 区。
 * @param options 判断参数。
 * @returns 是否应进入 frontmatter。
 */
export function shouldEnterFrontmatterFromBody(
    options: EnterFrontmatterFromBodyOptions,
): boolean {
    return options.isVimEnabled &&
        options.isVimNormalMode &&
        options.hasFrontmatter &&
        options.key === "k" &&
        options.currentLineNumber === options.firstBodyLineNumber;
}

/**
 * @function resolveFrontmatterEnterAction
 * @description 解析当前导航行按下 `Enter` 后的目标动作。
 *   布尔字段不进入额外编辑态，而是在导航层直接切换值并保持可继续 `j/k`。
 * @param value 当前字段值。
 * @returns 进入值控件或直接切换布尔值。
 */
export function resolveFrontmatterEnterAction(value: unknown): FrontmatterEnterAction {
    return typeof value === "boolean" ? "toggle-boolean" : "focus-value";
}

/**
 * @function resolveFrontmatterNavigationMove
 * @description 解析 frontmatter 导航层内 `j/k` 的移动结果。
 * @param currentIndex 当前聚焦项索引。
 * @param totalCount 可导航项总数。
 * @param direction 导航方向。
 * @returns 移动结果。
 */
export function resolveFrontmatterNavigationMove(
    currentIndex: number,
    totalCount: number,
    direction: "previous" | "next",
): FrontmatterNavigationMoveResult {
    if (totalCount <= 0 || currentIndex < 0 || currentIndex >= totalCount) {
        return { kind: "stay" };
    }

    if (direction === "previous") {
        if (currentIndex === 0) {
            return { kind: "stay" };
        }

        return {
            kind: "move",
            index: currentIndex - 1,
        };
    }

    if (currentIndex === totalCount - 1) {
        return { kind: "exit-body" };
    }

    return {
        kind: "move",
        index: currentIndex + 1,
    };
}