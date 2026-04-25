/**
 * @module plugins/markdown-codemirror/editor/CodeMirrorEditorPreviewMirror
 * @description 为 workbench split preview 提供 CodeMirror 编辑器 DOM 镜像。
 *   模块只复制现有 editor DOM，不创建新的 EditorView，避免预分区阶段重复挂载重型编辑器。
 *
 * @dependencies
 *   - react
 *   - CodeMirrorEditorTab.css
 *
 * @example
 *   registerCodeMirrorEditorPreviewSource(articleId, () => tabRootRef.current);
 *   <CodeMirrorEditorPreviewMirror articleId={articleId} title="note.md" />
 *
 * @exports
 *   - registerCodeMirrorEditorPreviewSource 注册当前真实 editor DOM 来源。
 *   - CodeMirrorEditorPreviewMirror 渲染无交互、无 EditorView 生命周期副作用的 preview 镜像。
 */

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

type EditorPreviewSourceGetter = () => HTMLElement | null;

const editorPreviewSources = new Map<string, EditorPreviewSourceGetter>();

/**
 * @function registerCodeMirrorEditorPreviewSource
 * @description 注册指定 article/editor tab 的真实 DOM 来源，用于 split preview 阶段克隆视觉镜像。
 * @param articleId editor tab 对应的文章标识，通常等于 workbench tab id。
 * @param getSourceElement 返回当前真实 editor 根 DOM 的函数。
 * @returns 取消注册函数；仅移除同一 getter，避免新挂载实例被旧清理误删。
 */
export function registerCodeMirrorEditorPreviewSource(
    articleId: string,
    getSourceElement: EditorPreviewSourceGetter,
): () => void {
    editorPreviewSources.set(articleId, getSourceElement);
    console.debug("[editor-preview-mirror] source registered", { articleId });

    return () => {
        if (editorPreviewSources.get(articleId) === getSourceElement) {
            editorPreviewSources.delete(articleId);
            console.debug("[editor-preview-mirror] source unregistered", { articleId });
        }
    };
}

/**
 * @function removeUnsafeMirrorAttributes
 * @description 移除克隆 DOM 中可能造成重复 id、焦点或编辑行为的属性。
 * @param clone 待清理的 DOM 克隆根节点。
 * @returns void。
 */
function removeUnsafeMirrorAttributes(clone: HTMLElement): void {
    clone.querySelectorAll<HTMLElement>("[id]").forEach((element) => {
        element.removeAttribute("id");
    });

    clone.querySelectorAll<HTMLElement>("[contenteditable]").forEach((element) => {
        element.setAttribute("contenteditable", "false");
        element.setAttribute("tabindex", "-1");
    });

    clone.querySelectorAll<HTMLElement>("button, input, textarea, select, [tabindex]").forEach((element) => {
        element.setAttribute("tabindex", "-1");
    });
}

/**
 * @function markMirrorEditorNodes
 * @description 标记克隆中的 CodeMirror 节点，便于测试区分真实 EditorView 与 preview 镜像。
 * @param clone 待标记的 DOM 克隆根节点。
 * @returns void。
 */
function markMirrorEditorNodes(clone: HTMLElement): void {
    clone.setAttribute("data-editor-preview-mirror-clone", "true");
    clone.querySelectorAll<HTMLElement>(".cm-editor").forEach((element) => {
        element.setAttribute("data-editor-preview-mirror-node", "true");
    });
}

/**
 * @function copyScrollableOffsets
 * @description 将源 editor 的滚动位置复制到克隆 editor，保证 preview 与当前可见视口一致。
 * @param source 源 editor 根 DOM。
 * @param clone 克隆 editor 根 DOM。
 * @returns void。
 */
function copyScrollableOffsets(source: HTMLElement, clone: HTMLElement): void {
    const sourceScrollers = Array.from(source.querySelectorAll<HTMLElement>(".cm-scroller"));
    const cloneScrollers = Array.from(clone.querySelectorAll<HTMLElement>(".cm-scroller"));

    sourceScrollers.forEach((sourceScroller, index) => {
        const cloneScroller = cloneScrollers[index];
        if (!cloneScroller) {
            return;
        }

        cloneScroller.scrollTop = sourceScroller.scrollTop;
        cloneScroller.scrollLeft = sourceScroller.scrollLeft;
    });
}

/**
 * @function createEditorPreviewMirrorClone
 * @description 基于真实 editor DOM 创建安全的 preview 镜像克隆。
 * @param source 源 editor 根 DOM。
 * @returns 清理并标记后的 DOM 克隆。
 */
function createEditorPreviewMirrorClone(source: HTMLElement): HTMLElement {
    const clone = source.cloneNode(true) as HTMLElement;
    removeUnsafeMirrorAttributes(clone);
    markMirrorEditorNodes(clone);
    copyScrollableOffsets(source, clone);
    return clone;
}

export interface CodeMirrorEditorPreviewMirrorProps {
    /** editor tab 对应的文章标识。 */
    articleId: string;
    /** fallback 状态显示的 tab 标题。 */
    title: string;
}

/**
 * @function CodeMirrorEditorPreviewMirror
 * @description 渲染 CodeMirror 编辑器的视觉镜像；不挂载新的 CodeMirrorEditorTab 或 EditorView。
 * @param props 预览镜像属性。
 * @returns React preview 节点。
 */
export function CodeMirrorEditorPreviewMirror(props: CodeMirrorEditorPreviewMirrorProps): ReactNode {
    const { articleId, title } = props;
    const mirrorHostRef = useRef<HTMLDivElement | null>(null);
    const [hasMirror, setHasMirror] = useState(false);

    useLayoutEffect(() => {
        const mirrorHost = mirrorHostRef.current;
        if (!mirrorHost) {
            return;
        }

        mirrorHost.innerHTML = "";
        const sourceElement = editorPreviewSources.get(articleId)?.() ?? null;
        if (!sourceElement) {
            console.warn("[editor-preview-mirror] source missing", { articleId, title });
            setHasMirror(false);
            return;
        }

        const mirrorClone = createEditorPreviewMirrorClone(sourceElement);
        mirrorHost.appendChild(mirrorClone);
        setHasMirror(true);

        window.requestAnimationFrame(() => {
            copyScrollableOffsets(sourceElement, mirrorClone);
        });

        return () => {
            mirrorHost.innerHTML = "";
        };
    }, [articleId, title]);

    return (
        <div
            className="cm-editor-preview-mirror"
            data-editor-preview-mirror="true"
            data-editor-preview-article-id={articleId}
            aria-hidden="true"
        >
            <div className="cm-editor-preview-mirror__host" ref={mirrorHostRef} />
            {!hasMirror ? (
                <div className="cm-editor-preview-mirror__fallback">
                    Preview: {title}
                </div>
            ) : null}
        </div>
    );
}