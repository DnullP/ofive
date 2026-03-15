/**
 * @module host/registry/activityRegistry.test
 * @description 活动图标注册中心单元测试：覆盖两种类型（panel-container / callback）
 *   的注册、注销、快照、订阅、按 ID 查找等功能。
 * @dependencies
 *   - bun:test
 *   - ./activityRegistry
 *
 * @example
 *   bun test src/host/registry/activityRegistry.test.ts
 */

import { describe, expect, it, afterEach } from "bun:test";
import {
    registerActivity,
    unregisterActivity,
    getActivitiesSnapshot,
    subscribeActivities,
    getActivityById,
    resolveActivityTitle,
    type PanelContainerActivity,
    type CallbackActivity,
} from "./activityRegistry";

/** 创建面板容器型活动描述 */
function createPanelActivity(overrides: Partial<PanelContainerActivity> = {}): PanelContainerActivity {
    return {
        type: "panel-container",
        id: overrides.id ?? "test-panel-activity",
        title: overrides.title ?? "Test Panel Activity",
        icon: overrides.icon ?? "icon",
        defaultSection: overrides.defaultSection ?? "top",
        defaultBar: overrides.defaultBar ?? "left",
        defaultOrder: overrides.defaultOrder ?? 1,
    };
}

/** 创建回调型活动描述 */
function createCallbackActivity(overrides: Partial<CallbackActivity> = {}): CallbackActivity {
    return {
        type: "callback",
        id: overrides.id ?? "test-callback-activity",
        title: overrides.title ?? "Test Callback Activity",
        icon: overrides.icon ?? "icon",
        defaultSection: overrides.defaultSection ?? "top",
        defaultBar: overrides.defaultBar ?? "left",
        defaultOrder: overrides.defaultOrder ?? 1,
        onActivate: overrides.onActivate ?? (() => { }),
    };
}

describe("activityRegistry", () => {
    const cleanupFns: (() => void)[] = [];

    afterEach(() => {
        cleanupFns.forEach((fn) => fn());
        cleanupFns.length = 0;
        for (const activity of getActivitiesSnapshot()) {
            unregisterActivity(activity.id);
        }
    });

    describe("registerActivity", () => {
        it("应注册面板容器型活动", () => {
            cleanupFns.push(registerActivity(createPanelActivity({ id: "files" })));

            const snapshot = getActivitiesSnapshot();
            expect(snapshot).toHaveLength(1);
            expect(snapshot[0].id).toBe("files");
            expect(snapshot[0].type).toBe("panel-container");
        });

        it("应注册回调型活动", () => {
            cleanupFns.push(registerActivity(createCallbackActivity({ id: "graph" })));

            const snapshot = getActivitiesSnapshot();
            expect(snapshot).toHaveLength(1);
            expect(snapshot[0].id).toBe("graph");
            expect(snapshot[0].type).toBe("callback");
        });

        it("应支持混合注册两种类型", () => {
            cleanupFns.push(registerActivity(createPanelActivity({ id: "files", defaultOrder: 1 })));
            cleanupFns.push(registerActivity(createCallbackActivity({ id: "graph", defaultOrder: 2 })));

            const snapshot = getActivitiesSnapshot();
            expect(snapshot).toHaveLength(2);
            expect(snapshot[0].type).toBe("panel-container");
            expect(snapshot[1].type).toBe("callback");
        });

        it("应按 defaultOrder 排序", () => {
            cleanupFns.push(registerActivity(createPanelActivity({ id: "c", defaultOrder: 3 })));
            cleanupFns.push(registerActivity(createPanelActivity({ id: "a", defaultOrder: 1 })));
            cleanupFns.push(registerActivity(createCallbackActivity({ id: "b", defaultOrder: 2 })));

            const ids = getActivitiesSnapshot().map((a) => a.id);
            expect(ids).toEqual(["a", "b", "c"]);
        });

        it("相同 id 注册应覆盖旧条目", () => {
            cleanupFns.push(registerActivity(createPanelActivity({ id: "files", title: "Old" })));
            cleanupFns.push(registerActivity(createPanelActivity({ id: "files", title: "New" })));

            const snapshot = getActivitiesSnapshot();
            expect(snapshot).toHaveLength(1);
            expect(resolveActivityTitle(snapshot[0].title)).toBe("New");
        });

        it("应返回取消注册函数", () => {
            const unregister = registerActivity(createPanelActivity({ id: "files" }));
            expect(getActivitiesSnapshot()).toHaveLength(1);

            unregister();
            expect(getActivitiesSnapshot()).toHaveLength(0);
        });
    });

    describe("unregisterActivity", () => {
        it("应移除已注册的活动", () => {
            cleanupFns.push(registerActivity(createPanelActivity({ id: "files" })));
            unregisterActivity("files");
            expect(getActivitiesSnapshot()).toHaveLength(0);
        });

        it("对未注册的 id 应无操作", () => {
            unregisterActivity("nonexistent");
            expect(getActivitiesSnapshot()).toHaveLength(0);
        });
    });

    describe("getActivityById", () => {
        it("应返回已注册的活动", () => {
            cleanupFns.push(registerActivity(createCallbackActivity({ id: "graph" })));
            const result = getActivityById("graph");
            expect(result).toBeDefined();
            expect(result!.type).toBe("callback");
        });

        it("未注册时应返回 undefined", () => {
            expect(getActivityById("nonexistent")).toBeUndefined();
        });
    });

    describe("回调型活动的 onActivate", () => {
        it("应可以调用 onActivate 回调", () => {
            let activated = false;
            cleanupFns.push(registerActivity(createCallbackActivity({
                id: "graph",
                onActivate: () => { activated = true; },
            })));

            const activity = getActivityById("graph");
            expect(activity).toBeDefined();
            if (activity?.type === "callback") {
                activity.onActivate({} as any);
            }
            expect(activated).toBe(true);
        });
    });

    describe("subscribeActivities", () => {
        it("应在注册时通知监听器", () => {
            let callCount = 0;
            const unsub = subscribeActivities(() => { callCount++; });

            cleanupFns.push(registerActivity(createPanelActivity({ id: "files" })));
            expect(callCount).toBe(1);

            unsub();
        });

        it("应在注销时通知监听器", () => {
            cleanupFns.push(registerActivity(createPanelActivity({ id: "files" })));

            let callCount = 0;
            const unsub = subscribeActivities(() => { callCount++; });
            unregisterActivity("files");
            expect(callCount).toBe(1);

            unsub();
        });

        it("取消订阅后不应再通知", () => {
            let callCount = 0;
            const unsub = subscribeActivities(() => { callCount++; });
            unsub();

            cleanupFns.push(registerActivity(createPanelActivity({ id: "files" })));
            expect(callCount).toBe(0);
        });
    });

    describe("resolveActivityTitle", () => {
        it("字符串标题直接返回", () => {
            expect(resolveActivityTitle("Hello")).toBe("Hello");
        });

        it("函数标题调用后返回", () => {
            expect(resolveActivityTitle(() => "Dynamic")).toBe("Dynamic");
        });
    });
});
