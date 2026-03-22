/**
 * @module host/layout/glassRuntimeStyle.test
 * @description 玻璃运行时样式计算测试，覆盖参数到 CSS 变量的映射关系。
 * @dependencies
 *  - bun:test
 *  - ./glassRuntimeStyle
 */

import { describe, expect, it } from "bun:test";
import { buildGlassRuntimeStyle } from "./glassRuntimeStyle";

describe("glassRuntimeStyle", () => {
    it("clamps inactive opacity so it never exceeds focused opacity", () => {
        const result = buildGlassRuntimeStyle({
            glassTintOpacity: 0.08,
            glassSurfaceOpacity: 0.17,
            glassInactiveSurfaceOpacity: 0.32,
            glassBlurRadius: 10,
        });

        expect(result.effectiveInactiveSurfaceOpacity).toBe(0.17);
        expect(result.cssVariables["--glass-inactive-surface-opacity"]).toBe("0.17");
    });

    it("maps blur radius directly to css variable", () => {
        const lowBlur = buildGlassRuntimeStyle({
            glassTintOpacity: 0.08,
            glassSurfaceOpacity: 0.18,
            glassInactiveSurfaceOpacity: 0.14,
            glassBlurRadius: 6,
        });
        const highBlur = buildGlassRuntimeStyle({
            glassTintOpacity: 0.08,
            glassSurfaceOpacity: 0.18,
            glassInactiveSurfaceOpacity: 0.14,
            glassBlurRadius: 20,
        });

        expect(lowBlur.cssVariables["--glass-blur-radius"]).toBe("6px");
        expect(highBlur.cssVariables["--glass-blur-radius"]).toBe("20px");
    });

    it("exposes soft and strong surface opacity variants", () => {
        const result = buildGlassRuntimeStyle({
            glassTintOpacity: 0.07,
            glassSurfaceOpacity: 0.16,
            glassInactiveSurfaceOpacity: 0.1,
            glassBlurRadius: 12,
        });

        expect(result.cssVariables["--glass-surface-opacity"]).toBe("0.16");
        expect(result.cssVariables["--glass-surface-opacity-soft"]).toBe("0.2");
        expect(result.cssVariables["--glass-surface-opacity-strong"]).toBe("0.26");
    });
});