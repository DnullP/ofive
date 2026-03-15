/**
 * @module host/registry/sidebarHeaderActionRegistry.test
 * @description 侧栏标题按钮注册中心单元测试：覆盖注册、排序与注销逻辑。
 */

import { afterEach, describe, expect, it } from "bun:test";
import {
    getSidebarHeaderActionsSnapshot,
    registerSidebarHeaderAction,
    unregisterSidebarHeaderAction,
    type SidebarHeaderActionDescriptor,
} from "./sidebarHeaderActionRegistry";

/**
 * @function createAction
 * @description 创建测试用按钮描述。
 * @param overrides 覆盖字段。
 * @returns 按钮描述。
 */
function createAction(
    overrides: Partial<SidebarHeaderActionDescriptor> & { id: string; activityId: string },
): SidebarHeaderActionDescriptor {
    return {
        id: overrides.id,
        activityId: overrides.activityId,
        title: overrides.title ?? overrides.id,
        icon: overrides.icon ?? null,
        order: overrides.order ?? 0,
        onClick: overrides.onClick ?? (() => {}),
    };
}

describe("sidebarHeaderActionRegistry", () => {
    afterEach(() => {
        for (const action of getSidebarHeaderActionsSnapshot()) {
            unregisterSidebarHeaderAction(action.id);
        }
    });

    it("应注册并返回侧栏标题按钮", () => {
        registerSidebarHeaderAction(createAction({ id: "files.new-note", activityId: "files" }));

        expect(getSidebarHeaderActionsSnapshot()).toHaveLength(1);
        expect(getSidebarHeaderActionsSnapshot()[0]?.id).toBe("files.new-note");
    });

    it("应按 order 和 id 排序", () => {
        registerSidebarHeaderAction(createAction({ id: "b", activityId: "files", order: 10 }));
        registerSidebarHeaderAction(createAction({ id: "a", activityId: "files", order: 10 }));
        registerSidebarHeaderAction(createAction({ id: "c", activityId: "files", order: 20 }));

        expect(getSidebarHeaderActionsSnapshot().map((action) => action.id)).toEqual(["a", "b", "c"]);
    });
});