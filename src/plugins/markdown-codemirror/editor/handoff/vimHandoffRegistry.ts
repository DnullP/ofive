/**
 * @module plugins/markdown-codemirror/editor/handoff/vimHandoffRegistry
 * @description Vim handoff 子系统：统一注册、解析并治理编辑器中由复杂装饰/Widget
 *   触发的 Vim 交互转交逻辑。
 *
 *   设计目标：
 *   1. 将 Vim handoff 从 `CodeMirrorEditorTab` 的分散 `if/return` 特判中抽离；
 *   2. 为 frontmatter、LaTeX、表格 widget 等复杂交互提供统一扩展点；
 *   3. 通过稳定的 Context / Result / Priority 模型约束未来迭代，避免新增 widget
 *      直接在宿主层插入未受治理的键盘逻辑；
 *   4. 保持 handoff 解析为纯逻辑，副作用由宿主层显式执行。
 *
 * @dependencies 无外部依赖
 */

export type VimHandoffSurface = "editor-body" | "frontmatter-navigation";

export interface VimHandoffContext {
    surface: VimHandoffSurface;
    key: string;
    markdown: string;
    currentLineNumber: number;
    selectionHead: number;
    hasFrontmatter: boolean;
    firstBodyLineNumber: number;
    isVimEnabled: boolean;
    isVimNormalMode: boolean;
}

export type VimHandoffResult =
    | {
        kind: "move-selection";
        targetLineNumber: number;
        reason: string;
    }
    | {
        kind: "focus-frontmatter-navigation";
        position: "first" | "last";
        reason: string;
    };

export interface VimHandoffRegistration {
    id: string;
    owner: string;
    surface: VimHandoffSurface;
    priority: number;
    description: string;
    resolve: (context: VimHandoffContext) => VimHandoffResult | null;
}

export const VIM_HANDOFF_PRIORITY = {
    structuralBoundary: 100,
    blockWidget: 200,
    localNavigation: 300,
} as const;

const vimHandoffMap = new Map<string, VimHandoffRegistration>();

export function registerVimHandoff(
    registration: VimHandoffRegistration,
): () => void {
    validateVimHandoffRegistration(registration);

    const hadPrevious = vimHandoffMap.has(registration.id);
    if (hadPrevious) {
        console.warn("[vim-handoff] duplicate registration overridden", {
            id: registration.id,
            owner: registration.owner,
        });
    }

    vimHandoffMap.set(registration.id, registration);
    console.info("[vim-handoff] registered", {
        id: registration.id,
        owner: registration.owner,
        surface: registration.surface,
        priority: registration.priority,
    });

    return () => {
        if (vimHandoffMap.get(registration.id) === registration) {
            vimHandoffMap.delete(registration.id);
            console.info("[vim-handoff] unregistered", {
                id: registration.id,
                owner: registration.owner,
            });
        }
    };
}

export function unregisterVimHandoff(handoffId: string): void {
    if (vimHandoffMap.delete(handoffId)) {
        console.info("[vim-handoff] unregistered", {
            id: handoffId,
        });
    }
}

export function listRegisteredVimHandoffs(): VimHandoffRegistration[] {
    return [...vimHandoffMap.values()].sort(compareVimHandoffRegistration);
}

export function resolveRegisteredVimHandoff(
    context: VimHandoffContext,
): VimHandoffResult | null {
    const candidates = listRegisteredVimHandoffs().filter((registration) => registration.surface === context.surface);

    for (const registration of candidates) {
        try {
            const result = registration.resolve(context);
            if (result === null) {
                continue;
            }

            validateVimHandoffResult(result);
            console.info("[vim-handoff] resolved", {
                id: registration.id,
                owner: registration.owner,
                surface: registration.surface,
                resultKind: result.kind,
                reason: result.reason,
            });
            return result;
        } catch (error) {
            console.error("[vim-handoff] resolve failed", {
                id: registration.id,
                owner: registration.owner,
                message: error instanceof Error ? error.message : String(error),
            });
        }
    }

    return null;
}

function compareVimHandoffRegistration(
    left: VimHandoffRegistration,
    right: VimHandoffRegistration,
): number {
    if (left.priority !== right.priority) {
        return left.priority - right.priority;
    }

    return left.id.localeCompare(right.id);
}

function validateVimHandoffRegistration(registration: VimHandoffRegistration): void {
    if (!registration.id.trim()) {
        throw new Error("Vim handoff registration id must not be empty");
    }

    if (!registration.owner.trim()) {
        throw new Error(`Vim handoff registration owner must not be empty: ${registration.id}`);
    }

    if (!registration.description.trim()) {
        throw new Error(`Vim handoff registration description must not be empty: ${registration.id}`);
    }

    if (!Number.isFinite(registration.priority)) {
        throw new Error(`Vim handoff registration priority must be finite: ${registration.id}`);
    }
}

function validateVimHandoffResult(result: VimHandoffResult): void {
    if (!result.reason.trim()) {
        throw new Error("Vim handoff result reason must not be empty");
    }

    if (result.kind === "move-selection") {
        if (!Number.isInteger(result.targetLineNumber) || result.targetLineNumber < 1) {
            throw new Error("Vim handoff move-selection targetLineNumber must be >= 1");
        }
    }
}