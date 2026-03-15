/**
 * @module layout/layoutStateReducers.test
 * @description 布局面板状态转换逻辑的单元测试 & 回归测试。
 *
 * 覆盖范围：
 * - 面板初始状态构建
 * - 面板定义变化时的状态合并
 * - 活动 ID 解析
 * - 可见面板过滤
 * - 活动自动选中
 * - 跨容器拖拽（左→右、右→左）
 * - 空侧栏拖入（空左侧栏、空右侧栏）
 * - 回归测试：右→左→右拖拽后面板消失 bug
 *
 * @dependencies
 *   - bun:test
 *   - ./layoutStateReducers
 *
 * @example
 *   bun test src/host/layout/layoutStateReducers.test.ts
 */

import { describe, expect, it } from "bun:test";
import {
    buildInitialPanelStates,
    mergePanelStates,
    removeActivityReferencesFromPanelStates,
    repairUnknownActivityReferencesInPanelStates,
    resolveActivityId,
    getVisiblePanelIds,
    autoSelectActivityId,
    computeCrossContainerDrop,
    computeEmptySidebarDrop,
    computeEmptyRightSidebarDrop,
    resolveRightActivityIdAfterDrop,
    type PanelRuntimeState,
    type PanelDefinitionInfo,
} from "./layoutStateReducers";

/* ────────── 测试辅助 ────────── */

/**
 * 创建面板定义信息的辅助函数。
 */
function def(overrides: Partial<PanelDefinitionInfo> & { id: string }): PanelDefinitionInfo {
    return {
        position: "left",
        order: 0,
        ...overrides,
    };
}

/**
 * 创建运行时状态的辅助函数。
 */
function state(overrides: Partial<PanelRuntimeState> & { id: string }): PanelRuntimeState {
    return {
        position: "left",
        order: 0,
        activityId: overrides.id,
        ...overrides,
    };
}

/**
 * 从面板定义列表构建 panelById Map。
 */
function makePanelById(defs: PanelDefinitionInfo[]): Map<string, PanelDefinitionInfo> {
    return new Map(defs.map((d) => [d.id, d]));
}

/* ══════════════════════════════════════════════════════════════════════
 *  buildInitialPanelStates
 * ══════════════════════════════════════════════════════════════════════ */

describe("buildInitialPanelStates", () => {
    it("应从面板定义构建初始状态", () => {
        const panels: PanelDefinitionInfo[] = [
            def({ id: "files", activityId: "files", position: "left", order: 0 }),
            def({ id: "outline", activityId: "outline", position: "right", order: 1 }),
        ];

        const result = buildInitialPanelStates(panels);

        expect(result).toEqual([
            { id: "files", position: "left", order: 0, activityId: "files" },
            { id: "outline", position: "right", order: 1, activityId: "outline" },
        ]);
    });

    it("缺失 position 时默认为 left", () => {
        const panels: PanelDefinitionInfo[] = [def({ id: "p1" })];
        const result = buildInitialPanelStates(panels);
        expect(result[0].position).toBe("left");
    });

    it("缺失 order 时使用数组索引", () => {
        const panels: PanelDefinitionInfo[] = [
            { id: "a" },
            { id: "b" },
            { id: "c" },
        ];
        const result = buildInitialPanelStates(panels);
        expect(result.map((s) => s.order)).toEqual([0, 1, 2]);
    });

    it("缺失 activityId 时回退为面板 id", () => {
        const panels: PanelDefinitionInfo[] = [{ id: "myPanel" }];
        const result = buildInitialPanelStates(panels);
        expect(result[0].activityId).toBe("myPanel");
    });

    it("空列表返回空数组", () => {
        expect(buildInitialPanelStates([])).toEqual([]);
    });
});

/* ══════════════════════════════════════════════════════════════════════
 *  mergePanelStates
 * ══════════════════════════════════════════════════════════════════════ */

describe("mergePanelStates", () => {
    it("新增面板时保留已有状态，追加新条目", () => {
        const prev: PanelRuntimeState[] = [
            state({ id: "files", position: "left", order: 0, activityId: "files" }),
        ];
        const panels: PanelDefinitionInfo[] = [
            def({ id: "files", activityId: "files" }),
            def({ id: "outline", activityId: "outline", position: "right", order: 1 }),
        ];

        const result = mergePanelStates(prev, panels);

        expect(result).toHaveLength(2);
        // 已有条目保持原状态
        expect(result[0]).toEqual(prev[0]);
        // 新条目从定义创建
        expect(result[1]).toEqual({
            id: "outline",
            position: "right",
            order: 1,
            activityId: "outline",
        });
    });

    it("面板被移除时不再出现在结果中", () => {
        const prev: PanelRuntimeState[] = [
            state({ id: "files", position: "left", order: 0, activityId: "files" }),
            state({ id: "removed", position: "left", order: 1, activityId: "removed" }),
        ];
        const panels: PanelDefinitionInfo[] = [
            def({ id: "files", activityId: "files" }),
        ];

        const result = mergePanelStates(prev, panels);
        expect(result).toHaveLength(1);
        expect(result[0].id).toBe("files");
    });

    it("已有条目的运行时位置不被新定义覆盖", () => {
        const prev: PanelRuntimeState[] = [
            state({ id: "backlinks", position: "left", order: 2, activityId: "files" }),
        ];
        const panels: PanelDefinitionInfo[] = [
            def({ id: "backlinks", activityId: "outline", position: "right", order: 0 }),
        ];

        const result = mergePanelStates(prev, panels);
        // 运行时状态保持不变（position 仍为 left，activityId 仍为 files）
        expect(result[0].position).toBe("left");
        expect(result[0].activityId).toBe("files");
        expect(result[0].order).toBe(2);
    });
});

describe("removeActivityReferencesFromPanelStates", () => {
    it("应移除被删除的自定义容器面板，并将挂载面板回退到默认 activity", () => {
        const prev: PanelRuntimeState[] = [
            state({
                id: "custom-panel:custom-calendar",
                position: "right",
                order: 0,
                activityId: "custom-activity:custom-calendar",
            }),
            state({
                id: "calendar-panel",
                position: "right",
                order: 1,
                activityId: "custom-activity:custom-calendar",
            }),
            state({
                id: "outline",
                position: "right",
                order: 2,
                activityId: "outline",
            }),
        ];
        const panels: PanelDefinitionInfo[] = [
            def({ id: "calendar-panel", activityId: "calendar", position: "right" }),
            def({ id: "outline", activityId: "outline", position: "right" }),
        ];

        const result = removeActivityReferencesFromPanelStates(
            prev,
            panels,
            "custom-activity:custom-calendar",
            "custom-panel:custom-calendar",
        );

        expect(result).toEqual([
            {
                id: "calendar-panel",
                position: "right",
                order: 1,
                activityId: "calendar",
            },
            {
                id: "outline",
                position: "right",
                order: 2,
                activityId: "outline",
            },
        ]);
    });
});

describe("repairUnknownActivityReferencesInPanelStates", () => {
    it("应将失效的自定义 activity 引用回退到面板默认 activity", () => {
        const prev: PanelRuntimeState[] = [
            state({
                id: "calendar-panel",
                position: "right",
                order: 1,
                activityId: "custom-activity:deleted-calendar",
            }),
            state({
                id: "outline",
                position: "right",
                order: 2,
                activityId: "outline",
            }),
        ];
        const panels: PanelDefinitionInfo[] = [
            def({ id: "calendar-panel", activityId: "calendar", position: "right" }),
            def({ id: "outline", activityId: "outline", position: "right" }),
        ];

        const result = repairUnknownActivityReferencesInPanelStates(
            prev,
            panels,
            new Set(["calendar", "outline"]),
        );

        expect(result).toEqual([
            {
                id: "calendar-panel",
                position: "right",
                order: 1,
                activityId: "calendar",
            },
            {
                id: "outline",
                position: "right",
                order: 2,
                activityId: "outline",
            },
        ]);
    });
});

/* ══════════════════════════════════════════════════════════════════════
 *  resolveActivityId
 * ══════════════════════════════════════════════════════════════════════ */

describe("resolveActivityId", () => {
    it("优先使用运行时状态中的 activityId", () => {
        const states: PanelRuntimeState[] = [
            state({ id: "backlinks", activityId: "files" }),
        ];
        const panelById = makePanelById([
            def({ id: "backlinks", activityId: "outline" }),
        ]);

        expect(resolveActivityId("backlinks", states, panelById)).toBe("files");
    });

    it("运行时状态不存在时回退到定义中的 activityId", () => {
        const states: PanelRuntimeState[] = [];
        const panelById = makePanelById([
            def({ id: "outline", activityId: "outline" }),
        ]);

        expect(resolveActivityId("outline", states, panelById)).toBe("outline");
    });

    it("定义也不存在时回退到面板 ID", () => {
        const states: PanelRuntimeState[] = [];
        const panelById = makePanelById([]);

        expect(resolveActivityId("unknown", states, panelById)).toBe("unknown");
    });
});

/* ══════════════════════════════════════════════════════════════════════
 *  getVisiblePanelIds
 * ══════════════════════════════════════════════════════════════════════ */

describe("getVisiblePanelIds", () => {
    const baseStates: PanelRuntimeState[] = [
        state({ id: "files", position: "left", order: 0, activityId: "files" }),
        state({ id: "search", position: "left", order: 1, activityId: "files" }),
        state({ id: "outline", position: "right", order: 0, activityId: "outline" }),
        state({ id: "backlinks", position: "right", order: 1, activityId: "outline" }),
    ];

    const panelById = makePanelById([
        def({ id: "files" }),
        def({ id: "search" }),
        def({ id: "outline" }),
        def({ id: "backlinks" }),
    ]);

    it("按位置过滤左侧面板", () => {
        const result = getVisiblePanelIds(baseStates, panelById, "left", null);
        expect(result).toEqual(["files", "search"]);
    });

    it("按位置过滤右侧面板", () => {
        const result = getVisiblePanelIds(baseStates, panelById, "right", null);
        expect(result).toEqual(["outline", "backlinks"]);
    });

    it("按活动 ID 过滤", () => {
        const result = getVisiblePanelIds(baseStates, panelById, "left", "files");
        expect(result).toEqual(["files", "search"]);
    });

    it("activeActivityId 不匹配时返回空", () => {
        const result = getVisiblePanelIds(baseStates, panelById, "left", "nonexistent");
        expect(result).toEqual([]);
    });

    it("按 order 排序", () => {
        const unorderedStates: PanelRuntimeState[] = [
            state({ id: "b", position: "left", order: 2, activityId: "x" }),
            state({ id: "a", position: "left", order: 0, activityId: "x" }),
            state({ id: "c", position: "left", order: 1, activityId: "x" }),
        ];
        const byId = makePanelById([def({ id: "a" }), def({ id: "b" }), def({ id: "c" })]);

        const result = getVisiblePanelIds(unorderedStates, byId, "left", null);
        expect(result).toEqual(["a", "c", "b"]);
    });

    it("排除 tabOnly 面板", () => {
        const states: PanelRuntimeState[] = [
            state({ id: "graph", position: "left", order: 0, activityId: "graph" }),
            state({ id: "files", position: "left", order: 1, activityId: "files" }),
        ];
        const byId = makePanelById([
            def({ id: "graph", tabOnly: true }),
            def({ id: "files" }),
        ]);

        const result = getVisiblePanelIds(states, byId, "left", null);
        expect(result).toEqual(["files"]);
    });
});

/* ══════════════════════════════════════════════════════════════════════
 *  autoSelectActivityId
 * ══════════════════════════════════════════════════════════════════════ */

describe("autoSelectActivityId", () => {
    it("当前选中项在列表中时保持不变", () => {
        const items = [{ id: "files" }, { id: "search" }];
        expect(autoSelectActivityId(items, "search")).toBe("search");
    });

    it("当前选中项不在列表中时自动选第一个", () => {
        const items = [{ id: "files" }, { id: "search" }];
        expect(autoSelectActivityId(items, "removed")).toBe("files");
    });

    it("当前选中项为 null 时自动选第一个", () => {
        const items = [{ id: "files" }];
        expect(autoSelectActivityId(items, null)).toBe("files");
    });

    it("列表为空时返回 null", () => {
        expect(autoSelectActivityId([], "files")).toBe(null);
    });

    it("排除 settings 和 tabOnly 项", () => {
        const items = [
            { id: "settings", isSettings: true },
            { id: "graph", tabOnly: true },
            { id: "files" },
        ];
        expect(autoSelectActivityId(items, null)).toBe("files");
    });

    it("全部为 settings / tabOnly 时返回 null", () => {
        const items = [
            { id: "settings", isSettings: true },
            { id: "graph", tabOnly: true },
        ];
        expect(autoSelectActivityId(items, null)).toBe(null);
    });
});

/* ══════════════════════════════════════════════════════════════════════
 *  computeCrossContainerDrop
 * ══════════════════════════════════════════════════════════════════════ */

describe("computeCrossContainerDrop", () => {
    /* ── 典型布局：左侧 files + search，右侧 outline + backlinks ── */

    const definitions: PanelDefinitionInfo[] = [
        def({ id: "files", activityId: "files", position: "left", order: 0 }),
        def({ id: "search", activityId: "files", position: "left", order: 1 }),
        def({ id: "outline", activityId: "outline", position: "right", order: 0 }),
        def({ id: "backlinks", activityId: "outline", position: "right", order: 1 }),
    ];
    const panelById = makePanelById(definitions);

    const initialStates: PanelRuntimeState[] = [
        state({ id: "files", position: "left", order: 0, activityId: "files" }),
        state({ id: "search", position: "left", order: 1, activityId: "files" }),
        state({ id: "outline", position: "right", order: 0, activityId: "outline" }),
        state({ id: "backlinks", position: "right", order: 1, activityId: "outline" }),
    ];

    describe("右→左拖拽", () => {
        it("应将面板移到左侧栏并继承目标面板的 activityId", () => {
            const result = computeCrossContainerDrop({
                prev: initialStates,
                movedPanelId: "backlinks",
                targetPosition: "left",
                dropTargetPanelId: "files",
                dropPosition: "bottom",
                panelById,
                activeActivityId: "files",
                activeRightActivityId: "outline",
            });

            const moved = result.find((s) => s.id === "backlinks");
            expect(moved?.position).toBe("left");
            expect(moved?.activityId).toBe("files");
        });

        it("插入位置应在目标面板下方", () => {
            const result = computeCrossContainerDrop({
                prev: initialStates,
                movedPanelId: "backlinks",
                targetPosition: "left",
                dropTargetPanelId: "files",
                dropPosition: "bottom",
                panelById,
                activeActivityId: "files",
                activeRightActivityId: "outline",
            });

            const moved = result.find((s) => s.id === "backlinks");
            const files = result.find((s) => s.id === "files");
            expect(moved!.order).toBeGreaterThan(files!.order);
        });

        it("插入到顶部时 order=0", () => {
            const result = computeCrossContainerDrop({
                prev: initialStates,
                movedPanelId: "backlinks",
                targetPosition: "left",
                dropTargetPanelId: "files",
                dropPosition: "top",
                panelById,
                activeActivityId: "files",
                activeRightActivityId: "outline",
            });

            const moved = result.find((s) => s.id === "backlinks");
            expect(moved!.order).toBe(0);
        });

        it("源侧栏中的面板应重新排序", () => {
            const result = computeCrossContainerDrop({
                prev: initialStates,
                movedPanelId: "backlinks",
                targetPosition: "left",
                dropTargetPanelId: "files",
                dropPosition: "bottom",
                panelById,
                activeActivityId: "files",
                activeRightActivityId: "outline",
            });

            // 右侧只剩 outline，order 应为 0
            const outline = result.find((s) => s.id === "outline");
            expect(outline?.position).toBe("right");
            expect(outline?.order).toBe(0);
        });
    });

    describe("左→右拖拽", () => {
        it("应将面板移到右侧栏并加入目标 activity 分组", () => {
            const result = computeCrossContainerDrop({
                prev: initialStates,
                movedPanelId: "search",
                targetPosition: "right",
                dropTargetPanelId: "outline",
                dropPosition: "bottom",
                panelById,
                activeActivityId: "files",
                activeRightActivityId: "outline",
            });

            const moved = result.find((s) => s.id === "search");
            expect(moved?.position).toBe("right");
            // icon 与 panel 解耦：面板加入 drop target 所属 activity（outline），而非恢复原始 activityId
            expect(moved?.activityId).toBe("outline");
        });
    });

    describe("面板不存在时", () => {
        it("应返回原状态不变", () => {
            const result = computeCrossContainerDrop({
                prev: initialStates,
                movedPanelId: "nonexistent",
                targetPosition: "left",
                dropTargetPanelId: "files",
                dropPosition: "bottom",
                panelById,
                activeActivityId: "files",
                activeRightActivityId: "outline",
            });

            expect(result).toBe(initialStates);
        });
    });
});

/* ══════════════════════════════════════════════════════════════════════
 *  computeEmptySidebarDrop
 * ══════════════════════════════════════════════════════════════════════ */

describe("computeEmptySidebarDrop", () => {
    it("应将面板从右侧移到左侧栏末尾", () => {
        const prev: PanelRuntimeState[] = [
            state({ id: "files", position: "left", order: 0, activityId: "files" }),
            state({ id: "outline", position: "right", order: 0, activityId: "outline" }),
        ];

        const result = computeEmptySidebarDrop({
            prev,
            movedPanelId: "outline",
            activeActivityId: "files",
        });

        const moved = result.find((s) => s.id === "outline");
        expect(moved?.position).toBe("left");
        expect(moved?.activityId).toBe("files");
        expect(moved?.order).toBe(1); // 追加到末尾
    });

    it("左侧栏为空时面板变为 order=0", () => {
        const prev: PanelRuntimeState[] = [
            state({ id: "outline", position: "right", order: 0, activityId: "outline" }),
        ];

        const result = computeEmptySidebarDrop({
            prev,
            movedPanelId: "outline",
            activeActivityId: null,
        });

        const moved = result.find((s) => s.id === "outline");
        expect(moved?.position).toBe("left");
        expect(moved?.order).toBe(0);
        // 无 activeActivityId 时回退到面板自身的 activityId
        expect(moved?.activityId).toBe("outline");
    });

    it("面板不存在时返回原状态", () => {
        const prev: PanelRuntimeState[] = [
            state({ id: "files", position: "left", order: 0, activityId: "files" }),
        ];

        const result = computeEmptySidebarDrop({
            prev,
            movedPanelId: "nonexistent",
            activeActivityId: "files",
        });

        expect(result).toBe(prev);
    });
});

/* ══════════════════════════════════════════════════════════════════════
 *  computeEmptyRightSidebarDrop
 * ══════════════════════════════════════════════════════════════════════ */

describe("computeEmptyRightSidebarDrop", () => {
    const definitions: PanelDefinitionInfo[] = [
        def({ id: "files", activityId: "files", position: "left" }),
        def({ id: "backlinks", activityId: "outline", position: "right" }),
    ];
    const panelById = makePanelById(definitions);

    it("应将面板从左侧移到右侧栏并加入当前右侧活动分组", () => {
        const prev: PanelRuntimeState[] = [
            state({ id: "files", position: "left", order: 0, activityId: "files" }),
            // backlinks 当前在左侧（被拖过来的），activityId 被改写为 "files"
            state({ id: "backlinks", position: "left", order: 1, activityId: "files" }),
        ];

        const result = computeEmptyRightSidebarDrop({
            prev,
            movedPanelId: "backlinks",
            panelById,
            activeRightActivityId: "outline",
        });

        const moved = result.find((s) => s.id === "backlinks");
        expect(moved?.position).toBe("right");
        // icon 与 panel 解耦：面板加入当前右侧活动分组 "outline"
        expect(moved?.activityId).toBe("outline");
        expect(moved?.order).toBe(0);
    });

    it("右侧栏已有面板时追加到末尾", () => {
        const prev: PanelRuntimeState[] = [
            state({ id: "files", position: "left", order: 0, activityId: "files" }),
            state({ id: "outline", position: "right", order: 0, activityId: "outline" }),
            state({ id: "backlinks", position: "left", order: 1, activityId: "files" }),
        ];
        const byId = makePanelById([
            def({ id: "files", activityId: "files" }),
            def({ id: "outline", activityId: "outline" }),
            def({ id: "backlinks", activityId: "outline" }),
        ]);

        const result = computeEmptyRightSidebarDrop({
            prev,
            movedPanelId: "backlinks",
            panelById: byId,
            activeRightActivityId: "outline",
        });

        const moved = result.find((s) => s.id === "backlinks");
        expect(moved?.position).toBe("right");
        expect(moved?.order).toBe(1);
    });

    it("面板不存在时返回原状态", () => {
        const prev: PanelRuntimeState[] = [
            state({ id: "files", position: "left", order: 0, activityId: "files" }),
        ];

        const result = computeEmptyRightSidebarDrop({
            prev,
            movedPanelId: "nonexistent",
            panelById,
            activeRightActivityId: "outline",
        });

        expect(result).toBe(prev);
    });
});

/* ══════════════════════════════════════════════════════════════════════
 *  resolveRightActivityIdAfterDrop
 * ══════════════════════════════════════════════════════════════════════ */

describe("resolveRightActivityIdAfterDrop", () => {
    it("应返回面板定义中的 activityId", () => {
        const panelById = makePanelById([
            def({ id: "backlinks", activityId: "outline" }),
        ]);
        expect(resolveRightActivityIdAfterDrop("backlinks", panelById)).toBe("outline");
    });

    it("定义中无 activityId 时回退为面板 ID", () => {
        const panelById = makePanelById([
            def({ id: "myPanel" }),
        ]);
        expect(resolveRightActivityIdAfterDrop("myPanel", panelById)).toBe("myPanel");
    });

    it("面板不在定义中时回退为面板 ID", () => {
        const panelById = makePanelById([]);
        expect(resolveRightActivityIdAfterDrop("unknown", panelById)).toBe("unknown");
    });
});

/* ══════════════════════════════════════════════════════════════════════
 *  回归测试：右→左→右拖拽后面板消失 bug
 * ══════════════════════════════════════════════════════════════════════ */

describe("回归测试：面板跨容器往返拖拽", () => {
    /*
     * 场景复现：反向链接面板（activityId: "outline"）初始在右侧栏。
     * 1. 拖到左侧栏 → activityId 被改为 "files"
     * 2. 再拖回右侧栏
     * 预期：activityId 应恢复为 "outline"
     * 旧 bug：activityId 仍为 "files"，visibleRightPanels 过滤时找不到 → 消失
     */

    const definitions: PanelDefinitionInfo[] = [
        def({ id: "files", activityId: "files", position: "left", order: 0 }),
        def({ id: "outline", activityId: "outline", position: "right", order: 0 }),
        def({ id: "backlinks", activityId: "outline", position: "right", order: 1 }),
    ];
    const panelById = makePanelById(definitions);

    const initialStates: PanelRuntimeState[] = buildInitialPanelStates(definitions);

    it("右→左→右（crossContainer）：activityId 应加入目标 activity 分组", () => {
        // Step 1: 将 backlinks 从右侧拖到左侧
        const afterRightToLeft = computeCrossContainerDrop({
            prev: initialStates,
            movedPanelId: "backlinks",
            targetPosition: "left",
            dropTargetPanelId: "files",
            dropPosition: "bottom",
            panelById,
            activeActivityId: "files",
            activeRightActivityId: "outline",
        });

        const backlinkAfterStep1 = afterRightToLeft.find((s) => s.id === "backlinks");
        expect(backlinkAfterStep1?.position).toBe("left");
        expect(backlinkAfterStep1?.activityId).toBe("files"); // 在左侧，activityId 变为 "files"

        // Step 2: 将 backlinks 从左侧拖回右侧
        const afterLeftToRight = computeCrossContainerDrop({
            prev: afterRightToLeft,
            movedPanelId: "backlinks",
            targetPosition: "right",
            dropTargetPanelId: "outline",
            dropPosition: "bottom",
            panelById,
            activeActivityId: "files",
            activeRightActivityId: "outline",
        });

        const backlinkAfterStep2 = afterLeftToRight.find((s) => s.id === "backlinks");
        expect(backlinkAfterStep2?.position).toBe("right");
        // icon 与 panel 解耦：面板加入 drop target 的 activityId "outline"
        expect(backlinkAfterStep2?.activityId).toBe("outline");
    });

    it("右→左→右（emptyRightSidebar）：activityId 应加入当前右侧活动分组", () => {
        // Step 1: 将 backlinks 从右侧拖到左侧的空区域
        const afterRightToLeft = computeEmptySidebarDrop({
            prev: initialStates,
            movedPanelId: "backlinks",
            activeActivityId: "files",
        });

        const backlinkAfterStep1 = afterRightToLeft.find((s) => s.id === "backlinks");
        expect(backlinkAfterStep1?.position).toBe("left");
        expect(backlinkAfterStep1?.activityId).toBe("files");

        // Step 2: 将 backlinks 从左侧拖到空的右侧栏
        const afterLeftToRight = computeEmptyRightSidebarDrop({
            prev: afterRightToLeft,
            movedPanelId: "backlinks",
            panelById,
            activeRightActivityId: "outline",
        });

        const backlinkAfterStep2 = afterLeftToRight.find((s) => s.id === "backlinks");
        expect(backlinkAfterStep2?.position).toBe("right");
        // icon 与 panel 解耦：面板加入当前右侧活动分组 "outline"
        expect(backlinkAfterStep2?.activityId).toBe("outline");
    });

    it("往返拖拽后面板在右侧 visiblePanelIds 中可见", () => {
        // Step 1: 右→左
        const afterRightToLeft = computeCrossContainerDrop({
            prev: initialStates,
            movedPanelId: "backlinks",
            targetPosition: "left",
            dropTargetPanelId: "files",
            dropPosition: "bottom",
            panelById,
            activeActivityId: "files",
            activeRightActivityId: "outline",
        });

        // Step 2: 左→右
        const afterLeftToRight = computeCrossContainerDrop({
            prev: afterRightToLeft,
            movedPanelId: "backlinks",
            targetPosition: "right",
            dropTargetPanelId: "outline",
            dropPosition: "bottom",
            panelById,
            activeActivityId: "files",
            activeRightActivityId: "outline",
        });

        // 验证：使用 activeRightActivityId="outline" 过滤右侧面板
        const visibleRight = getVisiblePanelIds(
            afterLeftToRight,
            panelById,
            "right",
            "outline",
        );
        expect(visibleRight).toContain("backlinks");
        expect(visibleRight).toContain("outline");
    });

    it("多次往返拖拽后状态仍然正确", () => {
        let current = initialStates;

        // 往返 3 次
        for (let i = 0; i < 3; i++) {
            // 右→左
            current = computeCrossContainerDrop({
                prev: current,
                movedPanelId: "backlinks",
                targetPosition: "left",
                dropTargetPanelId: "files",
                dropPosition: "bottom",
                panelById,
                activeActivityId: "files",
                activeRightActivityId: "outline",
            });

            const afterLeft = current.find((s) => s.id === "backlinks");
            expect(afterLeft?.position).toBe("left");
            expect(afterLeft?.activityId).toBe("files");

            // 左→右
            current = computeCrossContainerDrop({
                prev: current,
                movedPanelId: "backlinks",
                targetPosition: "right",
                dropTargetPanelId: "outline",
                dropPosition: "bottom",
                panelById,
                activeActivityId: "files",
                activeRightActivityId: "outline",
            });

            const afterRight = current.find((s) => s.id === "backlinks");
            expect(afterRight?.position).toBe("right");
            expect(afterRight?.activityId).toBe("outline");
        }

        // 最终验证可见性
        const visibleRight = getVisiblePanelIds(current, panelById, "right", "outline");
        expect(visibleRight).toContain("backlinks");
    });

    it("resolveRightActivityIdAfterDrop 返回原始 activityId 而非被污染值", () => {
        const result = resolveRightActivityIdAfterDrop("backlinks", panelById);
        // 不管运行时状态如何，始终返回定义中的 "outline"
        expect(result).toBe("outline");
    });
});

/* ══════════════════════════════════════════════════════════════════════
 *  边界情况与排序正确性
 * ══════════════════════════════════════════════════════════════════════ */

describe("跨容器拖拽：排序边界", () => {
    const defs: PanelDefinitionInfo[] = [
        def({ id: "a", activityId: "x", position: "left", order: 0 }),
        def({ id: "b", activityId: "x", position: "left", order: 1 }),
        def({ id: "c", activityId: "x", position: "left", order: 2 }),
        def({ id: "d", activityId: "y", position: "right", order: 0 }),
    ];
    const byId = makePanelById(defs);
    const states = buildInitialPanelStates(defs);

    it("拖到目标面板上方时 order 在目标之前", () => {
        const result = computeCrossContainerDrop({
            prev: states,
            movedPanelId: "d",
            targetPosition: "left",
            dropTargetPanelId: "b",
            dropPosition: "top",
            panelById: byId,
            activeActivityId: "x",
            activeRightActivityId: "y",
        });

        const orders = result
            .filter((s) => s.position === "left")
            .sort((a, b) => a.order - b.order)
            .map((s) => s.id);
        expect(orders).toEqual(["a", "d", "b", "c"]);
    });

    it("拖到目标面板下方时 order 在目标之后", () => {
        const result = computeCrossContainerDrop({
            prev: states,
            movedPanelId: "d",
            targetPosition: "left",
            dropTargetPanelId: "b",
            dropPosition: "bottom",
            panelById: byId,
            activeActivityId: "x",
            activeRightActivityId: "y",
        });

        const orders = result
            .filter((s) => s.position === "left")
            .sort((a, b) => a.order - b.order)
            .map((s) => s.id);
        expect(orders).toEqual(["a", "b", "d", "c"]);
    });

    it("拖到首个面板上方时 order=0", () => {
        const result = computeCrossContainerDrop({
            prev: states,
            movedPanelId: "d",
            targetPosition: "left",
            dropTargetPanelId: "a",
            dropPosition: "top",
            panelById: byId,
            activeActivityId: "x",
            activeRightActivityId: "y",
        });

        const moved = result.find((s) => s.id === "d");
        expect(moved?.order).toBe(0);
    });

    it("拖到最后一个面板下方时 order 为最大", () => {
        const result = computeCrossContainerDrop({
            prev: states,
            movedPanelId: "d",
            targetPosition: "left",
            dropTargetPanelId: "c",
            dropPosition: "bottom",
            panelById: byId,
            activeActivityId: "x",
            activeRightActivityId: "y",
        });

        const moved = result.find((s) => s.id === "d");
        const maxOrder = Math.max(
            ...result.filter((s) => s.position === "left").map((s) => s.order),
        );
        expect(moved?.order).toBe(maxOrder);
    });
});

describe("空侧栏拖入：源侧栏重新排序", () => {
    it("面板移出后源侧栏的 order 应连续", () => {
        const prev: PanelRuntimeState[] = [
            state({ id: "a", position: "right", order: 0, activityId: "y" }),
            state({ id: "b", position: "right", order: 1, activityId: "y" }),
            state({ id: "c", position: "right", order: 2, activityId: "y" }),
        ];

        const result = computeEmptySidebarDrop({
            prev,
            movedPanelId: "b",
            activeActivityId: "files",
        });

        // b 移到左侧后，右侧 a 和 c 应连续排序
        const rightPanels = result
            .filter((s) => s.position === "right")
            .sort((a, b) => a.order - b.order);
        expect(rightPanels.map((s) => s.id)).toEqual(["a", "c"]);
        expect(rightPanels.map((s) => s.order)).toEqual([0, 1]);
    });
});
