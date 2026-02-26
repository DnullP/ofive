/**
 * @module layout/OutlinePanel
 * @description 文章大纲面板：监听全局聚焦文章状态，并实时解析 Markdown 标题。
 * @dependencies
 *  - react
 *  - ../store/editorContextStore
 */

import { useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useFocusedArticle } from "../store/editorContextStore";
import "./OutlinePanel.css";

/**
 * @interface HeadingItem
 * @description 标题项结构。
 */
interface HeadingItem {
    level: number;
    text: string;
    line: number;
}

/**
 * @function parseMarkdownHeadings
 * @description 解析 Markdown 内容中的标题。
 * @param content Markdown 文本。
 * @returns 标题数组。
 */
function parseMarkdownHeadings(content: string): HeadingItem[] {
    const lines = content.split("\n");
    const results: HeadingItem[] = [];

    lines.forEach((line, index) => {
        const matched = line.match(/^(#{1,6})\s+(.+)$/);
        if (!matched) {
            return;
        }

        const hashes = matched[1] ?? "#";
        const headingText = (matched[2] ?? "").trim();
        if (!headingText) {
            return;
        }

        results.push({
            level: Math.min(6, Math.max(1, hashes.length)),
            text: headingText,
            line: index + 1,
        });
    });

    return results;
}

/**
 * @function OutlinePanel
 * @description 渲染当前聚焦文章的大纲。
 * @returns 大纲面板视图。
 */
export function OutlinePanel(): ReactNode {
    const { t } = useTranslation();
    const focusedArticle = useFocusedArticle();

    const headings = useMemo(() => {
        if (!focusedArticle) {
            return [];
        }
        return parseMarkdownHeadings(focusedArticle.content);
    }, [focusedArticle]);

    if (!focusedArticle) {
        return (
            <div className="outline-panel">
                <div className="outline-panel-header">{t("outline.noFocusedArticle")}</div>
                <div className="outline-empty">{t("outline.focusArticleHint")}</div>
            </div>
        );
    }

    return (
        <div className="outline-panel">
            <div className="outline-panel-header">{focusedArticle.path}</div>
            {headings.length === 0 ? (
                <div className="outline-empty">{t("outline.noHeadings")}</div>
            ) : (
                <ul className="outline-list">
                    {headings.map((heading) => (
                        <li key={`${String(heading.line)}-${heading.text}`}>
                            <button
                                type="button"
                                className="outline-item"
                                style={{ paddingLeft: `${String((heading.level - 1) * 14 + 8)}px` }}
                                title={t("outline.lineNumber", { line: String(heading.line) })}
                            >
                                {heading.text}
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </div>
    );
}
