/**
 * @module plugins/markdown-codemirror/editor/renderParityContract
 * @description 编辑态/阅读态渲染能力契约：集中声明两种模式承诺支持的增强渲染特性，作为 guard 的唯一事实来源。
 * @dependencies 无外部依赖
 */

/**
 * @type EditorRenderFeature
 * @description 需要显式对齐的增强渲染特性标识。
 */
export type EditorRenderFeature =
    | "frontmatter"
    | "image-embed"
    | "inline-highlight"
    | "inline-tag"
    | "latex-inline"
    | "latex-block";

/**
 * @interface RenderFeatureDescriptor
 * @description 单项渲染特性的稳定描述。
 */
interface RenderFeatureDescriptor {
    /** 特性标识。 */
    id: EditorRenderFeature;
    /** 面向用户的简短说明。 */
    label: string;
}

const FEATURE_DESCRIPTORS: RenderFeatureDescriptor[] = [
    { id: "frontmatter", label: "Frontmatter" },
    { id: "image-embed", label: "Image Embed" },
    { id: "inline-highlight", label: "Highlight" },
    { id: "inline-tag", label: "Tag" },
    { id: "latex-inline", label: "Inline LaTeX" },
    { id: "latex-block", label: "Block LaTeX" },
];

const EDIT_MODE_SUPPORTED_FEATURES = new Set<EditorRenderFeature>(
    FEATURE_DESCRIPTORS.map((descriptor) => descriptor.id),
);

const READ_MODE_SUPPORTED_FEATURES = new Set<EditorRenderFeature>(
    FEATURE_DESCRIPTORS.map((descriptor) => descriptor.id),
);

/**
 * @function getReadModeUnsupportedFeatures
 * @description 根据契约计算阅读态仍未对齐的增强渲染特性。
 * @returns 当前阅读态不支持的增强渲染特性列表。
 */
export function getReadModeUnsupportedFeatures(): EditorRenderFeature[] {
    return FEATURE_DESCRIPTORS
        .map((descriptor) => descriptor.id)
        .filter((feature) => EDIT_MODE_SUPPORTED_FEATURES.has(feature) && !READ_MODE_SUPPORTED_FEATURES.has(feature));
}

/**
 * @function describeRenderFeature
 * @description 返回渲染特性的用户可读标签。
 * @param feature 渲染特性标识。
 * @returns 特性标签。
 */
export function describeRenderFeature(feature: EditorRenderFeature): string {
    return FEATURE_DESCRIPTORS.find((descriptor) => descriptor.id === feature)?.label ?? feature;
}