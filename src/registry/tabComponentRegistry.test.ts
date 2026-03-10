/**
 * @module registry/tabComponentRegistry.test
 * @description Tab 组件注册中心单元测试：覆盖注册、注销、快照、订阅、按 ID 查找等功能。
 * @dependencies
 *   - bun:test
 *   - ./tabComponentRegistry
 *
 * @example
 *   bun test src/registry/tabComponentRegistry.test.ts
 */

import { describe, expect, it, afterEach } from "bun:test";
import {
    registerTabComponent,
    unregisterTabComponent,
    getTabComponentsSnapshot,
    subscribeTabComponents,
    getTabComponentById,
    type TabComponentDescriptor,
} from "./tabComponentRegistry";

/**
 * 创建测试用的 Tab 组件描述。
 */
function createTestTabComponent(overrides: Partial<TabComponentDescriptor> = {}): TabComponentDescriptor {
    return {
        id: overrides.id ?? "test-tab",
        component: overrides.component ?? (() => null),
    };
}

describe("tabComponentRegistry", () => {
    const cleanupFns: (() => void)[] = [];

    afterEach(() => {
        cleanupFns.forEach((fn) => fn());
        cleanupFns.length = 0;
        for (const comp of getTabComponentsSnapshot()) {
            unregisterTabComponent(comp.id);
        }
    });

    describe("registerTabComponent", () => {
        it("应注册 Tab 组件并出现在快照中", () => {
            cleanupFns.push(registerTabComponent(createTestTabComponent({ id: "editor" })));

            const snapshot = getTabComponentsSnapshot();
            expect(snapshot).toHaveLength(1);
            expect(snapshot[0].id).toBe("editor");
        });

        it("应支持注册多个 Tab 组件", () => {
            cleanupFns.push(registerTabComponent(createTestTabComponent({ id: "editor" })));
            cleanupFns.push(registerTabComponent(createTestTabComponent({ id: "viewer" })));

            expect(getTabComponentsSnapshot()).toHaveLength(2);
        });

        it("相同 id 注册应覆盖旧条目", () => {
            const comp1 = (): null => null;
            const comp2 = (): null => null;
            cleanupFns.push(registerTabComponent({ id: "editor", component: comp1 as any }));
            cleanupFns.push(registerTabComponent({ id: "editor", component: comp2 as any }));

            const snapshot = getTabComponentsSnapshot();
            expect(snapshot).toHaveLength(1);
            expect(snapshot[0].component).toBe(comp2);
        });

        it("应返回取消注册函数", () => {
            const unregister = registerTabComponent(createTestTabComponent({ id: "editor" }));
            expect(getTabComponentsSnapshot()).toHaveLength(1);

            unregister();
            expect(getTabComponentsSnapshot()).toHaveLength(0);
        });
    });

    describe("unregisterTabComponent", () => {
        it("应移除已注册的组件", () => {
            cleanupFns.push(registerTabComponent(createTestTabComponent({ id: "editor" })));
            unregisterTabComponent("editor");
            expect(getTabComponentsSnapshot()).toHaveLength(0);
        });

        it("对未注册的 id 应无操作", () => {
            unregisterTabComponent("nonexistent");
            expect(getTabComponentsSnapshot()).toHaveLength(0);
        });
    });

    describe("getTabComponentById", () => {
        it("应返回已注册的组件", () => {
            cleanupFns.push(registerTabComponent(createTestTabComponent({ id: "editor" })));
            const result = getTabComponentById("editor");
            expect(result).toBeDefined();
            expect(result!.id).toBe("editor");
        });

        it("未注册时应返回 undefined", () => {
            expect(getTabComponentById("nonexistent")).toBeUndefined();
        });
    });

    describe("subscribeTabComponents", () => {
        it("应在注册时通知监听器", () => {
            let callCount = 0;
            const unsub = subscribeTabComponents(() => { callCount++; });

            cleanupFns.push(registerTabComponent(createTestTabComponent({ id: "editor" })));
            expect(callCount).toBe(1);

            unsub();
        });

        it("应在注销时通知监听器", () => {
            cleanupFns.push(registerTabComponent(createTestTabComponent({ id: "editor" })));

            let callCount = 0;
            const unsub = subscribeTabComponents(() => { callCount++; });
            unregisterTabComponent("editor");
            expect(callCount).toBe(1);

            unsub();
        });

        it("取消订阅后不应再通知", () => {
            let callCount = 0;
            const unsub = subscribeTabComponents(() => { callCount++; });
            unsub();

            cleanupFns.push(registerTabComponent(createTestTabComponent({ id: "editor" })));
            expect(callCount).toBe(0);
        });
    });
});
