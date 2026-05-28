/**
 * @module plugins/markdown-codemirror/editor/CodeMirrorEditorPreviewMirror
 * @description 为 workbench split preview 提供 CodeMirror 编辑器 DOM 镜像。
 *   模块只复制现有 editor DOM，不创建新的 EditorView，避免预分区阶段重复挂载重型编辑器。
 *
 * @dependencies
 *   - react
 *   - CodeMirrorEditorPreviewMirror.css
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
import {
    copyScrollableOffsets,
    createEditorPreviewMirrorClone,
} from "./editorPreviewMirrorDom";
import "./CodeMirrorEditorPreviewMirror.css";

type EditorPreviewSourceGetter = () => HTMLElement | null;

const EDITOR_PREVIEW_SNAPSHOT_CACHE_LIMIT = 128;
const editorPreviewSources = new Map<string, EditorPreviewSourceGetter>();
const editorPreviewSnapshotCache = new Map<string, HTMLElement>();

/**
 * @function cacheEditorPreviewSnapshot
 * @description 缓存指定 editor 的最近一次可见 DOM 镜像，供 inactive tab 在预览阶段复用。
 * @param articleId editor tab 对应的文章标识。
 * @param source 源 editor 根 DOM。
 * @returns void。
 */
function cacheEditorPreviewSnapshot(articleId: string, source: HTMLElement): void {
    editorPreviewSnapshotCache.delete(articleId);
    editorPreviewSnapshotCache.set(articleId, createEditorPreviewMirrorClone(source));

    while (editorPreviewSnapshotCache.size > EDITOR_PREVIEW_SNAPSHOT_CACHE_LIMIT) {
        const oldestArticleId = editorPreviewSnapshotCache.keys().next().value;
        if (typeof oldestArticleId !== "string") {
            return;
        }
        editorPreviewSnapshotCache.delete(oldestArticleId);
    }
}

/**
 * @function cloneCachedEditorPreviewSnapshot
 * @description 克隆缓存中的 editor DOM 镜像，避免 preview 直接复用同一个 DOM 节点。
 * @param articleId editor tab 对应的文章标识。
 * @returns 缓存存在时返回新的 DOM 克隆，否则返回 null。
 */
function cloneCachedEditorPreviewSnapshot(articleId: string): HTMLElement | null {
    const snapshot = editorPreviewSnapshotCache.get(articleId) ?? null;
    if (!snapshot) {
        return null;
    }

    const clone = snapshot.cloneNode(true) as HTMLElement;
    copyScrollableOffsets(snapshot, clone);
    return clone;
}

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
    const sourceElement = getSourceElement();
    if (sourceElement) {
        cacheEditorPreviewSnapshot(articleId, sourceElement);
    }
    console.debug("[editor-preview-mirror] source registered", { articleId });

    return () => {
        const sourceElement = getSourceElement();
        if (sourceElement) {
            cacheEditorPreviewSnapshot(articleId, sourceElement);
        }

        if (editorPreviewSources.get(articleId) === getSourceElement) {
            editorPreviewSources.delete(articleId);
            console.debug("[editor-preview-mirror] source unregistered", { articleId });
        }
    };
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
        let mirrorClone: HTMLElement | null = null;
        if (!sourceElement) {
            mirrorClone = cloneCachedEditorPreviewSnapshot(articleId);
            if (!mirrorClone) {
                console.warn("[editor-preview-mirror] source missing", { articleId, title });
                setHasMirror(false);
                return;
            }
        } else {
            mirrorClone = createEditorPreviewMirrorClone(sourceElement);
            cacheEditorPreviewSnapshot(articleId, sourceElement);
        }

        mirrorHost.appendChild(mirrorClone);
        setHasMirror(true);

        if (sourceElement) {
            window.requestAnimationFrame(() => {
                copyScrollableOffsets(sourceElement, mirrorClone);
                cacheEditorPreviewSnapshot(articleId, sourceElement);
            });
        }

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
