/**
 * @module host/layout/vaultTabScope.test
 * @description 仓库切换时的 Tab 生命周期策略测试，覆盖元数据装饰与关闭判定。
 * @dependencies
 *   - bun:test
 *   - ./vaultTabScope
 *
 * @example
 *   bun test src/host/layout/vaultTabScope.test.ts
 */

import { describe, expect, it } from "bun:test";
import {
    TAB_COMPONENT_ID_PARAM,
    TAB_LIFECYCLE_SCOPE_PARAM,
    decorateTabParamsWithLifecycle,
    resolveTabLifecycleScopeForVaultChange,
    shouldCloseTabOnVaultChange,
} from "./vaultTabScope";

describe("vaultTabScope", () => {
    /**
     * @function should_decorate_tab_params_with_component_and_scope_metadata
     * @description 打开 Tab 时，应把组件 ID 与作用域固化到 params 中。
     */
    it("should decorate tab params with component and scope metadata", () => {
        const result = decorateTabParamsWithLifecycle({
            componentId: "calendar-tab",
            lifecycleScope: "vault",
            params: {
                stateKey: "calendar",
            },
        });

        expect(result.stateKey).toBe("calendar");
        expect(result[TAB_COMPONENT_ID_PARAM]).toBe("calendar-tab");
        expect(result[TAB_LIFECYCLE_SCOPE_PARAM]).toBe("vault");
    });

    /**
     * @function should_treat_file_tabs_as_vault_scoped_even_without_explicit_metadata
     * @description 历史 file:* Tab 即使未带元数据，也应在仓库切换时被识别为 vault。
     */
    it("should treat file tabs as vault scoped even without explicit metadata", () => {
        expect(resolveTabLifecycleScopeForVaultChange({
            panelId: "file:notes/demo.md",
        })).toBe("vault");
    });

    /**
     * @function should_keep_global_tabs_open_when_vault_changes
     * @description 未声明为 vault 的全局 Tab，不应在仓库切换时关闭。
     */
    it("should keep global tabs open when vault changes", () => {
        expect(shouldCloseTabOnVaultChange({
            panelId: "settings",
            panelParams: decorateTabParamsWithLifecycle({
                componentId: "settings",
                lifecycleScope: "global",
            }),
        })).toBe(false);
    });

    /**
     * @function should_close_vault_scoped_tabs_when_vault_changes
     * @description 带有 vault 作用域元数据的 Tab，应在仓库切换时统一关闭。
     */
    it("should close vault scoped tabs when vault changes", () => {
        expect(shouldCloseTabOnVaultChange({
            panelId: "calendar",
            panelParams: decorateTabParamsWithLifecycle({
                componentId: "calendar-tab",
                lifecycleScope: "vault",
            }),
        })).toBe(true);
    });
});