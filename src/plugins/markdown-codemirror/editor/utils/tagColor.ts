/**
 * @module plugins/markdown-codemirror/editor/utils/tagColor
 * @description Compute deterministic tag colors from tag text.
 */

export function computeTagColorStyles(tag: string): { background: string; border: string; text: string } {
    let h = 0;
    let v = 0;
    for (let i = 0; i < tag.length; i++) {
        const code = tag.charCodeAt(i);
        h = (h * 31 + code) | 0;
        v = (v * 131 + code) | 0;
    }
    h = Math.abs(h) % 360;
    v = Math.abs(v) % 100; // 0..99

    // Softer saturation range: 30% - 70%
    const sat = 30 + Math.round((v / 99) * 40);
    // background lightness: 92% down to 56%
    const lightBg = 92 - Math.round((v / 99) * 36);
    // border slightly darker than background
    const borderLight = Math.max(22, lightBg - 14);
    // text lightness: 12% - 28%
    const textLight = 12 + Math.round((1 - v / 99) * 16);

    const bgAlpha = 0.85;
    const borderAlpha = 0.9;
    const background = `hsl(${h} ${sat}% ${lightBg}% / ${bgAlpha})`;
    const border = `hsl(${h} ${Math.max(30, sat - 10)}% ${borderLight}% / ${borderAlpha})`;
    const text = `hsl(${h} ${Math.max(10, sat - 40)}% ${textLight}%)`;
    return { background, border, text };
}
