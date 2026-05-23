/**
 * @module plugins/markdown-codemirror/editor/imageEmbedLayout
 * @description Image embed layout helpers for parsing and serializing `![[path|640x360]]`.
 * @dependencies 无
 */

export interface ImageEmbedLayout {
    width?: number;
    height?: number;
}

export interface ParsedImageEmbedTarget {
    target: string;
    layout: ImageEmbedLayout | null;
}

const IMAGE_EMBED_SIZE_PATTERN = /^(\d+(?:\.\d+)?)(?:\s*x\s*(\d+(?:\.\d+)?))?$/i;

function normalizeImageEmbedSize(value: string | undefined): number | undefined {
    if (!value) {
        return undefined;
    }

    const numericValue = Number(value);
    if (!Number.isFinite(numericValue) || numericValue <= 0) {
        return undefined;
    }

    return Math.round(numericValue);
}

export function parseImageEmbedTarget(rawTarget: string): ParsedImageEmbedTarget {
    const parts = rawTarget.split("|");
    const target = (parts.shift() ?? "").trim();

    for (const rawPart of parts) {
        const part = rawPart.trim();
        const sizeMatch = part.match(IMAGE_EMBED_SIZE_PATTERN);
        if (!sizeMatch) {
            continue;
        }

        const width = normalizeImageEmbedSize(sizeMatch[1]);
        const height = normalizeImageEmbedSize(sizeMatch[2]);
        const layout: ImageEmbedLayout = {};
        if (width !== undefined) {
            layout.width = width;
        }
        if (height !== undefined) {
            layout.height = height;
        }

        if (layout.width !== undefined || layout.height !== undefined) {
            return {
                target,
                layout,
            };
        }
    }

    return {
        target,
        layout: null,
    };
}

export function serializeImageEmbedTarget(
    target: string,
    layout: ImageEmbedLayout | null | undefined,
): string {
    const trimmedTarget = target.trim();
    const width = normalizeImageEmbedSize(layout?.width === undefined ? undefined : String(layout.width));
    const height = normalizeImageEmbedSize(layout?.height === undefined ? undefined : String(layout.height));

    if (width === undefined && height === undefined) {
        return trimmedTarget;
    }

    if (width !== undefined && height !== undefined) {
        return `${trimmedTarget}|${width}x${height}`;
    }

    if (width !== undefined) {
        return `${trimmedTarget}|${width}`;
    }

    return `${trimmedTarget}|${height}`;
}

export function serializeImageEmbedSyntax(
    target: string,
    layout: ImageEmbedLayout | null | undefined,
): string {
    return `![[${serializeImageEmbedTarget(target, layout)}]]`;
}
