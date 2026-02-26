/**
 * @module layout/editor/syntaxExclusionZones
 * @description 语法排斥区域注册中心：解决多种块级语法结构（code fence、LaTeX block、
 *   frontmatter 等）嵌套时的装饰冲突。
 *
 *   设计理念：
 *   - 每个"块级容器"插件（frontmatter / code fence / LaTeX block）在构建装饰前，
 *     先将自己管辖的文档区间注册到排斥区域表中。
 *   - 其他插件（包括行级注册表和其他块级插件）在处理某个位置前，查询该位置是否
 *     已被更高优先级的插件占据；若是则跳过，避免产生冲突装饰。
 *
 *   优先级（由文档语义决定）：
 *   1. frontmatter — 最高，总在文档头部，内容为 YAML
 *   2. code-fence  — 次高，内容为原始代码，不应做任何 markdown 渲染
 *   3. latex-block — 内容为 TeX 公式，不应做 markdown 渲染
 *
 *   数据存储以 EditorView 为键（WeakMap），每次文档/选区变化时由各插件重新声明，
 *   因此不存在过期区域。
 *
 * @dependencies 无外部依赖
 *
 * @exports
 *   - ExclusionZoneOwner — 排斥区域所有者标识
 *   - ExclusionZone — 单个排斥区域
 *   - setExclusionZones — 声明某个所有者的排斥区域列表
 *   - isInsideExclusionZone — 查询某位置是否被排斥
 *   - isRangeInsideExclusionZone — 查询某范围是否被排斥
 *   - clearExclusionZones — 清理某个所有者的排斥区域
 */

import type { EditorView } from "@codemirror/view";

/* ================================================================== */
/*  类型定义                                                           */
/* ================================================================== */

/**
 * @type ExclusionZoneOwner
 * @description 排斥区域所有者标识。按优先级从高到低排列。
 */
export type ExclusionZoneOwner = "frontmatter" | "code-fence" | "latex-block";

/**
 * @interface ExclusionZone
 * @description 单个排斥区域，表示文档中一段被特定块级插件管辖的范围。
 *   - from  起始偏移（含）
 *   - to    结束偏移（含）
 */
export interface ExclusionZone {
    /** 区域起始偏移（含）。 */
    from: number;
    /** 区域结束偏移（含）。 */
    to: number;
}

/* ================================================================== */
/*  优先级表                                                           */
/* ================================================================== */

/** 所有者优先级：数值越小优先级越高。 */
const OWNER_PRIORITY: Record<ExclusionZoneOwner, number> = {
    frontmatter: 0,
    "code-fence": 1,
    "latex-block": 2,
};

/* ================================================================== */
/*  存储                                                               */
/* ================================================================== */

/**
 * 以 EditorView 为键的排斥区域存储。
 * 内层 Map 以 owner 为键，值为该 owner 声明的所有排斥区域。
 */
const zonesStore = new WeakMap<
    EditorView,
    Map<ExclusionZoneOwner, ExclusionZone[]>
>();

/**
 * 获取或创建某个 view 的区域 Map。
 */
function getOrCreateViewMap(
    view: EditorView,
): Map<ExclusionZoneOwner, ExclusionZone[]> {
    let map = zonesStore.get(view);
    if (!map) {
        map = new Map();
        zonesStore.set(view, map);
    }
    return map;
}

/* ================================================================== */
/*  公共 API                                                           */
/* ================================================================== */

/**
 * @function setExclusionZones
 * @description 声明某个所有者在当前文档版本中管辖的排斥区域列表。
 *   每次调用会完全覆盖该 owner 之前的声明。
 *   应在 ViewPlugin 的 build/update 方法中调用。
 * @param view 编辑器视图。
 * @param owner 区域所有者标识。
 * @param zones 排斥区域列表（无需排序）。
 */
export function setExclusionZones(
    view: EditorView,
    owner: ExclusionZoneOwner,
    zones: ExclusionZone[],
): void {
    const map = getOrCreateViewMap(view);
    map.set(owner, zones);
}

/**
 * @function clearExclusionZones
 * @description 清理某个所有者的排斥区域声明。
 * @param view 编辑器视图。
 * @param owner 区域所有者标识。
 */
export function clearExclusionZones(
    view: EditorView,
    owner: ExclusionZoneOwner,
): void {
    const map = zonesStore.get(view);
    if (map) {
        map.delete(owner);
    }
}

/**
 * @function isInsideExclusionZone
 * @description 查询某个文档位置是否处于排斥区域内。
 *   可通过 excludeOwner 参数排除自身的区域（插件不排斥自己）。
 * @param view 编辑器视图。
 * @param pos 文档偏移位置。
 * @param excludeOwner 要排除的所有者（通常是调用方自身）。
 * @returns 若位置处于排斥区域内则返回 true。
 */
export function isInsideExclusionZone(
    view: EditorView,
    pos: number,
    excludeOwner?: ExclusionZoneOwner,
): boolean {
    const map = zonesStore.get(view);
    if (!map) return false;

    for (const [owner, zones] of map) {
        if (owner === excludeOwner) continue;
        for (const zone of zones) {
            if (pos >= zone.from && pos <= zone.to) {
                return true;
            }
        }
    }
    return false;
}

/**
 * @function isRangeInsideExclusionZone
 * @description 查询某个文档范围是否与排斥区域重叠。
 *   可通过 excludeOwner 排除自身区域。
 * @param view 编辑器视图。
 * @param from 范围起始偏移。
 * @param to 范围结束偏移。
 * @param excludeOwner 要排除的所有者。
 * @returns 若范围与排斥区域重叠则返回 true。
 */
export function isRangeInsideExclusionZone(
    view: EditorView,
    from: number,
    to: number,
    excludeOwner?: ExclusionZoneOwner,
): boolean {
    const map = zonesStore.get(view);
    if (!map) return false;

    for (const [owner, zones] of map) {
        if (owner === excludeOwner) continue;
        for (const zone of zones) {
            if (from <= zone.to && to >= zone.from) {
                return true;
            }
        }
    }
    return false;
}

/**
 * @function isInsideHigherPriorityZone
 * @description 查询某个位置是否被优先级更高的所有者的排斥区域覆盖。
 *   用于块级插件判断自己是否应跳过某个区域。
 * @param view 编辑器视图。
 * @param pos 文档偏移位置。
 * @param self 当前插件的所有者标识。
 * @returns 若被更高优先级区域覆盖则返回 true。
 */
export function isInsideHigherPriorityZone(
    view: EditorView,
    pos: number,
    self: ExclusionZoneOwner,
): boolean {
    const map = zonesStore.get(view);
    if (!map) return false;

    const selfPriority = OWNER_PRIORITY[self];
    for (const [owner, zones] of map) {
        if (OWNER_PRIORITY[owner] >= selfPriority) continue;
        for (const zone of zones) {
            if (pos >= zone.from && pos <= zone.to) {
                return true;
            }
        }
    }
    return false;
}

/**
 * @function isRangeInsideHigherPriorityZone
 * @description 查询某个范围是否与优先级更高的所有者的排斥区域重叠。
 * @param view 编辑器视图。
 * @param from 范围起始偏移。
 * @param to 范围结束偏移。
 * @param self 当前插件的所有者标识。
 * @returns 若与更高优先级区域重叠则返回 true。
 */
export function isRangeInsideHigherPriorityZone(
    view: EditorView,
    from: number,
    to: number,
    self: ExclusionZoneOwner,
): boolean {
    const map = zonesStore.get(view);
    if (!map) return false;

    const selfPriority = OWNER_PRIORITY[self];
    for (const [owner, zones] of map) {
        if (OWNER_PRIORITY[owner] >= selfPriority) continue;
        for (const zone of zones) {
            if (from <= zone.to && to >= zone.from) {
                return true;
            }
        }
    }
    return false;
}
