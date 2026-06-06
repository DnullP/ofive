/**
 * @module host/layout/workbenchTitlebarOffset
 * @description Keeps the macOS traffic-light tab strip offset on the top-left visible tab section.
 */

export const WORKBENCH_TITLEBAR_OFFSET_ATTR = "data-workbench-titlebar-offset";
export const WORKBENCH_MAC_LEFT_TITLEBAR_OFFSET = "mac-left";

/**
 * @function syncWorkbenchTitlebarOffsetTarget
 * @description Marks only the top-left visible tab strip as the macOS titlebar offset target.
 * @param root Workbench layout root.
 */
export function syncWorkbenchTitlebarOffsetTarget(root: HTMLElement): void {
    const strips = Array.from(root.querySelectorAll<HTMLElement>(".layout-v2-tab-section__strip"));
    const target = strips
        .map((strip) => ({ strip, rect: strip.getBoundingClientRect() }))
        .filter(({ rect }) => rect.width > 0 && rect.height > 0)
        .sort((left, right) => {
            const topDelta = left.rect.top - right.rect.top;
            if (Math.abs(topDelta) > 2) {
                return topDelta;
            }

            return left.rect.left - right.rect.left;
        })[0]?.strip ?? null;

    for (const strip of strips) {
        if (strip === target) {
            if (strip.getAttribute(WORKBENCH_TITLEBAR_OFFSET_ATTR) !== WORKBENCH_MAC_LEFT_TITLEBAR_OFFSET) {
                strip.setAttribute(WORKBENCH_TITLEBAR_OFFSET_ATTR, WORKBENCH_MAC_LEFT_TITLEBAR_OFFSET);
            }
            continue;
        }

        if (strip.hasAttribute(WORKBENCH_TITLEBAR_OFFSET_ATTR)) {
            strip.removeAttribute(WORKBENCH_TITLEBAR_OFFSET_ATTR);
        }
    }
}
