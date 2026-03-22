/**
 * @module host/layout/glassRuntimeStyle
 * @description 玻璃运行时样式计算：将配置参数转换为根节点 CSS 变量，供桌面窗口材质样式使用。
 * @dependencies
 *  - 无外部运行时依赖
 * @example
 * ```ts
 * const runtimeStyle = buildGlassRuntimeStyle({
 *   glassTintOpacity: 0.08,
 *   glassSurfaceOpacity: 0.18,
 *   glassInactiveSurfaceOpacity: 0.14,
 *   glassBlurRadius: 12,
 * });
 * document.documentElement.style.setProperty("--glass-blur-radius", runtimeStyle.cssVariables["--glass-blur-radius"]);
 * ```
 */

/**
 * @interface GlassRuntimeStyleInput
 * @description 玻璃运行时样式计算输入。
 */
export interface GlassRuntimeStyleInput {
    /** 毛玻璃基础底色透明度。 */
    glassTintOpacity: number;
    /** 聚焦时玻璃表面透明度。 */
    glassSurfaceOpacity: number;
    /** 失焦时玻璃表面透明度。 */
    glassInactiveSurfaceOpacity: number;
    /** 玻璃模糊半径。 */
    glassBlurRadius: number;
}

/**
 * @interface GlassRuntimeStyleResult
 * @description 玻璃运行时样式计算结果。
 */
export interface GlassRuntimeStyleResult {
    /** 需要写入根节点的 CSS 变量。 */
    cssVariables: Record<string, string>;
    /** 实际生效的失焦透明度，不会高于聚焦透明度。 */
    effectiveInactiveSurfaceOpacity: number;
}

/**
 * @function clampGlassAlpha
 * @description 将玻璃透明度限制在 0 到 1 之间，并保留两位小数。
 * @param value 原始透明度值。
 * @returns 限制范围后的透明度。
 */
function clampGlassAlpha(value: number): number {
    return Math.max(0, Math.min(1, Number(value.toFixed(2))));
}

/**
 * @function buildGlassRuntimeStyle
 * @description 根据配置参数生成玻璃运行时 CSS 变量。
 * @param input 玻璃配置输入。
 * @returns CSS 变量映射与实际生效的失焦透明度。
 * @throws 无显式异常；输入异常值会被自动钳制。
 */
export function buildGlassRuntimeStyle(
    input: GlassRuntimeStyleInput,
): GlassRuntimeStyleResult {
    const effectiveInactiveSurfaceOpacity = clampGlassAlpha(
        Math.min(input.glassInactiveSurfaceOpacity, input.glassSurfaceOpacity),
    );
    const glassBlurRadius = Math.max(4, Math.round(input.glassBlurRadius));

    return {
        effectiveInactiveSurfaceOpacity,
        cssVariables: {
            "--glass-tint-opacity": String(clampGlassAlpha(input.glassTintOpacity)),
            "--glass-surface-opacity": String(clampGlassAlpha(input.glassSurfaceOpacity)),
            "--glass-inactive-surface-opacity": String(effectiveInactiveSurfaceOpacity),
            "--glass-blur-radius": `${glassBlurRadius}px`,
            "--glass-surface-opacity-soft": String(
                clampGlassAlpha(input.glassSurfaceOpacity + 0.04),
            ),
            "--glass-surface-opacity-strong": String(
                clampGlassAlpha(input.glassSurfaceOpacity + 0.1),
            ),
            "--glass-inactive-surface-opacity-soft": String(
                clampGlassAlpha(effectiveInactiveSurfaceOpacity + 0.04),
            ),
            "--glass-inactive-surface-opacity-strong": String(
                clampGlassAlpha(effectiveInactiveSurfaceOpacity + 0.08),
            ),
        },
    };
}