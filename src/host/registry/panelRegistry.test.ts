/**
 * @module host/registry/panelRegistry.test
 * @description 面板注册中心单元测试：覆盖注册、注销、快照、订阅等核心功能。
 * @dependencies
 *   - bun:test
 *   - ./panelRegistry
 *
 * @example
 *   bun test src/host/registry/panelRegistry.test.ts
 */

import { describe, expect, it, afterEach } from "bun:test";
import {
    registerPanel,
    unregisterPanel,
    getPanelsSnapshot,
    subscribePanels,
    resolveTitle,
    type PanelDescriptor,
} from "./panelRegistry";

/**
 * 创建测试用的面板描述。
 */
function createTestPanel(overrides: Partial<PanelDescriptor> = {}): PanelDescriptor {
    return {
        id: overrides.id ?? "test-panel",
        title: overrides.title ?? "Test Panel",
        activityId: overrides.activityId ?? "test-activity",
        defaultPosition: overrides.defaultPosition ?? "left",
        defaultOrder: overrides.defaultOrder ?? 1,
        render: overrides.render ?? (() => null),
    };
}

describe("panelRegistry", () => {
    /** 每次测试前清理所有已注册的面板 */
    const cleanupFns: (() => void)[] = [];

    afterEach(() => {
        cleanupFns.forEach((fn) => fn());
        cleanupFns.length = 0;
        // 确保清理完毕
        for (const panel of getPanelsSnapshot()) {
            unregisterPanel(panel.id);
        }
    });

    describe("registerPanel", () => {
        it("应注册面板并出现在快照中", () => {
            const panel = createTestPanel({ id: "p1" });
            cleanupFns.push(registerPanel(panel));

            const snapshot = getPanelsSnapshot();
            expect(snapshot).toHaveLength(1);
            expect(snapshot[0].id).toBe("p1");
        });

        it("应支持注册多个面板", () => {
            cleanupFns.push(registerPanel(createTestPanel({ id: "p1", defaultOrder: 2 })));
            cleanupFns.push(registerPanel(createTestPanel({ id: "p2", defaultOrder: 1 })));

            const snapshot = getPanelsSnapshot();
            expect(snapshot).toHaveLength(2);
        });

        it("应按 defaultOrder 排序", () => {
            cleanupFns.push(registerPanel(createTestPanel({ id: "p1", defaultOrder: 3 })));
            cleanupFns.push(registerPanel(createTestPanel({ id: "p2", defaultOrder: 1 })));
            cleanupFns.push(registerPanel(createTestPanel({ id: "p3", defaultOrder: 2 })));

            const snapshot = getPanelsSnapshot();
            expect(snapshot.map((p) => p.id)).toEqual(["p2", "p3", "p1"]);
        });

        it("相同 defaultOrder 时按 id 字母序排列", () => {
            cleanupFns.push(registerPanel(createTestPanel({ id: "beta", defaultOrder: 1 })));
            cleanupFns.push(registerPanel(createTestPanel({ id: "alpha", defaultOrder: 1 })));

            const snapshot = getPanelsSnapshot();
            expect(snapshot.map((p) => p.id)).toEqual(["alpha", "beta"]);
        });

        it("相同 id 注册应覆盖旧条目", () => {
            cleanupFns.push(registerPanel(createTestPanel({ id: "p1", title: "Old" })));
            cleanupFns.push(registerPanel(createTestPanel({ id: "p1", title: "New" })));

            const snapshot = getPanelsSnapshot();
            expect(snapshot).toHaveLength(1);
            expect(resolveTitle(snapshot[0].title)).toBe("New");
        });

        it("应返回取消注册函数", () => {
            const unregister = registerPanel(createTestPanel({ id: "p1" }));
            expect(getPanelsSnapshot()).toHaveLength(1);

            unregister();
            expect(getPanelsSnapshot()).toHaveLength(0);
        });
    });

    describe("unregisterPanel", () => {
        it("应移除已注册的面板", () => {
            cleanupFns.push(registerPanel(createTestPanel({ id: "p1" })));
            expect(getPanelsSnapshot()).toHaveLength(1);

            unregisterPanel("p1");
            expect(getPanelsSnapshot()).toHaveLength(0);
        });

        it("对未注册的 id 应无操作", () => {
            unregisterPanel("nonexistent");
            expect(getPanelsSnapshot()).toHaveLength(0);
        });
    });

    describe("subscribePanels", () => {
        it("应在注册时通知监听器", () => {
            let callCount = 0;
            const unsub = subscribePanels(() => {
                callCount++;
            });

            cleanupFns.push(registerPanel(createTestPanel({ id: "p1" })));
            expect(callCount).toBe(1);

            unsub();
        });

        it("应在注销时通知监听器", () => {
            cleanupFns.push(registerPanel(createTestPanel({ id: "p1" })));

            let callCount = 0;
            const unsub = subscribePanels(() => {
                callCount++;
            });

            unregisterPanel("p1");
            expect(callCount).toBe(1);

            unsub();
        });

        it("取消订阅后不应再通知", () => {
            let callCount = 0;
            const unsub = subscribePanels(() => {
                callCount++;
            });
            unsub();

            cleanupFns.push(registerPanel(createTestPanel({ id: "p1" })));
            expect(callCount).toBe(0);
        });
    });

    describe("resolveTitle", () => {
        it("字符串标题直接返回", () => {
            expect(resolveTitle("Hello")).toBe("Hello");
        });

        it("函数标题调用后返回", () => {
            expect(resolveTitle(() => "Dynamic")).toBe("Dynamic");
        });
    });
});
